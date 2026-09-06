// Room authorisation through the real edge service: httpServer verifies tokens
// against authService's JWKS, proxies /api/auth, and gates room creation.
// SRS FR-AUTHZ-01…03, FR-VAL-03, FR-DEP-03

const request = require('supertest');
const { resetDatabase, resetRedis, parseCookies, cookieHeader, ORIGIN, validPassword } = require('../helpers/harness');

// roomManager runs as its own service; these tests are about who may reach it,
// not about what it does, so it is stubbed.
jest.mock('../../server/httpServer/roomManager.js', () => ({
    createRoom: jest.fn(async () => 'abc-def-ghi'),
    checkRoom: jest.fn(async () => ({ exists: true, full: false })),
}));
const roomManager = require('../../server/httpServer/roomManager.js');

let authApp;
let authServer;
let http;
let prisma;
let redis;

beforeAll(async () => {
    // real authService on an ephemeral port, so the JWKS fetch is a real one
    const built = await require('../../server/authService/app').createApp();
    authApp = built;
    prisma = built.prisma;
    redis = built.redis;
    authServer = built.app.listen(0);

    const { port } = authServer.address();
    process.env.JWKS_URL = `http://127.0.0.1:${port}/.well-known/jwks.json`;
    process.env.AUTH_SERVICE_URL = `http://127.0.0.1:${port}`;

    // config is cached per service, so httpServer must be built after the env
    // above is set
    const { load } = require('../../server/shared/config');
    const cfg = load('http', { ...process.env });
    http = require('../../server/httpServer/app').createApp({ cfg }).app;
});

afterAll(async () => {
    if (authServer) await new Promise((resolve) => authServer.close(resolve));
    if (authApp) await authApp.app.locals.close();
});

beforeEach(async () => {
    await resetDatabase(prisma);
    await resetRedis(redis);
    roomManager.createRoom.mockClear();
    roomManager.checkRoom.mockClear();
});

/** Signs up through httpServer's proxy, the way the browser does. */
async function signupThroughProxy() {
    const body = {
        email: `member${Date.now()}${Math.floor(Math.random() * 1000)}@example.com`,
        password: validPassword,
        displayName: 'Room Member',
    };
    const res = await request(http).post('/api/auth/signup').set('Origin', ORIGIN).send(body);
    return { res, jar: parseCookies(res), body };
}

describe('auth proxy', () => {
    it('passes signup through to authService and returns its cookies', async () => {
        const { res, jar } = await signupThroughProxy();

        expect(res.status).toBe(201);
        expect(jar.f2f_at).toBeDefined();
        expect(jar.f2f_rt).toBeDefined();
        expect(jar.f2f_csrf).toBeDefined();
    });

    it('passes authService errors through unchanged', async () => {
        const res = await request(http).post('/api/auth/login').set('Origin', ORIGIN)
            .send({ email: 'nobody@example.com', password: 'not a real password' });

        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    });
});

describe('creating a room', () => {
    it('is refused for a guest', async () => {
        const res = await request(http).post('/api/room').set('Origin', ORIGIN);

        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe('AUTH_REQUIRED');
        expect(roomManager.createRoom).not.toHaveBeenCalled();
    });

    it('is refused for a forged token', async () => {
        const res = await request(http).post('/api/room').set('Origin', ORIGIN)
            .set('Authorization', 'Bearer eyJhbGciOiJub25lIn0.eyJzdWIiOiJhdHRhY2tlciJ9.');

        expect(res.status).toBe(401);
        expect(roomManager.createRoom).not.toHaveBeenCalled();
    });

    it('succeeds for a signed-in member', async () => {
        const { jar } = await signupThroughProxy();

        const res = await request(http).post('/api/room').set('Origin', ORIGIN)
            .set('Cookie', cookieHeader(jar));

        expect(res.status).toBe(201);
        expect(res.body.data.roomId).toBe('abc-def-ghi');
        expect(roomManager.createRoom).toHaveBeenCalledTimes(1);
    });

    it('is refused again once the member signs out', async () => {
        const { jar } = await signupThroughProxy();

        await request(http).post('/api/auth/logout').set('Origin', ORIGIN)
            .set('Cookie', cookieHeader(jar))
            .set('X-CSRF-Token', jar.f2f_csrf.value);

        const res = await request(http).post('/api/room').set('Origin', ORIGIN)
            .set('Cookie', cookieHeader(jar));

        // the access token has not expired, but logout denylisted it
        expect(res.status).toBe(401);
    });
});

describe('joining a room', () => {
    it('stays open to guests', async () => {
        const res = await request(http).get('/api/room?roomId=abc-def-ghi');

        expect(res.status).toBe(200);
        expect(res.body.data.roomId).toBe('abc-def-ghi');
    });

    it('reports a missing room and a full room distinctly', async () => {
        roomManager.checkRoom.mockResolvedValueOnce({ exists: false, full: false });
        expect((await request(http).get('/api/room?roomId=zzz-zzz-zzz')).status).toBe(404);

        roomManager.checkRoom.mockResolvedValueOnce({ exists: true, full: true });
        expect((await request(http).get('/api/room?roomId=abc-def-ghi')).status).toBe(409);
    });

    it('rejects a malformed room code before calling roomManager', async () => {
        const bad = [
            'abc',
            'ABC-DEF-GHI',
            'abc-def-ghi-jkl',
            '../../etc/passwd',
            'abc-def-ghi/../admin',
            "abc-def-ghi' OR '1'='1",
        ];

        for (const roomId of bad) {
            const res = await request(http).get(`/api/room?roomId=${encodeURIComponent(roomId)}`);
            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('VALIDATION_FAILED');
        }
        expect(roomManager.checkRoom).not.toHaveBeenCalled();
    });
});

describe('pages', () => {
    it('serves the home, login and signup pages', async () => {
        for (const route of ['/', '/login', '/signup']) {
            const res = await request(http).get(route);
            expect(res.status).toBe(200);
            expect(res.headers['content-type']).toMatch(/html/);
        }
    });

    it('sets the baseline security headers', async () => {
        const res = await request(http).get('/');

        expect(res.headers['x-content-type-options']).toBe('nosniff');
        expect(res.headers['x-frame-options']).toBe('DENY');
        expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
        expect(res.headers['permissions-policy']).toMatch(/camera=\(self\)/);
    });

    it('sends a bad room code back home instead of showing an error page', async () => {
        const res = await request(http).get('/room/not-a-code');

        expect(res.status).toBe(302);
        expect(res.headers.location).toBe('/?error=server');
    });
});
