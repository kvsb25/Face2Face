// Access-token verification must reject every shape of forged token.
// SRS FR-SESS-01, FR-SESS-02 (the tampering matrix in §7.1)

const crypto = require('crypto');
const { SignJWT, importPKCS8 } = require('jose');
const { load } = require('../../server/shared/config');
const { createSigner, createLocalVerifier, ALG } = require('../../server/shared/jwt');

const cfg = load('auth');
const decodePem = (b64) => Buffer.from(b64, 'base64').toString('utf8');

let signer;
let verify;

beforeAll(async () => {
    signer = await createSigner(cfg);
    verify = await createLocalVerifier(cfg);
});

const claims = { sub: crypto.randomUUID(), sid: crypto.randomUUID(), name: 'Test User', emailVerified: true };

describe('valid tokens', () => {
    it('round-trips the claims the services rely on', async () => {
        const { token, jti } = await signer.signAccessToken(claims);
        const { payload, protectedHeader } = await verify(token);

        expect(protectedHeader).toMatchObject({ alg: ALG, kid: cfg.JWT_KEY_ID, typ: 'JWT' });
        expect(payload).toMatchObject({
            sub: claims.sub,
            sid: claims.sid,
            name: 'Test User',
            email_verified: true,
            iss: cfg.JWT_ISSUER,
            aud: cfg.JWT_AUDIENCE,
            jti,
        });
        expect(payload.exp - payload.iat).toBe(cfg.ACCESS_TOKEN_TTL);
    });
});

describe('forged and invalid tokens are rejected', () => {
    const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');

    it('rejects alg:none', async () => {
        const header = b64url({ alg: 'none', typ: 'JWT' });
        const payload = b64url({ sub: claims.sub, iss: cfg.JWT_ISSUER, aud: cfg.JWT_AUDIENCE, exp: Math.floor(Date.now() / 1000) + 600 });
        await expect(verify(`${header}.${payload}.`)).rejects.toThrow();
    });

    it('rejects an HMAC token signed with the public key (alg confusion)', async () => {
        const secret = crypto.createSecretKey(Buffer.from(decodePem(cfg.JWT_PUBLIC_KEY)));
        const token = await new SignJWT({ sid: claims.sid })
            .setProtectedHeader({ alg: 'HS256', kid: cfg.JWT_KEY_ID })
            .setIssuer(cfg.JWT_ISSUER)
            .setAudience(cfg.JWT_AUDIENCE)
            .setSubject(claims.sub)
            .setExpirationTime('10m')
            .sign(secret);

        await expect(verify(token)).rejects.toThrow();
    });

    it('rejects a token signed by a different RSA key', async () => {
        const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
        const other = await importPKCS8(privateKey.export({ type: 'pkcs8', format: 'pem' }), ALG);
        const token = await new SignJWT({ sid: claims.sid })
            .setProtectedHeader({ alg: ALG, kid: cfg.JWT_KEY_ID })
            .setIssuer(cfg.JWT_ISSUER)
            .setAudience(cfg.JWT_AUDIENCE)
            .setSubject(claims.sub)
            .setExpirationTime('10m')
            .sign(other);

        await expect(verify(token)).rejects.toThrow();
    });

    it('rejects an expired token beyond the clock tolerance', async () => {
        const key = await importPKCS8(decodePem(cfg.JWT_PRIVATE_KEY), ALG);
        const past = Math.floor(Date.now() / 1000) - 3600;
        const token = await new SignJWT({ sid: claims.sid })
            .setProtectedHeader({ alg: ALG, kid: cfg.JWT_KEY_ID })
            .setIssuer(cfg.JWT_ISSUER)
            .setAudience(cfg.JWT_AUDIENCE)
            .setSubject(claims.sub)
            .setIssuedAt(past)
            .setExpirationTime(past + 60)
            .sign(key);

        await expect(verify(token)).rejects.toMatchObject({ code: 'ERR_JWT_EXPIRED' });
    });

    it('rejects a token that is not yet valid', async () => {
        const key = await importPKCS8(decodePem(cfg.JWT_PRIVATE_KEY), ALG);
        const token = await new SignJWT({ sid: claims.sid })
            .setProtectedHeader({ alg: ALG, kid: cfg.JWT_KEY_ID })
            .setIssuer(cfg.JWT_ISSUER)
            .setAudience(cfg.JWT_AUDIENCE)
            .setSubject(claims.sub)
            .setNotBefore(Math.floor(Date.now() / 1000) + 3600)
            .setExpirationTime('2h')
            .sign(key);

        await expect(verify(token)).rejects.toThrow();
    });

    it('rejects the wrong issuer and the wrong audience', async () => {
        const key = await importPKCS8(decodePem(cfg.JWT_PRIVATE_KEY), ALG);
        const build = (iss, aud) => new SignJWT({ sid: claims.sid })
            .setProtectedHeader({ alg: ALG, kid: cfg.JWT_KEY_ID })
            .setIssuer(iss)
            .setAudience(aud)
            .setSubject(claims.sub)
            .setExpirationTime('10m')
            .sign(key);

        await expect(verify(await build('https://evil.example', cfg.JWT_AUDIENCE))).rejects.toThrow();
        await expect(verify(await build(cfg.JWT_ISSUER, 'some-other-api'))).rejects.toThrow();
    });

    it('rejects a token whose payload was edited after signing', async () => {
        const { token } = await signer.signAccessToken(claims);
        const [header, payload, signature] = token.split('.');
        const edited = JSON.parse(Buffer.from(payload, 'base64url').toString());
        edited.sub = crypto.randomUUID();

        await expect(verify(`${header}.${b64url(edited)}.${signature}`)).rejects.toThrow();
    });

    it('rejects structurally broken tokens', async () => {
        for (const bad of ['', 'not.a.token', 'a.b', 'a.b.c.d']) {
            await expect(verify(bad)).rejects.toThrow();
        }
    });
});
