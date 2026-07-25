# What's New — Reorganization + Cloud Firestore

This update reorganizes the tool (inspired by Reoon's dashboard) and adds an
optional **Cloud Firestore** data store.

## 1. Hybrid data store (SQLite ↔ Firestore)

All data access now goes through a single abstraction, `store.js`, which picks
its backend automatically:

| Condition | Store used |
|-----------|-----------|
| `USE_FIRESTORE=1` **and** a Firebase service account is configured | **Cloud Firestore** |
| otherwise (default) | **local SQLite** (`users.sqlite`) |

If `USE_FIRESTORE=1` but Firestore can't initialise, the app logs a warning and
**falls back to SQLite** — so it never fails to start. The active store is
printed at boot: `[Store] Active data store: SQLITE|FIRESTORE`, and also
returned by `GET /health`.

### What is stored where

- **User credentials** — email, **bcrypt-hashed** password (never plaintext),
  credits, role, created-at.
- **Verification batches** — every single / bulk / CSV execution is saved as
  one batch, tagged with a **per-user sequential batch number** and an optional
  **task name**, and retained for **~30 days** (then auto-deleted).

### Firestore layout

```
users/{emailLower}                    → user document (id = lowercased email)
users/{emailLower}/batches/{autoId}   → one execution batch (number, counts, results)
password_resets/{tokenHash}           → single-use reset token
```

### Enabling Firestore

1. In the [Firebase console](https://console.firebase.google.com): **Build →
   Firestore Database → Create database**.
2. Make sure a service account is set (same one used for Google sign-in):
   `FIREBASE_SERVICE_ACCOUNT=...` **or** `GOOGLE_APPLICATION_CREDENTIALS=./serviceAccount.json`.
3. Set `USE_FIRESTORE=1` in your backend `.env`.
4. Start the backend with env loaded: `node --env-file=.env server.js`.

> Note: SQLite and Firestore are **separate** stores — switching does not copy
> existing data across. Pick one before you have real users, or migrate manually.

## 2. Reorganized dashboard (Reoon-style)

- **Overview** — credits, 30-day emails verified, lists cleaned, valid-rate, and
  a **Usage Statistics donut** (Valid / Catch-all / Disposable / Invalid / Unknown).
- **Single / Bulk / Clean-a-List** — Bulk and CSV now accept an optional
  **Task Name** (like Reoon).
- **Tasks & Results** — a new page listing every execution batch: batch number,
  date, task name, type, status, total, per-status breakdown, with **filter
  tabs**, **pagination**, expandable details and per-batch **CSV download**
  (results are lazy-loaded from `GET /history/:id`).

## API changes

| Endpoint | Change |
|----------|--------|
| `POST /verify`, `/verify/bulk`, `/verify/csv` | accept optional `name`; response includes `batchId`, `batchNumber` |
| `GET /history` | now returns batch **summaries** (no per-address results); each item has `batchNumber`, `name`, `counts.disposable` |
| `GET /history/:id` | **new** — full results for one batch (Details / Download) |
| `GET /history/stats/overview` | replaces `GET /history/stats`; adds `counts.disposable` |
| `GET /health` | now also returns the active `store` |

Everything is backward-compatible on SQLite: existing databases are migrated
automatically (new `batch_number`, `name`, `disposable_count` columns are added
on startup).
