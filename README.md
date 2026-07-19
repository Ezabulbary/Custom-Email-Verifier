# Custom-Email-Verifier

A fully-featured SaaS Email Verifier built with Node.js, Express, SQLite, and a React frontend.

## Features
- Secure Login & Registration with JWT.
- Single Email Verification.
- Bulk Email Verification (paste).
- CSV Drag-and-Drop list verification.
- SMTP RCPT TO checking (Requires Port 25 outbound access).
- Disposable email detection.
- Credit system for users.

## Deep verification & catch-all handling

Catch-all (accept-all) domains reply `250 OK` to *every* recipient, so a plain
SMTP RCPT TO check can't tell a real mailbox from a fake one. To get past that,
each result now includes a `confidence` score (0-100) and a detected `provider`,
built from several signals:

- **Multi-probe catch-all detection.** Several random addresses are probed. If
  every one is accepted, the domain is flagged catch-all; if any is rejected,
  the accepted real address is a genuine mailbox (high confidence).
- **Response-diff heuristic.** On a catch-all domain, if the server phrases its
  reply for the real address differently from the random probes, the address is
  treated as *likely real* (confidence is raised).
- **Microsoft 365 mailbox check.** For M365 tenants (MX ending in
  `.mail.protection.outlook.com`) the unauthenticated `GetCredentialType`
  endpoint is queried, which can resolve a mailbox even when SMTP is catch-all.
- **Greylisting retry.** Temporary `4xx` SMTP replies are retried once before
  being reported as `unknown`.

`status` is one of `valid`, `invalid`, `catch-all`, or `unknown`; use
`confidence` to rank how deliverable each address is. The only 100%-certain
signal remains sending a real (double opt-in) email.

## Setup

1. Install backend dependencies: `npm install`
2. Start backend: `node server.js`
3. Install frontend dependencies: `cd frontend && npm install`
4. Start frontend: `npm run dev`
