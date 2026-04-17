"""Vision module — JSON parsing robustness (no model required)."""

from __future__ import annotations

import pytest

from bakerysense.agent.vision import _extract_json


def test_extract_bare_json():
    out = _extract_json('{"croissant": 6, "baguette": 3}')
    assert out == {"croissant": 6, "baguette": 3}


def test_extract_json_with_code_fence():
    out = _extract_json('```json\n{"croissant": 4}\n```')
    assert out == {"croissant": 4}


def test_extract_json_with_unmarked_fence():
    out = _extract_json('```\n{"baguette": 10}\n```')
    assert out == {"baguette": 10}


def test_extract_json_with_leading_prose():
    out = _extract_json('Sure, here are the counts: {"croissant": 2}')
    assert out == {"croissant": 2}


def test_extract_json_rejects_pure_prose():
    with pytest.raises(ValueError):
        _extract_json("I cannot see any products.")
