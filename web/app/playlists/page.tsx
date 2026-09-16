"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { createPlaylist, deletePlaylist, listPlaylists, type Playlist } from "@/lib/api";
import { mmss } from "@/lib/profile";

export default function PlaylistsPage() {
  const [lists, setLists] = useState<Playlist[]>([]);
  const [name, setName] = useState("");
  const refresh = useCallback(() => { listPlaylists().then(setLists).catch(() => undefined); }, []);
  useEffect(refresh, [refresh]);
  return (
    <main className="min-h-screen max-w-3xl mx-auto flex flex-col gap-6 p-8">
      <header className="flex items-baseline gap-4"><Link href="/" className="text-zinc-500 hover:text-zinc-200">← stations</Link><h1 className="text-3xl font-semibold tracking-tight">Playlists</h1><Link href="/library" className="text-zinc-400 hover:text-zinc-100">library →</Link></header>
      <div className="flex gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New playlist…" className="flex-1 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 outline-none focus:border-zinc-500" />
        <button onClick={async () => { if (name.trim()) { await createPlaylist(name.trim()); setName(""); refresh(); } }} className="px-4 py-2 rounded-lg bg-zinc-100 text-black font-medium">Create</button>
      </div>
      {lists.map((p) => (
        <div key={p.id} className="flex items-center gap-3 border border-zinc-800 rounded-xl px-4 py-3">
          <Link href={`/playlists/${p.id}`} className="flex-1"><div className="font-medium">{p.name}</div><div className="text-xs text-zinc-400">{p.items.length} songs · {mmss(p.seconds)}</div></Link>
          <button onClick={async () => { if (confirm(`Delete playlist “${p.name}”? (songs stay in the library)`)) { await deletePlaylist(p.id); refresh(); } }} className="text-xs text-zinc-500 hover:text-red-400">delete</button>
        </div>
      ))}
    </main>
  );
}
