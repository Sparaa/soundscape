/** ABC score parser for the YuE2/SheetSage2 dialect (ported from vidmakr's abcPlayback.ts; Apache-2.0 here): timed note
 * events per voice and — what the visualizer wants — section start times. */

export type AbcVoice = "vocal" | "ins";

export interface AbcNote {
  /** seconds from the start of the score */
  t: number;
  /** seconds */
  dur: number;
  /** MIDI note number */
  midi: number;
  section: string;
}

export interface AbcEvents {
  notes: AbcNote[];
  seconds: number;
  bpm: number;
  voice: AbcVoice;
  /** sections that had at least one note in this voice */
  sections: string[];
}

const LETTER: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const SHARP_ORDER = ["F", "C", "G", "D", "A", "E", "B"];
const FLAT_ORDER = ["B", "E", "A", "D", "G", "C", "F"];

/** Key signature accidentals per letter, from "F#m", "Bb", "C", "Ddor"… */
export function keySignature(key: string): Record<string, number> {
  const sig: Record<string, number> = { C: 0, D: 0, E: 0, F: 0, G: 0, A: 0, B: 0 };
  const m = /^\s*([A-Ga-g])([#b]?)\s*([A-Za-z]*)/.exec(key || "");
  if (!m) return sig;
  const tonic = (LETTER[m[1].toUpperCase()] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0) + 12) % 12;
  const mode = m[3].toLowerCase();
  const shift = mode.startsWith("min") || mode === "m" || mode.startsWith("aeo") ? 3 : mode.startsWith("dor") ? 10 : mode.startsWith("mix") ? 5 : mode.startsWith("lyd") ? 7 : mode.startsWith("phr") ? 8 : mode.startsWith("loc") ? 1 : 0;
  const major = (tonic + shift) % 12;
  const sharps: Record<number, number> = { 0: 0, 7: 1, 2: 2, 9: 3, 4: 4, 11: 5, 6: 6, 1: 7 };
  const flats: Record<number, number> = { 5: 1, 10: 2, 3: 3, 8: 4, 1: 5, 6: 6, 11: 7 };
  const preferFlats = m[2] === "b" || (!(major in sharps) && major in flats) || (major === 6 && m[2] !== "#");
  if (preferFlats && major in flats) for (const l of FLAT_ORDER.slice(0, flats[major])) sig[l] = -1;
  else if (major in sharps) for (const l of SHARP_ORDER.slice(0, sharps[major])) sig[l] = 1;
  else if (major in flats) for (const l of FLAT_ORDER.slice(0, flats[major])) sig[l] = -1;
  return sig;
}

function frac(text: string, fallback: [number, number]): [number, number] {
  const m = /^\s*(\d+)\s*\/\s*(\d+)/.exec(text);
  return m && Number(m[2]) ? [Number(m[1]), Number(m[2])] : fallback;
}

/** length multiplier from an ABC length suffix: "" → 1, "2" → 2, "3/2" → 1.5, "/" → 0.5, "//" → 0.25 */
export function abcLength(suffix: string): number {
  if (!suffix) return 1;
  const m = /^(\d*)(\/+)?(\d*)$/.exec(suffix);
  if (!m) return 1;
  const num = m[1] ? Number(m[1]) : 1;
  if (!m[2]) return num;
  const den = m[3] ? Number(m[3]) : 2 ** m[2].length;
  return num / (den || 1);
}

const TOKEN = /"[^"]*"|\[[^\]]*\]|![^!]*!|\{[^}]*\}|\+[^+]*\+|\|[:\]]?|:?\||(\(\d)|([_=^]*)([A-Ga-g])([,']*)(\d*\/*\d*)|([zZxX])(\d*\/*\d*)|(-)|./g;

/** Parse one voice of the score into timed note events. */
export function abcNoteEvents(abc: string, voice: AbcVoice = "vocal"): AbcEvents {
  let unit: [number, number] = [1, 8];
  let meter: [number, number] = [4, 4];
  let bpm = 120;
  let beatNote: [number, number] | null = null;
  let key = "C";
  const musicLines: { text: string; section: string }[] = [];
  let current: AbcVoice | null = null;
  let section = "";
  let sawVoice = false;
  for (const raw of abc.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("%")) {
      if (!line.startsWith("%%")) section = line.replace(/^%+\s*/, "").toLowerCase();
      continue;
    }
    if (/^V:/.test(line)) {
      sawVoice = true;
      current = /vocal/i.test(line) ? "vocal" : "ins";
      continue;
    }
    if (/^[A-Za-z]:/.test(line)) {
      const field = line[0];
      const body = line.slice(2).trim();
      if (field === "L") unit = frac(body, unit);
      else if (field === "M") meter = body === "C" ? [4, 4] : body === "C|" ? [2, 2] : frac(body, meter);
      else if (field === "Q") {
        const q = /(?:(\d+)\s*\/\s*(\d+)\s*=\s*)?(\d+)/.exec(body);
        if (q) {
          bpm = Number(q[3]) || bpm;
          if (q[1] && q[2]) beatNote = [Number(q[1]), Number(q[2])];
        }
      } else if (field === "K") key = body;
      continue;
    }
    if ((current ?? "vocal") === voice) musicLines.push({ text: line, section });
  }
  if (voice === "ins" && !sawVoice) return { notes: [], seconds: 0, bpm, voice, sections: [] };
  const sig = keySignature(key);
  const beat = beatNote ?? [1, meter[1]];
  const secondsPerWhole = (60 / bpm) / (beat[0] / beat[1]);
  const unitSec = secondsPerWhole * (unit[0] / unit[1]);
  const barUnits = (meter[0] / meter[1]) / (unit[0] / unit[1]);
  const notes: AbcNote[] = [];
  const sections = new Set<string>();
  let t = 0;
  let tieOpen = false;
  let barAcc: Record<string, number> = {};
  for (const { text, section: sec } of musicLines) {
    TOKEN.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = TOKEN.exec(text)) !== null) {
      const tok = m[0];
      if (m[3] !== undefined) {
        const letter = m[3].toUpperCase();
        const acc = m[2];
        const accVal = acc === "" ? (letter in barAcc ? barAcc[letter] : sig[letter]) : acc === "=" ? 0 : (acc.split("").reduce((a, c) => a + (c === "^" ? 1 : -1), 0));
        if (acc !== "") barAcc[letter] = accVal;
        const octave = (m[3] === letter ? 4 : 5) + (m[4].match(/'/g)?.length ?? 0) - (m[4].match(/,/g)?.length ?? 0);
        const dur = abcLength(m[5]) * unitSec;
        const midi = 12 * (octave + 1) + LETTER[letter] + accVal;
        const last = notes[notes.length - 1];
        if (tieOpen && last && last.midi === midi && Math.abs(last.t + last.dur - t) < 1e-6) last.dur += dur;
        else notes.push({ t, dur, midi, section: sec });
        sections.add(sec);
        tieOpen = false;
        t += dur;
      } else if (m[6] !== undefined) {
        const bars = m[6] === "Z" || m[6] === "X" ? abcLength(m[7]) * barUnits : abcLength(m[7]);
        t += bars * unitSec;
        tieOpen = false;
      } else if (m[8] !== undefined) {
        tieOpen = true;
      } else if (tok.startsWith("|") || tok.endsWith("|")) {
        barAcc = {};
      }
    }
  }
  return { notes, seconds: t, bpm, voice, sections: [...sections] };
}



export interface SectionCue { label: string; t: number }

/** Section start times in seconds from the planned score. `actualSeconds` rescales when the render came out a
 * different length than the plan (YuE2 reports both). Sections without notes in the chosen voice fall back to the
 * other voice; a leading section always starts at 0. */
export function sectionCues(abc: string, actualSeconds?: number | null): SectionCue[] {
  const voc = abcNoteEvents(abc, "vocal");
  const ins = abcNoteEvents(abc, "ins");
  const planned = Math.max(voc.seconds, ins.seconds);
  const scale = actualSeconds && planned > 0 ? actualSeconds / planned : 1;
  const firsts = new Map<string, number>();
  const order: string[] = [];
  for (const line of abc.split(/\r?\n/)) {
    const l = line.trim();
    if (l.startsWith("%") && !l.startsWith("%%")) {
      const label = l.replace(/^%+\s*/, "").toLowerCase();
      if (label.startsWith("chunk")) continue;
      order.push(label);
    }
  }
  // note events carry their section label; the first note of each occurrence gives its start. Labels repeat (verse,
  // verse) — walk events in time order and open a new cue whenever the label changes.
  const events = [...voc.notes, ...ins.notes].sort((a, b) => a.t - b.t);
  const cues: SectionCue[] = [];
  let current = "";
  for (const n of events) {
    if (n.section !== current) {
      current = n.section;
      cues.push({ label: current || "song", t: Math.round(n.t * scale * 100) / 100 });
    }
  }
  if (cues.length && cues[0].t > 0) cues[0].t = 0;
  if (!cues.length) return order.length ? [{ label: order[0], t: 0 }] : [{ label: "song", t: 0 }];
  void firsts;
  return cues;
}

/** The cue active at time t (seconds). */
export function sectionAt(cues: SectionCue[], t: number): SectionCue | null {
  let hit: SectionCue | null = null;
  for (const c of cues) if (c.t <= t) hit = c; else break;
  return hit;
}
