import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { crossfadeGains, nextStartAt, RadioPlayer } from "@/lib/player";
import { planLabel, type Song } from "@/lib/api";

describe("player helpers", () => {
  it("schedules the next track before the end", () => {
    expect(nextStartAt(200)).toBe(197);
    expect(nextStartAt(2)).toBe(1);
    expect(nextStartAt(null)).toBe(Infinity);
  });
  it("equal-power crossfade", () => {
    const mid = crossfadeGains(0.5);
    expect(mid.out).toBeCloseTo(mid.in, 5);
    expect(crossfadeGains(0)).toEqual({ out: 1, in: 0 });
    expect(crossfadeGains(1).out).toBeCloseTo(0, 5);
  });
  it("labels plans", () => {
    expect(planLabel({ mode: "faithful", explain: "cover of “X” with new words" } as never)).toBe("cover of “X” with new words");
    expect(planLabel({ mode: "hook", explain: "" } as never)).toBe("hook");
    expect(planLabel(null)).toBe("");
  });
});

// ---- RadioPlayer against stubbed <audio> + WebAudio (vitest runs in node): only the pulling logic is exercised.
class FakeAudio {
  src = ""; currentTime = 0; duration = NaN; ended = false; paused = true; crossOrigin = ""; preload = "";
  play() { this.paused = false; return Promise.resolve(); }
  pause() { this.paused = true; }
  load() { if (!this.src) { this.duration = NaN; this.currentTime = 0; this.ended = false; } }
  removeAttribute(n: string) { if (n === "src") this.src = ""; }
}
const param = () => ({ value: 0, cancelScheduledValues() {}, setValueAtTime() {}, linearRampToValueAtTime() {} });
const node = () => { const n = { gain: param(), connect: (_: unknown) => n, fftSize: 0, smoothingTimeConstant: 0 }; return n; };
class FakeCtx {
  currentTime = 0; destination = {};
  createGain() { return node(); }
  createAnalyser() { return node(); }
  createMediaElementSource() { return node(); }
  resume() { return Promise.resolve(); }
}
const song = (id: string, seconds: number): Song => ({ id, seconds } as unknown as Song);

describe("RadioPlayer pulls the next song", () => {
  let audios: FakeAudio[];
  beforeEach(() => {
    audios = [];
    vi.useFakeTimers();
    vi.stubGlobal("window", { AudioContext: FakeCtx, setTimeout, clearTimeout });
    vi.stubGlobal("Audio", class extends FakeAudio { constructor() { super(); audios.push(this); } });
    vi.stubGlobal("performance", { now: () => Date.now() });
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  async function playToTheEnd(p: RadioPlayer) {
    await p.start(song("a", 100));
    const a = audios[0];
    a.duration = 100; a.currentTime = 98;                      // inside the crossfade window
    await vi.advanceTimersByTimeAsync(300);                    // one tick → first ask
    a.currentTime = 100; a.ended = true; a.paused = true;      // the song ran out while the ask was failing
  }

  it("keeps asking after a failed fetch (API restart mid-deploy) instead of stalling until Skip", async () => {
    const p = new RadioPlayer((id) => `/audio/${id}`);
    const errors: unknown[] = [];
    p.onNextError = (e) => errors.push(e);
    const asks = vi.fn<() => Promise<Song | null>>()
      .mockRejectedValueOnce(new Error("Failed to fetch"))
      .mockResolvedValue(song("b", 120));
    p.onNeedNext = asks;
    await playToTheEnd(p);
    expect(asks).toHaveBeenCalledTimes(1);
    expect(errors).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1500);                   // retry after ~1 s, not never
    expect(asks).toHaveBeenCalledTimes(2);
    expect(p.current.song?.id).toBe("b");
    expect(audios.find((x) => x.src === "/audio/b")?.paused).toBe(false);
    p.stop();
  });

  it("waits a second between asks while nothing is cued, then crossfades when a song appears", async () => {
    const p = new RadioPlayer((id) => `/audio/${id}`);
    const asks = vi.fn<() => Promise<Song | null>>().mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValue(song("b", 120));
    p.onNeedNext = asks;
    await playToTheEnd(p);
    expect(asks).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(500);
    expect(asks).toHaveBeenCalledTimes(1);                     // not hammering the API every 250 ms
    await vi.advanceTimersByTimeAsync(2100);
    expect(asks).toHaveBeenCalledTimes(3);
    expect(p.current.song?.id).toBe("b");
    p.stop();
  });
});
