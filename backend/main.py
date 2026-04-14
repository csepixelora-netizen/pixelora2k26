from __future__ import annotations

import json
import os
import re
import uuid
from csv import DictWriter
from io import StringIO
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

import firebase_admin
from firebase_admin import credentials, firestore, storage

from fastapi import FastAPI, File, Form, Header, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles

from food_migration import apply_food_patches

# Paths
BACKEND_DIR = Path(__file__).resolve().parent
PROJECT_DIR = BACKEND_DIR.parent
FRONTEND_DIR = PROJECT_DIR / "frontend"
UPLOAD_DIR = BACKEND_DIR / "uploads" / "payment_screenshots"
DATA_DIR = BACKEND_DIR / "data"
REGISTRATIONS_FILE = DATA_DIR / "registrations.jsonl"

UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
DATA_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="PIXELORA Backend", version="1.0.0")

ALLOWED_ORIGINS_RAW = os.getenv("ALLOWED_ORIGINS", "*").strip()


def parse_allowed_origins(raw_value: str) -> list[str]:
    if not raw_value or raw_value == "*":
        return ["*"]

    parsed = [origin.strip() for origin in raw_value.split(",") if origin.strip()]

    def normalize_origin(value: str) -> str:
        trimmed = value.strip().rstrip("/")
        if not trimmed:
            return ""

        parsed_url = urlparse(trimmed)
        if parsed_url.scheme and parsed_url.netloc:
            return f"{parsed_url.scheme}://{parsed_url.netloc}"

        return trimmed

    cleaned = [
        normalize_origin(origin)
        for origin in parsed
        if "your-github-username.github.io" not in origin
    ]
    cleaned = [origin for origin in cleaned if origin]
    return cleaned if cleaned else ["*"]


ALLOWED_ORIGINS = parse_allowed_origins(ALLOWED_ORIGINS_RAW)
ALLOW_CREDENTIALS = "*" not in ALLOWED_ORIGINS

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=ALLOW_CREDENTIALS,
    allow_methods=["*"],
    allow_headers=["*"],
)

FIREBASE_SERVICE_ACCOUNT_JSON = os.getenv("FIREBASE_SERVICE_ACCOUNT_JSON", "").strip()
FIREBASE_STORAGE_BUCKET = os.getenv("FIREBASE_STORAGE_BUCKET", "").strip()
ADMIN_PORTAL_SECRET = os.getenv("ADMIN_PORTAL_SECRET", "").strip()
SURFACE_ACCESS_PASSWORD = os.getenv("PIXELORA_SURFACE_PASSWORD", "CSE").strip()

firebase_db = None
firebase_bucket = None

if FIREBASE_SERVICE_ACCOUNT_JSON:
    try:
        service_account_info = json.loads(FIREBASE_SERVICE_ACCOUNT_JSON)
        firebase_options: dict[str, str] = {}
        if FIREBASE_STORAGE_BUCKET:
            firebase_options["storageBucket"] = FIREBASE_STORAGE_BUCKET

        if not firebase_admin._apps:
            firebase_app = firebase_admin.initialize_app(
                credentials.Certificate(service_account_info),
                firebase_options if firebase_options else None,
            )
        else:
            firebase_app = firebase_admin.get_app()

        firebase_db = firestore.client(app=firebase_app)
        if FIREBASE_STORAGE_BUCKET:
            firebase_bucket = storage.bucket(app=firebase_app)
    except json.JSONDecodeError:
        firebase_db = None
        firebase_bucket = None

ALLOWED_YEARS = {"I-Year", "II-Year", "III-Year", "IV-Year"}
ALLOWED_TECHNICAL_EVENTS = {"Innopitch", "Devfolio", "Promptcraft"}
ALLOWED_NON_TECHNICAL_EVENTS = {
    "E-Sports (Free fire)",
    "IPL Auction",
    "Visual Content",
    "Visual Connect",
    "Channel Surfing",
}
EVENT_NAME_ALIASES = {
    "Visual Connect": "Visual Content",
}
TEAM_SIZE_RULES = {
    "Innopitch": {"min": 1, "max": 3},
    "Devfolio": {"min": 1, "max": 1},
    "Promptcraft": {"min": 1, "max": 1},
    "E-Sports (Free fire)": {"min": 4, "max": 4},
    "IPL Auction": {"min": 4, "max": 4},
    "Visual Content": {"min": 3, "max": 3},
    "Visual Connect": {"min": 3, "max": 3},
    "Channel Surfing": {"min": 2, "max": 2},
}
ALLOWED_FOOD = {"Veg", "Non-Veg"}
IPL_TOTAL_SLOTS = 10

EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
UPI_VPA_PATTERN = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9._-]{0,253}@[a-zA-Z][a-zA-Z0-9.-]{1,63}$")


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


def require_admin_secret(x_admin_secret: str | None) -> None:
    if ADMIN_PORTAL_SECRET and x_admin_secret != ADMIN_PORTAL_SECRET:
        raise HTTPException(status_code=403, detail="Invalid admin secret.")


def require_surface_auth(x_surface_auth: str | None) -> None:
    if SURFACE_ACCESS_PASSWORD and x_surface_auth != SURFACE_ACCESS_PASSWORD:
        raise HTTPException(status_code=403, detail="Invalid surface access code.")


def sanitize_registration_for_surface(record: dict) -> dict:
    """Strip sensitive fields for coordinator / surface-tier clients."""
    out = dict(record)
    out.pop("paymentScreenshot", None)
    out.pop("payerUpiId", None)
    return out


def normalize_event_name(event_name: str) -> str:
    normalized = event_name.strip()
    return EVENT_NAME_ALIASES.get(normalized, normalized)


def validate_team_size(event_name: str, members: list[str], team_size_raw: str | None, category_label: str) -> None:
    if not event_name:
        return

    rule = TEAM_SIZE_RULES.get(event_name, {"min": 1, "max": 1})
    actual_size = len(members) + 1
    min_size = int(rule["min"])
    max_size = int(rule["max"])

    if actual_size < min_size or actual_size > max_size:
        if min_size == max_size:
            raise HTTPException(
                status_code=400,
                detail=f"{category_label} team size for {event_name} must be exactly {min_size} members.",
            )

        raise HTTPException(
            status_code=400,
            detail=f"{category_label} team size for {event_name} must be between {min_size} and {max_size} members.",
        )

    if team_size_raw:
        try:
            submitted_size = int(team_size_raw)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Invalid {category_label.lower()} team size value.")

        if submitted_size != actual_size:
            raise HTTPException(
                status_code=400,
                detail=f"{category_label} team size mismatch for {event_name}.",
            )


def _parse_json_object(value: object) -> dict:
    if isinstance(value, dict):
        return value
    if isinstance(value, str) and value.strip():
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return {}


def _parse_json_array(value: object) -> list:
    if isinstance(value, list):
        return value
    if isinstance(value, str) and value.strip():
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return []
        return parsed if isinstance(parsed, list) else []
    return []


def _normalize_team_object(raw: object) -> dict:
    data = raw if isinstance(raw, dict) else _parse_json_object(raw)
    members = data.get("members", [])
    if isinstance(members, str) and members.strip():
        try:
            members = json.loads(members)
        except json.JSONDecodeError:
            members = []
    if not isinstance(members, list):
        members = []
    return {
        "teamName": str(data.get("teamName") or ""),
        "teamLeader": str(data.get("teamLeader") or ""),
        "teamSize": str(data.get("teamSize") or ""),
        "members": [str(m) for m in members if m is not None],
    }


def _parse_primary_registrant(record: dict) -> dict:
    pr = record.get("primaryRegistrant")
    if isinstance(pr, dict) and str(pr.get("name", "")).strip():
        return {
            "name": str(pr.get("name", "")).strip(),
            "email": str(pr.get("email", "")).strip(),
            "phone": str(pr.get("phone", pr.get("whatsapp", "")) or "").strip(),
            "collegeName": str(pr.get("collegeName", "")).strip(),
            "departmentName": str(pr.get("departmentName", "")).strip(),
            "year": str(pr.get("year", "")).strip(),
            "food": str(pr.get("food", "")).strip(),
        }
    return {
        "name": str(record.get("name", "")).strip(),
        "email": str(record.get("email", "")).strip(),
        "phone": str(record.get("whatsapp", "")).strip(),
        "collegeName": str(record.get("collegeName", "")).strip(),
        "departmentName": str(record.get("departmentName", "")).strip(),
        "year": str(record.get("year", "")).strip(),
        "food": str(record.get("food", "")).strip(),
    }


def _normalize_match_name(value: object) -> str:
    s = str(value or "").strip().lower()
    return re.sub(r"\s+", " ", s)


def _merge_member_dicts(a: dict, b: dict) -> dict:
    def best(x: object, y: object) -> str:
        tx = str(x or "").strip()
        ty = str(y or "").strip()
        return ty or tx

    out = {**a, **b}
    out["memberId"] = best(a.get("memberId"), b.get("memberId")) or str(a.get("memberId") or b.get("memberId") or "").strip()
    out["name"] = best(a.get("name"), b.get("name")) or str(a.get("name") or b.get("name") or "").strip()
    out["email"] = best(a.get("email"), b.get("email"))
    out["phone"] = best(a.get("phone"), b.get("phone"))
    out["food"] = best(a.get("food"), b.get("food"))
    out["collegeName"] = best(a.get("collegeName"), b.get("collegeName"))
    out["departmentName"] = best(a.get("departmentName"), b.get("departmentName"))
    out["technicalEvent"] = best(a.get("technicalEvent"), b.get("technicalEvent"))
    out["nonTechnicalEvent"] = best(a.get("nonTechnicalEvent"), b.get("nonTechnicalEvent"))
    out["technical_used"] = bool(a.get("technical_used") or b.get("technical_used"))
    out["nontechnical_used"] = bool(a.get("nontechnical_used") or b.get("nontechnical_used"))
    return out


def _member_pool(record: dict) -> list[dict]:
    combined: list[dict] = []
    for member in _parse_json_array(record.get("teamMembers", [])):
        if isinstance(member, dict):
            combined.append(member)

    session_raw = record.get("sessionData")
    session = session_raw if isinstance(session_raw, dict) else _parse_json_object(session_raw)
    if isinstance(session, dict):
        for member in _parse_json_array(session.get("teamMembers", [])):
            if isinstance(member, dict):
                combined.append(member)

    by_key: dict[str, dict] = {}
    for member in combined:
        member_id = str(member.get("memberId", "") or "").strip().lower()
        email = str(member.get("email", "") or "").strip().lower()
        name_key = _normalize_match_name(member.get("name", ""))
        key = member_id or f"{email}|{name_key}"
        if not key:
            continue
        if key not in by_key:
            by_key[key] = dict(member)
        else:
            by_key[key] = _merge_member_dicts(by_key[key], member)
    return list(by_key.values())


def _resolve_contact(name: str, pool: list[dict], primary: dict) -> dict:
    label = str(name or "").strip()
    if not label:
        return {"name": "", "email": "", "phone": "", "food": "", "collegeName": "", "departmentName": ""}
    name_key = _normalize_match_name(label)
    for member in pool:
        if _normalize_match_name(member.get("name", "")) == name_key:
            return {
                "name": label,
                "email": str(member.get("email", "") or "").strip(),
                "phone": str(member.get("phone", "") or "").strip(),
                "food": str(member.get("food", "") or "").strip(),
                "collegeName": str(member.get("collegeName", "") or "").strip(),
                "departmentName": str(member.get("departmentName", "") or "").strip(),
            }
    if _normalize_match_name(primary.get("name", "")) == name_key:
        return {
            "name": label,
            "email": str(primary.get("email", "") or "").strip(),
            "phone": str(primary.get("phone", "") or "").strip(),
            "food": str(primary.get("food", "") or "").strip(),
            "collegeName": str(primary.get("collegeName", "") or "").strip(),
            "departmentName": str(primary.get("departmentName", "") or "").strip(),
        }
    return {"name": label, "email": "", "phone": "", "food": "", "collegeName": "", "departmentName": ""}


def _dedupe_contacts(contacts: list[dict]) -> list[dict]:
    output: list[dict] = []
    seen: set[str] = set()
    for contact in contacts:
        key = str(contact.get("email", "") or "").strip().lower() or _normalize_match_name(contact.get("name", ""))
        if not key or key in seen:
            continue
        seen.add(key)
        output.append(contact)
    return output


def _enrich_event_team_members(block: dict | None, pool: list[dict], primary: dict) -> dict | None:
    if not block or not isinstance(block, dict):
        return block
    team = block.get("team")
    if not isinstance(team, dict):
        return block
    members = team.get("members")
    if not isinstance(members, list):
        return block
    out_members: list[dict] = []
    for m in members:
        if not isinstance(m, dict):
            continue
        nm = str(m.get("name", "") or "").strip()
        if not nm:
            out_members.append(m)
            continue
        r = _resolve_contact(nm, pool, primary)
        out_members.append(
            {
                **m,
                "email": str(r.get("email") or m.get("email") or "").strip(),
                "phone": str(r.get("phone") or m.get("phone") or "").strip(),
                "food": str(r.get("food") or m.get("food") or "").strip(),
                "collegeName": str(r.get("collegeName") or m.get("collegeName") or "").strip(),
                "departmentName": str(r.get("departmentName") or m.get("departmentName") or "").strip(),
            }
        )
    return {**block, "team": {**team, "members": out_members}}


def _apply_events_contact_enrichment(events: dict, pool: list[dict], primary: dict) -> dict:
    if not isinstance(events, dict):
        return events
    tech = events.get("technical")
    nt = events.get("nonTechnical")
    return {
        "technical": _enrich_event_team_members(tech if isinstance(tech, dict) else None, pool, primary),
        "nonTechnical": _enrich_event_team_members(nt if isinstance(nt, dict) else None, pool, primary),
    }


def _build_event_block(
    *,
    event_name: str,
    team_blob: object,
    pool: list[dict],
    primary: dict,
    pool_event_key: str,
    pool_used_key: str,
) -> dict | None:
    event_name = str(event_name or "").strip()
    if not event_name:
        return None

    team = _normalize_team_object(team_blob)
    leader = str(team.get("teamLeader") or primary.get("name") or "").strip()
    roster_names: list[str] = []
    seen_lower: set[str] = set()
    leader_key = _normalize_match_name(leader) if leader else ""

    for raw_name in team.get("members") or []:
        teammate = str(raw_name or "").strip()
        if not teammate:
            continue
        lowered = _normalize_match_name(teammate)
        if lowered in seen_lower:
            continue
        if leader_key and lowered == leader_key:
            continue
        seen_lower.add(lowered)
        roster_names.append(teammate)

    for member in pool:
        pool_event = str(member.get(pool_event_key, "") or "").strip()
        matches_event = bool(event_name) and pool_event == event_name
        marked_used = bool(member.get(pool_used_key))
        if not matches_event and not marked_used:
            continue
        teammate = str(member.get("name", "") or "").strip()
        if not teammate:
            continue
        lowered = _normalize_match_name(teammate)
        if leader_key and lowered == leader_key:
            continue
        if lowered in seen_lower:
            continue
        seen_lower.add(lowered)
        roster_names.append(teammate)

    member_rows = _dedupe_contacts([_resolve_contact(n, pool, primary) for n in roster_names])
    return {"name": event_name, "team": {"leader": leader, "members": member_rows}}


def build_events_structure(primary: dict, record: dict, pool: list[dict] | None = None) -> dict:
    pool = _member_pool(record) if pool is None else pool
    technical = _build_event_block(
        event_name=str(record.get("technicalEvents", "") or "").strip(),
        team_blob=record.get("technicalTeam", {}),
        pool=pool,
        primary=primary,
        pool_event_key="technicalEvent",
        pool_used_key="technical_used",
    )
    non_technical = _build_event_block(
        event_name=str(record.get("nonTechnicalEvents", "") or "").strip(),
        team_blob=record.get("nonTechnicalTeam", {}),
        pool=pool,
        primary=primary,
        pool_event_key="nonTechnicalEvent",
        pool_used_key="nontechnical_used",
    )
    return {"technical": technical, "nonTechnical": non_technical}


def normalize_record(record: dict) -> dict:
    created_at_value = record.get("createdAt")
    if hasattr(created_at_value, "isoformat"):
        created_at_value = created_at_value.isoformat()

    session_raw = record.get("sessionData", {})
    session_data = session_raw if isinstance(session_raw, dict) else _parse_json_object(session_raw)

    primary = _parse_primary_registrant(record)
    if not str(primary.get("food") or "").strip() and record.get("food"):
        primary["food"] = str(record.get("food", "")).strip()
    if not str(primary.get("phone") or "").strip() and record.get("whatsapp"):
        primary["phone"] = str(record.get("whatsapp", "")).strip()
    if not str(primary.get("collegeName") or "").strip() and record.get("collegeName"):
        primary["collegeName"] = str(record.get("collegeName", "")).strip()
    if not str(primary.get("departmentName") or "").strip() and record.get("departmentName"):
        primary["departmentName"] = str(record.get("departmentName", "")).strip()
    pool = _member_pool(record)
    team_members = [dict(m) for m in pool]
    events = _apply_events_contact_enrichment(build_events_structure(primary, record, pool), pool, primary)

    return {
        "id": record.get("id", ""),
        "name": record.get("name", ""),
        "email": record.get("email", ""),
        "whatsapp": record.get("whatsapp", ""),
        "year": record.get("year", ""),
        "collegeName": record.get("collegeName", ""),
        "departmentName": record.get("departmentName", ""),
        "technicalEvents": record.get("technicalEvents", ""),
        "technicalTeam": _normalize_team_object(record.get("technicalTeam", {})),
        "nonTechnicalEvents": record.get("nonTechnicalEvents", ""),
        "nonTechnicalTeam": _normalize_team_object(record.get("nonTechnicalTeam", {})),
        "food": record.get("food", ""),
        "payerUpiId": str(record.get("payerUpiId", "") or "").strip(),
        "paymentScreenshot": record.get("paymentScreenshot", ""),
        "sessionData": session_data,
        "teamMembers": team_members,
        "primaryRegistrant": primary,
        "events": events,
        "createdAt": created_at_value or "",
    }


def load_local_registrations() -> list[dict]:
    records: list[dict] = []

    if not REGISTRATIONS_FILE.exists():
        return records

    with REGISTRATIONS_FILE.open("r", encoding="utf-8") as file:
        for line in file:
            line = line.strip()
            if not line:
                continue
            try:
                records.append(normalize_record(json.loads(line)))
            except json.JSONDecodeError:
                continue

    return records


def load_firestore_registrations() -> list[dict]:
    if firebase_db is None:
        return []

    records: list[dict] = []
    for document in firebase_db.collection("registrations").stream():
        records.append(normalize_record(document.to_dict() | {"id": document.id}))
    return records


def load_registrations() -> list[dict]:
    records_by_id: dict[str, dict] = {}

    for record in load_local_registrations() + load_firestore_registrations():
        record_id = str(record.get("id", "")).strip()
        if not record_id:
            continue
        records_by_id[record_id] = record

    records = list(records_by_id.values())
    records.sort(key=lambda item: str(item.get("createdAt", "")), reverse=True)
    return records


def count_ipl_auction_registrations(records: list[dict] | None = None) -> int:
    registration_records = records if records is not None else load_registrations()
    return sum(1 for record in registration_records if record.get("nonTechnicalEvents") == "IPL Auction")


def get_ipl_slot_status() -> dict[str, int]:
    registered = count_ipl_auction_registrations()
    return {
        "total": IPL_TOTAL_SLOTS,
        "registered": registered,
        "available": max(0, IPL_TOTAL_SLOTS - registered),
    }


def sync_local_registrations_to_firestore() -> None:
    if firebase_db is None:
        return

    for record in load_local_registrations():
        record_id = str(record.get("id", "")).strip()
        if not record_id:
            continue
        firebase_db.collection("registrations").document(record_id).set(record)


def save_registration_record(record: dict) -> None:
    with REGISTRATIONS_FILE.open("a", encoding="utf-8") as file:
        file.write(json.dumps(record, ensure_ascii=True) + "\n")

    if firebase_db is not None:
        firebase_db.collection("registrations").document(str(record["id"])).set(record)


def delete_registration_storage() -> None:
    if firebase_bucket is not None:
        for blob in firebase_bucket.list_blobs(prefix="payment_screenshots/"):
            blob.delete()

    if UPLOAD_DIR.exists():
        for file_path in UPLOAD_DIR.iterdir():
            if file_path.is_file():
                file_path.unlink()


RECORD_ID_PATTERN = re.compile(r"^[a-fA-F0-9]{8,64}$")


def delete_payment_asset_for_record(record: dict) -> None:
    """Best-effort removal of the payment screenshot for one registration (local + Firebase)."""
    rid = str(record.get("id", "")).strip()
    if not rid:
        return
    if UPLOAD_DIR.exists():
        for file_path in UPLOAD_DIR.iterdir():
            if file_path.is_file() and file_path.name.startswith(rid):
                try:
                    file_path.unlink()
                except OSError:
                    pass
                break
    if firebase_bucket is not None:
        for ext in (".jpg", ".jpeg", ".png", ".webp", ".gif"):
            try:
                blob = firebase_bucket.blob(f"payment_screenshots/{rid}{ext}")
                if blob.exists():
                    blob.delete()
                    break
            except Exception:
                continue


def delete_one_registration(record_id: str) -> dict | None:
    """Remove a single registration from Firestore and rewrite the local JSONL to match remaining rows."""
    record_id = str(record_id or "").strip()
    if not RECORD_ID_PATTERN.match(record_id):
        return None

    all_records = load_registrations()
    target: dict | None = None
    for item in all_records:
        if str(item.get("id", "")).strip() == record_id:
            target = item
            break
    if target is None:
        return None

    remaining = [item for item in all_records if str(item.get("id", "")).strip() != record_id]
    delete_payment_asset_for_record(target)

    if firebase_db is not None:
        try:
            firebase_db.collection("registrations").document(record_id).delete()
        except Exception:
            pass

    REGISTRATIONS_FILE.parent.mkdir(parents=True, exist_ok=True)
    with REGISTRATIONS_FILE.open("w", encoding="utf-8") as file:
        for item in remaining:
            file.write(json.dumps(item, ensure_ascii=True) + "\n")

    return target


def delete_all_registrations() -> int:
    existing_records = load_registrations()

    if firebase_db is not None:
        batch = firebase_db.batch()
        operations = 0
        for record in existing_records:
            record_id = str(record.get("id", "")).strip()
            if not record_id:
                continue
            batch.delete(firebase_db.collection("registrations").document(record_id))
            operations += 1
            if operations >= 450:
                batch.commit()
                batch = firebase_db.batch()
                operations = 0

        if operations:
            batch.commit()

        try:
            firebase_db.collection("slotCounters").document("iplAuction").delete()
        except Exception:
            pass

    if REGISTRATIONS_FILE.exists():
        REGISTRATIONS_FILE.write_text("", encoding="utf-8")

    delete_registration_storage()
    return len(existing_records)


@app.on_event("startup")
def sync_registrations_on_startup() -> None:
    sync_local_registrations_to_firestore()


def flatten_registration_for_csv(record: dict) -> dict:
    technical_team = record.get("technicalTeam") or {}
    non_technical_team = record.get("nonTechnicalTeam") or {}

    return {
        "id": record.get("id", ""),
        "name": record.get("name", ""),
        "email": record.get("email", ""),
        "whatsapp": record.get("whatsapp", ""),
        "year": record.get("year", ""),
        "collegeName": record.get("collegeName", ""),
        "departmentName": record.get("departmentName", ""),
        "technicalEvents": record.get("technicalEvents", ""),
        "technicalTeamName": technical_team.get("teamName", ""),
        "technicalTeamLeader": technical_team.get("teamLeader", ""),
        "technicalTeamSize": technical_team.get("teamSize", ""),
        "technicalTeamMembers": ", ".join(technical_team.get("members", []) or []),
        "nonTechnicalEvents": record.get("nonTechnicalEvents", ""),
        "nonTechnicalTeamName": non_technical_team.get("teamName", ""),
        "nonTechnicalTeamLeader": non_technical_team.get("teamLeader", ""),
        "nonTechnicalTeamSize": non_technical_team.get("teamSize", ""),
        "nonTechnicalTeamMembers": ", ".join(non_technical_team.get("members", []) or []),
        "food": record.get("food", ""),
        "payerUpiId": record.get("payerUpiId", ""),
        "paymentScreenshot": record.get("paymentScreenshot", ""),
        "sessionData": json.dumps(record.get("sessionData", {}), ensure_ascii=True),
        "teamMembers": json.dumps(record.get("teamMembers", []), ensure_ascii=True),
        "primaryRegistrant": json.dumps(record.get("primaryRegistrant", {}), ensure_ascii=True),
        "events": json.dumps(record.get("events", {}), ensure_ascii=True),
        "createdAt": record.get("createdAt", ""),
    }


@app.get("/api/surface/registrations")
def list_surface_registrations(
    x_surface_auth: str | None = Header(default=None, alias="X-Surface-Auth"),
) -> dict[str, list[dict]]:
    """Limited read path for event coordinators (first-tier site password, not admin secret)."""
    require_surface_auth(x_surface_auth)
    return {"registrations": [sanitize_registration_for_surface(r) for r in load_registrations()]}


@app.get("/api/admin/registrations")
def list_admin_registrations(x_admin_secret: str | None = Header(default=None)) -> dict[str, list[dict]]:
    require_admin_secret(x_admin_secret)
    return {"registrations": load_registrations()}


@app.get("/api/admin/registrations.csv")
def download_admin_registrations_csv(x_admin_secret: str | None = Header(default=None)) -> Response:
    require_admin_secret(x_admin_secret)

    records = [flatten_registration_for_csv(record) for record in load_registrations()]
    buffer = StringIO()
    writer = DictWriter(buffer, fieldnames=list(records[0].keys()) if records else [
        "id",
        "name",
        "email",
        "whatsapp",
        "year",
        "collegeName",
        "departmentName",
        "technicalEvents",
        "technicalTeamName",
        "technicalTeamLeader",
        "technicalTeamSize",
        "technicalTeamMembers",
        "nonTechnicalEvents",
        "nonTechnicalTeamName",
        "nonTechnicalTeamLeader",
        "nonTechnicalTeamSize",
        "nonTechnicalTeamMembers",
        "food",
        "payerUpiId",
        "paymentScreenshot",
        "sessionData",
        "teamMembers",
        "primaryRegistrant",
        "events",
        "createdAt",
    ])
    writer.writeheader()
    writer.writerows(records)

    return Response(
        content=buffer.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="pixelora-registrations.csv"'},
    )


@app.get("/api/slots/ipl-auction")
def get_ipl_auction_slots() -> dict[str, int]:
    return get_ipl_slot_status()


@app.delete("/api/admin/registrations")
def clear_admin_registrations(x_admin_secret: str | None = Header(default=None)) -> dict[str, int]:
    require_admin_secret(x_admin_secret)
    deleted = delete_all_registrations()
    return {"deleted": deleted, "remaining": 0, "registered": 0, "available": IPL_TOTAL_SLOTS, "total": IPL_TOTAL_SLOTS}


@app.delete("/api/admin/registrations/{registration_id}")
def delete_single_admin_registration(
    registration_id: str,
    x_admin_secret: str | None = Header(default=None),
) -> dict[str, object]:
    require_admin_secret(x_admin_secret)
    rid = str(registration_id or "").strip()
    if not RECORD_ID_PATTERN.match(rid):
        raise HTTPException(status_code=400, detail="Invalid registration id.")
    removed = delete_one_registration(rid)
    if removed is None:
        raise HTTPException(status_code=404, detail="Registration not found.")
    slots = get_ipl_slot_status()
    return {"deleted": True, "id": rid, **slots}


@app.post("/api/admin/migrations/backfill-food")
def admin_backfill_registration_food(
    apply: bool = Query(False, description="When true, write normalized food fields to Firestore."),
    x_admin_secret: str | None = Header(default=None),
) -> dict[str, object]:
    """
    Normalize meal preferences: empty, hyphen, em dash, and unknown values become Non-Veg;
    common spellings map to Veg / Non-Veg. Patches root ``food``, ``primaryRegistrant``,
    ``teamMembers``, ``sessionData``, and ``events`` where present.
    """
    require_admin_secret(x_admin_secret)
    if firebase_db is None:
        raise HTTPException(status_code=503, detail="Firestore is not configured.")

    scanned = 0
    to_change = 0
    sample: list[dict[str, object]] = []
    pending: list[tuple[object, dict[str, object]]] = []

    for document in firebase_db.collection("registrations").stream():
        scanned += 1
        raw = document.to_dict() or {}
        patched, changes = apply_food_patches(raw)
        if not changes:
            continue
        to_change += 1
        if apply:
            pending.append((document.reference, patched))
        if len(sample) < 25:
            sample.append({"id": document.id, "changes": changes})

    if apply and pending:
        batch = firebase_db.batch()
        n = 0
        for ref, patched in pending:
            batch.set(ref, patched)
            n += 1
            if n >= 400:
                batch.commit()
                batch = firebase_db.batch()
                n = 0
        if n:
            batch.commit()

    return {
        "dryRun": not apply,
        "apply": apply,
        "scanned": scanned,
        "documentsWithChanges": to_change,
        "written": apply and to_change > 0,
        "sample": sample,
    }


@app.post("/api/registrations")
async def create_registration(
    name: str = Form(...),
    email: str = Form(...),
    whatsapp: str = Form(...),
    year: str = Form(...),
    collegeName: str = Form(...),
    departmentName: str = Form(...),
    technicalEvents: str = Form(""),
    nonTechnicalEvents: str = Form(""),
    technicalTeamName: str | None = Form(None),
    technicalTeamLeader: str | None = Form(None),
    technicalTeamSize: str | None = Form(None),
    technicalTeamMembers: str | None = Form(None),
    nonTechnicalTeamName: str | None = Form(None),
    nonTechnicalTeamLeader: str | None = Form(None),
    nonTechnicalTeamSize: str | None = Form(None),
    nonTechnicalTeamMembers: str | None = Form(None),
    food: str = Form(...),
    payerUpiId: str = Form(""),
    sessionData: str | None = Form(None),
    teamMembers: str | None = Form(None),
    paymentScreenshot: UploadFile = File(...),
) -> dict[str, str]:
    name = name.strip()
    email = email.strip()
    whatsapp = whatsapp.strip()
    year = year.strip()
    collegeName = collegeName.strip()
    departmentName = departmentName.strip()
    technicalEvents = technicalEvents.strip()
    nonTechnicalEvents = nonTechnicalEvents.strip()
    technicalTeamName = (technicalTeamName or '').strip() or None
    technicalTeamLeader = (technicalTeamLeader or '').strip() or None
    technicalTeamSize = (technicalTeamSize or '').strip() or None
    technicalTeamMembers = (technicalTeamMembers or '').strip() or None
    nonTechnicalTeamName = (nonTechnicalTeamName or '').strip() or None
    nonTechnicalTeamLeader = (nonTechnicalTeamLeader or '').strip() or None
    nonTechnicalTeamSize = (nonTechnicalTeamSize or '').strip() or None
    nonTechnicalTeamMembers = (nonTechnicalTeamMembers or '').strip() or None
    food = food.strip()
    payer_upi_id = (payerUpiId or "").strip()
    sessionData = (sessionData or '').strip() or None
    teamMembers = (teamMembers or '').strip() or None

    if not all([name, email, whatsapp, year, collegeName, departmentName, food]):
        raise HTTPException(status_code=400, detail="All fields are required.")

    if not technicalEvents and not nonTechnicalEvents:
        raise HTTPException(status_code=400, detail="Select at least one event.")

    if not EMAIL_PATTERN.match(email):
        raise HTTPException(status_code=400, detail="Invalid email format.")

    if year not in ALLOWED_YEARS:
        raise HTTPException(status_code=400, detail="Invalid year selection.")

    technicalEvents = normalize_event_name(technicalEvents)
    nonTechnicalEvents = normalize_event_name(nonTechnicalEvents)

    if technicalEvents and technicalEvents not in ALLOWED_TECHNICAL_EVENTS:
        raise HTTPException(status_code=400, detail="Invalid technical event selection.")

    if nonTechnicalEvents and nonTechnicalEvents not in ALLOWED_NON_TECHNICAL_EVENTS:
        raise HTTPException(status_code=400, detail="Invalid non-technical event selection.")

    if nonTechnicalEvents == "IPL Auction" and count_ipl_auction_registrations() >= IPL_TOTAL_SLOTS:
        raise HTTPException(status_code=400, detail="IPL Auction slots are full. Please select another non-technical event.")

    if food not in ALLOWED_FOOD:
        raise HTTPException(status_code=400, detail="Invalid food selection.")

    if payer_upi_id and not UPI_VPA_PATTERN.match(payer_upi_id):
        raise HTTPException(status_code=400, detail="Invalid payer UPI ID format.")

    if not paymentScreenshot.content_type or not paymentScreenshot.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Payment screenshot must be an image.")

    suffix = Path(paymentScreenshot.filename or "screenshot").suffix.lower()
    if suffix not in {".jpg", ".jpeg", ".png", ".webp", ".gif"}:
        suffix = ".jpg"

    registration_id = uuid.uuid4().hex
    image_filename = f"{registration_id}{suffix}"
    image_path = UPLOAD_DIR / image_filename

    image_bytes = await paymentScreenshot.read()
    if not image_bytes:
        raise HTTPException(status_code=400, detail="Uploaded screenshot is empty.")

    payment_screenshot_ref = f"uploads/payment_screenshots/{image_filename}"

    if firebase_bucket is not None:
        try:
            blob = firebase_bucket.blob(f"payment_screenshots/{image_filename}")
            blob.upload_from_string(image_bytes, content_type=paymentScreenshot.content_type or "image/jpeg")
            blob.make_public()
            payment_screenshot_ref = blob.public_url
        except Exception:
            # If cloud upload fails (for example invalid/missing bucket), keep accepting
            # registrations by storing screenshots locally.
            image_path.write_bytes(image_bytes)
    else:
        image_path.write_bytes(image_bytes)

    created_at = datetime.now(timezone.utc).isoformat()

    parsed_technical_members: list[str] = []
    parsed_nontechnical_members: list[str] = []
    parsed_session_data: dict = {}
    parsed_team_members: list[dict] = []

    if technicalTeamMembers:
        try:
            parsed_technical_members = [
                str(member).strip()
                for member in json.loads(technicalTeamMembers)
                if str(member).strip()
            ]
        except json.JSONDecodeError:
            parsed_technical_members = []

    if nonTechnicalTeamMembers:
        try:
            parsed_nontechnical_members = [
                str(member).strip()
                for member in json.loads(nonTechnicalTeamMembers)
                if str(member).strip()
            ]
        except json.JSONDecodeError:
            parsed_nontechnical_members = []

    if sessionData:
        try:
            parsed_session_data = json.loads(sessionData)
        except json.JSONDecodeError:
            parsed_session_data = {}

    if teamMembers:
        try:
            parsed_team_members = [
                member if isinstance(member, dict) else {"value": member}
                for member in json.loads(teamMembers)
            ]
        except json.JSONDecodeError:
            parsed_team_members = []

    validate_team_size(technicalEvents, parsed_technical_members, technicalTeamSize, "Technical")
    validate_team_size(nonTechnicalEvents, parsed_nontechnical_members, nonTechnicalTeamSize, "Non-technical")

    technical_team = _normalize_team_object(
        {
            "teamName": technicalTeamName,
            "teamLeader": technicalTeamLeader,
            "teamSize": technicalTeamSize,
            "members": parsed_technical_members,
        }
    )
    non_technical_team = _normalize_team_object(
        {
            "teamName": nonTechnicalTeamName,
            "teamLeader": nonTechnicalTeamLeader,
            "teamSize": nonTechnicalTeamSize,
            "members": parsed_nontechnical_members,
        }
    )

    primary_registrant = {
        "name": name,
        "email": email,
        "phone": whatsapp,
        "collegeName": collegeName,
        "departmentName": departmentName,
        "year": year,
        "food": food,
    }

    synthetic_record = {
        "technicalEvents": technicalEvents,
        "nonTechnicalEvents": nonTechnicalEvents,
        "technicalTeam": technical_team,
        "nonTechnicalTeam": non_technical_team,
        "teamMembers": parsed_team_members,
    }
    session_dict = parsed_session_data if isinstance(parsed_session_data, dict) else {}
    enrich_pool = _member_pool({"teamMembers": parsed_team_members, "sessionData": session_dict})
    events = _apply_events_contact_enrichment(
        build_events_structure(primary_registrant, synthetic_record, enrich_pool),
        enrich_pool,
        primary_registrant,
    )

    record = {
        "id": registration_id,
        "name": name,
        "email": email,
        "whatsapp": whatsapp,
        "year": year,
        "collegeName": collegeName,
        "departmentName": departmentName,
        "technicalEvents": technicalEvents,
        "nonTechnicalEvents": nonTechnicalEvents,
        "technicalTeam": technical_team,
        "nonTechnicalTeam": non_technical_team,
        "food": food,
        "payerUpiId": payer_upi_id,
        "paymentScreenshot": payment_screenshot_ref,
        "sessionData": parsed_session_data,
        "teamMembers": parsed_team_members,
        "primaryRegistrant": primary_registrant,
        "events": events,
        "createdAt": created_at,
    }

    save_registration_record(record)

    return {"message": "Registration submitted successfully.", "id": registration_id}


# Serve frontend from the sibling frontend folder so /api and site share one origin.
if UPLOAD_DIR.parent.exists():
    app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR.parent), name="uploads")

if FRONTEND_DIR.exists():
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
