"""Soundscape API. Phase 1: stations + seeds (ingest → analysis → profile). Health from Phase 0."""
from __future__ import annotations

import json
import time
import uuid
from pathlib import Path
from typing import Any, Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel

from . import abc as abclib, analyze, config, db, ingest, profile, sidecars

app = FastAPI(title="Soundscape", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
state: dict[str, Any] = {}


def con():
    if "db" not in state:
        state["db"] = db.connect(config.LIBRARY_DIR)
    return state["db"]


@app.on_event("startup")
async def _startup() -> None:
    con()


@app.get("/healthz")
async def healthz() -> dict:
    side = await sidecars.all_health()
    return {"ok": all(s["ok"] for s in side.values()), "sidecars": side,
            "llm": {"base_url": config.LLM_BASE_URL, "model": config.LLM_MODEL}, "library": str(config.LIBRARY_DIR)}


# ---- stations ---------------------------------------------------------------

class StationCreate(BaseModel):
    name: str
    language: str = "English"


def _row(r) -> dict[str, Any]:
    d = dict(r)
    for k in ("profile", "settings", "analysis"):
        if k in d and isinstance(d[k], str):
            try:
                d[k] = json.loads(d[k])
            except ValueError:
                pass
    return d


def _station(sid: str) -> dict[str, Any]:
    r = con().execute("SELECT * FROM stations WHERE id=?", (sid,)).fetchone()
    if not r:
        raise HTTPException(404, "station not found")
    s = _row(r)
    s["seeds"] = [_seed_summary(_row(x)) for x in con().execute("SELECT * FROM seeds WHERE station_id=? ORDER BY created", (sid,))]
    return s


def _seed_summary(seed: dict[str, Any]) -> dict[str, Any]:
    a = seed.get("analysis") or {}
    return {"id": seed["id"], "title": seed["title"], "source": seed["source"], "seconds": seed["seconds"], "created": seed["created"],
            "key": a.get("key"), "bpm": a.get("bpm"), "sections": a.get("sections"), "style_guess": a.get("style_guess"),
            "promoted_sections": a.get("promoted_sections"), "warnings": a.get("warnings"), "has_score": bool(a.get("abc"))}


def _rebuild_profile(sid: str) -> dict[str, Any]:
    st = _row(con().execute("SELECT * FROM stations WHERE id=?", (sid,)).fetchone())
    analyses = [_row(x)["analysis"] for x in con().execute("SELECT analysis FROM seeds WHERE station_id=?", (sid,))]
    analyses = [a for a in analyses if isinstance(a, dict)]
    prof = profile.build_profile(analyses, language=(st.get("settings") or {}).get("language", "English")) if analyses else None
    con().execute("UPDATE stations SET profile=? WHERE id=?", (json.dumps(prof) if prof else None, sid))
    con().commit()
    return prof


@app.post("/stations")
def create_station(req: StationCreate) -> dict:
    sid = uuid.uuid4().hex[:12]
    name = " ".join(req.name.split())[:80] or "Untitled station"
    con().execute("INSERT INTO stations (id, name, created, profile, settings) VALUES (?,?,?,?,?)",
                  (sid, name, time.time(), None, json.dumps({"language": req.language})))
    con().commit()
    return _station(sid)


@app.get("/stations")
def list_stations() -> list[dict]:
    return [_station(_row(r)["id"]) for r in con().execute("SELECT id FROM stations ORDER BY created DESC")]


@app.get("/stations/{sid}")
def get_station(sid: str) -> dict:
    return _station(sid)


@app.delete("/stations/{sid}")
def delete_station(sid: str) -> dict:
    _station(sid)
    for r in con().execute("SELECT id FROM seeds WHERE station_id=?", (sid,)):
        for p in (config.LIBRARY_DIR / "seeds").glob(f"{r['id']}.*"):
            p.unlink(missing_ok=True)
    con().execute("DELETE FROM seeds WHERE station_id=?", (sid,))
    con().execute("DELETE FROM stations WHERE id=?", (sid,))
    con().commit()
    return {"ok": True}


# ---- seeds ------------------------------------------------------------------

@app.post("/stations/{sid}/seeds")
async def add_seed(sid: str, file: Optional[UploadFile] = File(default=None), url: Optional[str] = Form(default=None),
                   title: Optional[str] = Form(default=None)) -> dict:
    """Multipart: either `file` (any audio) or `url` (anything yt-dlp fetches). The audio is stored under
    library/seeds and analysed (SheetSage2 score + CLAP sound tags); the station profile is rebuilt."""
    st = _station(sid)
    seed_id = uuid.uuid4().hex[:12]
    if file is not None:
        data = await file.read()
        if not data:
            raise HTTPException(400, "empty file")
        ext = ingest.ext_for(file.filename or "", file.content_type)
        meta = {"title": title or Path(file.filename or "upload").stem, "source": f"upload:{file.filename}"}
    elif url and ingest.is_url(url):
        try:
            data, meta = await ingest.fetch_link(url.strip())
        except abclib.MusicError as e:
            raise HTTPException(502, str(e))
        ext = "m4a"
        if title:
            meta["title"] = title
    else:
        raise HTTPException(400, "send a file or a URL")
    path = ingest.save_seed_audio(config.LIBRARY_DIR, seed_id, data, ext)
    seconds = ingest.probe_seconds(path) or meta.get("duration")
    try:
        analysis = await analyze.transcribe(data, name=meta["title"], language=(st.get("settings") or {}).get("language", "English"))
    except abclib.MusicError as e:
        path.unlink(missing_ok=True)
        raise HTTPException(502, f"analysis failed: {e}")
    con().execute("INSERT INTO seeds (id, station_id, title, source, seconds, analysis, created) VALUES (?,?,?,?,?,?,?)",
                  (seed_id, sid, meta["title"][:200], meta.get("source"), seconds, json.dumps(analysis), time.time()))
    con().commit()
    _rebuild_profile(sid)
    return _station(sid)


@app.delete("/seeds/{seed_id}")
def delete_seed(seed_id: str) -> dict:
    r = con().execute("SELECT station_id FROM seeds WHERE id=?", (seed_id,)).fetchone()
    if not r:
        raise HTTPException(404, "seed not found")
    for p in (config.LIBRARY_DIR / "seeds").glob(f"{seed_id}.*"):
        p.unlink(missing_ok=True)
    con().execute("DELETE FROM seeds WHERE id=?", (seed_id,))
    con().commit()
    _rebuild_profile(r["station_id"])
    return _station(r["station_id"])


@app.get("/seeds/{seed_id}/audio")
def seed_audio(seed_id: str):
    hits = list((config.LIBRARY_DIR / "seeds").glob(f"{seed_id}.*"))
    if not hits:
        raise HTTPException(404, "no audio")
    return FileResponse(hits[0])


@app.get("/seeds/{seed_id}/analysis")
def seed_analysis(seed_id: str) -> dict:
    r = con().execute("SELECT analysis FROM seeds WHERE id=?", (seed_id,)).fetchone()
    if not r:
        raise HTTPException(404, "seed not found")
    return _row(r)["analysis"]
