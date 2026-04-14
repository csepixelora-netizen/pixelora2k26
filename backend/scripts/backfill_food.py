"""
Backfill ``food`` on all Firestore ``registrations`` documents (and optional local JSONL).

  cd backend
  python scripts/backfill_food.py              # dry-run
  python scripts/backfill_food.py --apply      # write Firestore
  python scripts/backfill_food.py --apply --local-jsonl   # also rewrite data/registrations.jsonl

Requires ``FIREBASE_SERVICE_ACCOUNT_JSON`` (and optional bucket env) like the API server.
Loads ``.env`` from the backend directory when present.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

REGISTRATIONS_FILE = BACKEND_DIR / "data" / "registrations.jsonl"


def load_dotenv(path: Path) -> None:
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        if key and key not in os.environ:
            os.environ[key] = value


def run_firestore(apply: bool) -> dict:
    import firebase_admin
    from firebase_admin import credentials, firestore

    raw_json = os.getenv("FIREBASE_SERVICE_ACCOUNT_JSON", "").strip()
    if not raw_json:
        raise SystemExit("Set FIREBASE_SERVICE_ACCOUNT_JSON in the environment or backend/.env")

    service_account_info = json.loads(raw_json)
    if not firebase_admin._apps:
        firebase_admin.initialize_app(credentials.Certificate(service_account_info))
    db = firestore.client()

    from food_migration import apply_food_patches

    scanned = 0
    to_change = 0
    sample: list[dict] = []
    pending: list[tuple] = []

    for document in db.collection("registrations").stream():
        scanned += 1
        raw = document.to_dict() or {}
        patched, changes = apply_food_patches(raw)
        if not changes:
            continue
        to_change += 1
        pending.append((document.reference, patched, changes))
        if len(sample) < 15:
            sample.append({"id": document.id, "changes": changes})

    if apply and pending:
        batch = db.batch()
        n = 0
        for ref, patched, _ in pending:
            batch.set(ref, patched)
            n += 1
            if n >= 400:
                batch.commit()
                batch = db.batch()
                n = 0
        if n:
            batch.commit()

    return {
        "dryRun": not apply,
        "scanned": scanned,
        "documentsWithChanges": to_change,
        "written": bool(apply and to_change),
        "sample": sample,
    }


def run_jsonl(apply: bool) -> dict:
    from food_migration import apply_food_patches

    if not REGISTRATIONS_FILE.is_file():
        return {"path": str(REGISTRATIONS_FILE), "lines": 0, "changed": 0, "skipped": True}

    lines = REGISTRATIONS_FILE.read_text(encoding="utf-8").splitlines()
    out: list[str] = []
    changed = 0
    for line in lines:
        s = line.strip()
        if not s:
            continue
        obj = json.loads(s)
        patched, ch = apply_food_patches(obj)
        if ch:
            changed += 1
        out.append(json.dumps(patched, ensure_ascii=True))

    if apply and out:
        REGISTRATIONS_FILE.write_text("\n".join(out) + "\n", encoding="utf-8")

    return {"path": str(REGISTRATIONS_FILE), "lines": len(out), "changed": changed, "written": apply}


def main() -> None:
    load_dotenv(BACKEND_DIR / ".env")
    parser = argparse.ArgumentParser(description="Backfill registration food fields.")
    parser.add_argument("--apply", action="store_true", help="Persist changes (default is dry-run).")
    parser.add_argument(
        "--local-jsonl",
        action="store_true",
        help=f"Also patch {REGISTRATIONS_FILE.name} when present.",
    )
    args = parser.parse_args()

    result = run_firestore(apply=args.apply)
    print(json.dumps(result, indent=2))

    if args.local_jsonl:
        jr = run_jsonl(apply=args.apply)
        print(json.dumps({"localJsonl": jr}, indent=2))


if __name__ == "__main__":
    main()
