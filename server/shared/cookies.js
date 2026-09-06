// Cookie names and attributes in one place, so the access token, the refresh
// token and the CSRF token cannot drift apart. (SRS FR-SESS-09…14)

const AT_COOKIE = 'f2f_at';
const RT_COOKIE = 'f2f_rt';
const CSRF_COOKIE = 'f2f_csrf';

// The refresh cookie is scoped to the auth API. A cookie the browser only sends
// to /api/auth is not exposed on every page load, every room request or every
// static asset — the blast radius of a leak elsewhere is much smaller.
const RT_PATH = '/api/auth';

function baseOptions(cfg) {
    const options = {
        httpOnly: true,
        secure: cfg.COOKIE_SECURE,
        sameSite: cfg.COOKIE_SAMESITE,
        path: '/',
    };
    if (cfg.COOKIE_DOMAIN) options.domain = cfg.COOKIE_DOMAIN;
    return options;
}

function setAccessCookie(res, cfg, token) {
    res.cookie(AT_COOKIE, token, { ...baseOptions(cfg), maxAge: cfg.ACCESS_TOKEN_TTL * 1000 });
}

function setRefreshCookie(res, cfg, token) {
    res.cookie(RT_COOKIE, token, {
        ...baseOptions(cfg),
        // strict: a refresh must never ride along on a cross-site navigation
        sameSite: 'strict',
        path: RT_PATH,
        maxAge: cfg.REFRESH_TOKEN_TTL * 1000,
    });
}

// Readable by JavaScript on purpose — the page has to echo it back in a header,
// which is exactly what a cross-site attacker cannot do. (SRS FR-SESS-11)
function setCsrfCookie(res, cfg, token) {
    res.cookie(CSRF_COOKIE, token, {
        ...baseOptions(cfg),
        httpOnly: false,
        maxAge: cfg.REFRESH_TOKEN_TTL * 1000,
    });
}

// Clearing must repeat the attributes the cookie was set with, or the browser
// keeps the original.
function clearAuthCookies(res, cfg) {
    const base = baseOptions(cfg);
    res.clearCookie(AT_COOKIE, base);
    res.clearCookie(RT_COOKIE, { ...base, sameSite: 'strict', path: RT_PATH });
    res.clearCookie(CSRF_COOKIE, { ...base, httpOnly: false });
}

module.exports = {
    AT_COOKIE, RT_COOKIE, CSRF_COOKIE, RT_PATH,
    setAccessCookie, setRefreshCookie, setCsrfCookie, clearAuthCookies, baseOptions,
};
