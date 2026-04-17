"""Model backends for the agent.

Two interchangeable backends, selected by ``BAKERYSENSE_BACKEND``:

* ``llamacpp`` (default) — in-process via ``llama-cpp-python`` loading a GGUF
  from a local path or a HuggingFace repo.
* ``ollama`` — HTTP to a running Ollama daemon's OpenAI-compatible endpoint.

Both return identical OpenAI-format chat-completion responses so the rest of
the codebase (``session.py``, ``tools.py``) is unchanged.

Environment variables (all optional):

    BAKERYSENSE_BACKEND          'llamacpp' (default) or 'ollama'
    BAKERYSENSE_MODEL_PATH       llamacpp: absolute path to a .gguf file
    BAKERYSENSE_MODEL_REPO       llamacpp: HuggingFace repo id
    BAKERYSENSE_MODEL_FILE       llamacpp: GGUF filename pattern
    BAKERYSENSE_N_CTX            llamacpp: context window (default 8192)
    BAKERYSENSE_N_GPU_LAYERS     llamacpp: layers on GPU (default -1 = all)
    BAKERYSENSE_CHAT_FORMAT      llamacpp: chat-template override
    BAKERYSENSE_OLLAMA_MODEL     ollama: model tag, e.g. 'gemma4:e4b' or 'qwen3-vl:8b'
    BAKERYSENSE_OLLAMA_URL       ollama: base URL (default http://localhost:11434)
    BAKERYSENSE_TEMPERATURE      both:   sampling temperature (default 0.2)
    BAKERYSENSE_MAX_TOKENS       both:   completion cap (default 512)
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any


DEFAULT_REPO = "ggml-org/gemma-4-E4B-it-GGUF"
DEFAULT_FILE = "*Q4_K_M*"
DEFAULT_OLLAMA_MODEL = "gemma4:e4b-it-q4_K_M"  # Ollama tag for Gemma 4 E4B Q4_K_M
DEFAULT_OLLAMA_URL = "http://localhost:11434"


@dataclass
class ModelConfig:
    backend: str = "llamacpp"
    # llama-cpp-python settings
    repo_id: str = DEFAULT_REPO
    filename: str = DEFAULT_FILE
    model_path: str | None = None
    n_ctx: int = 8192
    n_gpu_layers: int = -1
    chat_format: str | None = None
    # Ollama settings
    ollama_model: str = DEFAULT_OLLAMA_MODEL
    ollama_url: str = DEFAULT_OLLAMA_URL
    # Shared
    temperature: float = 0.2
    max_tokens: int = 512
    verbose: bool = False

    @classmethod
    def from_env(cls) -> "ModelConfig":
        return cls(
            backend=os.getenv("BAKERYSENSE_BACKEND", "llamacpp").lower(),
            repo_id=os.getenv("BAKERYSENSE_MODEL_REPO", DEFAULT_REPO),
            filename=os.getenv("BAKERYSENSE_MODEL_FILE", DEFAULT_FILE),
            model_path=os.getenv("BAKERYSENSE_MODEL_PATH") or None,
            n_ctx=int(os.getenv("BAKERYSENSE_N_CTX", "8192")),
            n_gpu_layers=int(os.getenv("BAKERYSENSE_N_GPU_LAYERS", "-1")),
            chat_format=os.getenv("BAKERYSENSE_CHAT_FORMAT") or None,
            ollama_model=os.getenv("BAKERYSENSE_OLLAMA_MODEL", DEFAULT_OLLAMA_MODEL),
            ollama_url=os.getenv("BAKERYSENSE_OLLAMA_URL", DEFAULT_OLLAMA_URL),
            temperature=float(os.getenv("BAKERYSENSE_TEMPERATURE", "0.2")),
            max_tokens=int(os.getenv("BAKERYSENSE_MAX_TOKENS", "512")),
            verbose=os.getenv("BAKERYSENSE_VERBOSE", "0") not in ("0", "", "false", "False"),
        )

    def describe(self) -> str:
        if self.backend == "ollama":
            return f"ollama:{self.ollama_model} @ {self.ollama_url}"
        if self.model_path:
            return f"llamacpp:local:{self.model_path}"
        return f"llamacpp:hf:{self.repo_id}/{self.filename}"


# ====================================================== llama-cpp-python backend
class _LlamaCppBackend:
    def __init__(self, config: ModelConfig) -> None:
        try:
            from llama_cpp import Llama  # type: ignore
        except ImportError as e:
            raise RuntimeError(
                "llama-cpp-python is not installed. Install with:\n"
                "    uv pip install -e '.[agent]'\n"
                "or switch backends: BAKERYSENSE_BACKEND=ollama"
            ) from e

        common: dict[str, Any] = dict(
            n_ctx=config.n_ctx,
            n_gpu_layers=config.n_gpu_layers,
            verbose=config.verbose,
        )
        if config.chat_format:
            common["chat_format"] = config.chat_format

        if config.model_path:
            path = Path(config.model_path).expanduser()
            if not path.exists():
                raise FileNotFoundError(
                    f"BAKERYSENSE_MODEL_PATH points to a missing file: {path}"
                )
            self._llm = Llama(model_path=str(path), **common)
        else:
            self._llm = Llama.from_pretrained(
                repo_id=config.repo_id,
                filename=config.filename,
                **common,
            )
        self._config = config

    def chat(self, messages: list[dict], tools: list[dict] | None, tool_choice: str) -> dict:
        kwargs: dict[str, Any] = dict(
            messages=messages,
            temperature=self._config.temperature,
            max_tokens=self._config.max_tokens,
        )
        if tools:
            kwargs["tools"] = tools
            kwargs["tool_choice"] = tool_choice
        return self._llm.create_chat_completion(**kwargs)


# =============================================================== Ollama backend
class _OllamaBackend:
    def __init__(self, config: ModelConfig) -> None:
        try:
            import httpx  # type: ignore
        except ImportError as e:
            raise RuntimeError(
                "httpx is required for the Ollama backend. Install with:\n"
                "    uv pip install httpx"
            ) from e

        self._httpx = httpx
        self._config = config
        timeout_s = float(os.getenv("BAKERYSENSE_OLLAMA_TIMEOUT", "600"))
        self._client = httpx.Client(
            base_url=config.ollama_url.rstrip("/"),
            timeout=httpx.Timeout(timeout_s, connect=10.0),
        )
        # sanity check — surface clear error if daemon isn't up
        try:
            self._client.get("/api/tags").raise_for_status()
        except Exception as e:
            raise RuntimeError(
                f"Could not reach Ollama at {config.ollama_url}. "
                "Start it with `ollama serve` or set BAKERYSENSE_OLLAMA_URL."
            ) from e

    def chat(self, messages: list[dict], tools: list[dict] | None, tool_choice: str) -> dict:
        body: dict[str, Any] = {
            "model": self._config.ollama_model,
            "messages": messages,
            "temperature": self._config.temperature,
            "max_tokens": self._config.max_tokens,
            "stream": False,
        }
        if tools:
            body["tools"] = tools
            # Ollama's OpenAI endpoint honours tool_choice only for some models;
            # omitting keeps behaviour model-default.
            if tool_choice and tool_choice != "auto":
                body["tool_choice"] = tool_choice

        response = self._client.post("/v1/chat/completions", json=body)
        if response.status_code != 200:
            raise RuntimeError(f"Ollama error {response.status_code}: {response.text}")
        return response.json()


# ===================================================================== facade
class GemmaServer:
    """Lightweight wrapper. Loads lazily so tests can import without the model."""

    def __init__(self, config: ModelConfig | None = None) -> None:
        self.config = config or ModelConfig.from_env()
        self._backend: _LlamaCppBackend | _OllamaBackend | None = None

    def load(self) -> None:
        if self._backend is not None:
            return
        if self.config.backend == "ollama":
            self._backend = _OllamaBackend(self.config)
        elif self.config.backend == "llamacpp":
            self._backend = _LlamaCppBackend(self.config)
        else:
            raise ValueError(
                f"Unknown BAKERYSENSE_BACKEND={self.config.backend!r}. "
                f"Use 'llamacpp' or 'ollama'."
            )

    def chat(
        self,
        messages: list[dict],
        tools: list[dict] | None = None,
        tool_choice: str = "auto",
    ) -> dict:
        if self._backend is None:
            self.load()
        assert self._backend is not None
        return self._backend.chat(messages, tools=tools, tool_choice=tool_choice)
