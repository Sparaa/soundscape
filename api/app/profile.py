"""StationProfile — what the agent composes FROM. Pure functions over seed analyses (SheetSage2 + CLAP output)."""
from __future__ import annotations

import statistics
from collections import Counter, defaultdict
from typing import Any

from . import abc as abclib

TAG_CATEGORIES = ("genre", "mood", "instruments", "vocal", "voice", "production")
TOP_PER_CATEGORY = {"genre": 3, "mood": 3, "instruments": 4, "vocal": 1, "voice": 2, "production": 2}
BPM_BAND = 0.08          # ± around the seeds' BPM range
INSTRUMENTAL_LABEL = "instrumental music without vocals"


def merge_tags(analyses: list[dict[str, Any]]) -> dict[str, list[dict[str, float]]]:
    """Per category: mean probability of each label across seeds (absent = 0), top-k, sorted."""
    out: dict[str, list[dict[str, float]]] = {}
    n = max(1, len(analyses))
    for cat in TAG_CATEGORIES:
        acc: dict[str, float] = defaultdict(float)
        for a in analyses:
            for t in ((a.get("tags") or {}).get(cat) or []):
                acc[t["label"]] += float(t.get("p", 0.0)) / n
        ranked = sorted(acc.items(), key=lambda kv: -kv[1])[: TOP_PER_CATEGORY.get(cat, 3)]
        out[cat] = [{"label": l, "weight": round(w, 4)} for l, w in ranked if w > 0]
    return out


def bpm_band(analyses: list[dict[str, Any]]) -> dict[str, float] | None:
    bpms = [float(a["bpm"]) for a in analyses if a.get("bpm")]
    if not bpms:
        return None
    lo, hi = min(bpms), max(bpms)
    return {"low": round(lo * (1 - BPM_BAND)), "high": round(hi * (1 + BPM_BAND)), "center": round(statistics.median(bpms))}


def section_grammar(analyses: list[dict[str, Any]]) -> list[str]:
    """The most common section sequence among the seeds (ties → the longest)."""
    seqs = [tuple(s.lower() for s in (a.get("sections") or [])) for a in analyses]
    seqs = [s for s in seqs if s]
    if not seqs:
        return ["intro", "verse", "chorus", "verse", "chorus", "bridge", "chorus", "outro"]
    best = Counter(seqs).most_common()
    top_n = best[0][1]
    return list(max((s for s, c in best if c == top_n), key=len))


def phrase_shapes(analyses: list[dict[str, Any]]) -> dict[str, list[int]]:
    """Per base section label (verse/chorus/bridge…): the median line-syllable pattern across seeds."""
    per_label: dict[str, list[list[int]]] = defaultdict(list)
    for a in analyses:
        if not a.get("abc"):
            continue
        promoted, _ = abclib.promote_sparse_vocals(a["abc"])
        for label, counts in abclib.vocal_phrases(promoted or a["abc"]).items():
            base = label.rsplit(" ", 1)[0] if label[-1:].isdigit() else label
            per_label[base].append(counts)
    out: dict[str, list[int]] = {}
    for base, shapes in per_label.items():
        lines = int(statistics.median(len(s) for s in shapes))
        out[base] = [int(statistics.median(s[i] for s in shapes if len(s) > i)) for i in range(lines)]
    return out


def is_instrumental(tags: dict[str, list[dict[str, float]]]) -> bool:
    vocal = tags.get("vocal") or []
    return bool(vocal) and vocal[0]["label"] == INSTRUMENTAL_LABEL


def style_line(tags: dict[str, list[dict[str, float]]], bpm: dict[str, float] | None, *, language: str = "English") -> str:
    """A YuE2 style line from the merged tags: language, genre(s), mood, instruments, vocal, production, BPM."""
    parts = [language]
    genres = [t["label"] for t in tags.get("genre", [])]
    if genres:
        parts.append(genres[0] + (f" with {genres[1]} touches" if len(genres) > 1 and tags["genre"][1]["weight"] >= 0.25 * tags["genre"][0]["weight"] else ""))
    parts += [t["label"] for t in tags.get("mood", [])[:2]]
    parts += [t["label"] for t in tags.get("instruments", [])[:4]]
    vocal = tags.get("vocal") or []
    if vocal and vocal[0]["label"] != INSTRUMENTAL_LABEL:
        voice = [t["label"] for t in tags.get("voice", [])[:1]]
        parts.append(" ".join(voice + [vocal[0]["label"]]))
    elif vocal:
        parts.append("instrumental")
    parts += [t["label"] for t in tags.get("production", [])[:1]]
    if bpm:
        parts.append(f"{int(bpm['center'])} BPM")
    return ", ".join(p for p in parts if p)


def build_profile(analyses: list[dict[str, Any]], *, language: str = "English") -> dict[str, Any]:
    tags = merge_tags(analyses)
    bpm = bpm_band(analyses)
    keys = sorted({a["key"] for a in analyses if a.get("key")})
    return {
        "seeds": len(analyses),
        "tags": tags,
        "bpm": bpm,
        "keys": keys,
        "sections": section_grammar(analyses),
        "phrases": phrase_shapes(analyses),
        "instrumental": is_instrumental(tags),
        "language": language,
        "style": style_line(tags, bpm, language=language)[: abclib.MAX_STYLE_CHARS],
        "seconds": round(statistics.median(float(a["seconds"]) for a in analyses if a.get("seconds")), 1) if any(a.get("seconds") for a in analyses) else None,
    }
