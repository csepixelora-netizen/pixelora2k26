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

from typing import Annotated

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles

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


def _read_secret_env(name: str) -> str:
    """Trim whitespace; strip one pair of surrounding quotes if present (common Render paste mistake)."""
    raw = os.getenv(name, "").strip()
    if len(raw) >= 2 and ((raw[0] == raw[-1] == '"') or (raw[0] == raw[-1] == "'")):
        return raw[1:-1].strip()
    return raw


ADMIN_PORTAL_SECRET = _read_secret_env("ADMIN_PORTAL_SECRET")
ADMIN_SECRET_TECH = _read_secret_env("ADMIN_SECRET_TECH")
ADMIN_SECRET_NONTECH = _read_secret_env("ADMIN_SECRET_NONTECH")
ADMIN_SECRET_FOOD = _read_secret_env("ADMIN_SECRET_FOOD")

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
TECHNICAL_SOLO_EVENTS = {"Devfolio", "Promptcraft"}
ALLOWED_NON_TECHNICAL_EVENTS = {
    "E-Sports (Free fire)",
    "IPL Auction",
    "Visual Connect",
    "Channel Surfing",
}
ALLOWED_FOOD = {"Veg", "Non-Veg"}
IPL_TOTAL_SLOTS = 10

EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


def resolve_admin_scope(secret: str | None) -> str | None:
    if not secret:
        return None
    s = str(secret).strip()
    if ADMIN_PORTAL_SECRET and s == ADMIN_PORTAL_SECRET:
        return "full"
    if ADMIN_SECRET_TECH and s == ADMIN_SECRET_TECH:
        return "technical"
    if ADMIN_SECRET_NONTECH and s == ADMIN_SECRET_NONTECH:
        return "nontechnical"
    if ADMIN_SECRET_FOOD and s == ADMIN_SECRET_FOOD:
        return "food"
    return None


def read_admin_secret(
    x_admin_secret: Annotated[str | None, Header(alias="X-Admin-Secret")] = None,
) -> str | None:
    if x_admin_secret is None:
        return None
    xs = str(x_admin_secret).strip()
    return xs if xs else None


def require_admin_scope(secret: str | None) -> str:
    if not secret:
        raise HTTPException(
            status_code=401,
            detail="Missing X-Admin-Secret header.",
        )
    scope = resolve_admin_scope(secret)
    if not scope:
        raise HTTPException(
            status_code=403,
            detail="Invalid admin secret. If using committee codes, ensure ADMIN_SECRET_* is set on Render "
            "(not only local .env) and matches exactly—no extra quotes or spaces in the dashboard.",
        )
    return scope


def require_master_admin_secret(x_admin_secret: str | None) -> None:
    """Delete / destructive ops: only main ADMIN_PORTAL_SECRET (or open if unset)."""
    if not ADMIN_PORTAL_SECRET:
        return
    if (x_admin_secret or "").strip() != ADMIN_PORTAL_SECRET:
        raise HTTPException(status_code=403, detail="Only the main admin secret can perform this action.")


def filter_registration_for_scope(record: dict, scope: str) -> dict:
    if scope == "full":
        return dict(record)
    common = {
        "id": record.get("id", ""),
        "name": record.get("name", ""),
        "year": record.get("year", ""),
        "collegeName": record.get("collegeName", ""),
        "departmentName": record.get("departmentName", ""),
        "createdAt": record.get("createdAt", ""),
        "food": record.get("food", ""),
    }
    if scope == "technical":
        return {
            **common,
            "email": record.get("email", ""),
            "whatsapp": record.get("whatsapp", ""),
            "technicalEvents": record.get("technicalEvents", ""),
            "technicalTeam": record.get("technicalTeam") or {},
            "paymentScreenshot": record.get("paymentScreenshot", ""),
        }
    if scope == "nontechnical":
        return {
            **common,
            "email": record.get("email", ""),
            "whatsapp": record.get("whatsapp", ""),
            "nonTechnicalEvents": record.get("nonTechnicalEvents", ""),
            "nonTechnicalTeam": record.get("nonTechnicalTeam") or {},
            "paymentScreenshot": record.get("paymentScreenshot", ""),
        }
    if scope == "food":
        return {
            "id": record.get("id", ""),
            "name": record.get("name", ""),
            "technicalEvents": record.get("technicalEvents", ""),
            "nonTechnicalEvents": record.get("nonTechnicalEvents", ""),
            "technicalTeam": record.get("technicalTeam") or {},
            "nonTechnicalTeam": record.get("nonTechnicalTeam") or {},
            "food": record.get("food", ""),
            "createdAt": record.get("createdAt", ""),
        }
    return dict(record)


def parse_participant_foods_payload(raw: str | None, label: str) -> list[dict[str, str]]:
    if not raw or not str(raw).strip():
        return []
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid {label} JSON.") from exc
    if not isinstance(data, list):
        raise HTTPException(status_code=400, detail=f"{label} must be a JSON array.")
    out: list[dict[str, str]] = []
    for item in data:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name", "")).strip()
        food = str(item.get("food", "")).strip()
        role = str(item.get("role", "")).strip()
        if not name or food not in ALLOWED_FOOD:
            raise HTTPException(status_code=400, detail=f"Invalid {label} entry (name and Veg/Non-Veg required).")
        out.append({"name": name, "role": role, "food": food})
    return out


def build_food_summary_line(
    technical_team: dict,
    non_technical_team: dict,
    legacy_food: str,
) -> str:
    parts: list[str] = []
    tf = technical_team.get("participantFoods") if isinstance(technical_team, dict) else None
    nf = non_technical_team.get("participantFoods") if isinstance(non_technical_team, dict) else None
    if isinstance(tf, list) and tf:
        parts.append("Tech: " + ", ".join(f"{p.get('name', '')}:{p.get('food', '')}" for p in tf if isinstance(p, dict)))
    if isinstance(nf, list) and nf:
        parts.append(
            "Non-Tech: " + ", ".join(f"{p.get('name', '')}:{p.get('food', '')}" for p in nf if isinstance(p, dict))
        )
    if parts:
        return " | ".join(parts)
    return legacy_food.strip()


def normalize_record(record: dict) -> dict:
    created_at_value = record.get("createdAt")
    if hasattr(created_at_value, "isoformat"):
        created_at_value = created_at_value.isoformat()

    return {
        "id": record.get("id", ""),
        "name": record.get("name", ""),
        "email": record.get("email", ""),
        "whatsapp": record.get("whatsapp", ""),
        "year": record.get("year", ""),
        "collegeName": record.get("collegeName", ""),
        "departmentName": record.get("departmentName", ""),
        "technicalEvents": record.get("technicalEvents", ""),
        "technicalTeam": record.get("technicalTeam", {}),
        "nonTechnicalEvents": record.get("nonTechnicalEvents", ""),
        "nonTechnicalTeam": record.get("nonTechnicalTeam", {}),
        "food": record.get("food", ""),
        "paymentScreenshot": record.get("paymentScreenshot", ""),
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
    tf = technical_team.get("participantFoods") or []
    nf = non_technical_team.get("participantFoods") or []
    tech_food_str = json.dumps(tf, ensure_ascii=True) if tf else ""
    nontech_food_str = json.dumps(nf, ensure_ascii=True) if nf else ""

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
        "technicalParticipantFoods": tech_food_str,
        "nonTechnicalEvents": record.get("nonTechnicalEvents", ""),
        "nonTechnicalTeamName": non_technical_team.get("teamName", ""),
        "nonTechnicalTeamLeader": non_technical_team.get("teamLeader", ""),
        "nonTechnicalTeamSize": non_technical_team.get("teamSize", ""),
        "nonTechnicalTeamMembers": ", ".join(non_technical_team.get("members", []) or []),
        "nonTechnicalParticipantFoods": nontech_food_str,
        "foodSummary": record.get("food", ""),
        "paymentScreenshot": record.get("paymentScreenshot", ""),
        "createdAt": record.get("createdAt", ""),
    }


@app.get("/api/admin/env-hint")
def admin_env_configuration_hint() -> dict[str, bool]:
    """Which admin env vars are non-empty on this server (values are never exposed). Use to verify Render config."""
    return {
        "adminPortalSecretSet": bool(ADMIN_PORTAL_SECRET),
        "adminSecretTechSet": bool(ADMIN_SECRET_TECH),
        "adminSecretNontechSet": bool(ADMIN_SECRET_NONTECH),
        "adminSecretFoodSet": bool(ADMIN_SECRET_FOOD),
    }


@app.get("/api/admin/registrations")
def list_admin_registrations(admin_secret: str | None = Depends(read_admin_secret)) -> dict:
    scope = require_admin_scope(admin_secret)
    records = [normalize_record(r) for r in load_registrations()]
    filtered = [filter_registration_for_scope(r, scope) for r in records]
    return {"registrations": filtered, "adminScope": scope}


@app.get("/api/admin/registrations.csv")
def download_admin_registrations_csv(admin_secret: str | None = Depends(read_admin_secret)) -> Response:
    scope = require_admin_scope(admin_secret)
    raw_records = [normalize_record(r) for r in load_registrations()]
    records = [flatten_registration_for_csv(filter_registration_for_scope(r, scope)) for r in raw_records]
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
        "technicalParticipantFoods",
        "nonTechnicalEvents",
        "nonTechnicalTeamName",
        "nonTechnicalTeamLeader",
        "nonTechnicalTeamSize",
        "nonTechnicalTeamMembers",
        "nonTechnicalParticipantFoods",
        "foodSummary",
        "paymentScreenshot",
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
def clear_admin_registrations(admin_secret: str | None = Depends(read_admin_secret)) -> dict[str, int]:
    require_master_admin_secret(admin_secret)
    deleted = delete_all_registrations()
    return {"deleted": deleted, "remaining": 0, "registered": 0, "available": IPL_TOTAL_SLOTS, "total": IPL_TOTAL_SLOTS}


@app.post("/api/registrations")
async def create_registration(
    name: str = Form(...),
    email: str = Form(...),
    whatsapp: str = Form(...),
    year: str = Form(...),
    collegeName: str = Form(...),
    departmentName: str = Form(...),
    technicalEvents: str = Form(...),
    nonTechnicalEvents: str = Form(...),
    technicalTeamName: str | None = Form(None),
    technicalTeamLeader: str | None = Form(None),
    technicalTeamSize: str | None = Form(None),
    technicalTeamMembers: str | None = Form(None),
    nonTechnicalTeamName: str | None = Form(None),
    nonTechnicalTeamLeader: str | None = Form(None),
    nonTechnicalTeamSize: str | None = Form(None),
    nonTechnicalTeamMembers: str | None = Form(None),
    technicalParticipantFoods: str | None = Form(None),
    nonTechnicalParticipantFoods: str | None = Form(None),
    food: str | None = Form(None),
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
    legacy_food = (food or "").strip()

    if not all(
        [
            name,
            email,
            whatsapp,
            year,
            collegeName,
            departmentName,
            technicalEvents,
            nonTechnicalEvents,
        ]
    ):
        raise HTTPException(status_code=400, detail="All fields are required.")

    if not EMAIL_PATTERN.match(email):
        raise HTTPException(status_code=400, detail="Invalid email format.")

    if year not in ALLOWED_YEARS:
        raise HTTPException(status_code=400, detail="Invalid year selection.")

    if technicalEvents not in ALLOWED_TECHNICAL_EVENTS:
        raise HTTPException(status_code=400, detail="Invalid technical event selection.")

    if nonTechnicalEvents not in ALLOWED_NON_TECHNICAL_EVENTS:
        raise HTTPException(status_code=400, detail="Invalid non-technical event selection.")

    if nonTechnicalEvents == "IPL Auction" and count_ipl_auction_registrations() >= IPL_TOTAL_SLOTS:
        raise HTTPException(status_code=400, detail="IPL Auction slots are full. Please select another non-technical event.")

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

    tech_foods = parse_participant_foods_payload(technicalParticipantFoods, "technicalParticipantFoods")
    nontech_foods = parse_participant_foods_payload(nonTechnicalParticipantFoods, "nonTechnicalParticipantFoods")

    if technicalEvents in TECHNICAL_SOLO_EVENTS:
        if len(tech_foods) != 1:
            raise HTTPException(status_code=400, detail="Select food for the technical event participant.")
    else:
        try:
            tech_size = int(str(technicalTeamSize or "1").strip())
        except ValueError:
            tech_size = 1
        if len(tech_foods) != tech_size:
            raise HTTPException(
                status_code=400,
                detail="Food preference is required for each technical team member (leader + members).",
            )

    try:
        nontech_size = int(str(nonTechnicalTeamSize or "1").strip())
    except ValueError:
        nontech_size = 1
    if len(nontech_foods) != nontech_size:
        raise HTTPException(
            status_code=400,
            detail="Food preference is required for each non-technical team member (leader + members).",
        )

    technical_team_payload = {
        "teamName": technicalTeamName,
        "teamLeader": technicalTeamLeader,
        "teamSize": technicalTeamSize,
        "members": parsed_technical_members,
        "participantFoods": tech_foods,
    }
    non_technical_team_payload = {
        "teamName": nonTechnicalTeamName,
        "teamLeader": nonTechnicalTeamLeader,
        "teamSize": nonTechnicalTeamSize,
        "members": parsed_nontechnical_members,
        "participantFoods": nontech_foods,
    }

    food_summary = build_food_summary_line(technical_team_payload, non_technical_team_payload, legacy_food)

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
        "technicalTeam": technical_team_payload,
        "nonTechnicalTeam": non_technical_team_payload,
        "food": food_summary,
        "paymentScreenshot": payment_screenshot_ref,
        "createdAt": created_at,
    }

    save_registration_record(record)

    return {"message": "Registration submitted successfully.", "id": registration_id}


# Serve frontend from the sibling frontend folder so /api and site share one origin.
if UPLOAD_DIR.parent.exists():
    app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR.parent), name="uploads")

if FRONTEND_DIR.exists():
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
