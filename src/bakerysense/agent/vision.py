"""Multimodal vision path: display-case photo → per-SKU remaining-unit counts.

Gemma 4 ships with a vision tower. We send an image plus a focused prompt and
ask Gemma to return strict JSON mapping SKU names to integer counts. The
numeric result then flows into ``decision.markdown`` / ``suggest_markdowns``
like any other structured tool output.

The image is passed via OpenAI-compatible ``messages[].content`` list entries
with ``type: "image_url"``. Both Ollama and llama-cpp-python (with a loaded
mmproj projector) honour this shape.
"""

from __future__ import annotations

import base64
import json
import mimetypes
import re
from dataclasses import dataclass
from pathlib import Path

from bakerysense.agent.server import GemmaServer


_PROMPT_TEMPLATE = """\
You are looking at a photo of a bakery display case.
Count the remaining units of each product visible in the photo.
The known product catalogue for this bakery is:

{sku_list}

Return ONLY a single JSON object mapping SKU name to integer unit count.
- Use exactly the SKU names listed above; do not invent new ones.
- Omit SKUs that are not visible in the photo.
- Do not include explanations, markdown code fences, or any text outside the JSON.

Example valid response:
{{"croissant": 6, "baguette": 3}}
"""


@dataclass
class PhotoCountResult:
    path: str
    counts: dict[str, int]
    raw_response: str

    def to_dict(self) -> dict:
        return {"path": self.path, "counts": self.counts}


def _encode_image_data_url(image_path: Path) -> str:
    mime, _ = mimetypes.guess_type(str(image_path))
    if not mime or not mime.startswith("image/"):
        mime = "image/jpeg"
    data = base64.b64encode(image_path.read_bytes()).decode("ascii")
    return f"data:{mime};base64,{data}"


def _extract_json(text: str) -> dict:
    """Pull the first top-level JSON object out of the model's response.

    Gemma should obey the instruction to return bare JSON, but we defensively
    strip code fences and surrounding prose if it doesn't.
    """
    cleaned = text.strip()
    # strip ``` fences
    cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
    cleaned = re.sub(r"\s*```$", "", cleaned)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass
    match = re.search(r"\{[^{}]*\}", cleaned, re.DOTALL)
    if match:
        return json.loads(match.group(0))
    raise ValueError(f"Could not parse JSON from model output: {text!r}")


def count_units_from_photo(
    server: GemmaServer,
    image_path: str | Path,
    known_skus: list[str],
) -> PhotoCountResult:
    """Ask Gemma to count visible SKUs in ``image_path``.

    ``known_skus`` restricts the allowed keys so noise / hallucinations are
    filtered before the result reaches the decision layer.
    """
    path = Path(image_path).expanduser().resolve()
    if not path.exists():
        raise FileNotFoundError(f"Image not found: {path}")

    data_url = _encode_image_data_url(path)
    prompt = _PROMPT_TEMPLATE.format(sku_list="\n".join(f"- {s}" for s in known_skus))

    messages = [
        {
            "role": "user",
            "content": [
                {"type": "text", "text": prompt},
                {"type": "image_url", "image_url": {"url": data_url}},
            ],
        }
    ]
    response = server.chat(messages=messages)
    text = response["choices"][0]["message"].get("content") or ""
    parsed = _extract_json(text)

    # coerce + whitelist against known_skus
    allowed = set(known_skus)
    counts: dict[str, int] = {}
    for k, v in parsed.items():
        if k in allowed:
            try:
                counts[k] = int(v)
            except (TypeError, ValueError):
                continue
    return PhotoCountResult(path=str(path), counts=counts, raw_response=text)
