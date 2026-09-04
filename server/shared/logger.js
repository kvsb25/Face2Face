// Structured JSON logging with redaction applied at the logger, not at call
// sites, so a secret cannot leak through a log line someone forgot to sanitise.
// (SRS FR-OBS-01, FR-OBS-02)

const crypto = require('crypto');
const pino = require('pino');

// Every path here is dropped before serialisation. `remove: true` deletes the
// key entirely rather than printing '[Redacted]', which keeps logs honest about
// what the service actually holds.
const REDACT_PATHS = [
    'password', '*.password', '*.*.password',
    'passwordHash', '*.passwordHash',
    'currentPassword', '*.currentPassword',
    'newPassword', '*.newPassword',
    'token', '*.token', 'refreshToken', '*.refreshToken', 'accessToken', '*.accessToken',
    'code', '*.code', 'code_verifier', '*.code_verifier', 'client_secret', '*.client_secret',
    'req.headers.cookie', 'req.headers.authorization', 'req.headers["x-csrf-token"]',
    'res.headers["set-cookie"]',
    'ip', '*.ip', 'req.ip', 'req.remoteAddress',
];

function createLogger(cfg, bindings = {}) {
    const options = {
        level: cfg.LOG_LEVEL,
        redact: { paths: REDACT_PATHS, remove: true },
        base: { service: cfg.service, ...bindings },
        formatters: { level: (label) => ({ level: label }) },
        timestamp: pino.stdTimeFunctions.isoTime,
    };

    // pretty output is a development convenience only; production stays JSON
    if (!cfg.isProduction && !cfg.isTest) {
        return pino({
            ...options,
            transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } },
        });
    }
    if (cfg.isTest) return pino({ ...options, level: process.env.TEST_LOG_LEVEL || 'silent' });
    return pino(options);
}

/**
 * Keyed hash of a client IP. A bare SHA-256 of an IPv4 address is trivially
 * reversible (2^32 candidates), so the hash is an HMAC under a server secret —
 * it stays useful for correlation and useless to anyone who steals the table.
 * (SRS NFR-PRIV-01)
 */
function hashIp(ip, cfg) {
    if (!ip) return null;
    return crypto.createHmac('sha256', Buffer.from(cfg.IP_HASH_SECRET, 'base64'))
        .update(String(ip))
        .digest();
}

// CR/LF in a value would let a caller forge extra log records or header lines
// (SRS FR-OBS-01, FR-VAL-07)
function stripNewlines(value) {
    return typeof value === 'string' ? value.replace(/[\r\n]+/g, ' ') : value;
}

module.exports = { createLogger, hashIp, stripNewlines, REDACT_PATHS };
