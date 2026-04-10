# PIXELORA FastAPI Backend

This backend accepts registration form submissions and stores data in:

- Firebase Firestore collection: `registrations`
- Firebase Storage bucket path: `payment_screenshots/`

If Firebase env variables are not configured, it falls back to local storage:

- Form metadata in `backend/data/registrations.jsonl`
- Payment screenshots in `backend/uploads/payment_screenshots/`

## Local Setup

1. Open terminal in the `backend` folder.
2. Copy environment template:

```powershell
copy .env.example .env
```

3. Update `ADMIN_PORTAL_SECRET` and optional Firebase values in `.env`.
4. Install dependencies:

```powershell
pip install -r requirements.txt
```

5. Run the server:

```powershell
uvicorn main:app --reload --host 0.0.0.0 --port 8000 --env-file .env
```

6. Open in browser:

- Main site: `http://127.0.0.1:8000/`
- Health check: `http://127.0.0.1:8000/api/health`

## Render + Firebase Environment Variables

Set these in your Render service:

- `ALLOWED_ORIGINS`: comma-separated frontend origins (for example, your GitHub Pages URL)
- `FIREBASE_SERVICE_ACCOUNT_JSON`: full Firebase service account JSON as one line string
- `FIREBASE_STORAGE_BUCKET`: bucket name, for example `your-project-id.appspot.com`
- `ADMIN_PORTAL_SECRET`: strong secret for full admin access (list, CSV, delete all)
- `ADMIN_SECRET_TECH` (optional): technical-committee view (technical events, teams, per-person food for tech side)
- `ADMIN_SECRET_NONTECH` (optional): non-technical committee view
- `ADMIN_SECRET_FOOD` (optional): food/hospitality view (per-person meals; no payment links)

## API

### GET `/api/admin/env-hint`

Public (no secret). Returns which admin-related environment variables are **non-empty** on this server — use to confirm Render loaded `ADMIN_SECRET_FOOD` etc. (values are never exposed).

### GET `/api/admin/registrations`

Send the secret in the **`X-Admin-Secret`** header.

Returns `{ "registrations": [...], "adminScope": "full" | "technical" | "nontechnical" | "food" }` depending on which secret was used.

### GET `/api/admin/registrations.csv`

Downloads the registrations as a CSV file (columns depend on `adminScope`).

Send the matching secret in the `X-Admin-Secret` header. Delete-all (`DELETE /api/admin/registrations`) accepts **only** `ADMIN_PORTAL_SECRET`.

### POST `/api/registrations`

Multipart form-data fields:

- `name`
- `email`
- `whatsapp`
- `year`
- `collegeName`
- `departmentName`
- `technicalEvents`
- `nonTechnicalEvents`
- `technicalTeamName`
- `technicalTeamLeader`
- `technicalTeamSize`
- `technicalTeamMembers` (JSON string array)
- `nonTechnicalTeamName`
- `nonTechnicalTeamLeader`
- `nonTechnicalTeamSize`
- `nonTechnicalTeamMembers` (JSON string array)
- `technicalParticipantFoods` (JSON array: `{ name, role, food }[]` for leader + each technical member, or one object for solo Devfolio/Promptcraft)
- `nonTechnicalParticipantFoods` (JSON array: same shape for non-technical team)
- `food` (optional legacy single field; summary is stored in `food` on the record from participant lists)
- `paymentScreenshot` (image file)

Stored on each registration: `technicalTeam.participantFoods`, `nonTechnicalTeam.participantFoods`, and a combined `food` summary string for quick display and CSV.
