# Soundscape

A radio that never runs out of songs. Seed a **station** with your own music (a file, or a link yt-dlp can fetch);
the **music agent** learns the seeds' sound and keeps composing new songs in that style — new pieces, reinterpretations,
hooks, and the occasional cover — cueing them up so playback is continuous until you press **Stop**. A **visualizer**
locked to the beat fills the screen. Anything you like is saved to disk and can be arranged into playlists.

**Self-hosted, personal use.** Soundscape is not a service and is not designed to be hosted for others. You run it on
your own GPU machine. The default models it drives — [YuE2](https://huggingface.co/m-a-p/YuE2-3B) (composer),
[SheetSage2](https://huggingface.co/m-a-p/SheetSage2) + [MERT](https://huggingface.co/m-a-p/MERT-v2-FullSong)
(transcription) — are released under **CC BY-NC 4.0** (non-commercial); [CLAP](https://huggingface.co/laion/larger_clap_music_and_speech)
is Apache-2.0. Soundscape's own code is **Apache-2.0**. Links are fetched with yt-dlp only for your own analysis; nothing is
redistributed.

## How it works

```
web  (Next.js, WebAudio + three.js)   player · visualizer · station · library
api  (FastAPI, SQLite, disk library)  ingest → analyze → station profile → agent → gate → queue
sidecars (GPU, own repos)             yue2-sidecar :3015 · sheetsage-sidecar :3016 · clipgrab-sidecar :3014
LLM                                   any OpenAI-compatible endpoint (lyrics + planning)
```

See `docs/plan.md` for the design, phases and decisions.

## Requirements

- Linux, Docker with the NVIDIA container runtime, one GPU with ≥ 16 GB VRAM (YuE2 peaks at 11-14 GB; SheetSage2/CLAP
  load in turn and unload when idle).
- An OpenAI-compatible LLM endpoint (a local server such as SGLang / vLLM / llama.cpp, or a hosted one) for the writer.
- The three sidecar images: `yue2-sidecar`, `sheetsage-sidecar`, `clipgrab-sidecar` (build from their repos).

## Run

```bash
cp .env.example .env                       # GPU uuid, LLM endpoint, library path
docker compose --profile gpu up -d         # everything, GPU sidecars included
open http://localhost:3020
```
Already running `yue2-sidecar` / `sheetsage-sidecar` elsewhere (e.g. shared with another app)? Set `YUE2_URL` /
`SHEETSAGE_URL` in `.env` and start without the profile: `docker compose up -d`.

## Status

Phase 3 — the radio plays (agent → LLM → YuE2 → gate → buffer, WebAudio crossfade player) and the visualizer runs on it:
three.js scenes with raw GLSL (nebula, rings), a beat clock locked to the planned BPM and bass onsets, section cues from
the planned score, palettes from the station's mood; every frame is published as the visual feed (`docs/visual-feed.md`)
for a future native front end. Next: library + playlists + steering (Phase 4). See `docs/plan.md` §8.
