"""OpenAI-compatible chat client + the two writing tasks (song, station themes)."""
from __future__ import annotations

import json
import re
from typing import Any, Optional

import httpx

from . import abc as abclib, config, prompts


class LLM:
    def __init__(self, base_url: str = config.LLM_BASE_URL, model: str = config.LLM_MODEL, api_key: str = config.LLM_API_KEY,
                 client: Optional[httpx.AsyncClient] = None, timeout_s: float = 300.0):
        self.base_url, self.model, self.api_key, self.client, self.timeout_s = base_url.rstrip("/"), model, api_key, client, timeout_s

    async def chat(self, system: str, user: str, *, temperature: float = 0.8, max_tokens: int = 1800) -> str:
        body = {"model": self.model, "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
                "temperature": temperature, "max_tokens": max_tokens, "stream": False,
                "chat_template_kwargs": {"enable_thinking": False}}
        own = self.client is None
        client = self.client or httpx.AsyncClient(timeout=self.timeout_s)
        try:
            r = await client.post(f"{self.base_url}/chat/completions", json=body,
                                  headers={"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"})
            if r.status_code != 200:
                raise abclib.MusicError(f"llm {r.status_code}: {r.text[:200]}")
            return r.json()["choices"][0]["message"]["content"]
        finally:
            if own:
                await client.aclose()


def song_brief(*, station: str, theme: str, style: str, duration_s: float, language: str, mode: str,
               abc: Optional[str], source_style: Optional[str]) -> str:
    """The user turn for the writer — the same fitting rules vidmakr's writer uses (phrase hints, verbatim chorus)."""
    lines = [f"Song brief: a song for the radio station '{station}'. Theme: {theme}.", f"Language: {language}",
             f"Target length: about {max(0.5, duration_s / 60):.1f} minutes of song",
             f"Style direction to honour: {style}"]
    if abc and abc.strip():
        f = abclib.abc_facts(abc)
        facts = ", ".join(x for x in (f"key {f['key']}" if f["key"] else "", f"{f['bpm']} BPM" if f["bpm"] else "",
                                      f"{f['bars']} bars" if f["bars"] else "",
                                      ("sections: " + " → ".join(f["sections"])) if f["sections"] else "") if x)
        phrases = abclib.vocal_phrases(abclib.promote_sparse_vocals(abc)[0] if mode != "inspired" else abc)
        if mode == "inspired":
            lines.append("INSPIRED BY: write a NEW song in the SHAPE of an existing one" + (f" ({facts})" if facts else "") +
                         ". Keep its section order and roughly its proportions, but the melody, images and wording are all new. "
                         "Do not write more sections than it has.")
        elif mode == "hook":
            hint = abclib.phrase_hint(phrases, ("chorus",))
            lines.append("HOOK ONLY: the verses, bridge and intro are new music, but every [Chorus] is sung to an EXISTING chorus melody"
                         + (f" ({facts})" if facts else "") + ". " +
                         (f"Chorus lines to fit exactly — one lyric line per melodic phrase, one syllable per sung note: {hint}. " if hint else "") +
                         "Repeat the chorus wording verbatim each time; verses are free but keep lines short and singable.")
        else:
            hint = abclib.phrase_hint(phrases)
            lines.append("COVER: the lyrics will be sung to an EXISTING melody" + (f" ({facts})" if facts else "") + ". "
                         "Fit the melody's phrasing — one lyric line per melodic phrase, one syllable per sung note, so each line's "
                         "syllable count matches its phrase" + (f": {hint}" if hint else ", about one line per two bars, 6-9 syllables each") +
                         ". Follow the section order of the melody, repeat the chorus wording verbatim each time, and do not write more "
                         "sections than the melody has. These per-section line counts override the usual length guidance.")
    lines.append("Return the JSON object now.")
    return "\n".join(lines)


async def write_song(llm: LLM, **brief_kwargs: Any) -> dict[str, str]:
    text = await llm.chat(prompts.SONG_SYSTEM_PROMPT, song_brief(**brief_kwargs))
    return abclib.parse_song_json(text)


async def station_themes(llm: LLM, *, style: str, blurb: str = "") -> list[str]:
    text = await llm.chat(prompts.THEMES_SYSTEM_PROMPT, f"Station sound: {style}\nOwner's blurb: {blurb or '(none)'}\nReturn the JSON array now.",
                          temperature=0.9, max_tokens=400)
    m = re.search(r"\[.*\]", text, re.S)
    try:
        items = json.loads(m.group(0) if m else text)
    except ValueError:
        items = [t.strip(" -•\"'") for t in text.splitlines() if t.strip()]
    out = [" ".join(str(t).split())[:80] for t in items if str(t).strip()]
    return out[:12] or ["a night drive with the windows down", "a letter never sent", "the last train home"]
