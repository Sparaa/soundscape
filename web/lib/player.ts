/** Radio player core: WebAudio graph (two decks with gain crossfade) that pulls the next song from the API when one
 * ends. The AnalyserNode is exposed for the visualizer (Phase 3). Pure helpers are exported for tests. */
import type { Song } from "./api";

export const CROSSFADE_S = 3;

/** Seconds into a track at which the next one should start (crossfade), never before 1 s. */
export function nextStartAt(durationS: number | null | undefined, crossfadeS = CROSSFADE_S): number {
  if (!durationS || !isFinite(durationS)) return Infinity;
  return Math.max(1, durationS - crossfadeS);
}

/** Equal-power crossfade gains at t in [0,1]. */
export function crossfadeGains(t: number): { out: number; in: number } {
  const x = Math.min(1, Math.max(0, t));
  return { out: Math.cos(x * Math.PI / 2), in: Math.sin(x * Math.PI / 2) };
}

export interface Deck { el: HTMLAudioElement; gain: GainNode; src: MediaElementAudioSourceNode; song: Song | null }

export class RadioPlayer {
  ctx: AudioContext;
  analyser: AnalyserNode;
  master: GainNode;
  decks: [Deck, Deck];
  active = 0;
  onSongChange: (s: Song | null) => void = () => {};
  onNeedNext: () => Promise<Song | null> = async () => null;
  /** A failed next-song fetch (API restarting, network blip): the player retries by itself; the UI may show it. */
  onNextError: (e: unknown) => void = () => {};
  private timer: number | null = null;
  private fetching = false;
  private retryAt = 0;      // performance.now() before which we don't ask again (nothing cued yet, or the last ask failed)

  constructor(audioUrl: (id: string) => string) {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.8;
    this.master.connect(this.analyser).connect(this.ctx.destination);
    const mk = (): Deck => {
      const el = new Audio();
      el.crossOrigin = "anonymous";
      el.preload = "auto";
      const gain = this.ctx.createGain();
      gain.gain.value = 0;
      const src = this.ctx.createMediaElementSource(el);
      src.connect(gain).connect(this.master);
      return { el, gain, src, song: null };
    };
    this.decks = [mk(), mk()];
    this.audioUrl = audioUrl;
  }
  private audioUrl: (id: string) => string;

  get current(): Deck { return this.decks[this.active]; }
  get standby(): Deck { return this.decks[1 - this.active]; }

  async start(first: Song): Promise<void> {
    await this.ctx.resume();
    this.load(this.current, first);
    this.current.gain.gain.value = 1;
    await this.current.el.play();
    this.onSongChange(first);
    this.tick();
  }

  private load(deck: Deck, song: Song): void {
    deck.song = song;
    deck.el.src = this.audioUrl(song.id);
    deck.el.load();
  }

  /** Called every 250 ms: near the end (or after it), fetch + start the next song on the standby deck and crossfade. */
  private tick = (): void => {
    const cur = this.current;
    const dur = isFinite(cur.el.duration) && cur.el.duration > 0 ? cur.el.duration : cur.song?.seconds ?? null;
    const due = cur.el.ended || cur.el.currentTime >= nextStartAt(dur);
    if (due && !this.fetching && !this.standby.song && performance.now() >= this.retryAt) void this.pull(cur.el.ended ? 0.2 : CROSSFADE_S);
    this.timer = window.setTimeout(this.tick, 250);
  };

  /** One attempt at the next song. `fetching` ALWAYS clears: a rejected fetch (API restarting mid-deploy, a blip) used to
   * leave it stuck and the radio silent after the song ended until the user pressed Skip. Nothing cued / failed → ask
   * again in a second (the agent is still composing), not every 250 ms. */
  private async pull(crossfadeS: number): Promise<void> {
    this.fetching = true;
    try {
      const next = await this.onNeedNext();
      if (next) await this.crossfadeTo(next, crossfadeS);
      else this.retryAt = performance.now() + 1000;
    } catch (e) {
      this.retryAt = performance.now() + 1000;
      this.onNextError(e);
    } finally {
      this.fetching = false;
    }
  }

  async crossfadeTo(next: Song, seconds = CROSSFADE_S): Promise<void> {
    const out = this.current, inn = this.standby;
    this.load(inn, next);
    await inn.el.play().catch(() => undefined);
    const t0 = this.ctx.currentTime;
    out.gain.gain.cancelScheduledValues(t0); inn.gain.gain.cancelScheduledValues(t0);
    out.gain.gain.setValueAtTime(out.gain.gain.value, t0); inn.gain.gain.setValueAtTime(0, t0);
    out.gain.gain.linearRampToValueAtTime(0, t0 + seconds); inn.gain.gain.linearRampToValueAtTime(1, t0 + seconds);
    this.active = 1 - this.active;
    this.onSongChange(next);
    window.setTimeout(() => { out.el.pause(); out.el.removeAttribute("src"); out.el.load(); out.song = null; }, seconds * 1000 + 100);
  }

  async skip(): Promise<void> {
    const next = await this.onNeedNext();
    if (next) await this.crossfadeTo(next, 0.5);
  }

  /** Stop = pause: the current song stays loaded so Play picks it up where it was (the server keeps a spare behind it). */
  pause(): void {
    if (this.timer) window.clearTimeout(this.timer);
    this.timer = null;
    for (const d of this.decks) d.el.pause();
  }

  get paused(): boolean { return !!this.current.song && this.current.el.paused; }

  async resume(): Promise<boolean> {
    if (!this.current.song) return false;
    await this.ctx.resume();
    await this.current.el.play();
    this.tick();
    return true;
  }

  stop(): void {
    if (this.timer) window.clearTimeout(this.timer);
    this.timer = null;
    for (const d of this.decks) { d.el.pause(); d.el.removeAttribute("src"); d.el.load(); d.song = null; d.gain.gain.value = 0; }
    this.onSongChange(null);
  }

  position(): { t: number; d: number } {
    const el = this.current.el;
    return { t: el.currentTime || 0, d: (isFinite(el.duration) && el.duration) || this.current.song?.seconds || 0 };
  }
}
