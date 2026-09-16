"""Thin async clients for the three GPU sidecars (same HTTP contracts vidmakr uses)."""
from typing import Any, Optional

import httpx

from . import config


async def healthz(url: str, client: Optional[httpx.AsyncClient] = None) -> dict[str, Any]:
    own = client is None
    client = client or httpx.AsyncClient(timeout=4.0)
    try:
        r = await client.get(f"{url}/healthz")
        r.raise_for_status()
        data = r.json()
        return {"ok": bool(data.get("ok", True)), "url": url, "gpu": (data.get("gpu") or {}).get("name"),
                "loaded": data.get("loaded")}
    except Exception as e:  # unreachable, refused, bad JSON — all "down" for the caller
        return {"ok": False, "url": url, "error": str(e)[:200]}
    finally:
        if own:
            await client.aclose()


async def all_health(client: Optional[httpx.AsyncClient] = None) -> dict[str, dict[str, Any]]:
    return {"yue2": await healthz(config.YUE2_URL, client),
            "sheetsage": await healthz(config.SHEETSAGE_URL, client),
            "clipgrab": await healthz(config.CLIPGRAB_URL, client)}
