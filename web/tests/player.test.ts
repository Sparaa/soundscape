import { describe, expect, it } from "vitest";
import { crossfadeGains, nextStartAt } from "@/lib/player";
import { planLabel } from "@/lib/api";

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
