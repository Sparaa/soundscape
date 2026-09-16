"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import * as THREE from "three";
import type { Song } from "@/lib/api";
import { sectionCues, type SectionCue } from "@/lib/abc";
import { SCENES, type Scene } from "@/lib/scenes";
import { BeatClock, bandEnergies, frame, logSpectrum, paletteFor, type Palette, type VisualFrame } from "@/lib/visual";
import type { RadioPlayer } from "@/lib/player";

export const FEED_CHANNEL = "soundscape-visual-feed";

/** Full-panel three.js visualizer driven by the player's AnalyserNode. Publishes each VisualFrame on a
 * BroadcastChannel (`soundscape-visual-feed`) and as `window.soundscapeFeed` — the feed contract (docs/visual-feed.md). */
export default function Visualizer({ player, song, tags, sceneName, onScene, label, background }: {
  player: RadioPlayer | null; song: Song | null; tags: { mood?: { label: string }[]; genre?: { label: string }[] } | null;
  sceneName: string; onScene: (n: string) => void; label?: string; background?: boolean;
}) {
  const host = useRef<HTMLDivElement | null>(null);
  const [fps, setFps] = useState(0);
  const songRef = useRef<Song | null>(song); songRef.current = song;
  const tagsRef = useRef(tags); tagsRef.current = tags;

  useEffect(() => {
    const el = host.current;
    if (!el || !player) return;
    const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.setClearColor(0x000000, 1);
    el.appendChild(renderer.domElement);
    const scene3 = new THREE.Scene();
    const cam = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
    cam.position.set(0, 0, 3.2);
    let sc: Scene = (SCENES[sceneName] ?? SCENES.radial)();
    scene3.add(sc.object);
    const analyser = player.analyser;
    const fft = new Uint8Array(analyser.frequencyBinCount);
    const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(FEED_CHANNEL) : null;
    let clock = new BeatClock(120, 0), cues: SectionCue[] = [], palette: Palette = paletteFor(null), cueSong: string | null = null;
    let last = performance.now(), frames = 0, fpsT = last, raf = 0, quality = 1;
    const resize = () => { const w = el.clientWidth, h = el.clientHeight; renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); };
    resize();
    const ro = new ResizeObserver(resize); ro.observe(el);
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const now = performance.now(); const dt = Math.min(0.1, (now - last) / 1000); last = now;
      const s = songRef.current;
      if (s && s.id !== cueSong) {                     // new song: cues, clock, palette
        cueSong = s.id;
        cues = s.abc ? sectionCues(s.abc, s.seconds) : [];
        const pos = player.position();
        clock = new BeatClock(s.plan?.bpm ?? 120, pos.t);
        palette = paletteFor(tagsRef.current, s.id.charCodeAt(0));
      }
      analyser.getByteFrequencyData(fft);
      const bands = bandEnergies(fft, player.ctx.sampleRate, analyser.fftSize);
      const pos = player.position();
      clock.update(pos.t, bands.bass);
      const spectrum = logSpectrum(fft, player.ctx.sampleRate, analyser.fftSize, 64);
      const f: VisualFrame = frame(pos.t, bands, clock, cues, palette, s ? { id: s.id, title: s.title, mode: s.plan?.mode ?? null } : null, pos.d, spectrum);
      sc.update(f, dt);
      renderer.render(scene3, cam);
      (window as unknown as { soundscapeFeed?: VisualFrame }).soundscapeFeed = f;
      channel?.postMessage(f);
      frames++;
      if (now - fpsT > 1000) {                         // adaptive quality: drop pixel ratio when below 45 fps
        const cur = frames * 1000 / (now - fpsT); setFps(Math.round(cur)); frames = 0; fpsT = now;
        if (cur < 45 && quality > 0.5) { quality -= 0.25; renderer.setPixelRatio(Math.min(2, window.devicePixelRatio) * quality); }
        else if (cur > 58 && quality < 1) { quality += 0.25; renderer.setPixelRatio(Math.min(2, window.devicePixelRatio) * quality); }
      }
    };
    tick();
    return () => { cancelAnimationFrame(raf); ro.disconnect(); sc.dispose(); renderer.dispose(); channel?.close(); el.removeChild(renderer.domElement); };
  }, [player, sceneName]);

  const fullscreen = () => { const el = host.current?.parentElement; if (!el) return; if (document.fullscreenElement) void document.exitFullscreen(); else void el.requestFullscreen(); };
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const body = (
    <div className={background ? "fixed inset-y-0 left-0 right-0 sm:right-[420px] z-0 bg-black" : "relative w-full aspect-video bg-black rounded-xl overflow-hidden border border-zinc-800"}>
      <div ref={host} className="absolute inset-0" />
      <div className="absolute bottom-3 right-3 flex gap-1 text-[11px] text-zinc-500">
        {Object.keys(SCENES).map((n) => <button key={n} onClick={() => onScene(n)} className={`px-2 py-0.5 rounded border ${n === sceneName ? "border-zinc-300 text-zinc-100" : "border-zinc-800"}`}>{n}</button>)}
        <button onClick={fullscreen} className="px-2 py-0.5 rounded border border-zinc-800">⛶</button>
        <span className="px-1 font-mono">{fps} fps</span>
      </div>
      {label && <div className="absolute top-4 left-5 text-zinc-500 text-xs tracking-[0.3em] uppercase pointer-events-none">{label}</div>}
      {song && <div className="absolute bottom-4 left-5 text-zinc-300 text-base pointer-events-none">{song.title}</div>}
      {!player && <div className="absolute inset-0 flex items-center justify-center text-zinc-600 text-sm">press Play</div>}
    </div>
  );
  // background mode renders straight into <body>: a fixed layer must not sit under a blurred/transformed ancestor
  if (background) return mounted ? createPortal(body, document.body) : null;
  return body;
}
