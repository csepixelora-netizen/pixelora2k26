# PIXELORA FastAPI Backend

This backend accepts registration form submissions and stores data in:

- Firebase Firestore collection: `registrations`
- Firebase Storage bucket path: `payment_screenshots/`

If Firebase env variables are not configured, it falls back to local storage:

- Form metadata in `backend/data/registrations.jsonl`
- Payment screenshots in `backend/uploads/payment_screenshots/`

## Local Setup

1. Open terminal in the `backend` folder.
2. Install dependencies:

```powershell
pip install -r requirements.txt
```

3. Run the server:

```powershell
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

4. Open in browser:

- Main site: `http://127.0.0.1:8000/`
- Health check: `http://127.0.0.1:8000/api/health`

## Render + Firebase Environment Variables

Set these in your Render service:

- `ALLOWED_ORIGINS`: comma-separated frontend origins (for example, your GitHub Pages URL)
- `FIREBASE_SERVICE_ACCOUNT_JSON`: full Firebase service account JSON as one line string
- `FIREBASE_STORAGE_BUCKET`: bucket name, for example `your-project-id.appspot.com`

## API

### GET `/api/admin/registrations`

Returns all registrations as JSON.

### GET `/api/admin/registrations.csv`

Downloads the registrations as a CSV file.

If `ADMIN_PORTAL_SECRET` is configured in Render, send it in the `X-Admin-Secret` header.

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
- `food`
- `paymentScreenshot` (image file)
