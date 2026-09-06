// Audit trail (SRS FR-OBS-03). Written on every authentication decision so an
// incident can be reconstructed without relying on log retention.

const EVENTS = {
    SIGNUP: 'signup',
    LOGIN: 'login',
    LOGOUT: 'logout',
    LOGOUT_ALL: 'logout_all',
    REFRESH: 'refresh',
    TOKEN_REUSE: 'token_reuse_detected',
    PASSWORD_CHANGE: 'password_change',
    LOCKOUT: 'lockout',
};

function createEventRepo(prisma, logger) {
    return {
        /**
         * Audit writes must never break the request they describe: a failed
         * insert is logged loudly but the caller's operation still completes.
         */
        async record({ userId = null, eventType, success, ipHash = null, userAgent = null, detail = {} }) {
            try {
                await prisma.authEvent.create({
                    data: { userId, eventType, success, ipHash, userAgent, detail },
                });
            } catch (err) {
                logger.error({ err, eventType }, 'failed to write auth event');
            }
        },
    };
}

module.exports = { createEventRepo, EVENTS };
