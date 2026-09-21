"""Refresh successful public hydrography query caches, preserving reviewed selection.

Run from any directory. This does not edit hydro-observations.json or game data.
"""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import json
import urllib.request

ROOT = Path(__file__).resolve().parent
NAMES = ("3dhp-flowline", "nhdplus-flowline", "dec-classification")


def refresh(name):
    path = ROOT / f"hydro-{name}-query.json"
    previous = json.loads(path.read_text(encoding="utf-8"))
    url = previous["url"]
    request = urllib.request.Request(url, headers={"User-Agent": "BlueCountyReferenceResearch/1.0"})
    with urllib.request.urlopen(request, timeout=45) as response:
        data = json.load(response)
    if data.get("error"):
        raise RuntimeError(f"{name}: {data['error']}")
    if data.get("exceededTransferLimit"):
        raise RuntimeError(f"{name}: source query exceeded transfer limit")
    document = {"url": url, "retrievedAt": datetime.now(timezone.utc).isoformat(), "response": data}
    path.write_text(json.dumps(document, indent=2) + "\n", encoding="utf-8")
    return {"source": name, "features": len(data.get("features", []))}


if __name__ == "__main__":
    with ThreadPoolExecutor(max_workers=3) as executor:
        for result in executor.map(refresh, NAMES):
            print(json.dumps(result))
