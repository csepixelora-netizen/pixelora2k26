from __future__ import annotations

import json
import os
import re
import uuid
from csv import DictWriter
from io import StringIO
from datetime import datetime, timezone
from pathlib import Path

import firebase_admin
from firebase_admin import credentials, firestore, storage

from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
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
    cleaned = [origin for origin in parsed if "your-github-username.github.io" not in origin]
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
    "Visual Connect",
    "Channel Surfing",
}
ALLOWED_FOOD = {"Veg", "Non-Veg"}
IPL_TOTAL_SLOTS = 10

EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


def require_admin_secret(x_admin_secret: str | None) -> None:
    if ADMIN_PORTAL_SECRET and x_admin_secret != ADMIN_PORTAL_SECRET:
        raise HTTPException(status_code=403, detail="Invalid admin secret.")


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
        "paymentScreenshot": record.get("paymentScreenshot", ""),
        "createdAt": record.get("createdAt", ""),
    }


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
def clear_admin_registrations(x_admin_secret: str | None = Header(default=None)) -> dict[str, int]:
    require_admin_secret(x_admin_secret)
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
    food: str = Form(...),
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
            food,
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

    if food not in ALLOWED_FOOD:
        raise HTTPException(status_code=400, detail="Invalid food selection.")

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
        "technicalTeam": {
            "teamName": technicalTeamName,
            "teamLeader": technicalTeamLeader,
            "teamSize": technicalTeamSize,
            "members": parsed_technical_members,
        },
        "nonTechnicalTeam": {
            "teamName": nonTechnicalTeamName,
            "teamLeader": nonTechnicalTeamLeader,
            "teamSize": nonTechnicalTeamSize,
            "members": parsed_nontechnical_members,
        },
        "food": food,
        "paymentScreenshot": payment_screenshot_ref,
        "createdAt": created_at,
    }

    save_registration_record(record)

    return {"message": "Registration submitted successfully.", "id": registration_id}


# Serve frontend from the sibling frontend folder so /api and site share one origin.
if FRONTEND_DIR.exists():
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
