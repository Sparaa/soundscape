import type { Profile, Seed } from "./api";

/** "3:16" from seconds. */
export function mmss(seconds: number | null | undefined): string {
  if (seconds == null || !isFinite(seconds)) return "–:––";
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** One-line seed summary: "F# minor · 128 BPM · 3:16 · intro → verse → chorus". */
export function seedLine(s: Seed): string {
  const parts: string[] = [];
  if (s.key) parts.push(s.key);
  if (s.bpm) parts.push(`${s.bpm} BPM`);
  if (s.seconds) parts.push(mmss(s.seconds));
  if (s.sections?.length) parts.push([...new Set(s.sections.map((x) => x.toLowerCase()))].join(" → "));
  return parts.join(" · ");
}

/** Top tags as "label 62%" chips, per category, in display order. */
export const TAG_ORDER = ["genre", "mood", "instruments", "vocal", "voice", "production"] as const;
export function tagChips(p: Profile, cat: string, max = 4): string[] {
  return (p.tags[cat] ?? []).slice(0, max).map((t) => `${t.label} ${Math.round(t.weight * 100)}%`);
}

/** Headline of a profile: "synth-pop · 118–158 BPM · F minor / F# minor · 9 sections · vocals". */
export function profileHeadline(p: Profile): string {
  const parts: string[] = [];
  const g = p.tags.genre?.[0]?.label;
  if (g) parts.push(g);
  if (p.bpm) parts.push(p.bpm.low === p.bpm.high ? `${p.bpm.center} BPM` : `${p.bpm.low}–${p.bpm.high} BPM`);
  if (p.keys.length) parts.push(p.keys.join(" / "));
  parts.push(`${p.sections.length} sections`);
  parts.push(p.instrumental ? "instrumental" : "vocals");
  return parts.join(" · ");
}
