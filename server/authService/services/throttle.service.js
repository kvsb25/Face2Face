// Per-account login backoff (SRS FR-AUTH-08).
//
// Keyed by a hash of the email so the Redis keyspace never contains a list of
// registered addresses. The backoff is exponential but capped, and always
// expires — a permanent lockout would let anyone deny a known user their
// account by failing logins on purpose.
//
// This is the account-scoped half of the throttling story; the IP, subnet and
// global limiters arrive with the P3 rate limiter.

const crypto = require('crypto');
const { AppError } = require('../../shared/errors');

const key = (email, cfg) => `auth:fail:${crypto
    .createHmac('sha256', Buffer.from(cfg.IP_HASH_SECRET, 'base64'))
    .update(String(email).toLowerCase())
    .digest('hex')}`;

function backoffSeconds(failures, cfg) {
    if (failures < cfg.LOGIN_MAX_FAILURES) return 0;
    const over = failures - cfg.LOGIN_MAX_FAILURES;
    return Math.min(2 ** over, cfg.LOGIN_BACKOFF_CAP_SECONDS);
}

function createThrottleService({ cfg, redis, logger }) {
    async function check(email) {
        if (!redis) return;
        let raw;
        try {
            raw = await redis.get(key(email, cfg));
        } catch (err) {
            // Login is an auth write: if the throttle store is unreachable we
            // fail closed rather than allow unlimited guessing. (SRS FR-RL-09)
            logger.error({ err }, 'throttle store unavailable');
            throw new AppError('SERVICE_UNAVAILABLE', { headers: { 'Retry-After': '5' }, cause: err });
        }

        const failures = Number(raw || 0);
        const wait = backoffSeconds(failures, cfg);
        if (wait > 0) {
            throw new AppError('ACCOUNT_LOCKED', {
                headers: { 'Retry-After': String(wait) },
                logMessage: `login throttled after ${failures} failures`,
            });
        }
    }

    async function recordFailure(email) {
        if (!redis) return 0;
        const k = key(email, cfg);
        const failures = await redis.incr(k);
        // the window always slides forward from the most recent failure
        await redis.expire(k, cfg.LOGIN_BACKOFF_CAP_SECONDS);
        return failures;
    }

    async function clear(email) {
        if (!redis) return;
        await redis.del(key(email, cfg));
    }

    return { check, recordFailure, clear, backoffSeconds };
}

module.exports = { createThrottleService, backoffSeconds, key };
