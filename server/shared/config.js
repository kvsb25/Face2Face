// Single source of configuration for every service. The whole environment is
// parsed and validated once at boot; anything missing or malformed fails the
// process immediately rather than surfacing as a confusing runtime error later.
// (SRS NFR-MNT-03, FR-CFG-02)

const path = require('path');
const { z } = require('zod');

require('dotenv').config({ path: path.join(__dirname, '../../.env'), quiet: true });

const SECRET_MIN_BYTES = 32;

// a base64 secret that decodes to at least 32 bytes
const secret = z.string().refine(
    (v) => {
        try { return Buffer.from(v, 'base64').length >= SECRET_MIN_BYTES; } catch { return false; }
    },
    { error: `must be base64 for at least ${SECRET_MIN_BYTES} bytes of entropy` }
);

const pem = z.string().refine(
    (v) => Buffer.from(v, 'base64').toString('utf8').includes('-----BEGIN'),
    { error: 'must be a base64-encoded PEM' }
);

const port = z.coerce.number().int().min(1).max(65535);
const seconds = z.coerce.number().int().positive();
const bool = z.union([z.boolean(), z.enum(['true', 'false']).transform((v) => v === 'true')]);

const csv = z.string().transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean));

const baseSchema = z.object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

    HTTP_PORT: port.default(3000),
    WS_PORT: port.default(3001),
    ROOM_MANAGER_PORT: port.default(3002),
    AUTH_PORT: port.default(3003),
    AUTH_SERVICE_URL: z.url().default('http://localhost:3003'),
    ROOM_MANAGER_URL: z.url().default('http://localhost:3002'),

    REDIS_URL: z.string().min(1),

    JWT_ISSUER: z.string().min(1),
    JWT_AUDIENCE: z.string().min(1),
    JWKS_URL: z.url(),
    ACCESS_TOKEN_TTL: seconds.default(900),
    REFRESH_TOKEN_TTL: seconds.default(2592000),
    REFRESH_FAMILY_MAX_AGE: seconds.default(7776000),

    COOKIE_DOMAIN: z.string().optional(),
    COOKIE_SECURE: bool.default(false),
    COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),
    CSRF_SECRET: secret,

    IP_HASH_SECRET: secret,
    INTERNAL_SERVICE_TOKEN: secret,
    ALLOWED_ORIGINS: csv,
});

// vars only the auth service needs; other services must not require the
// signing key or the pepper to boot (SRS C-5: verifiers hold no signing material)
const authSchema = baseSchema.extend({
    DATABASE_URL: z.string().min(1),
    JWT_PRIVATE_KEY: pem,
    JWT_PUBLIC_KEY: pem,
    JWT_KEY_ID: z.string().min(1),
    PASSWORD_PEPPER: secret,
    ARGON2_MEMORY_KIB: z.coerce.number().int().min(19456).default(19456),
    ARGON2_TIME_COST: z.coerce.number().int().min(2).default(2),
    ARGON2_PARALLELISM: z.coerce.number().int().min(1).default(1),
    ARGON2_MAX_CONCURRENCY: z.coerce.number().int().min(1).default(4),
    LOGIN_MAX_FAILURES: z.coerce.number().int().min(1).default(5),
    LOGIN_BACKOFF_CAP_SECONDS: seconds.default(900),
});

const schemas = {
    auth: authSchema,
    http: baseSchema,
    ws: baseSchema,
    rooms: baseSchema,
};

// Production must never run with development-grade settings. These checks are
// deliberately separate from the schema so the message names the risk.
function assertProductionSafety(cfg) {
    if (cfg.NODE_ENV !== 'production') return;

    const problems = [];
    if (!cfg.COOKIE_SECURE) problems.push('COOKIE_SECURE must be true in production (session cookies would travel in clear text)');
    if (cfg.ALLOWED_ORIGINS.includes('*')) problems.push('ALLOWED_ORIGINS must not contain a wildcard');
    if (cfg.ALLOWED_ORIGINS.some((o) => o.startsWith('http://') && !o.startsWith('http://localhost'))) {
        problems.push('ALLOWED_ORIGINS must use https in production');
    }
    if (problems.length) {
        throw new Error(`Unsafe production configuration:\n  - ${problems.join('\n  - ')}`);
    }
}

const cache = new Map();

/**
 * Load and validate configuration for one service.
 * @param {'auth'|'http'|'ws'|'rooms'} service
 * @param {NodeJS.ProcessEnv} [env] overridable for tests
 */
function load(service, env = process.env) {
    if (!schemas[service]) throw new Error(`Unknown service '${service}'`);
    if (env === process.env && cache.has(service)) return cache.get(service);

    // integration tests point every datastore at its test counterpart
    const resolved = { ...env };
    if (resolved.NODE_ENV === 'test') {
        resolved.DATABASE_URL = resolved.TEST_DATABASE_URL || resolved.DATABASE_URL;
    }

    const result = schemas[service].safeParse(resolved);
    if (!result.success) {
        const details = result.error.issues
            .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
            .join('\n');
        throw new Error(`Invalid configuration for '${service}' service:\n${details}`);
    }

    assertProductionSafety(result.data);

    const cfg = Object.freeze({
        ...result.data,
        service,
        isProduction: result.data.NODE_ENV === 'production',
        isTest: result.data.NODE_ENV === 'test',
        // the client lives outside the server tree; several services serve or reference it
        STATIC_PATH: path.join(__dirname, '../../client'),
    });

    if (env === process.env) cache.set(service, cfg);
    return cfg;
}

module.exports = { load, schemas, assertProductionSafety };
