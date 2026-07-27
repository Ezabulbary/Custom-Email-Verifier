// Minimal RFC 6238 TOTP (time-based one-time password) — no dependencies.
// Used for Authenticator-App two-factor auth (Google Authenticator, Authy, etc.).
const crypto = require('crypto');

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; // base32 (RFC 4648)

function base32Encode(buffer) {
    let bits = 0, value = 0, out = '';
    for (const byte of buffer) {
        value = (value << 8) | byte; bits += 8;
        while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
    }
    if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
    return out;
}

function base32Decode(str) {
    const clean = String(str).toUpperCase().replace(/[^A-Z2-7]/g, '');
    let bits = 0, value = 0; const out = [];
    for (const ch of clean) {
        const idx = ALPHABET.indexOf(ch);
        if (idx === -1) continue;
        value = (value << 5) | idx; bits += 5;
        if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
    }
    return Buffer.from(out);
}

// One HMAC-based OTP for a given counter.
function hotp(secretB32, counter) {
    const key = base32Decode(secretB32);
    const buf = Buffer.alloc(8);
    buf.writeBigUInt64BE(BigInt(counter));
    const h = crypto.createHmac('sha1', key).update(buf).digest();
    const off = h[h.length - 1] & 0x0f;
    const bin = ((h[off] & 0x7f) << 24) | ((h[off + 1] & 0xff) << 16) | ((h[off + 2] & 0xff) << 8) | (h[off + 3] & 0xff);
    return (bin % 1000000).toString().padStart(6, '0');
}

// A fresh random secret (base32) for a new authenticator enrolment.
function generateSecret() {
    return base32Encode(crypto.randomBytes(20));
}

// The current 30-second code (useful for testing).
function current(secretB32) {
    return hotp(secretB32, Math.floor(Date.now() / 30000));
}

// Verify a user-entered code, tolerating ±`window` time-steps for clock drift.
function verify(secretB32, token, window = 1) {
    if (!secretB32 || token == null) return false;
    const t = String(token).replace(/\D/g, '');
    if (t.length !== 6) return false;
    const counter = Math.floor(Date.now() / 30000);
    for (let i = -window; i <= window; i++) {
        if (hotp(secretB32, counter + i) === t) return true;
    }
    return false;
}

// otpauth:// URL that authenticator apps scan (as a QR) or import.
function otpauthURL(secretB32, account, issuer = 'BounceCure') {
    const label = encodeURIComponent(`${issuer}:${account}`);
    const params = new URLSearchParams({ secret: secretB32, issuer, algorithm: 'SHA1', digits: '6', period: '30' });
    return `otpauth://totp/${label}?${params.toString()}`;
}

module.exports = { generateSecret, verify, current, otpauthURL, hotp };
