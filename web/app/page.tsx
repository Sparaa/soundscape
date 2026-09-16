"use client";
import { useEffect, useState } from "react";
import { getHealth, sidecarLine, type Health } from "@/lib/api";

export default function Home() {
  const [health, setHealth] = useState<Health | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    getHealth().then(setHealth).catch((e) => setErr(String(e)));
  }, []);
  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-5xl font-semibold tracking-tight">Soundscape</h1>
      <p className="text-zinc-400">A radio that never runs out of songs.</p>
      <div className="text-sm text-zinc-300 font-mono flex flex-col gap-1">
        {err && <span className="text-red-400">api offline: {err}</span>}
        {health && Object.entries(health.sidecars).map(([n, h]) => <span key={n}>{sidecarLine(n, h)}</span>)}
        {health && <span>llm · {health.llm.model} · {health.llm.base_url}</span>}
      </div>
    </main>
  );
}
