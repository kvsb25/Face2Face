// SRS FR-SESS-11, FR-SESS-12, FR-VAL-02, FR-VAL-12

const crypto = require('crypto');
const { z } = require('zod');
const { load } = require('../../server/shared/config');
const { issueCsrfToken, verifyCsrfToken, isAllowedOrigin, constantTimeEquals } = require('../../server/shared/csrf');
const { validate, findPollutingKey } = require('../../server/shared/validate');

const cfg = load('auth');

describe('signed double-submit CSRF tokens', () => {
    const sid = crypto.randomUUID();

    it('verifies a token it issued for the same session', () => {
        expect(verifyCsrfToken(issueCsrfToken(sid, cfg), sid, cfg)).toBe(true);
    });

    it('rejects a token issued for a different session', () => {
        expect(verifyCsrfToken(issueCsrfToken(sid, cfg), crypto.randomUUID(), cfg)).toBe(false);
    });

    it('rejects a tampered signature and malformed tokens', () => {
        const token = issueCsrfToken(sid, cfg);
        const [random] = token.split('.');
        expect(verifyCsrfToken(`${random}.deadbeef`, sid, cfg)).toBe(false);
        expect(verifyCsrfToken('no-dot-here', sid, cfg)).toBe(false);
        expect(verifyCsrfToken('', sid, cfg)).toBe(false);
        expect(verifyCsrfToken(null, sid, cfg)).toBe(false);
    });

    it('is unforgeable without the secret', () => {
        const other = { ...cfg, CSRF_SECRET: crypto.randomBytes(32).toString('base64') };
        expect(verifyCsrfToken(issueCsrfToken(sid, other), sid, cfg)).toBe(false);
    });

    it('compares values of differing length without throwing', () => {
        expect(constantTimeEquals('short', 'a-much-longer-value')).toBe(false);
        expect(constantTimeEquals('same', 'same')).toBe(true);
    });
});

describe('origin checking', () => {
    const req = (headers) => ({ get: (name) => headers[name.toLowerCase()] });

    it('accepts an allow-listed origin', () => {
        expect(isAllowedOrigin(req({ origin: cfg.ALLOWED_ORIGINS[0] }), cfg)).toBe(true);
    });

    it('rejects a foreign origin', () => {
        expect(isAllowedOrigin(req({ origin: 'https://evil.example' }), cfg)).toBe(false);
    });

    it('falls back to referer, matching on origin only', () => {
        expect(isAllowedOrigin(req({ referer: `${cfg.ALLOWED_ORIGINS[0]}/room/abc-def-ghi` }), cfg)).toBe(true);
        expect(isAllowedOrigin(req({ referer: 'https://evil.example/page' }), cfg)).toBe(false);
        expect(isAllowedOrigin(req({ referer: 'not a url' }), cfg)).toBe(false);
    });

    it('rejects a request carrying neither header', () => {
        expect(isAllowedOrigin(req({}), cfg)).toBe(false);
    });
});

describe('request validation', () => {
    const schema = z.strictObject({ name: z.string().max(10) });
    const run = (body) => new Promise((resolve) => {
        const req = { body, get: () => undefined };
        validate({ body: schema })(req, {}, (err) => resolve({ err, req }));
    });

    it('passes a valid body through', async () => {
        const { err, req } = await run({ name: 'ok' });
        expect(err).toBeUndefined();
        expect(req.body).toEqual({ name: 'ok' });
    });

    it('rejects unknown keys instead of ignoring them', async () => {
        const { err } = await run({ name: 'ok', isAdmin: true });
        expect(err).toMatchObject({ code: 'VALIDATION_FAILED' });
    });

    it('reports the offending field', async () => {
        const { err } = await run({ name: 'x'.repeat(50) });
        expect(err.details).toEqual([expect.objectContaining({ field: 'name' })]);
    });

    it('rejects prototype-pollution keys at any depth', async () => {
        const { err } = await run(JSON.parse('{"name":"ok","nested":{"__proto__":{"admin":true}}}'));
        expect(err).toMatchObject({ code: 'VALIDATION_FAILED' });
        expect(err.details[0].field).toBe('__proto__');
    });

    it('detects polluting keys directly', () => {
        expect(findPollutingKey(JSON.parse('{"a":{"constructor":1}}'))).toBe('constructor');
        expect(findPollutingKey({ a: { b: 1 } })).toBeNull();
    });
});
