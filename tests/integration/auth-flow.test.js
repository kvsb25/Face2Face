// End-to-end auth behaviour against a real PostgreSQL and Redis.
// SRS FR-AUTH-01…09, FR-SESS-05…14, FR-AUTHZ-01

const request = require('supertest');
const {
    startAuthApp, resetDatabase, resetRedis, parseCookies, cookieHeader, signup, authed,
    ORIGIN, validPassword, AT_COOKIE, RT_COOKIE, CSRF_COOKIE, CSRF_HEADER,
} = require('../helpers/harness');

let app;
let prisma;
let redis;
let close;

beforeAll(async () => {
    const built = await startAuthApp();
    app = built.app;
    prisma = built.prisma;
    redis = built.redis;
    close = built.app.locals.close;
});

afterAll(async () => {
    if (close) await close();
});

beforeEach(async () => {
    await resetDatabase(prisma);
    await resetRedis(redis);
});

describe('signup', () => {
    it('creates the account and issues a session', async () => {
        const { res, jar } = await signup(app);

        expect(res.status).toBe(201);
        expect(res.body.data.user).toMatchObject({ displayName: 'Test User', emailVerified: false, hasPassword: true });
        expect(res.body.data.user).not.toHaveProperty('passwordHash');

        expect(jar[AT_COOKIE]).toBeDefined();
        expect(jar[RT_COOKIE]).toBeDefined();
        expect(jar[CSRF_COOKIE]).toBeDefined();
    });

    it('sets the cookie attributes the session model depends on', async () => {
        const { jar } = await signup(app);

        // access token: httpOnly, lax, site-wide
        expect(jar[AT_COOKIE].attributes).toEqual(expect.arrayContaining(['httponly', 'samesite=lax', 'path=/']));

        // refresh token: httpOnly, strict, and scoped to the auth API only
        expect(jar[RT_COOKIE].attributes).toEqual(expect.arrayContaining(['httponly', 'samesite=strict', 'path=/api/auth']));

        // csrf token: readable by the page on purpose, so it can be echoed back
        expect(jar[CSRF_COOKIE].attributes).not.toContain('httponly');
    });

    it('never stores the password in plaintext', async () => {
        const { body } = await signup(app);
        const user = await prisma.user.findUnique({ where: { email: body.email } });

        expect(user.passwordHash).toMatch(/^\$argon2id\$/);
        expect(user.passwordHash).not.toContain(validPassword);
    });

    it('rejects a duplicate email', async () => {
        const { body } = await signup(app);
        const res = await request(app).post('/api/auth/signup').set('Origin', ORIGIN).send(body);

        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe('EMAIL_TAKEN');
    });

    it('treats email as case-insensitive', async () => {
        const { res, body } = await signup(app, { email: 'MiXeD@Example.COM' });
        expect(res.body.data.user.email).toBe('mixed@example.com'); // normalised on the way in

        const duplicate = await request(app).post('/api/auth/signup').set('Origin', ORIGIN)
            .send({ ...body, email: 'MIXED@EXAMPLE.COM' });
        expect(duplicate.status).toBe(409);
    });

    it('rejects a weak password and an unknown field', async () => {
        const weak = await request(app).post('/api/auth/signup').set('Origin', ORIGIN)
            .send({ email: 'a@example.com', password: 'password123', displayName: 'A' });
        expect(weak.status).toBe(400);
        expect(weak.body.error.code).toBe('VALIDATION_FAILED');
        expect(weak.body.error.details[0].field).toBe('password');

        const extra = await request(app).post('/api/auth/signup').set('Origin', ORIGIN)
            .send({ email: 'a@example.com', password: validPassword, displayName: 'A', role: 'admin' });
        expect(extra.status).toBe(400);
    });

    it('writes an audit event', async () => {
        const { res } = await signup(app);
        const events = await prisma.authEvent.findMany({ where: { userId: res.body.data.user.id } });
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({ eventType: 'signup', success: true });
        // hashed, never the raw address (prisma returns bytea as Uint8Array)
        expect(events[0].ipHash).toBeInstanceOf(Uint8Array);
        expect(events[0].ipHash).toHaveLength(32);
    });
});

describe('login', () => {
    it('signs in with the right password', async () => {
        const { body } = await signup(app);
        const res = await request(app).post('/api/auth/login').set('Origin', ORIGIN)
            .send({ email: body.email, password: body.password });

        expect(res.status).toBe(200);
        expect(parseCookies(res)[AT_COOKIE]).toBeDefined();
    });

    it('returns the same generic error for an unknown email and a wrong password', async () => {
        const { body } = await signup(app);

        const wrongPassword = await request(app).post('/api/auth/login').set('Origin', ORIGIN)
            .send({ email: body.email, password: 'definitely not the one' });
        const unknownEmail = await request(app).post('/api/auth/login').set('Origin', ORIGIN)
            .send({ email: 'nobody@example.com', password: 'definitely not the one' });

        expect(wrongPassword.status).toBe(401);
        expect(unknownEmail.status).toBe(401);
        expect(wrongPassword.body).toEqual(unknownEmail.body);
        expect(wrongPassword.body.error.code).toBe('INVALID_CREDENTIALS');
    });

    it('throttles an account after repeated failures, then clears on success', async () => {
        const { body } = await signup(app);
        const attempt = (password) => request(app).post('/api/auth/login').set('Origin', ORIGIN)
            .send({ email: body.email, password });

        for (let i = 0; i < 5; i += 1) {
            expect((await attempt('wrong password here')).status).toBe(401);
        }

        const throttled = await attempt('wrong password here');
        expect(throttled.status).toBe(429);
        expect(throttled.body.error.code).toBe('ACCOUNT_LOCKED');
        expect(Number(throttled.headers['retry-after'])).toBeGreaterThan(0);

        // the correct password is refused too while the backoff is live —
        // otherwise the throttle would not slow a guessing attack down
        expect((await attempt(body.password)).status).toBe(429);
    });
});

describe('session lifecycle', () => {
    it('rotates the refresh token and invalidates the old one', async () => {
        const { jar } = await signup(app);

        const first = await request(app).post('/api/auth/refresh').set('Origin', ORIGIN)
            .set('Cookie', cookieHeader(jar));
        expect(first.status).toBe(200);

        const rotated = parseCookies(first);
        expect(rotated[RT_COOKIE].value).not.toBe(jar[RT_COOKIE].value);

        const withNew = await request(app).post('/api/auth/refresh').set('Origin', ORIGIN)
            .set('Cookie', `${RT_COOKIE}=${rotated[RT_COOKIE].value}`);
        expect(withNew.status).toBe(200);
    });

    it('kills the whole family when a consumed refresh token is replayed', async () => {
        const { jar, res: signupRes } = await signup(app);
        const userId = signupRes.body.data.user.id;

        const first = await request(app).post('/api/auth/refresh').set('Origin', ORIGIN)
            .set('Cookie', cookieHeader(jar));
        const rotated = parseCookies(first);

        // replay the token that was already spent
        const replay = await request(app).post('/api/auth/refresh').set('Origin', ORIGIN)
            .set('Cookie', `${RT_COOKIE}=${jar[RT_COOKIE].value}`);
        expect(replay.status).toBe(401);
        expect(replay.body.error.code).toBe('TOKEN_REUSE_DETECTED');

        // the token the legitimate client is holding dies with the family
        const afterBreach = await request(app).post('/api/auth/refresh').set('Origin', ORIGIN)
            .set('Cookie', `${RT_COOKIE}=${rotated[RT_COOKIE].value}`);
        expect(afterBreach.status).toBe(401);

        const live = await prisma.refreshToken.count({ where: { userId, revokedAt: null } });
        expect(live).toBe(0);

        const event = await prisma.authEvent.findFirst({ where: { userId, eventType: 'token_reuse_detected' } });
        expect(event).not.toBeNull();
    });

    it('lets exactly one of two concurrent refreshes win', async () => {
        const { jar } = await signup(app);
        const fire = () => request(app).post('/api/auth/refresh').set('Origin', ORIGIN)
            .set('Cookie', cookieHeader(jar));

        const results = await Promise.all([fire(), fire()]);
        const statuses = results.map((r) => r.status).sort();

        expect(statuses).toEqual([200, 401]);
    });

    it('rejects a refresh with no cookie', async () => {
        const res = await request(app).post('/api/auth/refresh').set('Origin', ORIGIN);
        expect(res.status).toBe(401);
    });

    it('refuses signup, login and refresh from a foreign origin', async () => {
        const { jar, body } = await signup(app);

        const cases = [
            ['/api/auth/signup', { email: 'x@example.com', password: validPassword, displayName: 'X' }, null],
            ['/api/auth/login', { email: body.email, password: body.password }, null],
            ['/api/auth/refresh', undefined, `${RT_COOKIE}=${jar[RT_COOKIE].value}`],
        ];

        for (const [path, payload, cookie] of cases) {
            const req = request(app).post(path).set('Origin', 'https://evil.example');
            if (cookie) req.set('Cookie', cookie);
            const res = await (payload ? req.send(payload) : req);

            expect(res.status).toBe(403);
            expect(res.body.error.code).toBe('CSRF_FAILED');
        }
    });

    it('refuses a state-changing request that carries no origin or referer', async () => {
        const res = await request(app).post('/api/auth/login')
            .send({ email: 'someone@example.com', password: validPassword });

        expect(res.status).toBe(403);
    });
});

describe('authenticated routes', () => {
    it('returns the profile for a signed-in user and 401 for a guest', async () => {
        const { jar, body } = await signup(app);

        const mine = await request(app).get('/api/auth/me').set('Cookie', cookieHeader(jar));
        expect(mine.status).toBe(200);
        expect(mine.body.data.user.email).toBe(body.email);

        const guest = await request(app).get('/api/auth/me');
        expect(guest.status).toBe(401);
        expect(guest.body.error.code).toBe('AUTH_REQUIRED');
    });

    it('rejects a state-changing request without the CSRF header', async () => {
        const { jar } = await signup(app);

        const noHeader = await request(app).post('/api/auth/logout').set('Origin', ORIGIN)
            .set('Cookie', cookieHeader(jar));
        expect(noHeader.status).toBe(403);
        expect(noHeader.body.error.code).toBe('CSRF_FAILED');

        const wrongHeader = await request(app).post('/api/auth/logout').set('Origin', ORIGIN)
            .set('Cookie', cookieHeader(jar)).set(CSRF_HEADER, 'not-the-token');
        expect(wrongHeader.status).toBe(403);
    });

    it('rejects a state-changing request from a foreign origin', async () => {
        const { jar } = await signup(app);
        const res = await request(app).post('/api/auth/logout')
            .set('Origin', 'https://evil.example')
            .set('Cookie', cookieHeader(jar))
            .set(CSRF_HEADER, jar[CSRF_COOKIE].value);

        expect(res.status).toBe(403);
    });

    it('logs out: clears cookies and kills the access token immediately', async () => {
        const { jar } = await signup(app);

        const res = await authed(app, 'post', '/api/auth/logout', jar);
        expect(res.status).toBe(204);

        const cleared = parseCookies(res);
        expect(cleared[AT_COOKIE].value).toBe('');
        expect(cleared[RT_COOKIE].value).toBe('');

        // the access token has not expired yet, but it must no longer work
        const afterLogout = await request(app).get('/api/auth/me').set('Cookie', cookieHeader(jar));
        expect(afterLogout.status).toBe(401);
    });

    it('changes the password, revokes other sessions and keeps the caller signed in', async () => {
        const { jar, body } = await signup(app);

        // a second device
        const other = await request(app).post('/api/auth/login').set('Origin', ORIGIN)
            .send({ email: body.email, password: body.password });
        const otherJar = parseCookies(other);

        const changed = await authed(app, 'post', '/api/auth/password', jar)
            .send({ currentPassword: body.password, newPassword: 'a different long passphrase 42' });
        expect(changed.status).toBe(200);

        // the other device's refresh token is dead
        const otherRefresh = await request(app).post('/api/auth/refresh').set('Origin', ORIGIN)
            .set('Cookie', `${RT_COOKIE}=${otherJar[RT_COOKIE].value}`);
        expect(otherRefresh.status).toBe(401);

        // the old password no longer works, the new one does
        const oldPassword = await request(app).post('/api/auth/login').set('Origin', ORIGIN)
            .send({ email: body.email, password: body.password });
        expect(oldPassword.status).toBe(401);

        const newPassword = await request(app).post('/api/auth/login').set('Origin', ORIGIN)
            .send({ email: body.email, password: 'a different long passphrase 42' });
        expect(newPassword.status).toBe(200);
    });

    it('refuses a password change with the wrong current password', async () => {
        const { jar, body } = await signup(app);
        const res = await authed(app, 'post', '/api/auth/password', jar)
            .send({ currentPassword: 'not my password at all', newPassword: 'another long passphrase 99' });

        expect(res.status).toBe(401);
        const user = await prisma.user.findUnique({ where: { email: body.email } });
        expect(await prisma.authEvent.count({ where: { userId: user.id, eventType: 'password_change', success: false } })).toBe(1);
    });
});

describe('service endpoints', () => {
    it('reports health and readiness', async () => {
        expect((await request(app).get('/healthz')).status).toBe(200);
        expect((await request(app).get('/readyz')).status).toBe(200);
    });

    it('publishes a JWKS containing only the public key', async () => {
        const res = await request(app).get('/.well-known/jwks.json');

        expect(res.status).toBe(200);
        expect(res.body.keys).toHaveLength(1);
        expect(res.body.keys[0]).toMatchObject({ kty: 'RSA', alg: 'RS256', use: 'sig' });
        expect(res.body.keys[0]).not.toHaveProperty('d'); // no private component
    });

    it('rejects an oversized body before parsing it', async () => {
        const res = await request(app).post('/api/auth/signup').set('Origin', ORIGIN)
            .send({ email: 'a@example.com', password: validPassword, displayName: 'x'.repeat(200000) });
        expect(res.status).toBe(413);
    });

    it('returns a typed error for malformed JSON', async () => {
        const res = await request(app).post('/api/auth/signup').set('Origin', ORIGIN)
            .set('Content-Type', 'application/json').send('{"email": ');
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_FAILED');
    });
});
