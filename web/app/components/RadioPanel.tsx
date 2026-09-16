"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { patchSettings, patchSong, planLabel, radioNext, radioPlay, radioStatus, radioStop, songAudioUrl, type RadioStatus, type Song, type Station } from "@/lib/api";
import { mmss } from "@/lib/profile";
import { RadioPlayer } from "@/lib/player";
import Visualizer from "@/app/components/Visualizer";

export default function RadioPanel({ station, onStation }: { station: Station; onStation: (s: Station) => void }) {
  const [status, setStatus] = useState<RadioStatus | null>(null);
  const [song, setSong] = useState<Song | null>(null);
  const [pos, setPos] = useState({ t: 0, d: 0 });
  const [err, setErr] = useState<string | null>(null);
  const [playerObj, setPlayerObj] = useState<RadioPlayer | null>(null);
  const [scene, setScene] = useState<string>(() => { try { return localStorage.getItem("soundscape.scene") ?? "nebula"; } catch { return "nebula"; } });
  const player = useRef<RadioPlayer | null>(null);
  const sid = station.id;

  const refresh = useCallback(() => radioStatus(sid).then(setStatus).catch((e) => setErr(String(e))), [sid]);
  useEffect(() => { void refresh(); const id = window.setInterval(refresh, 2000); return () => window.clearInterval(id); }, [refresh]);
  useEffect(() => { const id = window.setInterval(() => player.current && setPos(player.current.position()), 500); return () => window.clearInterval(id); }, []);
  useEffect(() => () => player.current?.stop(), []);

  const getPlayer = () => {
    if (!player.current) {
      const p = new RadioPlayer(songAudioUrl);
      p.onSongChange = setSong;
      p.onNeedNext = async () => { const r = await radioNext(sid); setStatus(r.status); return r.song; };
      player.current = p;
      setPlayerObj(p);
    }
    return player.current;
  };

  const onPlay = async () => {
    setErr(null);
    try {
      const st = await radioPlay(sid);
      setStatus(st);
      const p = getPlayer();
      // start as soon as the first song is cued (the spare makes this instant after the first session)
      const first = (await radioNext(sid));
      setStatus(first.status);
      if (first.song) await p.start(first.song);
      else {
        const wait = window.setInterval(async () => {
          const r = await radioNext(sid); setStatus(r.status);
          if (r.song) { window.clearInterval(wait); await p.start(r.song); }
          if (r.status.state === "stopped") window.clearInterval(wait);
        }, 3000);
      }
    } catch (e) { setErr(String(e)); }
  };
  const onStop = async () => { player.current?.stop(); setStatus(await radioStop(sid)); };
  const onSkip = async () => { await getPlayer().skip(); };
  const flag = async (s: Song, flags: { saved?: boolean; liked?: boolean }) => {
    const u = await patchSong(s.id, flags);
    if (song?.id === s.id) setSong(u);
    void refresh();
  };
  const covers = Number(station.settings?.covers ?? 1);
  const live = status?.state === "playing" || status?.state === "warming";
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xs uppercase tracking-widest text-zinc-500">Radio</h2>
      <Visualizer player={playerObj} song={song} tags={station.profile?.tags ?? null} sceneName={scene}
                  onScene={(n) => { setScene(n); try { localStorage.setItem("soundscape.scene", n); } catch { /* per-viewer convenience only */ } }} />
      <div className="border border-zinc-800 rounded-xl p-4 flex flex-col gap-3">
        <div className="flex items-center gap-3">
          {!live ? (
            <button onClick={onPlay} disabled={!station.profile} className="px-5 py-2 rounded-full bg-zinc-100 text-black font-medium disabled:opacity-40">▶ Play</button>
          ) : (
            <button onClick={onStop} className="px-5 py-2 rounded-full border border-zinc-600">■ Stop</button>
          )}
          <button onClick={onSkip} disabled={!song} className="px-3 py-2 rounded-full border border-zinc-800 disabled:opacity-40">⏭ Skip</button>
          <span className="text-xs text-zinc-500 font-mono">{status?.state ?? "…"} · {status?.ready.length ?? 0} cued</span>
          <label className="ml-auto text-xs text-zinc-400 flex items-center gap-2">covers ↔ new
            <input type="range" min={0} max={2} step={0.25} value={covers} onChange={async (e) => onStation(await patchSettings(sid, { covers: Number(e.target.value) }))} />
          </label>
        </div>
        {song ? (
          <div className="flex flex-col gap-1">
            <div className="text-2xl font-semibold">{song.title}</div>
            <div className="text-sm text-zinc-400">{planLabel(song.plan)} · {song.plan?.bpm} BPM{song.plan?.key ? ` · ${song.plan.key}` : ""}</div>
            <div className="h-1 bg-zinc-800 rounded"><div className="h-1 bg-zinc-200 rounded" style={{ width: `${pos.d ? Math.min(100, (100 * pos.t) / pos.d) : 0}%` }} /></div>
            <div className="text-xs text-zinc-500 font-mono">{mmss(pos.t)} / {mmss(pos.d)}</div>
            <div className="flex gap-2 text-xs">
              <button onClick={() => flag(song, { saved: !song.saved })} className={`px-2 py-1 rounded border ${song.saved ? "border-emerald-500 text-emerald-300" : "border-zinc-700"}`}>{song.saved ? "saved" : "save"}</button>
              <button onClick={() => flag(song, { liked: !song.liked })} className={`px-2 py-1 rounded border ${song.liked ? "border-pink-500 text-pink-300" : "border-zinc-700"}`}>{song.liked ? "♥ liked" : "♡ like"}</button>
            </div>
            {song.lyrics && <pre className="text-xs text-zinc-400 whitespace-pre-wrap font-sans mt-2 max-h-48 overflow-auto">{song.lyrics}</pre>}
          </div>
        ) : (
          <div className="text-sm text-zinc-500">{live ? "Composing the first song… (about a minute)" : "Press Play — the agent composes from the station profile and keeps two songs cued."}</div>
        )}
        {status?.rendering && (
          <div className="text-xs text-zinc-400">
            <span className="animate-pulse">●</span> rendering: {planLabel(status.rendering.plan)} · {status.rendering.stage} {Math.round(status.rendering.progress * 100)}% · {status.rendering.seconds}s{status.rendering.attempt > 1 ? ` · attempt ${status.rendering.attempt}` : ""}
          </div>
        )}
        {status && status.ready.length > 0 && (
          <div className="text-xs text-zinc-400 flex flex-col gap-0.5">
            <div className="uppercase tracking-widest text-zinc-500">Up next</div>
            {status.ready.map((s) => <div key={s.id}>{s.title} <span className="text-zinc-600">· {planLabel(s.plan)} · {mmss(s.seconds)}</span></div>)}
          </div>
        )}
        {status && status.recent.length > 0 && (
          <div className="text-xs text-zinc-500 flex flex-col gap-0.5">
            <div className="uppercase tracking-widest">Recent</div>
            {status.recent.slice(0, 6).map((s) => (
              <div key={s.id} className="flex gap-2">
                <span className={s.status === "rejected" ? "line-through" : ""}>{s.title}</span>
                <span className="text-zinc-600">· {planLabel(s.plan)}{s.status === "rejected" && s.gate ? ` · rejected: ${s.gate.reasons.join(", ")}` : ""}</span>
                {s.status !== "rejected" && <button onClick={() => flag(s, { saved: !s.saved })} className="text-zinc-400 hover:text-emerald-300">{s.saved ? "saved" : "save"}</button>}
              </div>
            ))}
          </div>
        )}
        {err && <div className="text-xs text-red-400">{err}</div>}
      </div>
    </section>
  );
}
