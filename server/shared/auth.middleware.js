// Access-token verification, used by authService locally and by httpServer /
// wsServer against JWKS. (SRS FR-SESS-02, FR-AUTHZ-01…03)

const { AppError } = require('./errors');
const { AT_COOKIE } = require('./cookies');
const { REVOKED_KEY } = require('../authService/services/token.service');

function readToken(req) {
    const fromCookie = req.cookies?.[AT_COOKIE];
    if (fromCookie) return fromCookie;

    // Bearer is accepted so non-browser callers and tests do not need a cookie
    // jar; browser sessions always use the httpOnly cookie.
    const header = req.get('authorization');
    if (header && header.startsWith('Bearer ')) return header.slice(7).trim();
    return null;
}

/**
 * @param {{ cfg: object, verify: (token: string) => Promise<{payload: object}>, getRedis: () => Promise<object>, logger: object }} deps
 */
function createAuthMiddleware({ cfg, verify, getRedis, logger }) {
    async function resolveUser(req) {
        const token = readToken(req);
        if (!token) return null;

        let payload;
        try {
            ({ payload } = await verify(token));
        } catch (err) {
            // expired, tampered, wrong issuer/audience, unknown key — all the
            // same to the caller: the session is not usable
            logger.debug({ err: err.code || err.message }, 'access token rejected');
            return null;
        }

        // A token can be valid and still be dead: logout and reuse detection
        // both denylist the jti for the remainder of its lifetime.
        if (payload.jti) {
            try {
                const redis = await getRedis();
                if (await redis.exists(REVOKED_KEY(payload.jti))) {
                    logger.debug({ jti: payload.jti }, 'access token is denylisted');
                    return null;
                }
            } catch (err) {
                // Fail closed: an unverifiable revocation state must not be
                // treated as "not revoked". (SRS FR-RL-09)
                logger.error({ err }, 'revocation check unavailable');
                throw new AppError('SERVICE_UNAVAILABLE', { cause: err });
            }
        }

        return {
            id: payload.sub,
            sid: payload.sid,
            name: payload.name,
            emailVerified: Boolean(payload.email_verified),
            jti: payload.jti,
            expiresAt: new Date(payload.exp * 1000),
        };
    }

    /** Attaches req.user when a valid session exists; never rejects. */
    const optionalAuth = async (req, res, next) => {
        try {
            req.user = await resolveUser(req);
            next();
        } catch (err) {
            next(err);
        }
    };

    /** Rejects anonymous callers. */
    const requireAuth = async (req, res, next) => {
        try {
            req.user = await resolveUser(req);
            if (!req.user) return next(new AppError('AUTH_REQUIRED'));
            next();
        } catch (err) {
            next(err);
        }
    };

    return { requireAuth, optionalAuth, resolveUser };
}

module.exports = { createAuthMiddleware, readToken };
