import asyncio, sqlite3
from pathlib import Path

import httpx

from app import db, sidecars


def test_schema_bootstraps(tmp_path: Path):
    con = db.connect(tmp_path)
    tables = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert {"stations", "seeds", "songs", "playlists", "playlist_items"} <= tables
    assert (tmp_path / "songs").is_dir() and (tmp_path / "seeds").is_dir()


def test_health_marks_unreachable_sidecars_down():
    def handler(request: httpx.Request) -> httpx.Response:
        if "3015" in str(request.url):
            return httpx.Response(200, json={"ok": True, "loaded": False, "gpu": {"name": "RTX 4090"}})
        raise httpx.ConnectError("refused")
    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    out = asyncio.run(sidecars.all_health(client))
    assert out["yue2"] == {"ok": True, "url": sidecars.config.YUE2_URL, "gpu": "RTX 4090", "loaded": False}
    assert out["sheetsage"]["ok"] is False and "refused" in out["sheetsage"]["error"]


def test_migrate_adds_columns_to_an_old_library(tmp_path: Path):
    con = sqlite3.connect(tmp_path / "soundscape.db")
    con.execute("CREATE TABLE songs (id TEXT PRIMARY KEY, station_id TEXT, title TEXT, style TEXT, lyrics TEXT, abc TEXT, plan TEXT, "
                "seconds REAL, path TEXT NOT NULL, liked INTEGER DEFAULT 0, saved INTEGER DEFAULT 0, created REAL NOT NULL)")
    con.commit(); con.close()
    con = db.connect(tmp_path)
    cols = {r[1] for r in con.execute("PRAGMA table_info(songs)")}
    assert {"status", "explain", "gate", "played"} <= cols
    assert db.migrate(con) == []          # idempotent
