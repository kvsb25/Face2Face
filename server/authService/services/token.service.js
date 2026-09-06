// Session lifecycle: issue, rotate, revoke (SRS FR-SESS-01…07, FR-SESS-14).

const crypto = require('crypto');
const { AppError } = require('../../shared/errors');
const { EVENTS } = require('../repositories/event.repo');

const sha256 = (value) => crypto.createHash('sha256').update(value).digest();
const REVOKED_KEY = (jti) => `jwt:revoked:${jti}`;

function createTokenService({ cfg, signer, tokenRepo, eventRepo, redis, logger }) {
    /**
     * Marks an access token as no longer valid before its natural expiry. The
     * entry only has to outlive the token itself, so it expires with it.
     */
    async function denylistJti(jti) {
        if (!redis) return;
        try {
            await redis.set(REVOKED_KEY(jti), '1', { EX: cfg.ACCESS_TOKEN_TTL });
        } catch (err) {
            // A denylist we cannot write is a security failure, not a nuisance:
            // surface it rather than quietly leaving the token usable.
            logger.error({ err, jti }, 'failed to denylist access token');
            throw new AppError('SERVICE_UNAVAILABLE', { cause: err });
        }
    }

    async function issueSession(user, context = {}, existing = {}) {
        const familyId = existing.familyId || crypto.randomUUID();
        const familyEndsAt = existing.familyEndsAt
            || new Date(Date.now() + cfg.REFRESH_FAMILY_MAX_AGE * 1000);

        const { token: accessToken, jti, expiresAt: accessExpiresAt } = await signer.signAccessToken({
            sub: user.id,
            sid: familyId,
            name: user.displayName,
            emailVerified: user.emailVerified,
        });

        // opaque, high-entropy, never a JWT: nothing about a refresh token
        // should be readable or verifiable without the database
        const refreshToken = crypto.randomBytes(32).toString('base64url');
        const expiresAt = new Date(Math.min(
            Date.now() + cfg.REFRESH_TOKEN_TTL * 1000,
            familyEndsAt.getTime(),
        ));

        const row = await tokenRepo.create({
            userId: user.id,
            familyId,
            tokenHash: sha256(refreshToken),
            expiresAt,
            familyEndsAt,
            jti,
            ipHash: context.ipHash || null,
            userAgent: context.userAgent || null,
        });

        return { accessToken, refreshToken, jti, familyId, accessExpiresAt, refreshExpiresAt: expiresAt, rowId: row.id };
    }

    /** Revokes a whole family and denylists the access tokens issued in it. */
    async function revokeFamily(familyId, { reason }) {
        const jtis = await tokenRepo.listFamilyJtis(familyId);
        await tokenRepo.revokeFamily(familyId);
        await Promise.all(jtis.map((row) => denylistJti(row.jti)));
        logger.warn({ familyId, reason, revoked: jtis.length }, 'refresh token family revoked');
    }

    /**
     * Rotation. Every refresh consumes the presented token and issues its
     * successor; presenting a token that was already consumed means someone is
     * replaying a stolen one, so the entire family dies.
     */
    async function rotate(presentedToken, context = {}) {
        const row = await tokenRepo.findByHash(sha256(presentedToken));
        if (!row) throw new AppError('INVALID_TOKEN', { logMessage: 'refresh token not found' });

        if (row.consumedAt || row.revokedAt) {
            await revokeFamily(row.familyId, { reason: 'refresh token reuse' });
            await eventRepo.record({
                userId: row.userId,
                eventType: EVENTS.TOKEN_REUSE,
                success: false,
                ipHash: context.ipHash,
                userAgent: context.userAgent,
                detail: { familyId: row.familyId },
            });
            throw new AppError('TOKEN_REUSE_DETECTED');
        }

        const now = new Date();
        if (row.expiresAt <= now || row.familyEndsAt <= now) {
            await revokeFamily(row.familyId, { reason: 'refresh token expired' });
            throw new AppError('INVALID_TOKEN', { logMessage: 'refresh token expired' });
        }

        // Whoever wins this update owns the rotation; a concurrent second
        // request finds the row already consumed and is rejected.
        const won = await tokenRepo.consume(row.id, now);
        if (!won) throw new AppError('INVALID_TOKEN', { logMessage: 'refresh token consumed concurrently' });

        const user = await context.findUser(row.userId);
        if (!user || user.status !== 'active') {
            await revokeFamily(row.familyId, { reason: 'account not active' });
            throw new AppError('INVALID_TOKEN', { logMessage: 'account not active' });
        }

        const issued = await issueSession(user, context, {
            familyId: row.familyId,
            familyEndsAt: row.familyEndsAt,
        });
        await tokenRepo.linkReplacement(row.id, issued.rowId);

        return { user, ...issued };
    }

    async function revokeCurrent(presentedToken, { jti } = {}) {
        if (presentedToken) {
            const row = await tokenRepo.findByHash(sha256(presentedToken));
            if (row) await revokeFamily(row.familyId, { reason: 'logout' });
        }
        if (jti) await denylistJti(jti);
    }

    async function revokeAllForUser(userId) {
        await tokenRepo.revokeAllForUser(userId);
    }

    return { issueSession, rotate, revokeFamily, revokeCurrent, revokeAllForUser, denylistJti, sha256 };
}

module.exports = { createTokenService, REVOKED_KEY, sha256 };
