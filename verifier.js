const dns = require('dns');
const dnsPromises = dns.promises;
// Use public DNS to avoid local network resolution issues
dns.setServers(['8.8.8.8', '1.1.1.1']);

const { isDisposable } = require('./disposable');
const { checkSMTP } = require('./smtp');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function verifyEmail(email) {
    const result = {
        email,
        status: 'unknown',
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
    if (!EMAIL_REGEX.test(email)) {
        result.status = 'invalid';
        result.reason = 'Invalid email syntax';
        return result;
    }
    result.syntax = true;

    const domain = email.split('@')[1];

    // 2. Disposable Check
    if (isDisposable(domain)) {
        result.disposable = true;
        result.status = 'invalid';
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
        result.reason = 'No MX records found for domain';
        return result;
    }

    result.mxFound = true;
    // Sort by priority (lower number = higher priority)
    mxRecords.sort((a, b) => a.priority - b.priority);
    result.mxRecords = mxRecords.map(r => r.exchange);
    
    const primaryMx = result.mxRecords[0];

    // 4. SMTP Handshake
    const smtpResult = await checkSMTP(primaryMx, email);
    result.smtpConnected = smtpResult.connected;
    result.smtpCode = smtpResult.code;

    if (!smtpResult.connected) {
        result.reason = 'Failed to connect to SMTP server: ' + smtpResult.message;
        result.status = 'unknown'; 
        return result;
    }

    if (smtpResult.code === 250) {
        // 5. Catch-All Detection
        const fakeEmail = `dsfjkq83472ndx@${domain}`;
        const catchAllResult = await checkSMTP(primaryMx, fakeEmail, true);
        
        if (catchAllResult.code === 250) {
            result.isCatchAll = true;
            result.status = 'catch-all';
            result.reason = 'Domain accepts all emails (catch-all)';
        } else {
            result.status = 'valid';
            result.reason = 'Mailbox exists';
        }
    } else if (smtpResult.code >= 500 && smtpResult.code < 600) {
        result.status = 'invalid';
        result.reason = `Mailbox does not exist (SMTP ${smtpResult.code})`;
    } else if (smtpResult.code >= 400 && smtpResult.code < 500) {
        result.status = 'unknown';
        result.reason = `Temporary failure / Greylisting (SMTP ${smtpResult.code})`;
    } else {
        result.status = 'unknown';
        result.reason = `Unexpected SMTP response: ${smtpResult.code} ${smtpResult.message}`;
    }

    return result;
}

module.exports = { verifyEmail };
