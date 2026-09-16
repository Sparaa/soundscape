# Soundscape — dynamic radio, plan v1 (2026-09-16, decisions taken; GO given — Phase 0 in progress)

**Soundscape**: open-source, local-first, single-user, self-hosted only — never a hosted service, so each user installs
YuE2 for personal use under its own license. Repo: `/mnt/AI/AIworkspace/soundscape` → GitHub public (source only).

## 1. What it is

A web radio that never runs out of songs. You seed a **station** with your own music (upload a file or paste a
YouTube/any-URL link); a **music agent** studies the seeds and keeps composing new songs in that genre and style,
cueing them up so playback is continuous until you press **Stop**. A **visualizer** locked to the beat and to the
song's structure fills the screen. Anything you like is **saved** to disk (audio is exempt from vidmakr's
no-content-on-disk rule) and can be arranged into **playlists**.

Non-goals for v1: multi-user accounts, encryption, streaming to other devices, mobile apps, commercial hosting
(the generation models are non-commercial — see §7).

## 2. What already exists (vidmakr, 2026-09) and gets reused

| Piece | Today | Radio use |
|---|---|---|
| `vidmakr-music` sidecar (YuE2-3B, :3015) | style + lyrics (+ optional ABC score, long mode, hook splice) → FLAC; ~71 s per 3.6-min song on a 4090, one song at a time, MAX_QUEUE 8 | the composer |
| `vidmakr-sheetsage` sidecar (SheetSage2 + CLAP, :3016) | song → melody/chord ABC, sections, key/BPM, CLAP style line + tags | the ear: seed analysis |
| `vidmakr-clipgrab` (yt-dlp + ffmpeg, :3014) | `/info`, `/clip` with `audio_only` (m4a) | link ingest |
| ai `music.py` + `music_prompts.py` | lyric writer (brief → title/style/lyrics fitted to a score), riff modes faithful / reinterpret / inspired / hook, sparse-vocal promotion, phrase hints, ABC helpers | the agent's writing tools |
| web `lib/abcPlayback.ts`, `lib/music.ts` | ABC parser (notes, sections, timing), music form helpers | visualizer structure cues |

Decision: the three sidecars are already standalone containers → make them **their own repos/images** (`yue2-sidecar`,
`sheetsage-sidecar`, `clipgrab`) consumed by both vidmakr and radio, rather than copying code into radio. vidmakr keeps
pointing at the same images; radio's compose pulls them. (Alternative: `git subtree` from vidmakr — worse, two masters.)

## 3. Architecture

```
radio-web (Next.js 15 / React 19 / Tailwind; WebAudio + WebGL)
  ├─ Player: gapless queue, crossfade, Stop/Skip/Save/Like/More-like-this
  ├─ Visualizer: AnalyserNode FFT + beat phase + section cues → GL scenes
  ├─ Station: seeds (upload / link), profile view, steer sliders
  └─ Library: saved songs, playlists, export
radio-api (FastAPI, SQLite, disk library)
  ├─ ingest:   upload | clipgrab /clip audio_only → wav/m4a in scratch
  ├─ analyze:  sheetsage /transcribe → {abc, sections, key, bpm, style_guess, tags}
  ├─ profile:  StationProfile = merged tags (genre/mood/instruments/vocal/production), BPM band,
  │            key set, section grammar, phrase shapes, source scores (for reinterpret/hook riffs)
  ├─ agent:    per-track plan → LLM lyric writer → yue2 /generate; keeps the buffer ≥ N ready
  ├─ gate:     CLAP similarity to profile, duration/silence/clipping checks, near-duplicate check
  └─ library:  songs/{id}.flac + {id}.json (style, lyrics, abc, seed lineage, plan); playlists table
sidecars (GPU): yue2 :3015, sheetsage :3016, clipgrab :3014       LLM: any OpenAI-compatible endpoint
```

Playback happens in the browser (WebAudio) so the visualizer has sample access; the API only serves files and state.
State machine per station: `stopped → warming (seeds analysed, first track rendering) → playing → stopping (finish
current, keep ONE spare rendered) → stopped`. "Stop" never discards the spare: pressing Play again starts instantly.

## 4. The music agent

**Station profile** (from 1..n seeds): CLAP tags per category with weights (averaged, seed-count weighted), BPM band
(±8 % around the seeds' BPMs), keys, section grammar (e.g. intro→verse→chorus→verse→chorus→bridge→chorus→outro),
average lyric-line syllables per section from `vocal_phrases`, language, vocal type (or **instrumental**).

**Per-track plan** (the agent's only real decision each cycle):
1. Pick a **riff mode** by weighted rotation — default `inspired 50 % / faithful cover 20 % / reinterpret 15 % /
   hook 15 %` (§10.5 for the creativity rules and the covers↔new slider). Inspired = new melody in the seeds' sound;
   faithful = new lyrics on a seed's exact melody + chords; reinterpret = a seed's melody in the station's sound;
   hook = the seed's chorus with new verses.
2. Pick a seed (round-robin over seeds, least-recently-used) when the mode needs one.
3. Vary: BPM jitter inside the band, key from the profile's set (relative major/minor allowed), a mood word swap
   from the tag list, a **theme** for the lyrics from a rolling list the LLM extends ("what is this station about?"
   is asked once from the seeds' CLAP tags + optional user blurb).
4. Ask the LLM for title/style/lyrics with the fitting rules already in `music.py` (phrase hints, verbatim chorus,
   line-count override). Instrumental stations skip lyrics ("[Instrumental]" tags only).
5. Render on YuE2 (cot `full` for inspired/hook, `melody` for reinterpret), seed = random, record the plan.
6. **Gate**: CLAP-embed the render, cosine vs the profile centroid ≥ threshold (else re-plan, max 2 retries);
   length within 2:00–5:30 (long mode when the plan calls for it); no > 3 s digital silence; reject near-duplicates
   (chroma fingerprint vs the last 20 tracks).

**Buffer policy**: keep `ready ≥ 2` while playing (one playing, one cued, one rendering); at Stop finish the render in
flight and keep exactly one spare. Generation is ~3× faster than real time on a 4090, so the buffer fills in the first
song. **Steering**: Like → the track's tags nudge the profile centroid (+); "Less like this" → (−); "More like this
seed" → temporarily pins the seed; sliders for energy/tempo/vocal density map onto style words and the BPM band.

## 5. Visualizer

Inputs: `AnalyserNode` FFT (bass/mid/treble bands, RMS), a beat phase clock (planned BPM from the track's `Q:` +
onset-strength correction, so beats stay locked even when energy dips), section boundaries from the ABC's planned
seconds (verse/chorus/bridge → scene changes), CLAP mood/genre tags → palette and scene family.
Scenes (WebGL, three.js or raw shaders): particle field / tunnel / waveform ribbon / kaleidoscope, each reacting to
bass hits (kick), snare-band transients, and section changes; chorus = wider, brighter; bridge = darker. A "cool"
default plus a couple of alternates, switchable; FPS-adaptive quality. Album-art tile generated per song by the
station's palette (no image model needed in v1).

## 6. Library and playlists

`library/songs/{id}.flac` (+ `.mp3` on export) and `{id}.json` (title, style, lyrics, abc, plan, seed lineage,
station, created, liked). SQLite: songs, stations, seeds, playlists, playlist_items (ordered). Playlist playback
reuses the same player (visualizer works on saved songs too). Import your own files into playlists. Export: zip.

## 7. Open-source packaging

- Code license: **Apache-2.0**. Model licenses: YuE2-3B, SheetSage2 and MERT-v2-FullSong are **CC BY-NC 4.0**, CLAP is
  Apache-2.0 → the README states plainly that the default stack is non-commercial; the sidecar interfaces are model-
  agnostic so a commercially licensed composer can be swapped in.
- yt-dlp ingest: the app downloads only what the user points it at, for personal analysis; nothing is redistributed.
  Say so in the README and default seeds to "inspired" riffs (no cover of the uploaded record unless asked).
- No accounts, no encryption, no cloud. LLM = `OPENAI_BASE_URL` + model name (default the local SGLang 27B; any
  OpenAI-compatible server works, including a small local model — the writing task is easy).
- Ship: `docker compose up` = web + api + the three sidecar images; GPU ≥ 16 GB (YuE2 11-14 GB; SheetSage/CLAP
  load in turn); CPU-only mode not supported in v1. Repo source-only (no weights), `.gitignore` for the library.
- Tests: pytest for api (agent planning, gate, library) with a fake composer; vitest for web (player queue, beat
  clock, ABC cues); an E2E script that seeds a station from a local file and plays two tracks against real sidecars.

## 8. Phases (each: tests → deploy → verify live → commit) — agent + music generation first, visuals after

0. **Skeleton** (½ day): repo, compose (sidecar images from the split-out repos), api + web scaffolds, library dir,
   README with the license section. vidmakr repointed at the split-out sidecar images (no behaviour change).
1. **Ingest + analysis + profile** (1 day): upload/link → clipgrab → sheetsage; StationProfile built and shown;
   unit tests on profile merging from 1-3 seeds.
2. **Agent + queue + player MVP** (2 days): plan → write → render → gate → cue; Play/Stop/Skip/Save; buffer policy
   incl. the spare; gapless crossfade; no visuals yet. E2E: seed a station, hear two consecutive songs.
3. **Visualizer** (2 days, three.js): analyser + beat clock + section cues; two scenes; palette from tags;
   fullscreen. Publishes the **visual feed contract** (JSON/WebSocket: bands, rms, beat phase, bar, section, palette)
   so a later Linux-native Vulkan front end is a drop-in.
4. **Library + playlists + steering** (1 day): save/like/less-like, playlist CRUD + playback, export.
5. **Release polish** (1 day): README/screenshots/GIF, model-license notice, issue templates, first tag.

## 9. Risks and mitigations

- **GPU sharing (home/testing only)**: the radio keeps the 4090 busy; vidmakr's music renders would queue behind it.
  → yue2 sidecar `priority: interactive|background` (radio submits background; interactive jobs jump the queue and
  may pre-empt a background job between chunks). Real usage = one app at a time, so nothing fancier.
- **Sameness**: seed rotation, theme list, temperature/seed variety, and the near-duplicate gate; surface "why this
  song" (plan) in the UI so the user can steer.
- **Length/structure limits**: YuE2 caps ~6 min (9000 semantic tokens); long mode chunks + crossfades exist.
- **Quality gate false negatives**: log rejected renders with reasons; expose the threshold.
- **Vocal vs instrumental seeds**: the CLAP vocal tag decides; user can override per station.

## 10. Decisions (user, 2026-09-16)
1. **Name: Soundscape.** New repo beside vidmakr, public, source only.
2. **Not hosted.** Users self-install; YuE2 / SheetSage2 personal use is theirs. README: "self-hosted, personal use;
   the default models are CC BY-NC" — no commercial-hosting path is designed for.
3. **Visuals: three.js first** — fastest iteration while the agent and music generation get "down pat" (the first
   priority). The "hella cool" end state is a **Linux-native app on Vulkan** (raw shaders); keep the visualizer's
   inputs (band energies, beat phase, section cues, palette) as a small typed stream so a native front end can
   consume the same feed later (§5 → "visual feed contract").
4. **Independent of vidmakr.** Shares the sidecar images, nothing else. For home use/testing (vidmakr dev in parallel)
   the yue2 sidecar gets a simple **job priority** (interactive > radio background); real usage is one app or the
   other, so no elaborate scheduler.
5. **Covers are allowed** (user, 2026-09-16: "covers are allowed, but our agent should get creative with mixing up
   exact covers with new inspired-by pieces"). A cover = the `faithful` riff: new lyrics sung to a seed's exact melody
   and chords. Default rotation **inspired 50 % / faithful cover 20 % / reinterpret 15 % / hook 15 %**, with the
   agent's "creativity" rules: never two covers of the same seed in a row, a cover of each seed at most once per
   hour of airtime, covers get a fresh lyrical theme (never the seed's words — we never have them anyway), and a
   station slider "covers ↔ new" moves the weights. The per-track plan is shown in the UI ("cover of <seed>",
   "inspired by the station", "hook from <seed>").
6. Sidecars split into their own repos in Phase 0 (recommended path taken).
