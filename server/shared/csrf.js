// Signed double-submit CSRF tokens (SRS FR-SESS-11, FR-SESS-12).
//
// The token is `<random>.<HMAC(secret, random|sid)>`. A cross-site attacker can
// make the browser send the cookie, but cannot read it to copy the value into
// the X-CSRF-Token header, and cannot forge the HMAC. Binding the session id in
// means a token minted for one session cannot be replayed against another.

const crypto = require('crypto');
const { AppError } = require('./errors');
const { CSRF_COOKIE } = require('./cookies');

const HEADER = 'x-csrf-token';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function sign(random, sid, cfg) {
    return crypto.createHmac('sha256', Buffer.from(cfg.CSRF_SECRET, 'base64'))
        .update(`${random}|${sid}`)
        .digest('base64url');
}

function issueCsrfToken(sid, cfg) {
    const random = crypto.randomBytes(24).toString('base64url');
    return `${random}.${sign(random, sid, cfg)}`;
}

// Constant-time over equal-length digests: hashing both sides first sidesteps
// timingSafeEqual's requirement that the buffers already match in length.
function constantTimeEquals(a, b) {
    const ha = crypto.createHash('sha256').update(String(a)).digest();
    const hb = crypto.createHash('sha256').update(String(b)).digest();
    return crypto.timingSafeEqual(ha, hb);
}

function verifyCsrfToken(token, sid, cfg) {
    if (typeof token !== 'string' || !token.includes('.')) return false;
    const [random, mac] = token.split('.');
    if (!random || !mac) return false;
    return constantTimeEquals(mac, sign(random, sid, cfg));
}

function isAllowedOrigin(req, cfg) {
    const origin = req.get('origin');
    if (origin) return cfg.ALLOWED_ORIGINS.includes(origin);

    const referer = req.get('referer');
    if (referer) {
        try { return cfg.ALLOWED_ORIGINS.includes(new URL(referer).origin); } catch { return false; }
    }
    // Neither header present on a state-changing request: reject rather than
    // assume. Browsers always send at least one of these for such requests.
    return false;
}

/**
 * Origin check on its own, for state-changing routes that run before a session
 * exists (signup, login) or that are authenticated by the refresh cookie alone.
 * Those cannot carry a session-bound CSRF token yet, but they can still be
 * required to come from this site. (SRS FR-SESS-12)
 */
function originGuard(cfg) {
    return (req, res, next) => {
        if (SAFE_METHODS.has(req.method)) return next();
        if (!isAllowedOrigin(req, cfg)) {
            return next(new AppError('CSRF_FAILED', { logMessage: 'origin/referer not allowed' }));
        }
        return next();
    };
}

/**
 * Guards every state-changing request. `getSid` reads the session id from
 * whatever the route already resolved (access token claims, or the refresh
 * token's family) so the check works before and after authentication.
 */
function csrfProtection(cfg, getSid) {
    return (req, res, next) => {
        if (SAFE_METHODS.has(req.method)) return next();

        if (!isAllowedOrigin(req, cfg)) {
            return next(new AppError('CSRF_FAILED', { logMessage: 'origin/referer not allowed' }));
        }

        const cookieToken = req.cookies?.[CSRF_COOKIE];
        const headerToken = req.get(HEADER);
        if (!cookieToken || !headerToken || !constantTimeEquals(cookieToken, headerToken)) {
            return next(new AppError('CSRF_FAILED', { logMessage: 'csrf cookie/header mismatch' }));
        }

        const sid = getSid ? getSid(req) : null;
        if (sid && !verifyCsrfToken(cookieToken, sid, cfg)) {
            return next(new AppError('CSRF_FAILED', { logMessage: 'csrf token not valid for this session' }));
        }

        return next();
    };
}

module.exports = { issueCsrfToken, verifyCsrfToken, csrfProtection, originGuard, isAllowedOrigin, constantTimeEquals, HEADER };
