"use client";
import { patchSong, planLabel, songAudioUrl, type Playlist, type Song } from "@/lib/api";
import { mmss } from "@/lib/profile";

/** One library / playlist row: title, plan, length, inline audio, save + votes, add-to-playlist, extra actions. */
export default function SongRow({ song, playlists, onChange, onAdd, extra }: {
  song: Song; playlists?: Playlist[]; onChange: (s: Song) => void; onAdd?: (playlistId: string) => void; extra?: React.ReactNode;
}) {
  const flag = async (flags: Parameters<typeof patchSong>[1]) => onChange(await patchSong(song.id, flags));
  return (
    <div className="border border-zinc-800 rounded-xl px-4 py-3 flex flex-col gap-2">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex-1 min-w-[12rem]">
          <div className="font-medium">{song.title ?? song.id}</div>
          <div className="text-xs text-zinc-400">{planLabel(song.plan) || song.explain || "imported"} · {mmss(song.seconds)}{song.plan ? ` · ${song.plan.bpm} BPM` : ""}</div>
        </div>
        <audio src={songAudioUrl(song.id)} controls preload="none" className="h-8 max-w-[16rem]" />
        <button onClick={() => flag({ saved: !song.saved })} className={`text-xs px-2 py-1 rounded border ${song.saved ? "border-emerald-500 text-emerald-300" : "border-zinc-700 text-zinc-300"}`}>{song.saved ? "saved" : "save"}</button>
        <button onClick={() => flag({ vote: song.vote > 0 ? 0 : 1 })} className={`text-xs px-2 py-1 rounded border ${song.vote > 0 ? "border-pink-500 text-pink-300" : "border-zinc-700 text-zinc-300"}`} title="more like this">{song.vote > 0 ? "♥" : "♡"}</button>
        <button onClick={() => flag({ vote: song.vote < 0 ? 0 : -1 })} className={`text-xs px-2 py-1 rounded border ${song.vote < 0 ? "border-amber-500 text-amber-300" : "border-zinc-700 text-zinc-300"}`} title="less like this">👎</button>
        {playlists && onAdd && playlists.length > 0 && (
          <select defaultValue="" onChange={(e) => { if (e.target.value) { onAdd(e.target.value); e.target.value = ""; } }} className="text-xs bg-zinc-900 border border-zinc-800 rounded px-1 py-1">
            <option value="">+ playlist…</option>
            {playlists.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
        {extra}
      </div>
    </div>
  );
}
