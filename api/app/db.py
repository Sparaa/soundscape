"""SQLite schema: stations → seeds; songs (rendered or imported) → playlists. Audio lives beside it on disk."""
import sqlite3
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS stations (id TEXT PRIMARY KEY, name TEXT NOT NULL, created REAL NOT NULL, profile TEXT, settings TEXT);
CREATE TABLE IF NOT EXISTS seeds (id TEXT PRIMARY KEY, station_id TEXT NOT NULL REFERENCES stations(id), title TEXT, source TEXT,
  seconds REAL, analysis TEXT, created REAL NOT NULL);
CREATE TABLE IF NOT EXISTS songs (id TEXT PRIMARY KEY, station_id TEXT REFERENCES stations(id), title TEXT, style TEXT, lyrics TEXT,
  abc TEXT, plan TEXT, seconds REAL, path TEXT NOT NULL, liked INTEGER DEFAULT 0, saved INTEGER DEFAULT 0, created REAL NOT NULL);
CREATE TABLE IF NOT EXISTS playlists (id TEXT PRIMARY KEY, name TEXT NOT NULL, created REAL NOT NULL);
CREATE TABLE IF NOT EXISTS playlist_items (playlist_id TEXT NOT NULL REFERENCES playlists(id), song_id TEXT NOT NULL REFERENCES songs(id),
  position INTEGER NOT NULL, PRIMARY KEY (playlist_id, position));
"""


def connect(library_dir: Path) -> sqlite3.Connection:
    library_dir.mkdir(parents=True, exist_ok=True)
    (library_dir / "songs").mkdir(exist_ok=True)
    (library_dir / "seeds").mkdir(exist_ok=True)
    con = sqlite3.connect(library_dir / "soundscape.db", check_same_thread=False)
    con.row_factory = sqlite3.Row
    con.executescript(SCHEMA)
    return con
