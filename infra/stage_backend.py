"""Copy only the runtime backend code into infra/build/api so `sam build` never packages
tests, virtual environments or local files.  Usage:  python infra/stage_backend.py"""

import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "backend"
DEST = Path(__file__).resolve().parent / "build" / "api"

if DEST.exists():
    shutil.rmtree(DEST)
DEST.mkdir(parents=True)
shutil.copytree(SRC / "app", DEST / "app", ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
shutil.copy2(SRC / "requirements.txt", DEST / "requirements.txt")
print(f"Staged backend into {DEST}")
