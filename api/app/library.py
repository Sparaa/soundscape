"""Library + playlists: saved songs persist on disk (audio is exempt from any no-content rule); unsaved radio songs are
pruned after RETAIN_HOURS; playlists are ordered lists of songs; export = zip of FLACs + an .m3u + the song JSONs."""
from __future__ import annotations

import io
import json
import time
import uuid
import zipfile
from pathlib import Path
from typing import Any, Optional

RETAIN_HOURS = 24.0


def prune(con, library: Path, *, now: Optional[float] = None, retain_hours: float = RETAIN_HOURS) -> list[str]:
    """Delete unsaved, unliked, already-played/rejected radio songs older than retain_hours (file + sidecar + row)."""
    now = now or time.time()
    cutoff = now - retain_hours * 3600
    gone = []
    rows = con.execute("SELECT id, path FROM songs WHERE saved=0 AND vote <= 0 AND status IN ('played','rejected') AND created < ? "
                       "AND id NOT IN (SELECT song_id FROM playlist_items)", (cutoff,)).fetchall()
    for r in rows:
        for p in (Path(r["path"]), Path(r["path"]).with_suffix(".json")):
            try:
                p.unlink()
            except FileNotFoundError:
                pass
        con.execute("DELETE FROM songs WHERE id=?", (r["id"],))
        gone.append(r["id"])
    con.commit()
    return gone


def import_song(con, library: Path, *, data: bytes, filename: str, title: Optional[str], seconds: Optional[float]) -> str:
    """Your own file into the library (saved, no plan). Kept in library/songs like rendered songs."""
    song_id = uuid.uuid4().hex[:12]
    ext = (Path(filename).suffix or ".bin").lower()
    path = library / "songs" / f"{song_id}{ext}"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    con.execute("INSERT INTO songs (id, station_id, title, seconds, path, created, status, saved, explain) VALUES (?,?,?,?,?,?,?,?,?)",
                (song_id, None, title or Path(filename).stem, seconds, str(path), time.time(), "played", 1, f"imported from {filename}"))
    con.commit()
    return song_id


# ---- playlists

def create_playlist(con, name: str) -> str:
    pid = uuid.uuid4().hex[:12]
    con.execute("INSERT INTO playlists (id, name, created) VALUES (?,?,?)", (pid, " ".join(name.split())[:80] or "Playlist", time.time()))
    con.commit()
    return pid


def playlist_items(con, pid: str) -> list[str]:
    return [r["song_id"] for r in con.execute("SELECT song_id FROM playlist_items WHERE playlist_id=? ORDER BY position", (pid,))]


def set_items(con, pid: str, song_ids: list[str]) -> None:
    """Replace the ordering (also used for reorder / remove). Songs in a playlist are auto-saved so pruning skips them."""
    con.execute("DELETE FROM playlist_items WHERE playlist_id=?", (pid,))
    seen: set[str] = set()
    pos = 0
    for sid in song_ids:
        if sid in seen or not con.execute("SELECT 1 FROM songs WHERE id=?", (sid,)).fetchone():
            continue
        seen.add(sid)
        con.execute("INSERT INTO playlist_items (playlist_id, song_id, position) VALUES (?,?,?)", (pid, sid, pos))
        con.execute("UPDATE songs SET saved=1 WHERE id=?", (sid,))
        pos += 1
    con.commit()


def add_item(con, pid: str, song_id: str, position: Optional[int] = None) -> list[str]:
    items = [s for s in playlist_items(con, pid) if s != song_id]
    items.insert(len(items) if position is None else max(0, min(len(items), position)), song_id)
    set_items(con, pid, items)
    return playlist_items(con, pid)


def export_zip(con, pid: str, name: str, songs: list[dict[str, Any]]) -> bytes:
    """FLACs + playlist.m3u + one JSON per song (style, lyrics, score, plan) — everything needed to re-import elsewhere."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_STORED) as z:
        m3u = ["#EXTM3U"]
        for i, s in enumerate(songs, 1):
            p = Path(s["path"])
            if not p.exists():
                continue
            fname = f"{i:02d} - {(s.get('title') or s['id']).replace('/', '-')}{p.suffix}"
            z.write(p, fname)
            m3u.append(f"#EXTINF:{int(s.get('seconds') or 0)},{s.get('title') or s['id']}")
            m3u.append(fname)
            z.writestr(fname.rsplit(".", 1)[0] + ".json", json.dumps({k: s.get(k) for k in ("id", "title", "style", "lyrics", "abc", "plan", "seconds", "explain", "created")}, indent=1))
        z.writestr("playlist.m3u", "\n".join(m3u) + "\n")
    return buf.getvalue()
