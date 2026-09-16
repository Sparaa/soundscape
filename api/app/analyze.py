"""SheetSage2 + CLAP analysis of a seed (the sidecar's async job API)."""
from __future__ import annotations

import asyncio
import base64
from typing import Any, Optional

import httpx

from . import config
from .abc import MusicError, promote_sparse_vocals

ANALYSIS_KEYS = ("abc", "abc_error", "warnings", "seconds", "key", "bpm", "bars", "sections", "tags", "style_guess", "timing")


async def transcribe(audio: bytes, *, name: str = "", language: str = "English", client: Optional[httpx.AsyncClient] = None,
                     poll_s: float = 2.0, timeout_s: float = 900.0) -> dict[str, Any]:
    own = client is None
    client = client or httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=10.0))
    try:
        r = await client.post(f"{config.SHEETSAGE_URL}/transcribe",
                              json={"audio_b64": base64.b64encode(audio).decode(), "name": name[:120], "melody_only": False,
                                    "language": language, "describe": True})
        if r.status_code != 200:
            raise MusicError(f"sheetsage {r.status_code}: {r.text[:200]}")
        job_id = r.json()["job_id"]
        waited = 0.0
        while True:
            s = (await client.get(f"{config.SHEETSAGE_URL}/jobs/{job_id}")).json()
            if s.get("state") == "done":
                break
            if s.get("state") == "error":
                raise MusicError(f"transcription failed: {s.get('error')}")
            await asyncio.sleep(poll_s)
            waited += poll_s
            if waited > timeout_s:
                raise MusicError("transcription timed out")
        out = {k: s.get(k) for k in ANALYSIS_KEYS}
        out["promoted_sections"] = promote_sparse_vocals(out["abc"])[1] if out.get("abc") else []
        return out
    finally:
        if own:
            await client.aclose()
