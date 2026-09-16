# Soundscape

**A radio that never runs out of songs.** Seed a station with your own music — a file, or a link `yt-dlp` can fetch —
and a music agent learns the seeds' sound and keeps composing: new songs in that style, reinterpretations, hooks with
new verses, the occasional straight cover with new words. Two songs stay cued while you listen; one spare survives
Stop so Play is instant. A beat-locked visualizer fills the screen. Save what you like, build playlists, export them.

Self-hosted, single-user, personal use. Not a service.

## What it does

- **Stations & seeds** — upload a song or paste a link. SheetSage2 transcribes the melody and chords into a score, CLAP
  describes the sound (genre, mood, instruments, vocals, production). One or more seeds become a *station profile*:
  weighted tags, a tempo band, keys, the song form, and how many syllables each line carries.
- **The agent** — every track gets a plan: *inspired* (new melody in the station's sound, 50 %), *faithful cover*
  (new lyrics on a seed's exact melody and chords, 20 %), *reinterpret* (a seed's melody in the station's sound, 15 %),
  *hook* (a seed's chorus with new verses, 15 %); a covers ↔ new slider moves the weights, and creativity rules stop
  the same seed being covered twice in a row or more than once an hour. The LLM writes a title, style line and lyrics
  fitted to the melody's phrasing; YuE2 renders; a gate rejects tracks that are too short, too quiet or don't sound like
  the station (CLAP similarity), and the agent tries again.
- **Radio** — press Play. The buffer keeps two songs ready and one spare after Stop. Skip, save, ♥ more like this,
  👎 less like this (votes steer the station's profile).
- **Visualizer** — three.js scenes driven by the player's analyser (default: a radial analyzer — ring bars, colored
  frequency rays with bass at the bottom, afterglow beams, a starfield disc and a rotating emblem; drop your logo at
  `web/public/logo.png`): a beat clock locked to the planned BPM and nudged
  by bass onsets, section changes from the planned score, palettes from the station's mood. Every frame is also
  published as a small JSON feed (`docs/visual-feed.md`) so a native front end can render the same data.
- **Library & playlists** — saved and liked songs persist on disk (FLAC + a JSON with style, lyrics, score and plan);
  unsaved radio songs are pruned after 24 h; import your own files; playlists with ordering, play-all through the same
  player and visualizer, and a zip export with an `.m3u`.

## Requirements

- Linux, Docker with the NVIDIA container runtime, a GPU with **≥ 16 GB VRAM** (YuE2 peaks at 11-14 GB; SheetSage2 and
  CLAP load in turn and unload when idle). A 4090 renders a 3-minute song in roughly 70-100 s.
- An **OpenAI-compatible LLM** endpoint for the writer (local SGLang / vLLM / llama.cpp, or hosted). Small models do fine.
- The three sidecar images, built from their repos (they are shared with other apps):
  [`yue2-sidecar`](../yue2-sidecar) · [`sheetsage-sidecar`](../sheetsage-sidecar) · [`clipgrab-sidecar`](../clipgrab-sidecar)

## Run

```bash
git clone … soundscape && cd soundscape
cp .env.example .env                       # GPU uuid, LLM endpoint, library path
docker build -t yue2-sidecar ../yue2-sidecar && docker build -t sheetsage-sidecar ../sheetsage-sidecar && docker build -t clipgrab-sidecar ../clipgrab-sidecar
docker compose --profile gpu up -d         # web :3020, api :3021, sidecars
open http://localhost:3020
```
First run: the sidecars download their weights (~12 GB) into named volumes. Already running the sidecars elsewhere?
Set `YUE2_URL` / `SHEETSAGE_URL` in `.env` and start without the profile (`docker compose up -d`).

`make test` runs the API (pytest) and web (vitest + tsc) suites in throwaway containers; `scripts/e2e.sh <song.mp3>`
seeds a station from a file and plays until two songs are cued.

## How the pieces fit

```
web  Next.js 15 · WebAudio (two decks, crossfade) · three.js scenes · visual feed
api  FastAPI · SQLite · library on disk     ingest → analyze → profile → agent → write → render → gate → cue
     clipgrab :3014   sheetsage :3016 (SheetSage2 + CLAP)   yue2 :3015 (YuE2-3B)   LLM (OpenAI-compatible)
```
Design, decisions and phases: `docs/plan.md`. Feed contract: `docs/visual-feed.md`.

## Licenses

Soundscape's code is **Apache-2.0** (see `LICENSE`). The default models it drives are not: **YuE2-3B**, **SheetSage2** and
**MERT-v2-FullSong** are **CC BY-NC 4.0** (non-commercial); **CLAP** (`laion/larger_clap_music_and_speech`) is Apache-2.0.
You download those weights yourself, for personal use, under their terms. Links are fetched with yt-dlp only for your
own analysis; nothing is redistributed. The sidecar interfaces are model-agnostic — swap in a differently licensed
composer if you need one.

## Troubleshooting

- *api offline / sidecar offline* on the home page → `curl localhost:3021/healthz` names the unreachable sidecar; the
  LLM must be reachable from inside Docker (bind it on `0.0.0.0` or the docker0 address, not only `127.0.0.1`).
- *First song takes minutes* → the first render loads YuE2 (~1 min) and the gate may reject an attempt; the buffer
  fills during the first song.
- *Everything sounds the same* → add more seeds, move the covers ↔ new slider, vote 👎 on the direction you dislike.
