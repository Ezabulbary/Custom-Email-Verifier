# Security review & hardening

A full security review of the backend (`server.js`, `store.js`, `verifier.js`,
`smtp.js`, `firebaseAdmin.js`, `totp.js`, `mailer.js`) was performed. This file
records what was found and what was fixed.

## Fixed

### 1. Critical — 2FA bypass via the pre-2FA token
When 2FA was enabled, `/auth/login` returned a short-lived `tempToken` signed
with the same secret as a real session token. `authenticateToken` only checked
the signature, so that `tempToken` was accepted on every protected route —
letting anyone with just the password skip the second factor entirely.
**Fix:** the pre-2FA token carries a `twofa` marker; `authenticateToken` now
rejects any token with that marker (403). It only works at `/auth/2fa/verify`.
Regression test: a `tempToken` is rejected by `/auth/me`, `/verify`, and
`/auth/2fa/totp/disable`.

### 2. High — No rate limiting on auth endpoints
Login, registration, 2FA verification and password-reset had no throttling
(password/TOTP brute force, reset-email bombing, account enumeration at scale).
**Fix:** added a small in-memory, per-IP fixed-window limiter (`rateLimit.js`)
on `/auth/login`, `/auth/register`, `/auth/2fa/verify`, `/auth/forgot-password`.

### 3. High — Credit check/deduction was not atomic (overspend)
Credits were checked at job start but deducted at completion, and single
`/verify` checked-then-deducted. Concurrent requests each saw the full balance,
so a user could verify far more than their credits.
**Fix:** credits are now reserved ATOMICALLY up front in a Firestore
transaction (`store.reserveCredits` — decrement only if sufficient); unused/
non-chargeable reservations are refunded on completion (or on error). Verified
under concurrency: exactly one of five simultaneous checks on a 1-credit
account is charged; the balance never goes negative.

### 4. Medium — Resource exhaustion on the free bounce/bulk path
`/bounce/csv` is free (no credit gate); a huge upload could spawn hundreds of
thousands of DNS/SMTP lookups. **Fix:** `MAX_EMAILS_PER_JOB` cap (default
50,000) enforced for every job; oversized jobs get HTTP 413.

### 5. Medium — SSRF (TOCTOU / DNS rebinding) in MX verification
The SSRF guard resolved the MX host, but `checkSMTP` connected by hostname
again — a second DNS lookup that a malicious domain owner could rebind to an
internal IP. **Fix:** the MX host is resolved to a public IP **once**, and the
SMTP socket connects to that vetted IP (`resolvePublicMxIp` + `checkSMTP`'s
`connectHost`). Private ranges stay blocked unless `ALLOW_PRIVATE_MX=1`.

### 6. Low — Email used as a Firestore document id
The lowercased email is the user document id; `/` in an email would corrupt
the Firestore path. **Fix:** email validation now rejects `/` (and whitespace/
`@`), and `/auth/login` validates the format before any lookup.

## Already sound (verified, no change needed)
- `JWT_SECRET` is mandatory in production (the server refuses to start without
  it); the dev fallback is persisted to a gitignored `.jwt_secret`.
- Secrets (`.env`, `serviceAccount.json`, `.jwt_secret`) are gitignored and not
  tracked.
- Uploads are capped (15 MB, single file) and MIME/extension filtered; the temp
  file is always removed.
- Static file serving uses `express.static` + a fixed `index.html` fallback —
  no path traversal.
- History (`/history/:id`, delete, job status) is scoped to the owner; a user
  cannot read or delete another user's data. Admin endpoints hide superadmins
  from plain admins and block self role-change / self-delete.
- Password reset is constant-response (no account enumeration); reset tokens are
  SHA-256 hashed, single-use, 1-hour TTL.
- Firestore access uses typed `.doc()/.where()` — no query injection; client
  error responses are generic (no stack traces).

## Accepted design choices (documented, not vulnerabilities)
- The **first registered account becomes superadmin** (bootstrap). Register the
  owner account immediately after deploying, or pre-set `SUPERADMIN_EMAIL`.
- Registration returns "Email already exists"; login distinguishes Google-only
  accounts. These are deliberate UX messages; the new rate limiting mitigates
  mass enumeration.
- Admins can adjust credits (including their own) — that is the intended
  Admin-Panel feature. Only trusted staff should hold admin/superadmin roles.
