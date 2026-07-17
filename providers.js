const https = require('https');

// Identify the mail provider from a domain's MX hosts. Knowing the provider
// lets us apply provider-specific checks (e.g. Microsoft 365) that can resolve
// addresses even when plain SMTP is a catch-all.
function detectProvider(mxHosts) {
  const hosts = (mxHosts || []).map(h => String(h).toLowerCase());
  if (hosts.some(h => h.endsWith('.mail.protection.outlook.com'))) return 'microsoft365';
  if (hosts.some(h => h.endsWith('.olc.protection.outlook.com'))) return 'outlook-consumer';
  if (hosts.some(h => h.includes('google.com') || h.endsWith('.googlemail.com') || h.includes('aspmx'))) return 'google';
  if (hosts.some(h => h.includes('pphosted.com') || h.includes('proofpoint'))) return 'proofpoint';
  return 'generic';
}

// Check whether a Microsoft 365 mailbox exists using the unauthenticated
// GetCredentialType endpoint. This is useful because many M365 tenants are
// configured as catch-all at the SMTP layer, so RCPT TO can't distinguish a
// real mailbox from a fake one — but this API still can.
//
// Resolves to { exists: true | false | null, ifExistsResult }.
//   exists === true  -> the account exists
//   exists === false -> the account does not exist
//   exists === null  -> inconclusive (network/parse error, throttled, etc.)
//
// Note: this is a strong signal, not an absolute truth — some tenants enable a
// privacy setting that always reports "exists", so callers should treat it as
// one input to a confidence score rather than a final verdict.
function checkMicrosoft365(email) {
  return new Promise((resolve) => {
    let payload;
    try {
      payload = JSON.stringify({ Username: email });
    } catch (e) {
      return resolve({ exists: null, error: 'bad input' });
    }

    const options = {
      hostname: 'login.microsoftonline.com',
      path: '/common/GetCredentialType?mkt=en-US',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(payload),
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
      },
      timeout: 8000
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const code = json.IfExistsResult;
          let exists = null;
          // 0 / 6 -> exists, 5 -> exists in a federated realm, 1 -> not found.
          if (code === 0 || code === 5 || code === 6) exists = true;
          else if (code === 1) exists = false;
          resolve({ exists, ifExistsResult: code });
        } catch (e) {
          resolve({ exists: null, error: 'parse error' });
        }
      });
    });

    req.on('error', () => resolve({ exists: null, error: 'request error' }));
    req.on('timeout', () => { req.destroy(); resolve({ exists: null, error: 'timeout' }); });
    req.write(payload);
    req.end();
  });
}

module.exports = { detectProvider, checkMicrosoft365 };
