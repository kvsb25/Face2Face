// Shared harness for integration tests: one app instance per file, a clean
// database between tests, and helpers for the cookie dance a browser does.
//
// Integration tests share one test database and one Redis logical database, so
// they must run serially — `npm run test:integration` passes --runInBand for
// exactly this reason. Running the files in parallel lets one file's reset wipe
// another's fixtures mid-test.

const request = require('supertest');
const { createApp } = require('../../server/authService/app');
const { AT_COOKIE, RT_COOKIE, CSRF_COOKIE } = require('../../server/shared/cookies');
const { HEADER: CSRF_HEADER } = require('../../server/shared/csrf');

const ORIGIN = 'http://localhost:3000';

async function startAuthApp() {
    const built = await createApp();
    return built;
}

/** Deletes in FK-safe order — the app role has DML rights but not TRUNCATE. */
async function resetDatabase(prisma) {
    await prisma.authEvent.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.oAuthAccount.deleteMany();
    await prisma.room.deleteMany();
    await prisma.user.deleteMany();
}

async function resetRedis(redis) {
    if (!redis) return;
    // only the test logical database is ever touched (SRS FR-RD-03)
    await redis.flushDb();
}

/** Parses Set-Cookie headers into { name: { value, attributes } }. */
function parseCookies(res) {
    const raw = res.headers['set-cookie'] || [];
    const out = {};
    for (const line of raw) {
        const [pair, ...rest] = line.split('; ');
        const index = pair.indexOf('=');
        const name = pair.slice(0, index);
        out[name] = {
            value: pair.slice(index + 1),
            attributes: rest.map((a) => a.toLowerCase()),
            raw: line,
        };
    }
    return out;
}

/** Turns a response's cookies into the Cookie header a browser would send back. */
function cookieHeader(jar) {
    return Object.entries(jar)
        .filter(([, c]) => c.value !== '')
        .map(([name, c]) => `${name}=${c.value}`)
        .join('; ');
}

function mergeCookies(jar, res) {
    return { ...jar, ...parseCookies(res) };
}

const validPassword = 'correct horse battery staple';

/** Signs a user up and returns the cookie jar plus the response. */
async function signup(app, overrides = {}) {
    const body = {
        email: overrides.email || `user${Date.now()}${Math.floor(Math.random() * 1000)}@example.com`,
        password: overrides.password || validPassword,
        displayName: overrides.displayName || 'Test User',
    };
    const res = await request(app).post('/api/auth/signup').set('Origin', ORIGIN).send(body);
    return { res, jar: parseCookies(res), body };
}

/** Authenticated request with cookies and the CSRF header a browser would add. */
function authed(app, method, path, jar) {
    const req = request(app)[method](path)
        .set('Origin', ORIGIN)
        .set('Cookie', cookieHeader(jar));
    if (jar[CSRF_COOKIE]) req.set(CSRF_HEADER, jar[CSRF_COOKIE].value);
    return req;
}

module.exports = {
    startAuthApp, resetDatabase, resetRedis,
    parseCookies, cookieHeader, mergeCookies, signup, authed,
    ORIGIN, validPassword,
    AT_COOKIE, RT_COOKIE, CSRF_COOKIE, CSRF_HEADER,
};
