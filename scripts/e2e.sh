#!/bin/bash
# End-to-end: seed a station from a local file and play until two songs are cued. usage: scripts/e2e.sh song.mp3 [api url]
set -euo pipefail
FILE="${1:?song file}"; API="${2:-http://127.0.0.1:3021}"
sid=$(curl -sf -X POST "$API/stations" -H 'Content-Type: application/json' -d '{"name":"e2e"}' | python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])')
echo "station $sid — analysing $(basename "$FILE")"
curl -sf -X POST "$API/stations/$sid/seeds" -F "file=@$FILE" | python3 -c 'import sys,json; s=json.load(sys.stdin); p=s["profile"]; print("profile:", p["style"])'
curl -sf -X POST "$API/stations/$sid/play" >/dev/null; t0=$(date +%s)
while :; do
  st=$(curl -sf "$API/stations/$sid/radio"); n=$(echo "$st" | python3 -c 'import sys,json; print(len(json.load(sys.stdin)["ready"]))')
  echo "[$(( $(date +%s) - t0 ))s] $(echo "$st" | python3 -c 'import sys,json; d=json.load(sys.stdin); r=d.get("rendering") or {}; print(d["state"], "ready", len(d["ready"]), "rendering", r.get("stage"), r.get("plan",{}).get("mode"))')"
  [ "$n" -ge 2 ] && break; sleep 10
done
curl -sf "$API/stations/$sid/radio" | python3 -c 'import sys,json; [print("cued:", s["title"], "|", s["explain"], "|", s["seconds"], "s | gate", s["gate"]["ok"], s["gate"].get("similarity")) for s in json.load(sys.stdin)["ready"]]'
curl -sf -X POST "$API/stations/$sid/stop" >/dev/null && echo "stopped (one spare kept)"
