// Access-token signing and verification (SRS FR-SESS-01, FR-SESS-02, FR-SESS-04).
//
// Signing lives only in authService, which holds the private key. Every other
// service verifies with the public key it fetches from JWKS, so a compromised
// edge service cannot mint tokens.

const { SignJWT, jwtVerify, importPKCS8, importSPKI, exportJWK, createRemoteJWKSet } = require('jose');
const crypto = require('crypto');

const ALG = 'RS256';
// Only RS256 is ever accepted. Passing an allow-list to jose is what defeats
// `alg: none` and the HMAC-with-the-public-key confusion attack: a token signed
// with any other algorithm fails before its signature is even considered.
const ALLOWED_ALGS = [ALG];
const CLOCK_TOLERANCE = 60; // seconds (SRS FR-SESS-02)

const decodePem = (b64) => Buffer.from(b64, 'base64').toString('utf8');

/** Signer for authService. */
async function createSigner(cfg) {
    const privateKey = await importPKCS8(decodePem(cfg.JWT_PRIVATE_KEY), ALG);

    /**
     * @param {{ sub: string, sid: string, name: string, emailVerified: boolean, jti?: string }} claims
     * @returns {Promise<{ token: string, jti: string, expiresAt: Date }>}
     */
    async function signAccessToken(claims) {
        const jti = claims.jti || crypto.randomUUID();
        const now = Math.floor(Date.now() / 1000);
        const exp = now + cfg.ACCESS_TOKEN_TTL;

        const token = await new SignJWT({
            sid: claims.sid,
            name: claims.name,
            email_verified: claims.emailVerified,
        })
            .setProtectedHeader({ alg: ALG, kid: cfg.JWT_KEY_ID, typ: 'JWT' })
            .setIssuer(cfg.JWT_ISSUER)
            .setAudience(cfg.JWT_AUDIENCE)
            .setSubject(claims.sub)
            .setJti(jti)
            .setIssuedAt(now)
            .setExpirationTime(exp)
            .sign(privateKey);

        return { token, jti, expiresAt: new Date(exp * 1000) };
    }

    return { signAccessToken };
}

/** JWKS document served at /.well-known/jwks.json. */
async function buildJwks(cfg) {
    const publicKey = await importSPKI(decodePem(cfg.JWT_PUBLIC_KEY), ALG);
    const jwk = await exportJWK(publicKey);
    return { keys: [{ ...jwk, kid: cfg.JWT_KEY_ID, alg: ALG, use: 'sig' }] };
}

/**
 * Verifier for httpServer / wsServer: fetches JWKS over HTTP and caches it,
 * refetching on an unknown `kid` so a key rotation needs no redeploy.
 */
function createRemoteVerifier(cfg) {
    const jwks = createRemoteJWKSet(new URL(cfg.JWKS_URL), {
        cacheMaxAge: 5 * 60 * 1000,     // SRS FR-SESS-04: cache for at least 5 minutes
        cooldownDuration: 60 * 1000,    // at most one refetch a minute
        timeoutDuration: 3000,
    });
    return (token) => jwtVerify(token, jwks, {
        issuer: cfg.JWT_ISSUER,
        audience: cfg.JWT_AUDIENCE,
        algorithms: ALLOWED_ALGS,
        clockTolerance: CLOCK_TOLERANCE,
    });
}

/** Verifier for authService itself — no point calling its own HTTP endpoint. */
async function createLocalVerifier(cfg) {
    const publicKey = await importSPKI(decodePem(cfg.JWT_PUBLIC_KEY), ALG);
    return (token) => jwtVerify(token, publicKey, {
        issuer: cfg.JWT_ISSUER,
        audience: cfg.JWT_AUDIENCE,
        algorithms: ALLOWED_ALGS,
        clockTolerance: CLOCK_TOLERANCE,
    });
}

module.exports = { createSigner, buildJwks, createRemoteVerifier, createLocalVerifier, ALG, ALLOWED_ALGS, CLOCK_TOLERANCE };
