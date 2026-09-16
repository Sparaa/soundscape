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
