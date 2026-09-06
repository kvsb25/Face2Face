// Shared auth helpers for the client pages.
//
// The access and refresh tokens live in httpOnly cookies the page cannot read.
// All this file does is send requests with credentials and echo the CSRF cookie
// back in a header — the one thing a cross-site attacker cannot do.

const CSRF_COOKIE = 'f2f_csrf';

function readCsrfToken() {
    const match = document.cookie.match(new RegExp(`(?:^|; )${CSRF_COOKIE}=([^;]*)`));
    return match ? decodeURIComponent(match[1]) : null;
}

/** fetch() wrapper that carries cookies and the CSRF header. */
async function apiFetch(path, { method = 'GET', body } = {}) {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    const csrf = readCsrfToken();
    if (csrf && method !== 'GET') headers['X-CSRF-Token'] = csrf;

    const response = await fetch(path, {
        method,
        headers,
        credentials: 'same-origin',
        body: body === undefined ? undefined : JSON.stringify(body),
    });

    let payload = null;
    if (response.status !== 204) {
        try { payload = await response.json(); } catch { payload = null; }
    }

    if (!response.ok) {
        const error = new Error(payload?.error?.message || 'Something went wrong.');
        error.code = payload?.error?.code;
        error.status = response.status;
        error.details = payload?.error?.details || [];
        error.retryAfter = Number(response.headers.get('Retry-After')) || null;
        throw error;
    }

    return payload?.data ?? null;
}

/** Returns the signed-in user, or null. Never throws for an anonymous visitor. */
async function fetchCurrentUser() {
    try {
        const data = await apiFetch('/api/auth/me');
        return data.user;
    } catch (err) {
        if (err.status !== 401) console.warn('could not load session:', err.message);
        return null;
    }
}

/**
 * Renders a validation failure next to the field it belongs to. Text is set as
 * textContent, never HTML — server messages are data, not markup.
 */
function showErrors(err, { summaryEl, fieldEls = {} }) {
    Object.values(fieldEls).forEach((el) => { el.textContent = ''; });
    summaryEl.textContent = '';

    const details = err.details || [];
    const unplaced = [];

    for (const detail of details) {
        const target = fieldEls[detail.field];
        if (target) target.textContent = detail.message;
        else unplaced.push(detail.message);
    }

    if (!details.length || unplaced.length) {
        const wait = err.retryAfter ? ` Try again in ${Math.ceil(err.retryAfter / 60)} minute(s).` : '';
        summaryEl.textContent = (unplaced.join(' ') || err.message) + wait;
    }
}

/** Where to go after signing in, restricted to a path on this site. */
function safeNextPath() {
    const next = new URLSearchParams(window.location.search).get('next');
    if (!next) return '/';
    // reject anything that could leave this origin: schemes, //host, backslashes
    if (!/^\/[^/\\]/.test(next)) return '/';
    return next;
}

window.F2FAuth = { apiFetch, fetchCurrentUser, showErrors, safeNextPath, readCsrfToken };
