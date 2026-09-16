"""Soundscape settings — environment only (no config files, no accounts)."""
import os
from pathlib import Path

YUE2_URL = os.environ.get("YUE2_URL", "http://yue2:3015").rstrip("/")
SHEETSAGE_URL = os.environ.get("SHEETSAGE_URL", "http://sheetsage:3016").rstrip("/")
CLIPGRAB_URL = os.environ.get("CLIPGRAB_URL", "http://clipgrab:3014").rstrip("/")
LLM_BASE_URL = os.environ.get("LLM_BASE_URL", "http://host.docker.internal:30000/v1").rstrip("/")
LLM_MODEL = os.environ.get("LLM_MODEL", "qwen3.8-27b")
LLM_API_KEY = os.environ.get("LLM_API_KEY", "local")
LIBRARY_DIR = Path(os.environ.get("LIBRARY_DIR", "./library"))
