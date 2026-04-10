# PIXELORA Deployment Guide

This setup deploys:

- Frontend on GitHub Pages
- Backend API on Render
- Database and file storage on Firebase (Firestore + Storage)

## 1. Create Firebase Project

1. Go to Firebase Console and create a project.
2. Enable Firestore Database in production mode.
3. Enable Firebase Storage.
4. Create a Service Account key:
   - Project settings -> Service accounts -> Generate new private key
   - Download JSON key file
5. Copy these values from Firebase project settings for frontend:
   - apiKey
   - authDomain
   - projectId
   - storageBucket
   - messagingSenderId
   - appId

## 2. Configure Frontend Runtime Config

Edit frontend/config.js:

- Set apiBaseUrl to your Render backend URL, for example:
  - https://pixelora-backend.onrender.com
- Fill firebase object with your web app Firebase values.

You can use `frontend/config.example.js` as a template.

## 3. Deploy Backend to Render

### Option A: Blueprint deploy (recommended)

1. Push code to GitHub.
2. In Render, click New + -> Blueprint.
3. Select the repository.
4. Render will read render.yaml.
5. Add secret environment variable:
   - FIREBASE_SERVICE_ACCOUNT_JSON = full service account JSON in one line
6. Verify env vars:
   - ALLOWED_ORIGINS = your GitHub Pages origin
   - FIREBASE_STORAGE_BUCKET = your-project-id.appspot.com
   - ADMIN_PORTAL_SECRET = strong secret string (full admin + delete-all)
   - Optional: ADMIN_SECRET_TECH, ADMIN_SECRET_NONTECH, ADMIN_SECRET_FOOD for committee-specific admin views (same `admin.html`, different code)
7. Deploy.

### Option B: Manual Web Service

1. New + -> Web Service.
2. Root directory: backend
3. Build command: pip install -r requirements.txt
4. Start command: uvicorn main:app --host 0.0.0.0 --port $PORT
5. Add the same env vars listed above.

## 4. Deploy Frontend to GitHub Pages

Because this is a static site, deploy the repository root as your Pages site.
The root `index.html` redirects visitors into `frontend/`, and `.nojekyll` prevents GitHub Pages from running Jekyll over the repo.

Simple flow:

1. In GitHub repo settings -> Pages:
   - Source: Deploy from a branch
   - Branch: main
   - Folder: /(root)
2. Save and wait for publishing.
3. Open the published site; it will redirect to the frontend app under `frontend/`.

Your frontend URL will be like:

- https://your-github-username.github.io/your-repo-name/

## 5. Set CORS Correctly

Render env var ALLOWED_ORIGINS should include exactly your frontend origin.

Example:

- https://your-github-username.github.io

If you use a custom domain, include that domain too, comma-separated.

## 6. Admin Portal

- Press `Ctrl+F7` on the frontend.
- Enter an admin code (`ADMIN_PORTAL_SECRET` for full access, or an optional committee code).
- If valid, it opens `frontend/admin.html`.
- Full secret: all columns, CSV, delete all, payment screenshots.
- Optional secrets (`ADMIN_SECRET_TECH`, `ADMIN_SECRET_NONTECH`, `ADMIN_SECRET_FOOD`): filtered views and CSV; delete-all only works with the main `ADMIN_PORTAL_SECRET`.

## 7. Local Development Env

1. Copy `backend/.env.example` to `backend/.env`.
2. Set `ADMIN_PORTAL_SECRET` and optional Firebase values.
3. Run backend with env file:

```powershell
uvicorn main:app --reload --host 0.0.0.0 --port 8000 --env-file .env
```

## 8. Verify End-to-End

1. Open backend health endpoint:
   - https://your-render-service.onrender.com/api/health
2. Open GitHub Pages frontend.
3. Submit registration form with screenshot.
4. Verify in Firebase:
   - Firestore: registrations collection has new document
   - Storage: payment_screenshots contains uploaded image

## Notes

- Render free tier can spin down after inactivity; first request may be slow.
- Do not commit private Firebase service account JSON into git.
- The backend still supports local file fallback if Firebase env vars are not set.
- Do not commit `backend/.env`, local uploads, or local registration JSONL data.
