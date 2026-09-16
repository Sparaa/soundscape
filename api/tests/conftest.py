import os, sys, tempfile
from pathlib import Path
os.environ.setdefault("LIBRARY_DIR", tempfile.mkdtemp(prefix="soundscape-test-"))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
