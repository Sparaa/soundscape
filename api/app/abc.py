"""ABC score helpers shared by the analysis, the agent and the writer.

Ported from vidmakr's ai/app/music.py (same author, Apache-2.0 here): the YuE2/SheetSage2 ABC dialect — `% label`
sections, `V: Vocal` / `V: Ins` voices, quoted chord symbols — plus the lyric-fitting tools: beat-aware phrase
shapes, repeated-section indexing, sparse-vocal promotion (the tune filed under the instrument line gets sung),
key/BPM facts and the writer's JSON parser."""
from __future__ import annotations

import json
import re
from typing import Any, Optional

MAX_STYLE_CHARS = 400
MAX_LYRIC_CHARS = 6000
MAX_ABC_CHARS = 60000
MAX_LYRICS_CHARS = MAX_LYRIC_CHARS


class MusicError(RuntimeError):
    pass


def tidy_lyrics(raw: str) -> str:
    """Normalise newlines, bracket bare section headers ("Chorus:" -> "[Chorus]"),
    collapse blank runs, and prepend [Verse] when no tag exists — the same
    rules the sidecar applies, so what the card stores is what it sang."""
    text = (raw or "").replace("\r\n", "\n").replace("\r", "\n")
    lines: list[str] = []
    for line in text.split("\n"):
        line = line.strip()
        if line[:1] == "[" and line[-1:] == "]":
            line = "[" + line[1:-1].strip().title() + "]"
        elif line.endswith(":") and len(line) <= 24 and line[:-1].replace(" ", "").isalnum():
            line = "[" + line[:-1].strip().title() + "]"
        lines.append(line)
    out: list[str] = []
    for line in lines:
        if line == "" and (not out or out[-1] == ""):
            continue
        out.append(line)
    while out and out[-1] == "":
        out.pop()
    text = "\n".join(out)
    if text and not any(l.startswith("[") and l.endswith("]") for l in out):
        text = "[Verse]\n" + text
    return text


MAX_ABC_CHARS = 60000
MAX_LYRICS_CHARS = MAX_LYRIC_CHARS
LONG_DEFAULTS: dict[str, Any] = {"max_lines_per_chunk": 24, "overlap_chorus": False,
                                 "crossfade_ms": 4000.0, "trim_start_s": 1.5, "trim_end_s": 2.5}


COVER_MODES = ("faithful", "reinterpret", "inspired", "hook")
COVER_MODE_LABELS = {"faithful": "faithful cover", "reinterpret": "reinterpretation",
                     "inspired": "inspired by", "hook": "hook only"}
_CHORD_RE = re.compile(r'"[^"]*"')


def strip_chords(abc: str) -> str:
    """Drop chord symbols from music lines (V: definitions keep their names)."""
    out = []
    for line in (abc or "").splitlines():
        out.append(line if re.match(r"^[A-Za-z]:", line) else _CHORD_RE.sub("", line))
    return "\n".join(out) + ("\n" if (abc or "").endswith("\n") else "")


def style_with_key_bpm(style: str, facts: dict[str, Any]) -> str:
    """Append the source's key and tempo to a style line that names neither."""
    out = (style or "").rstrip(" ,.")
    low = out.lower()
    if facts.get("key") and " key" not in low and f" {facts['key'].lower()}" not in low:
        out += f", in the key of {facts['key']}"
    if facts.get("bpm") and "bpm" not in low:
        out += f", {facts['bpm']} BPM"
    return out


def validate_abc(abc: Optional[str]) -> Optional[str]:
    """A cover score (SheetSage2 melody-only ABC, possibly hand-edited)."""
    if abc is None:
        return None
    text = abc.replace("\r\n", "\n").replace("\r", "\n").strip()
    if not text:
        return None
    if len(text) > MAX_ABC_CHARS:
        raise ValueError(f"abc exceeds {MAX_ABC_CHARS} characters")
    if not any(ln.startswith("K:") for ln in text.splitlines()):
        raise ValueError("abc needs a K: (key) header")
    return text + "\n"


def strip_headers(abc: str) -> str:
    return "\n".join(l for l in (abc or "").splitlines() if not re.match(r"^[A-Za-z]:", l))


_NOTE_RE = re.compile(r"[_=^]*[A-Ga-g][,']*\d*")
_TOKEN_RE = re.compile(r"\"[^\"]*\"|\[[^\]]*\]|![^!]*!|\{[^}]*\}|\|[:\]]?|:?\||([_=^]*[A-Ga-g][,']*)(\d*)(/\d*)?|([zZxX])(\d*)(/\d*)?|.")
_FRAC_RE = re.compile(r"^\s*(\d+)\s*/\s*(\d+)")
_LYRIC_SECTION_RE = re.compile(r"^(verse|chorus|pre-?chorus|bridge|hook|refrain)", re.I)


def abc_units(abc: Optional[str]) -> tuple[int, int]:
    """(units per beat, units per bar) from L: and M: — L:1/16 M:4/4 → (4, 16).
    A beat is the meter's denominator note (a quarter in 4/4, an eighth in 6/8)."""
    unit = (1, 8)
    meter = (4, 4)
    for raw in (abc or "").splitlines():
        line = raw.strip()
        if line.startswith("L:"):
            m = _FRAC_RE.match(line[2:])
            if m and int(m.group(2)):
                unit = (int(m.group(1)), int(m.group(2)))
        elif line.startswith("M:"):
            body = line[2:].strip()
            if body in ("C", "C|"):
                meter = (4, 4) if body == "C" else (2, 2)
            else:
                m = _FRAC_RE.match(body)
                if m and int(m.group(2)):
                    meter = (int(m.group(1)), int(m.group(2)))
        elif line.startswith("K:"):
            break
    per_beat = max(1, round((unit[1] / meter[1]) / unit[0]))
    return per_beat, max(per_beat, per_beat * meter[0])


def _length(num: str, den: Optional[str]) -> float:
    n = int(num) if num else 1
    if den is None:
        return float(n)
    d = int(den[1:]) if len(den) > 1 else 2
    return n / max(d, 1)


def _music_tokens(line: str, units_per_bar: int) -> list[tuple[str, float]]:
    """A music line → [("note", 1), ("rest", units), ("bar", 0)]; chords,
    decorations and grace notes dropped, ties/slurs ignored (a tied note still
    carries a syllable's worth of pitch for the writer's purposes)."""
    out: list[tuple[str, float]] = []
    for m in _TOKEN_RE.finditer(line):
        tok = m.group(0)
        if m.group(1) is not None:
            out.append(("note", 1.0))
        elif m.group(4) is not None:
            if m.group(4) in "ZX":
                out.append(("rest", float(units_per_bar) * (int(m.group(5)) if m.group(5) else 1)))
            else:
                out.append(("rest", _length(m.group(5), m.group(6))))
        elif tok.startswith("|") or tok.endswith("|"):
            out.append(("bar", 0.0))
    return out


def sections_with_voices(abc: Optional[str]) -> list[tuple[str, dict[str, list[str]]]]:
    """[(label, {"vocal": [music lines], "ins": [music lines]})] in score order
    — the YuE2/SheetSage2 dialect: `% label` sections, `V: Vocal` / `V: Ins`
    groups. Headers before the first section are skipped."""
    out: list[tuple[str, dict[str, list[str]]]] = []
    voice: Optional[str] = None
    for raw in (abc or "").splitlines():
        line = raw.strip()
        if not line:
            continue
        if line.startswith("%"):
            if line.startswith("%%"):
                continue
            out.append((line.lstrip("%").strip().lower(), {"vocal": [], "ins": []}))
            voice = None
            continue
        if line.startswith("V:"):
            voice = "vocal" if "vocal" in line.lower() else "ins"
            continue
        if re.match(r"^[A-Za-z]:", line) or not out:
            continue
        out[-1][1][voice or "vocal"].append(line)
    return out


def indexed_labels(labels: list[str]) -> list[str]:
    """["verse", "chorus", "verse", "chorus"] → ["verse 1", "chorus 1", "verse 2", "chorus 2"]
    (a label that occurs once keeps its bare name)."""
    counts: dict[str, int] = {}
    for l in labels:
        counts[l] = counts.get(l, 0) + 1
    seen: dict[str, int] = {}
    out = []
    for l in labels:
        seen[l] = seen.get(l, 0) + 1
        out.append(f"{l} {seen[l]}" if counts[l] > 1 else l)
    return out


def vocal_phrases(abc: Optional[str], *, min_rest_beats: float = 1.0, min_notes: int = 4,
                  max_notes: int = 12) -> dict[str, list[int]]:
    """Sung notes per lyric line, per section, from the V: Vocal lines — what
    the lyric writer needs to fit syllables: {"verse 1": [7, 8, 6, 5], ...}.
    A phrase ends at a rest of at least `min_rest_beats` (bar-long rests
    included); barlines alone never end one. Phrases longer than `max_notes`
    are re-split at their barlines and regrouped; shorter than `min_notes`
    are merged into their neighbour (2026-09-13: splitting on EVERY rest gave
    the writer 1-4-note "phrases" and one-or-two-word lyric lines)."""
    per_beat, per_bar = abc_units(abc)
    out: dict[str, list[int]] = {}
    secs = sections_with_voices(abc)
    for label, (_, voices) in zip(indexed_labels([l for l, _ in secs]), secs):
        tokens: list[tuple[str, float]] = []
        for line in voices["vocal"]:
            tokens.extend(_music_tokens(line, per_bar))
        # 1) split on long rests
        chunks: list[list[list[int]]] = [[[]]]  # chunks → bars → note counts
        for kind, val in tokens:
            if kind == "note":
                chunks[-1][-1].append(1)
            elif kind == "bar":
                chunks[-1].append([])
            elif val >= min_rest_beats * per_beat:
                chunks.append([[]])
        phrases: list[int] = []
        for bars in chunks:
            counts = [len(b) for b in bars if b]
            total = sum(counts)
            if not total:
                continue
            if total <= max_notes:
                phrases.append(total)
                continue
            # 2) too long for one line: regroup its bars up to max_notes
            acc = 0
            for c in counts:
                if acc and acc + c > max_notes:
                    phrases.append(acc)
                    acc = 0
                acc += c
            if acc:
                phrases.append(acc)
        # 3) merge fragments into a neighbour
        merged: list[int] = []
        for c in phrases:
            if merged and (c < min_notes or merged[-1] < min_notes) and merged[-1] + c <= max_notes + min_notes:
                merged[-1] += c
            else:
                merged.append(c)
        if merged:
            out[label] = merged
    return out


def phrase_hint(phrases: dict[str, list[int]], section_filter=None) -> str:
    """vocal_phrases → one line for the writer: "verse 1: 4 lines of 7, 9, 6, 8
    syllables; chorus (×3): 4 lines of 5, 8, 5, 8 syllables" — repeated
    choruses are shown once (they are sung to the same tune and worded
    verbatim), verses individually."""
    bits = []
    shown_chorus = False
    for label, counts in phrases.items():
        base = re.sub(r"\s+\d+$", "", label)
        if section_filter and not any(w in label for w in section_filter):
            continue
        if base == "chorus":
            if shown_chorus:
                continue
            shown_chorus = True
            n = sum(1 for l in phrases if re.sub(r"\s+\d+$", "", l) == "chorus")
            name = f"chorus (×{n})" if n > 1 else "chorus"
        else:
            name = label
        bits.append(f"{name}: {len(counts)} line{'s' if len(counts) != 1 else ''} of "
                    f"{', '.join(str(c) for c in counts[:16])}{'…' if len(counts) > 16 else ''} syllables")
    return "; ".join(bits)


def promote_sparse_vocals(abc: Optional[str], *, min_notes_per_bar: float = 2.5,
                          ins_ratio: float = 1.4) -> tuple[Optional[str], list[str]]:
    """SheetSage2 sometimes files a section's tune under `V: Ins` and leaves
    `V: Vocal` nearly empty (heavily processed vocals: Death Dealer's choruses
    had 16 sung notes over 16 bars against 92 in the instrument line). YuE2
    sings only the Vocal voice, so such a cover's chorus is a sparse filler
    line. For lyric sections (verse/chorus/bridge/…) whose vocal line is
    thinner than `min_notes_per_bar` while the Ins line has `ins_ratio`× as
    many notes, swap the two voices' music (chord symbols stay on the sung
    line). Returns (abc, ["chorus 1", "chorus 2", …]) — unchanged when nothing
    qualifies."""
    if not abc or not abc.strip():
        return abc, []
    _, per_bar = abc_units(abc)
    lines = abc.splitlines()
    # locate each section's V: groups as (voice, [line indexes])
    groups: list[tuple[str, list[tuple[str, list[int]]]]] = []
    voice: Optional[str] = None
    for i, raw in enumerate(lines):
        line = raw.strip()
        if line.startswith("%") and not line.startswith("%%"):
            groups.append((line.lstrip("%").strip().lower(), []))
            voice = None
            continue
        if line.startswith("V:") and groups:
            voice = "vocal" if "vocal" in line.lower() else "ins"
            groups[-1][1].append((voice, []))
            continue
        if not line or re.match(r"^[A-Za-z]:", line) or not groups or not groups[-1][1]:
            continue
        groups[-1][1][-1][1].append(i)
    promoted: list[str] = []
    labels = indexed_labels([l for l, _ in groups])
    for label, (raw_label, gs) in zip(labels, groups):
        if not _LYRIC_SECTION_RE.match(raw_label):
            continue
        vocal = [idx for v, idxs in gs for idx in idxs if v == "vocal"]
        ins = [idx for v, idxs in gs for idx in idxs if v == "ins"]
        if not vocal or not ins:
            continue
        v_notes = sum(len(_NOTE_RE.findall(_CHORD_RE.sub("", lines[i]))) for i in vocal)
        i_notes = sum(len(_NOTE_RE.findall(_CHORD_RE.sub("", lines[i]))) for i in ins)
        bars = sum(1 for i in vocal for b in _CHORD_RE.sub("", lines[i]).split("|") if b.strip()) or 1
        if v_notes / bars >= min_notes_per_bar or i_notes < ins_ratio * max(v_notes, 1):
            continue
        # swap music bar by bar between paired V: groups; chords ride on the sung line
        v_groups = [idxs for v, idxs in gs if v == "vocal"]
        i_groups = [idxs for v, idxs in gs if v == "ins"]
        for vg, ig in zip(v_groups, i_groups):
            for vi, ii in zip(vg, ig):
                v_bars = lines[vi].split("|")
                i_bars = lines[ii].split("|")
                sung = []
                for k, ib in enumerate(i_bars):
                    chords = _CHORD_RE.findall(v_bars[k]) if k < len(v_bars) else []
                    sung.append("".join(chords) + _CHORD_RE.sub("", ib))
                lines[vi], lines[ii] = "|".join(sung), _CHORD_RE.sub("", "|".join(v_bars))
        promoted.append(label)
    if not promoted:
        return abc, []
    return "\n".join(lines) + ("\n" if abc.endswith("\n") else ""), promoted


_ABC_KEY_RE = re.compile(r"^K:\s*([A-Ga-g][#b]?)\s*([A-Za-z]*)")
_ABC_Q_RE = re.compile(r"^Q:\s*(?:\d+\s*/\s*\d+\s*=\s*)?(\d+)")


def abc_facts(abc: Optional[str]) -> dict[str, Any]:
    """What a melody score tells the lyric writer: key, BPM, bar count,
    section labels (% comments / P: parts)."""
    key = bpm = None
    bars = 0
    sections: list[str] = []
    for raw in (abc or "").splitlines():
        line = raw.strip()
        if not line:
            continue
        if line.startswith("%"):
            label = line.lstrip("%").strip()
            if label and re.search(r"\b(intro|verse|pre-?chorus|chorus|bridge|outro|solo|interlude)\b", label, re.I):
                sections.append(label)
            continue
        if line.startswith("K:") and key is None:
            m = _ABC_KEY_RE.match(line)
            if m:
                tonic, mode = m.group(1), m.group(2).lower()
                mode_word = ("minor" if mode in ("m", "min", "minor") else
                             "major" if mode in ("", "maj", "major") else mode)
                key = f"{tonic[0].upper()}{tonic[1:]} {mode_word}"
            continue
        if line.startswith("Q:") and bpm is None:
            m = _ABC_Q_RE.match(line)
            if m:
                bpm = int(m.group(1))
            continue
        if line.startswith("P:"):
            sections.append(line[2:].strip())
            continue
        if re.match(r"^[A-Za-z]:", line):
            continue
        bars += line.count("|")
    return {"key": key, "bpm": bpm, "bars": bars, "sections": sections}


def parse_song_json(text: str) -> dict[str, str]:
    """Pull {title, style, lyrics} out of an LLM reply that may wrap the JSON
    in fences or prose. Lyrics are tidied; missing title becomes ''."""
    raw = (text or "").strip()
    if raw.startswith("```"):
        raw = raw.strip("`")
        raw = re.sub(r"^\s*json\s*", "", raw, flags=re.I).strip()
    start, end = raw.find("{"), raw.rfind("}")
    if start < 0 or end <= start:
        raise MusicError("song writer returned no JSON object")
    try:
        data = json.loads(raw[start:end + 1])
    except json.JSONDecodeError:
        # a stray literal newline inside the lyrics string is the usual break
        fixed = re.sub(r"(?<!\\)\n", lambda _m: "\\n", raw[start:end + 1])
        try:
            data = json.loads(fixed)
        except json.JSONDecodeError as e:
            raise MusicError(f"song writer JSON unparsable: {e}") from e
    if not isinstance(data, dict):
        raise MusicError("song writer JSON is not an object")
    style = " ".join(str(data.get("style") or "").split())
    lyrics = tidy_lyrics(str(data.get("lyrics") or ""))
    if not style or not lyrics:
        raise MusicError("song writer JSON lacks style or lyrics")
    title = " ".join(str(data.get("title") or "").split())[:120]
    return {"title": title, "style": style[:MAX_STYLE_CHARS], "lyrics": lyrics[:MAX_LYRICS_CHARS]}


