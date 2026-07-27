// Tiny dependency-free rate limiter (fixed window, in-memory). Consistent with
// the app's single-process, in-memory job model. For a multi-instance
// deployment, swap this for a shared store (Redis) — the interface stays the same.
//
// Usage:
//   const { rateLimit } = require('./rateLimit');
//   app.post('/auth/login', rateLimit({ windowMs: 15*60*1000, max: 10 }), handler)

const buckets = new Map(); // key -> { count, resetAt }

// Periodically drop expired buckets so memory doesn't grow unbounded.
setInterval(() => {
    const now = Date.now();
    for (const [key, b] of buckets) if (b.resetAt <= now) buckets.delete(key);
}, 60 * 1000).unref?.();

function clientIp(req) {
    // Trust the reverse proxy's X-Forwarded-For first hop if present, else the
    // socket address. (Behind nginx this is the real client IP.)
    const xff = req.headers['x-forwarded-for'];
    if (xff) return String(xff).split(',')[0].trim();
    return req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';
}

/**
 * @param {object} opts
 * @param {number} opts.windowMs  window length in ms
 * @param {number} opts.max       max requests per key per window
 * @param {string} [opts.name]    label used in the bucket key (so different
 *                                 limiters don't share counts)
 * @param {(req)=>string} [opts.keyGenerator] custom key (defaults to client IP)
 * @param {string} [opts.message] error message on limit
 */
function rateLimit({ windowMs, max, name = 'rl', keyGenerator, message } = {}) {
    return (req, res, next) => {
        const id = keyGenerator ? keyGenerator(req) : clientIp(req);
        const key = `${name}:${id}`;
        const now = Date.now();
        let b = buckets.get(key);
        if (!b || b.resetAt <= now) { b = { count: 0, resetAt: now + windowMs }; buckets.set(key, b); }
        b.count++;
        if (b.count > max) {
            const retry = Math.ceil((b.resetAt - now) / 1000);
            res.set('Retry-After', String(retry));
            return res.status(429).json({ error: message || `Too many requests. Try again in ${retry}s.` });
        }
        next();
    };
}

module.exports = { rateLimit, clientIp };
