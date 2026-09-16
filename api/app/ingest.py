"""Seed ingest: a file the user uploaded, or a link clipgrab (yt-dlp) fetches as audio. Audio is kept on disk."""
from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path
from typing import Any, Optional

import httpx

from . import config
from .abc import MusicError

URL_RE = re.compile(r"^https?://", re.I)
AUDIO_EXT = {"audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/flac": "flac", "audio/x-flac": "flac",
             "audio/wav": "wav", "audio/x-wav": "wav", "audio/ogg": "ogg", "audio/webm": "webm", "video/mp4": "mp4"}


def is_url(text: str) -> bool:
    return bool(URL_RE.match((text or "").strip()))


def ext_for(filename: str, content_type: Optional[str]) -> str:
    suffix = Path(filename or "").suffix.lstrip(".").lower()
    if suffix and len(suffix) <= 5:
        return suffix
    return AUDIO_EXT.get((content_type or "").split(";")[0].strip(), "bin")


def probe_seconds(path: Path) -> Optional[float]:
    try:
        out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", str(path)],
                             capture_output=True, text=True, timeout=30, check=True).stdout
        return round(float(json.loads(out)["format"]["duration"]), 2)
    except Exception:
        return None


async def fetch_link(url: str, *, client: Optional[httpx.AsyncClient] = None) -> tuple[bytes, dict[str, Any]]:
    """clipgrab: /info for the title, /clip audio_only for the sound (m4a)."""
    own = client is None
    client = client or httpx.AsyncClient(timeout=httpx.Timeout(600.0, connect=10.0))
    try:
        info: dict[str, Any] = {}
        try:
            r = await client.get(f"{config.CLIPGRAB_URL}/info", params={"url": url})
            if r.status_code == 200:
                info = r.json()
        except httpx.HTTPError:
            pass
        r = await client.post(f"{config.CLIPGRAB_URL}/clip", json={"url": url, "audio_only": True})
        if r.status_code != 200:
            raise MusicError(f"clipgrab {r.status_code}: {r.text[:200]}")
        return r.content, {"title": info.get("title") or url, "uploader": info.get("uploader"), "duration": info.get("duration"), "source": url}
    finally:
        if own:
            await client.aclose()


def save_seed_audio(library: Path, seed_id: str, data: bytes, ext: str) -> Path:
    d = library / "seeds"
    d.mkdir(parents=True, exist_ok=True)
    p = d / f"{seed_id}.{ext}"
    p.write_bytes(data)
    return p
