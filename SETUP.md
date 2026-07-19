# BounceCure — Setup & Configuration Guide

This explains **where to add every key** and **where your data is stored**.

---

## 1. Run it locally (2 processes)

The app has **two parts** that must both run:

| Part | Folder | Command | Port |
|------|--------|---------|------|
| Backend API (auth + email verification) | project root | `npm install` then `node server.js` | 3001 |
| Frontend (React UI) | `frontend/` | `npm install` then `npm run dev` | 5173 |

```bash
# Terminal 1 — backend
npm install
node server.js            # or: node --env-file=.env server.js

# Terminal 2 — frontend
cd frontend
npm install
npm run dev
```

Open the printed frontend URL (e.g. http://localhost:5173).
**If the backend is not running, login/register show "Cannot reach the server".** That is expected — start `node server.js`.

---

## 2. Where is my data stored right now?

- **Users** (email, bcrypt-hashed password, credits, role) → **`users.sqlite`** (a SQLite file created automatically in the project root, `users` table).
- **Work / verification history** (single, bulk, CSV runs + results) → same `users.sqlite`, `history` table (kept 30 days).
- The first account that registers becomes **admin**.

`users.sqlite` is git-ignored, so it never gets committed. Back it up like any database file.

---

## 3. Enable "Continue with Google" (optional)

Google sign-in uses **Firebase Authentication**. It's optional — without it the button just shows a hint and email/password still works.

### Step A — Create a Firebase project
1. Go to <https://console.firebase.google.com> → **Add project**.
2. In **Build → Authentication → Sign-in method**, enable **Google**.
3. In **Authentication → Settings → Authorized domains**, add `localhost` and your production domain.

### Step B — Frontend keys → `frontend/.env`
Firebase console → **Project settings (⚙️) → General → Your apps → Web app** → copy the SDK config into `frontend/.env`:

```
VITE_API_URL=http://localhost:3001
VITE_FIREBASE_API_KEY=AIza...
VITE_FIREBASE_AUTH_DOMAIN=your-app.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-app
VITE_FIREBASE_APP_ID=1:1234567890:web:abcdef
```
Then restart `npm run dev`. (Template: `frontend/.env.example`.)

### Step C — Backend service account → root `.env`
Firebase console → **Project settings → Service accounts → Generate new private key** (downloads a JSON). Give the backend access one of two ways:

**Option 1 — paste the JSON (one line):**
```
FIREBASE_SERVICE_ACCOUNT={"type":"service_account","project_id":"...", ... }
```
**Option 2 — save the file as `serviceAccount.json` in the project root and point to it:**
```
GOOGLE_APPLICATION_CREDENTIALS=./serviceAccount.json
```
Restart the backend. You should see `[Auth] Firebase Admin initialised — Google sign-in enabled.`

> Flow: browser gets a Google token → backend verifies it with firebase-admin → finds/creates the user in `users.sqlite` (NULL password, 100 credits) → issues the app JWT. Nothing else changes.

---

## 4. Storage architecture — recommendation

You asked about Firebase for users and Cloudinary for work history. Here's the production-correct split:

| Data | Best store | Why |
|------|-----------|-----|
| Users / auth | **Firebase Auth + Firestore** | Handles Google + email, sessions, password reset. |
| Work / verification history | **Firestore** (a `history` collection) | It's structured JSON — a database, not a file. Query/paginate easily. |
| Exported CSV **files** (only if you want to host them) | **Cloudinary** or S3-style storage | Cloudinary is a **media/file CDN** — good for files, **not** for JSON history rows. |

**Bottom line:** put both users and history in Firebase (Firestore). Use Cloudinary **only** if you later want to store generated CSV/report files as downloadable media. Today the app keeps both in SQLite, which is perfectly fine for a single server; move to Firestore when you need multi-instance scale or serverless.

*(Migrating the history table to Firestore is a follow-up: swap the `db.*` calls in `server.js` history routes for Firestore reads/writes with firebase-admin — the same service account from Step C.)*

---

## 5. Password reset & "Book a call"

**Forgot password** works out of the box for email/password accounts:
1. User clicks *Forgot password?* → enters email → backend stores a single-use,
   1-hour token (hashed) and generates a reset link `FRONTEND_URL/reset-password?token=…`.
2. In **development** the link is printed to the backend console so you can test.
3. In **production**, wire your email provider (SendGrid, SES, nodemailer/SMTP…)
   inside `deliverResetEmail()` in `server.js`, and set `FRONTEND_URL`.

**Book a quick call:** the "Book a quick call" buttons open `BRAND.callUrl` in
`frontend/src/App.jsx`. Replace it with your real Calendly / Cal.com booking link.

## 6. Production checklist
- Set `NODE_ENV=production` and a strong `JWT_SECRET` (`node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`).
- Set `CORS_ORIGINS=https://your-frontend-domain`.
- Set `VITE_API_URL` to your API origin and rebuild the frontend (`npm run build`).
- Add your production domain to Firebase **Authorized domains**.
- Keep `serviceAccount.json` / `.env` **out of git** (already git-ignored).
