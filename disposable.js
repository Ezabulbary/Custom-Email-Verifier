const https = require('https');

let disposableDomains = new Set();
let isLoaded = false;

const LIST_URL = 'https://raw.githubusercontent.com/disposable-email-domains/disposable-email-domains/master/disposable_email_blocklist.conf';

function fetchDomains() {
  return new Promise((resolve, reject) => {
    https.get(LIST_URL, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const lines = data.split('\n');
        lines.forEach(line => {
          const domain = line.trim().toLowerCase();
          if (domain && !domain.startsWith('//')) {
            disposableDomains.add(domain);
          }
        });
        isLoaded = true;
        console.log(`[Disposable] Loaded ${disposableDomains.size} disposable domains.`);
        resolve();
      });
    }).on('error', (err) => {
      console.error('[Disposable] Error fetching domains:', err);
      // Fallback to empty list
      resolve();
    });
  });
}

function isDisposable(domain) {
  if (!isLoaded) {
    console.warn('[Disposable] Domain list not loaded yet, returning false');
    return false;
  }
  return disposableDomains.has(domain.toLowerCase());
}

module.exports = {
  fetchDomains,
  isDisposable
};
