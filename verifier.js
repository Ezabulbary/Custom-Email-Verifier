const dns = require('dns');
const dnsPromises = dns.promises;
// Use public DNS to avoid local network resolution issues
dns.setServers(['8.8.8.8', '1.1.1.1']);

const { isDisposable } = require('./disposable');
const { checkSMTP } = require('./smtp');
const { detectProvider, checkMicrosoft365 } = require('./providers');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// SSRF guard: a mail domain's MX record is attacker-controllable, so before we
// open an SMTP connection we make sure the target resolves to a public address
// and not to loopback/link-local/private/internal ranges. Self-hosted setups
// that verify against an internal mail server can opt out with ALLOW_PRIVATE_MX=1.
function isPrivateIPv4(ip) {
    const p = ip.split('.').map(Number);
    if (p.length !== 4 || p.some(n => Number.isNaN(n) || n < 0 || n > 255)) return true;
    const [a, b] = p;
    return (
        a === 0 || a === 10 || a === 127 ||
        (a === 169 && b === 254) ||                 // link-local
        (a === 172 && b >= 16 && b <= 31) ||        // private
        (a === 192 && b === 168) ||                 // private
        (a === 100 && b >= 64 && b <= 127) ||       // CGNAT
        (a === 192 && b === 0 && p[2] === 0) ||     // IETF protocol assignments
        (a === 198 && (b === 18 || b === 19)) ||    // benchmarking
        a >= 224                                    // multicast / reserved
    );
}

function isPrivateIP(ip, family) {
    if (family === 4) return isPrivateIPv4(ip);
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::') return true;
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true;   // unique local
    if (lower.startsWith('fe80')) return true;                            // link-local
    const mapped = lower.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);           // IPv4-mapped
    if (mapped) return isPrivateIPv4(mapped[1]);
    return false;
}

// Resolve an MX host to a PUBLIC IP and return that IP (or null if it resolves
// to a private/internal range or can't be resolved). Returning the concrete IP
// lets the caller connect to it directly - closing the TOCTOU / DNS-rebinding
// hole where a second, connect-time DNS lookup could return an internal address
// after this guard passed.
async function resolvePublicMxIp(host) {
    if (process.env.ALLOW_PRIVATE_MX === '1') {
        // Opt-out: still resolve so we have an IP to connect to, but don't block.
        try { const a = await dnsPromises.lookup(host); return a.address; } catch { return null; }
    }
    try {
        const addrs = await dnsPromises.lookup(host, { all: true });
        if (!addrs || addrs.length === 0) return null;
        // Every resolved address must be public; connect to the first one.
        if (!addrs.every(a => !isPrivateIP(a.address, a.family))) return null;
        return addrs[0].address;
    } catch (err) {
        return null;
    }
}

// How many random addresses to probe when detecting a catch-all domain. More
// probes = higher confidence that the domain really accepts everything.
const CATCH_ALL_PROBES = 2;

// Build a random local-part that is extremely unlikely to be a real mailbox.
// The 'zz' prefix makes these probes easy to recognise in logs/tests.
function randomLocalPart() {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let s = 'zz';
    for (let i = 0; i < 18; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
}

// Normalize an SMTP reply so two responses can be compared while ignoring the
// address and any numbers that naturally differ between probes. If a server
// phrases the reply for a real mailbox differently from a random one, that is a
// hint the address is real even on a catch-all domain.
function normalizeMessage(msg) {
    return (msg || '')
        .toLowerCase()
        .replace(/<[^>]*>/g, '')                       // drop <address>
        .replace(/[a-z0-9._%+-]+@[a-z0-9.-]+/g, '')    // drop bare emails
        .replace(/[0-9]+/g, '')                        // drop numbers / status codes
        .replace(/\s+/g, ' ')
        .trim();
}

// --- Reoon-style fine-grained status taxonomy -------------------------------
// Every verification resolves to exactly ONE of these statuses. They mirror the
// categories used by services like Reoon, so each result carries a precise,
// self-explanatory verdict instead of a coarse valid/invalid:
//
//   safe       - real, deliverable mailbox (most likely a personal address)
//   role       - deliverable, but a role/group address (support@, info@, …)
//   catch-all  - domain accepts every address; the individual mailbox is unverifiable
//   disposable - temporary / throwaway email provider
//   invalid    - mailbox does not exist / domain rejects mail (will bounce)
//   inbox_full - mailbox exists but is over quota (may soft-bounce)
//   disabled   - mailbox existed but has been disabled / suspended
//   spamtrap   - address used to catch spammers - never send to it
//   unknown    - server gave no definitive answer (greylisting, blocked port, …)
const STATUSES = ['safe', 'role', 'catch-all', 'disposable', 'invalid', 'inbox_full', 'disabled', 'spamtrap', 'unknown'];

// Coarse rollup buckets for batch summaries / bounce-rate estimates. The
// per-address status above is always the source of truth; this only groups
// statuses together for aggregate counts.
function statusBucket(status) {
    switch (status) {
        case 'safe':
        case 'role':       return 'valid';
        case 'invalid':
        case 'disabled':
        case 'disposable': return 'invalid';
        case 'catch-all':  return 'catchAll';
        default:           return 'unknown'; // inbox_full, spamtrap, unknown
    }
}

// Role / group mailboxes: valid and deliverable, but not a specific person.
const ROLE_LOCALPARTS = new Set([
    'admin', 'administrator', 'postmaster', 'hostmaster', 'webmaster', 'root',
    'support', 'help', 'helpdesk', 'info', 'contact', 'enquiries', 'enquiry', 'inquiries',
    'sales', 'marketing', 'billing', 'accounts', 'accounting', 'finance', 'orders',
    'abuse', 'security', 'noc', 'privacy', 'legal', 'compliance',
    'hr', 'careers', 'jobs', 'recruiting', 'office', 'team', 'hello', 'service', 'services',
    'noreply', 'no-reply', 'donotreply', 'do-not-reply', 'mailer-daemon',
    'newsletter', 'news', 'media', 'press', 'feedback', 'all', 'everyone', 'staff'
]);

function isRoleAddress(email) {
    const local = String(email).split('@')[0].toLowerCase().split('+')[0].trim();
    return ROLE_LOCALPARTS.has(local);
}

// Known spam-trap / honeypot domains. Reliable spamtrap detection needs
// proprietary data, so this is a best-effort list you can extend via the
// SPAMTRAP_DOMAINS env var (comma-separated) without touching code.
const SPAMTRAP_DOMAINS = new Set(
    (process.env.SPAMTRAP_DOMAINS || '')
        .split(',').map(d => d.trim().toLowerCase()).filter(Boolean)
);
function isSpamtrapDomain(domain) {
    return SPAMTRAP_DOMAINS.has(domain);
}

// Inspect an SMTP reply for signals that distinguish an over-quota mailbox or a
// disabled/suspended account (both of which imply the mailbox EXISTS) from a
// plain "no such user" rejection. Returns 'spamtrap' | 'inbox_full' | 'disabled'
// | null.
function classifySmtpMessage(message) {
    const m = (message || '').toLowerCase();
    if (m.includes('spamtrap') || m.includes('spam trap')) return 'spamtrap';

    const fullHints = [
        'over quota', 'over-quota', 'overquota', 'quota exceeded', 'exceeded storage',
        'insufficient storage', 'insufficient system storage', 'mailbox full', 'mailbox is full',
        'inbox is full', 'user is over quota', 'not enough space', 'out of storage',
        '452 4.2.2', '552 5.2.2'
    ];
    if (fullHints.some(h => m.includes(h))) return 'inbox_full';

    const disabledHints = [
        'disabled', 'suspended', 'deactivated', 'account is inactive', 'no longer active',
        'no longer in use', 'account has been closed', 'account closed', 'account is locked',
        'account blocked', 'blocked for spam', 'blocked for abuse'
    ];
    if (disabledHints.some(h => m.includes(h))) return 'disabled';

    return null;
}

// Mark a confirmed-deliverable address as either 'safe' (personal) or 'role'.
function setDeliverable(result, email, confidence, reason) {
    result.status = isRoleAddress(email) ? 'role' : 'safe';
    result.confidence = confidence;
    result.reason = reason;
}

async function verifyEmail(email) {
    const result = {
        email,
        status: 'unknown',
        confidence: 0,          // 0-100: how sure we are the address is deliverable
        provider: 'unknown',
        syntax: false,
        disposable: false,
        mxFound: false,
        mxRecords: [],
        smtpConnected: false,
        smtpCode: null,
        isCatchAll: false,
        reason: ''
    };

    // 1. Syntax Check
    if (typeof email !== 'string' || !EMAIL_REGEX.test(email)) {
        result.status = 'invalid';
        result.confidence = 99;
        result.reason = 'Invalid email syntax';
        return result;
    }
    result.syntax = true;

    // Domains are case-insensitive; normalize so MX lookups and the catch-all
    // probe use a consistent, lower-cased domain.
    const domain = email.split('@')[1].toLowerCase();

    // 2. Disposable Check
    if (isDisposable(domain)) {
        result.disposable = true;
        result.status = 'disposable';
        result.confidence = 95;
        result.reason = 'Disposable / temporary email provider';
        return result;
    }

    // 2b. Known spam-trap domain (best-effort; extend via SPAMTRAP_DOMAINS).
    if (isSpamtrapDomain(domain)) {
        result.status = 'spamtrap';
        result.confidence = 90;
        result.reason = 'Known spam-trap domain. Do not send';
        return result;
    }

    // 3. MX Lookup
    let mxRecords;
    try {
        mxRecords = await dnsPromises.resolveMx(domain);
        if (!mxRecords || mxRecords.length === 0) throw new Error('No MX records');
    } catch (err) {
        result.status = 'invalid';
        result.confidence = 90;
        result.reason = 'No MX records found for domain';
        return result;
    }

    result.mxFound = true;
    // Sort by priority (lower number = higher priority)
    mxRecords.sort((a, b) => a.priority - b.priority);
    result.mxRecords = mxRecords.map(r => r.exchange);
    const primaryMx = result.mxRecords[0];

    // 4. Provider detection (drives provider-specific deep checks below)
    result.provider = detectProvider(result.mxRecords);

    // 5. Microsoft 365 deep check - resolves mailboxes even on catch-all tenants
    let m365 = null;
    if (result.provider === 'microsoft365') {
        m365 = await checkMicrosoft365(email);
        if (m365.exists === false) {
            result.status = 'invalid';
            result.confidence = 90;
            result.reason = 'Microsoft 365 reports the mailbox does not exist';
            return result;
        }
    }

    // SSRF guard: resolve the MX host to a public IP ONCE and connect to that
    // exact IP, so a rebinding attack can't slip an internal address in at
    // connect time.
    const mxIp = await resolvePublicMxIp(primaryMx);
    if (!mxIp) {
        result.status = 'unknown';
        result.confidence = 10;
        result.reason = 'Mail server resolves to a non-public address (blocked)';
        return result;
    }

    // 6. SMTP handshake for the real address (connect to the vetted IP)
    let smtpResult = await checkSMTP(primaryMx, email, false, mxIp);
    result.smtpConnected = smtpResult.connected;
    result.smtpCode = smtpResult.code;

    if (!smtpResult.connected) {
        // SMTP unreachable (commonly: outbound port 25 is blocked). Fall back to
        // any provider-level signal we already gathered.
        if (m365 && m365.exists === true) {
            setDeliverable(result, email, 80, 'Microsoft 365 confirms the mailbox exists (SMTP unreachable)');
        } else {
            result.status = 'unknown';
            result.confidence = 15;
            result.reason = 'Failed to connect to SMTP server: ' + smtpResult.message;
        }
        return result;
    }

    // Read the human-readable part of a non-250 reply to separate an over-quota
    // mailbox / disabled account / spam trap (mailbox effectively exists) from a
    // plain "no such user" rejection.
    const smtpClass = smtpResult.code !== 250 ? classifySmtpMessage(smtpResult.message) : null;
    if (smtpClass === 'spamtrap') {
        result.status = 'spamtrap';
        result.confidence = 85;
        result.reason = 'Address flagged as a spam trap. Do not send';
        return result;
    }
    if (smtpClass === 'inbox_full') {
        result.status = 'inbox_full';
        result.confidence = 70;
        result.reason = `Mailbox exists but is full / over quota (SMTP ${smtpResult.code})`;
        return result;
    }
    if (smtpClass === 'disabled') {
        result.status = 'disabled';
        result.confidence = 80;
        result.reason = `Mailbox exists but has been disabled / suspended (SMTP ${smtpResult.code})`;
        return result;
    }

    // Hard rejection -> mailbox does not exist
    if (smtpResult.code >= 500 && smtpResult.code < 600) {
        result.status = 'invalid';
        result.confidence = 85;
        result.reason = `Mailbox does not exist (SMTP ${smtpResult.code})`;
        return result;
    }

    // Temporary failure / greylisting -> wait and retry once
    if (smtpResult.code >= 400 && smtpResult.code < 500) {
        await new Promise(r => setTimeout(r, 3000));
        const retry = await checkSMTP(primaryMx, email, false, mxIp);
        result.smtpCode = retry.code;
        if (retry.code >= 500 && retry.code < 600) {
            result.status = 'invalid';
            result.confidence = 80;
            result.reason = `Mailbox does not exist (SMTP ${retry.code})`;
            return result;
        }
        if (retry.code !== 250) {
            result.status = 'unknown';
            result.confidence = 30;
            result.reason = `Temporary failure / greylisting (SMTP ${retry.code})`;
            return result;
        }
        smtpResult = retry; // retry accepted -> continue as a 250
    }

    if (smtpResult.code === 250) {
        // 7. Catch-all detection with multiple random probes.
        let acceptedProbes = 0;
        const probeMessages = [];
        for (let i = 0; i < CATCH_ALL_PROBES; i++) {
            const fake = `${randomLocalPart()}@${domain}`;
            const probe = await checkSMTP(primaryMx, fake, true, mxIp);
            if (probe.code === 250) {
                acceptedProbes++;
                probeMessages.push(probe.message);
            }
        }

        if (acceptedProbes < CATCH_ALL_PROBES) {
            // At least one random address was rejected -> not catch-all -> the
            // real address being accepted means the mailbox exists.
            setDeliverable(result, email, (m365 && m365.exists === true) ? 92 : 85, 'Mailbox exists');
            return result;
        }

        // Every random probe was accepted -> catch-all domain.
        result.isCatchAll = true;
        const realNorm = normalizeMessage(smtpResult.message);
        const serverDistinguishes = probeMessages.length > 0
            && probeMessages.every(m => normalizeMessage(m) !== realNorm);

        if (m365 && m365.exists === true) {
            setDeliverable(result, email, 82, 'Catch-all domain, but Microsoft 365 confirms the mailbox exists');
        } else if (serverDistinguishes) {
            result.status = 'catch-all';
            result.confidence = 60;
            result.reason = 'Catch-all domain, but the server replies differently for this address (likely real)';
        } else {
            result.status = 'catch-all';
            result.confidence = 40;
            result.reason = 'Domain accepts all emails (catch-all); deliverability uncertain';
        }
        return result;
    }

    // Anything else
    result.status = 'unknown';
    result.confidence = 20;
    result.reason = `Unexpected SMTP response: ${smtpResult.code} ${smtpResult.message}`;
    return result;
}

// --- Fast, free bounce-rate check (no SMTP, no credits) ---
// Estimates deliverability at the DOMAIN level: syntax + disposable + MX only.
// No SMTP handshake (which is the slow part), so it's fast and cheap. MX results
// are cached per-domain, so lists with repeated domains resolve almost instantly.
const mxCache = new Map();
const MX_CACHE_TTL = 60 * 60 * 1000; // 1 hour

async function domainHasMx(domain) {
    const hit = mxCache.get(domain);
    if (hit && Date.now() - hit.ts < MX_CACHE_TTL) return hit.ok;
    let ok = false;
    try {
        const mx = await dnsPromises.resolveMx(domain);
        ok = Array.isArray(mx) && mx.length > 0;
    } catch { ok = false; }
    mxCache.set(domain, { ok, ts: Date.now() });
    return ok;
}

async function quickVerify(email) {
    const result = { email, status: 'unknown', confidence: 0, syntax: false, disposable: false, mxFound: false, reason: '' };
    if (typeof email !== 'string' || !EMAIL_REGEX.test(email)) {
        result.status = 'invalid'; result.confidence = 99; result.reason = 'Invalid email syntax'; return result;
    }
    result.syntax = true;
    const domain = email.split('@')[1].toLowerCase();
    if (isDisposable(domain)) {
        result.disposable = true; result.status = 'disposable'; result.confidence = 90;
        result.reason = 'Disposable / temporary email provider'; return result;
    }
    if (isSpamtrapDomain(domain)) {
        result.status = 'spamtrap'; result.confidence = 90; result.reason = 'Known spam-trap domain'; return result;
    }
    const ok = await domainHasMx(domain);
    result.mxFound = ok;
    if (!ok) { result.status = 'invalid'; result.confidence = 85; result.reason = 'Domain has no mail server (will bounce)'; return result; }
    setDeliverable(result, email, 60, 'Domain accepts mail (not mailbox-verified)');
    return result;
}

// --- Catch-all-only verification --------------------------------------------
// A dedicated pass for the "Catch-All Verifier": it runs the full check, but is
// only meaningful for CATCH-ALL domains - the hard case standard verifiers flag
// as "risky". For a catch-all domain we try to RESOLVE the individual mailbox
// using every deep signal verifyEmail already gathers (Microsoft 365 API, and
// whether the server's reply for the real address differs from a random probe),
// so a catch-all can come back as deliverable (safe/role) instead of a shrug.
//
// Addresses on NON-catch-all domains are returned with status 'not_catch_all'
// so the page can skip them ("use standard verification for these").
async function verifyCatchAll(email) {
    const r = await verifyEmail(email);

    // Inconclusive (SMTP unreachable, greylisting, blocked port): we couldn't
    // even determine catch-all status, so keep 'unknown' rather than mislabel it.
    if (r.status === 'unknown') return r;

    // Conclusive verdicts that don't depend on catch-all - pass through as-is.
    if (['invalid', 'disposable', 'spamtrap', 'inbox_full', 'disabled'].includes(r.status)) return r;

    // In scope: a catch-all domain. verifyEmail sets isCatchAll=true when every
    // random probe was accepted - even if it then resolved the real mailbox to
    // safe/role via a deeper signal (Microsoft 365, reply-differencing).
    if (r.isCatchAll || r.status === 'catch-all') return r;

    // Otherwise it's a normal (non-catch-all) mailbox that resolved cleanly -
    // out of scope for this tool.
    return { ...r, status: 'not_catch_all', reason: 'Not a catch-all domain. Use standard verification' };
}

module.exports = { verifyEmail, quickVerify, verifyCatchAll, statusBucket, isRoleAddress, classifySmtpMessage, STATUSES };
