import asyncio, io
import httpx
from fastapi.testclient import TestClient

from app import analyze, ingest, main

ANALYSIS = {"abc": "X:1\nK:C\n% verse\nV: Vocal\nCDEF|", "seconds": 30.0, "key": "C major", "bpm": 100, "bars": 1, "sections": ["verse"],
            "tags": {"genre": [{"label": "folk", "p": 0.9}], "vocal": [{"label": "male vocals", "p": 0.8}]}, "style_guess": "English, folk", "warnings": []}


def test_station_lifecycle_with_upload_and_link(monkeypatch):
    calls = {}

    async def fake_transcribe(audio, *, name="", language="English", **kw):
        calls.setdefault("names", []).append(name)
        return dict(ANALYSIS, promoted_sections=[])

    async def fake_fetch(url, *, client=None):
        return b"FAKEAUDIO", {"title": "Linked song", "uploader": "someone", "duration": 30.0, "source": url}

    monkeypatch.setattr(analyze, "transcribe", fake_transcribe)
    monkeypatch.setattr(ingest, "fetch_link", fake_fetch)
    monkeypatch.setattr(ingest, "probe_seconds", lambda p: 30.0)
    c = TestClient(main.app)
    st = c.post("/stations", json={"name": "  Late night   drive "}).json()
    assert st["name"] == "Late night drive" and st["seeds"] == [] and st["profile"] is None
    sid = st["id"]
    r = c.post(f"/stations/{sid}/seeds", files={"file": ("mine.mp3", io.BytesIO(b"ID3..."), "audio/mpeg")})
    assert r.status_code == 200, r.text
    st = r.json()
    assert st["seeds"][0]["title"] == "mine" and st["seeds"][0]["key"] == "C major" and st["seeds"][0]["has_score"]
    assert st["profile"]["seeds"] == 1 and st["profile"]["style"].startswith("English, folk")
    r = c.post(f"/stations/{sid}/seeds", data={"url": "https://youtu.be/abc"})
    assert r.status_code == 200 and len(r.json()["seeds"]) == 2 and r.json()["seeds"][1]["source"] == "https://youtu.be/abc"
    assert calls["names"] == ["mine", "Linked song"]
    seed_id = st["seeds"][0]["id"]
    assert c.get(f"/seeds/{seed_id}/audio").content == b"ID3..."
    assert c.get(f"/seeds/{seed_id}/analysis").json()["bpm"] == 100
    assert c.post(f"/stations/{sid}/seeds", data={"url": "not a url"}).status_code == 400
    r = c.delete(f"/seeds/{seed_id}")
    assert len(r.json()["seeds"]) == 1 and r.json()["profile"]["seeds"] == 1
    assert c.delete(f"/stations/{sid}").json() == {"ok": True}
    assert c.get(f"/stations/{sid}").status_code == 404


def test_fetch_link_uses_clipgrab_audio_only():
    seen = {}
    def handler(req: httpx.Request):
        if req.url.path == "/info":
            return httpx.Response(200, json={"title": "Vid", "uploader": "U", "duration": 42})
        seen["body"] = req.read()
        return httpx.Response(200, content=b"M4A")
    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    data, meta = asyncio.run(ingest.fetch_link("https://example.com/v", client=client))
    import json
    assert data == b"M4A" and meta["title"] == "Vid" and json.loads(seen["body"]) == {"url": "https://example.com/v", "audio_only": True}
    assert ingest.ext_for("song.FLAC", None) == "flac" and ingest.ext_for("", "audio/mpeg") == "mp3" and ingest.is_url("ftp://x") is False


def test_transcribe_polls_the_job(monkeypatch):
    states = iter(["queued", "running", "done"])
    def handler(req: httpx.Request):
        if req.url.path == "/transcribe":
            return httpx.Response(200, json={"job_id": "j1", "state": "queued", "position": 0})
        return httpx.Response(200, json={"state": next(states), **ANALYSIS})
    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    out = asyncio.run(analyze.transcribe(b"x", name="n", client=client, poll_s=0))
    assert out["key"] == "C major" and out["promoted_sections"] == [] and "timing" in out
