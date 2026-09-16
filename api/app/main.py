"""Soundscape API — Phase 0 skeleton: health + library bootstrap. Phases 1-4 add stations, the agent, songs, playlists."""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import config, db, sidecars

app = FastAPI(title="Soundscape", version="0.0.1")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
state: dict = {}


@app.on_event("startup")
async def _startup() -> None:
    state["db"] = db.connect(config.LIBRARY_DIR)


@app.get("/healthz")
async def healthz() -> dict:
    side = await sidecars.all_health()
    return {"ok": all(s["ok"] for s in side.values()), "sidecars": side,
            "llm": {"base_url": config.LLM_BASE_URL, "model": config.LLM_MODEL}, "library": str(config.LIBRARY_DIR)}
