export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3021";

export interface SidecarHealth { ok: boolean; url: string; gpu?: string | null; loaded?: boolean | null; error?: string }
export interface Health { ok: boolean; sidecars: Record<"yue2" | "sheetsage" | "clipgrab", SidecarHealth>; llm: { base_url: string; model: string }; library: string }

export interface Tag { label: string; weight: number }
export interface Profile {
  seeds: number;
  tags: Record<string, Tag[]>;
  bpm: { low: number; high: number; center: number } | null;
  keys: string[];
  sections: string[];
  phrases: Record<string, number[]>;
  instrumental: boolean;
  language: string;
  style: string;
  seconds: number | null;
}
export interface Seed {
  id: string; title: string; source: string | null; seconds: number | null; created: number;
  key: string | null; bpm: number | null; sections: string[] | null; style_guess: string | null;
  promoted_sections: string[] | null; warnings: string[] | null; has_score: boolean;
}
export interface Station { id: string; name: string; created: number; profile: Profile | null; settings: { language?: string } | null; seeds: Seed[] }

async function j<T>(r: Response): Promise<T> {
  if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 300)}`);
  return r.json();
}

export async function getHealth(): Promise<Health> {
  return j(await fetch(`${API_URL}/healthz`, { cache: "no-store" }));
}
export async function listStations(): Promise<Station[]> {
  return j(await fetch(`${API_URL}/stations`, { cache: "no-store" }));
}
export async function getStation(id: string): Promise<Station> {
  return j(await fetch(`${API_URL}/stations/${id}`, { cache: "no-store" }));
}
export async function createStation(name: string, language = "English"): Promise<Station> {
  return j(await fetch(`${API_URL}/stations`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, language }) }));
}
export async function deleteStation(id: string): Promise<void> {
  await j(await fetch(`${API_URL}/stations/${id}`, { method: "DELETE" }));
}
export async function addSeedFile(stationId: string, file: File): Promise<Station> {
  const fd = new FormData();
  fd.append("file", file, file.name);
  return j(await fetch(`${API_URL}/stations/${stationId}/seeds`, { method: "POST", body: fd }));
}
export async function addSeedUrl(stationId: string, url: string): Promise<Station> {
  const fd = new FormData();
  fd.append("url", url);
  return j(await fetch(`${API_URL}/stations/${stationId}/seeds`, { method: "POST", body: fd }));
}
export async function deleteSeed(seedId: string): Promise<Station> {
  return j(await fetch(`${API_URL}/seeds/${seedId}`, { method: "DELETE" }));
}
export function seedAudioUrl(seedId: string): string {
  return `${API_URL}/seeds/${seedId}/audio`;
}

/** One line per sidecar for the status strip: "yue2 · RTX 4090 · idle". */
export function sidecarLine(name: string, h: SidecarHealth): string {
  if (!h.ok) return `${name} · offline`;
  return `${name} · ${h.gpu ?? "gpu?"} · ${h.loaded ? "loaded" : "idle"}`;
}
