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

async function resolvesToPublicHost(host) {
    if (process.env.ALLOW_PRIVATE_MX === '1') return true;
    // A raw IP literal in an MX record is itself suspicious — validate directly.
    try {
        const addrs = await dnsPromises.lookup(host, { all: true });
        if (!addrs || addrs.length === 0) return false;
        return addrs.every(a => !isPrivateIP(a.address, a.family));
    } catch (err) {
        return false;
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
        result.status = 'invalid';
        result.confidence = 95;
        result.reason = 'Disposable email provider';
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

    // 5. Microsoft 365 deep check — resolves mailboxes even on catch-all tenants
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

    // SSRF guard: refuse to connect to MX hosts that resolve to internal ranges.
    if (!(await resolvesToPublicHost(primaryMx))) {
        result.status = 'unknown';
        result.confidence = 10;
        result.reason = 'Mail server resolves to a non-public address (blocked)';
        return result;
    }

    // 6. SMTP handshake for the real address
    let smtpResult = await checkSMTP(primaryMx, email);
    result.smtpConnected = smtpResult.connected;
    result.smtpCode = smtpResult.code;

    if (!smtpResult.connected) {
        // SMTP unreachable (commonly: outbound port 25 is blocked). Fall back to
        // any provider-level signal we already gathered.
        if (m365 && m365.exists === true) {
            result.status = 'valid';
            result.confidence = 80;
            result.reason = 'Microsoft 365 confirms the mailbox exists (SMTP unreachable)';
        } else {
            result.status = 'unknown';
            result.confidence = 15;
            result.reason = 'Failed to connect to SMTP server: ' + smtpResult.message;
        }
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
        const retry = await checkSMTP(primaryMx, email);
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
            const probe = await checkSMTP(primaryMx, fake, true);
            if (probe.code === 250) {
                acceptedProbes++;
                probeMessages.push(probe.message);
            }
        }

        if (acceptedProbes < CATCH_ALL_PROBES) {
            // At least one random address was rejected -> not catch-all -> the
            // real address being accepted means the mailbox exists.
            result.status = 'valid';
            result.confidence = (m365 && m365.exists === true) ? 92 : 85;
            result.reason = 'Mailbox exists';
            return result;
        }

        // Every random probe was accepted -> catch-all domain.
        result.isCatchAll = true;
        const realNorm = normalizeMessage(smtpResult.message);
        const serverDistinguishes = probeMessages.length > 0
            && probeMessages.every(m => normalizeMessage(m) !== realNorm);

        if (m365 && m365.exists === true) {
            result.status = 'valid';
            result.confidence = 82;
            result.reason = 'Catch-all domain, but Microsoft 365 confirms the mailbox exists';
        } else if (serverDistinguishes) {
            result.status = 'catch-all';
            result.confidence = 60;
            result.reason = 'Catch-all domain, but the server replies differently for this address (likely real)';
        } else {
            result.status = 'catch-all';
            result.confidence = 40;
            result.reason = 'Domain accepts all emails (catch-all) — deliverability uncertain';
        }
        return result;
    }

    // Anything else
    result.status = 'unknown';
    result.confidence = 20;
    result.reason = `Unexpected SMTP response: ${smtpResult.code} ${smtpResult.message}`;
    return result;
}

module.exports = { verifyEmail };
