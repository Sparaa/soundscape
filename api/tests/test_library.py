import io, json, time, zipfile
from fastapi.testclient import TestClient

from app import library, main, steer

PROFILE = {"tags": {"genre": [{"label": "EDM", "weight": 0.5}, {"label": "orchestral film score", "weight": 0.4}], "mood": [{"label": "dark", "weight": 0.5}],
                    "instruments": [], "vocal": [{"label": "female vocals", "weight": 0.6}], "voice": [], "production": []},
           "bpm": {"low": 110, "high": 130, "center": 120}, "keys": [], "sections": ["verse"], "phrases": {}, "instrumental": False,
           "language": "English", "style": "x", "seconds": 200}


def test_steer_moves_weights_and_restyles():
    liked = [{"genre": [{"label": "EDM", "p": 0.9}], "mood": [{"label": "energetic", "p": 0.8}]}]
    disliked = [{"genre": [{"label": "orchestral film score", "p": 0.9}]}]
    out = steer.steer(PROFILE, liked, disliked)
    g = {t["label"]: t["weight"] for t in out["tags"]["genre"]}
    assert g["EDM"] > 0.5 and g["orchestral film score"] < 0.4
    assert any(t["label"] == "energetic" for t in out["tags"]["mood"])
    assert out["style"].startswith("English, EDM") and out["steered"] == {"likes": 1, "dislikes": 1}
    assert steer.steer(PROFILE, [], []) is PROFILE
    assert PROFILE["tags"]["genre"][0]["weight"] == 0.5     # input untouched


def _song_row(c, sid, title, created=None, status="played"):
    main.con().execute("INSERT INTO songs (id, station_id, title, seconds, path, created, status, saved) VALUES (?,?,?,?,?,?,?,0)",
                       (sid, None, title, 100.0, f"/tmp/{sid}.flac", created or time.time(), status))
    main.con().commit()


def test_playlists_votes_import_prune_export(tmp_path, monkeypatch):
    monkeypatch.setattr(main.config, "LIBRARY_DIR", tmp_path)
    monkeypatch.setattr(main.ingest, "probe_seconds", lambda p: 12.5)
    main.reset_db()
    with TestClient(main.app) as c:
        # two real files so export can zip them
        for sid in ("a1", "b2"):
            p = tmp_path / "songs" / f"{sid}.flac"; p.parent.mkdir(parents=True, exist_ok=True); p.write_bytes(b"fLaC" + sid.encode())
            main.con().execute("INSERT INTO songs (id, station_id, title, seconds, path, created, status, saved) VALUES (?,?,?,?,?,?,?,0)",
                               (sid, None, sid.upper(), 90.0, str(p), time.time() - 2 * 86400, "played"))
        main.con().commit()
        assert c.patch("/songs/a1", json={"vote": -1}).json()["vote"] == -1
        assert c.patch("/songs/a1", json={"liked": True}).json()["vote"] == 1
        pl = c.post("/playlists", json={"name": "  Late   set "}).json()
        assert pl["name"] == "Late set" and pl["items"] == []
        pid = pl["id"]
        assert [s["id"] for s in c.post(f"/playlists/{pid}/items", json={"song_id": "b2"}).json()["items"]] == ["b2"]
        pl = c.post(f"/playlists/{pid}/items", json={"song_id": "a1", "position": 0}).json()
        assert [s["id"] for s in pl["items"]] == ["a1", "b2"] and pl["seconds"] == 180.0
        assert c.get("/songs/b2").json()["saved"] is True            # in a playlist → saved
        assert [s["id"] for s in c.patch(f"/playlists/{pid}", json={"order": ["b2", "a1", "zzz"]}).json()["items"]] == ["b2", "a1"]
        z = zipfile.ZipFile(io.BytesIO(c.get(f"/playlists/{pid}/export.zip").content))
        names = z.namelist()
        assert "playlist.m3u" in names and any(n.startswith("01 - B2") for n in names) and any(n.endswith(".json") for n in names)
        assert "#EXTINF:90,B2" in z.read("playlist.m3u").decode()
        imp = c.post("/library/import", files={"file": ("mine.wav", io.BytesIO(b"RIFF...."), "audio/wav")}).json()
        assert imp["saved"] is True and imp["seconds"] == 12.5 and imp["explain"].startswith("imported")
        lib = c.get("/library").json()
        assert {s["id"] for s in lib} >= {"a1", "b2", imp["id"]}
        # prune: an old unsaved, unvoted, played song goes; playlist members / saved / voted stay
        main.con().execute("INSERT INTO songs (id, station_id, title, seconds, path, created, status, saved) VALUES ('old',NULL,'Old',50,?,?, 'played',0)",
                           (str(tmp_path / "songs" / "old.flac"), time.time() - 3 * 86400))
        main.con().commit()
        assert c.post("/library/prune").json()["pruned"] == ["old"]
        assert c.delete(f"/playlists/{pid}/items/a1").json()["items"][0]["id"] == "b2"
        assert c.delete(f"/playlists/{pid}").json() == {"ok": True}
        assert c.delete("/songs/a1").json() == {"ok": True} and c.get("/songs/a1").status_code == 404
