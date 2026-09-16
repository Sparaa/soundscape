"""Quality gate for a rendered track: length, loudness/silence, and sound similarity to the station (CLAP tags)."""
from __future__ import annotations

import json
import math
import re
import subprocess
from pathlib import Path
from typing import Any, Optional

MIN_SECONDS, MAX_SECONDS = 45.0, 420.0
MIN_MEAN_DB, MIN_MAX_DB = -35.0, -20.0
MIN_SIMILARITY = 0.30


def ffprobe_seconds(path: Path) -> Optional[float]:
    try:
        out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", str(path)],
                             capture_output=True, text=True, timeout=60, check=True).stdout
        return float(json.loads(out)["format"]["duration"])
    except Exception:
        return None


def loudness(path: Path) -> tuple[Optional[float], Optional[float]]:
    """(mean_dB, max_dB) via ffmpeg volumedetect."""
    try:
        err = subprocess.run(["ffmpeg", "-v", "info", "-i", str(path), "-af", "volumedetect", "-f", "null", "-"],
                             capture_output=True, text=True, timeout=120).stderr
        mean = re.search(r"mean_volume:\s*(-?[\d.]+) dB", err)
        mx = re.search(r"max_volume:\s*(-?[\d.]+) dB", err)
        return (float(mean.group(1)) if mean else None, float(mx.group(1)) if mx else None)
    except Exception:
        return None, None


def tag_vector(tags: dict[str, Any] | None, weight_key: str) -> dict[str, float]:
    v: dict[str, float] = {}
    for cat, items in (tags or {}).items():
        for t in items or []:
            v[f"{cat}:{t['label']}"] = float(t.get(weight_key, 0.0))
    return v


def similarity(profile_tags: dict[str, Any] | None, render_tags: dict[str, Any] | None) -> Optional[float]:
    """Cosine between the station's weighted tags and the render's CLAP tag probabilities (None = no data)."""
    a, b = tag_vector(profile_tags, "weight"), tag_vector(render_tags, "p")
    if not a or not b:
        return None
    dot = sum(a[k] * b.get(k, 0.0) for k in a)
    na, nb = math.sqrt(sum(x * x for x in a.values())), math.sqrt(sum(x * x for x in b.values()))
    return round(dot / (na * nb), 3) if na and nb else 0.0


def check(path: Path, *, profile_tags: dict[str, Any] | None = None, render_tags: dict[str, Any] | None = None,
          seconds: Optional[float] = None, mean_db: Optional[float] = None, max_db: Optional[float] = None) -> dict[str, Any]:
    """{ok, reasons, seconds, mean_db, max_db, similarity}. Pass measurements to skip the ffmpeg calls (tests)."""
    seconds = seconds if seconds is not None else ffprobe_seconds(path)
    if mean_db is None and max_db is None:
        mean_db, max_db = loudness(path)
    reasons: list[str] = []
    if seconds is None:
        reasons.append("unreadable audio")
    elif seconds < MIN_SECONDS:
        reasons.append(f"too short ({seconds:.0f} s)")
    elif seconds > MAX_SECONDS:
        reasons.append(f"too long ({seconds:.0f} s)")
    if mean_db is not None and mean_db < MIN_MEAN_DB:
        reasons.append(f"too quiet (mean {mean_db:.0f} dB)")
    if max_db is not None and max_db < MIN_MAX_DB:
        reasons.append(f"near-silent (peak {max_db:.0f} dB)")
    sim = similarity(profile_tags, render_tags)
    if sim is not None and sim < MIN_SIMILARITY:
        reasons.append(f"does not sound like the station (similarity {sim:.2f})")
    return {"ok": not reasons, "reasons": reasons, "seconds": seconds, "mean_db": mean_db, "max_db": max_db, "similarity": sim}
