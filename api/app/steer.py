"""Steering: likes and "less like this" votes on rendered songs bend the station's tag weights (and its style line)."""
from __future__ import annotations

import copy
from collections import defaultdict
from typing import Any

from . import profile as prof

LIKE_GAIN, DISLIKE_GAIN = 0.35, 0.35
MAX_VOTES = 30


def steer(profile: dict[str, Any], liked: list[dict[str, Any]], disliked: list[dict[str, Any]]) -> dict[str, Any]:
    """profile = build_profile output; liked/disliked = CLAP tag dicts ({cat: [{label, p}]}) of voted songs.
    Returns a NEW profile whose tag weights moved toward liked sounds and away from disliked ones (never below 0),
    with the style line and the instrumental flag recomputed. Seeds stay the anchor: gains are fractions of a vote's p."""
    if not liked and not disliked:
        return profile
    out = copy.deepcopy(profile)
    tags = out.get("tags") or {}
    for cat in prof.TAG_CATEGORIES:
        acc: dict[str, float] = defaultdict(float)
        for t in tags.get(cat) or []:
            acc[t["label"]] += float(t["weight"])
        for votes, gain in ((liked[-MAX_VOTES:], LIKE_GAIN), (disliked[-MAX_VOTES:], -DISLIKE_GAIN)):
            if not votes:
                continue
            for v in votes:
                for t in (v or {}).get(cat) or []:
                    acc[t["label"]] += gain * float(t.get("p", 0.0)) / len(votes)
        ranked = sorted(((l, w) for l, w in acc.items() if w > 0.01), key=lambda kv: -kv[1])[: prof.TOP_PER_CATEGORY.get(cat, 3)]
        tags[cat] = [{"label": l, "weight": round(w, 4)} for l, w in ranked]
    out["tags"] = tags
    out["instrumental"] = prof.is_instrumental(tags)
    out["style"] = prof.style_line(tags, out.get("bpm"), language=out.get("language", "English"))[: prof.abclib.MAX_STYLE_CHARS]
    out["steered"] = {"likes": len(liked), "dislikes": len(disliked)}
    return out
