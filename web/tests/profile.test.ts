import { describe, expect, it } from "vitest";
import { mmss, profileHeadline, seedLine, tagChips } from "@/lib/profile";
import type { Profile, Seed } from "@/lib/api";

const P: Profile = {
  seeds: 2, keys: ["F minor", "F# minor"], sections: ["intro", "verse", "chorus"], phrases: {}, instrumental: false, language: "English",
  style: "s", seconds: 190, bpm: { low: 118, high: 158, center: 137 },
  tags: { genre: [{ label: "synth-pop", weight: 0.4 }, { label: "EDM", weight: 0.3 }], mood: [], instruments: [], vocal: [{ label: "female vocals", weight: 0.65 }], voice: [], production: [] },
};

describe("profile helpers", () => {
  it("formats", () => {
    expect(mmss(196.25)).toBe("3:16");
    expect(mmss(null)).toBe("–:––");
    expect(profileHeadline(P)).toBe("synth-pop · 118–158 BPM · F minor / F# minor · 3 sections · vocals");
    expect(tagChips(P, "genre")).toEqual(["synth-pop 40%", "EDM 30%"]);
    expect(tagChips(P, "mood")).toEqual([]);
  });
  it("summarises a seed", () => {
    const s: Seed = { id: "a", title: "t", source: null, seconds: 196, created: 0, key: "F# minor", bpm: 128, sections: ["Intro", "verse", "Chorus", "verse"], style_guess: null, promoted_sections: null, warnings: null, has_score: true };
    expect(seedLine(s)).toBe("F# minor · 128 BPM · 3:16 · intro → verse → chorus");
  });
});
