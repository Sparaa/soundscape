export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3021";

export interface SidecarHealth { ok: boolean; url: string; gpu?: string | null; loaded?: boolean | null; error?: string }
export interface Health { ok: boolean; sidecars: Record<"yue2" | "sheetsage" | "clipgrab", SidecarHealth>; llm: { base_url: string; model: string }; library: string }

export async function getHealth(): Promise<Health> {
  const r = await fetch(`${API_URL}/healthz`, { cache: "no-store" });
  if (!r.ok) throw new Error(`api ${r.status}`);
  return r.json();
}

/** One line per sidecar for the status strip: "yue2 · RTX 4090 · idle". */
export function sidecarLine(name: string, h: SidecarHealth): string {
  if (!h.ok) return `${name} · offline`;
  return `${name} · ${h.gpu ?? "gpu?"} · ${h.loaded ? "loaded" : "idle"}`;
}
