// Shared Redis client. One connection per process, created lazily so a service
// that never touches Redis does not open one. Tests are pointed at their own
// logical database so a flush can never hit development data. (SRS FR-RD-03)

const { createClient } = require('redis');

let client = null;
let connecting = null;

function urlForConfig(cfg) {
    if (!cfg.isTest) return cfg.REDIS_URL;
    const testDb = process.env.REDIS_TEST_DB || '15';
    return cfg.REDIS_URL.replace(/\/\d+$/, '') + `/${testDb}`;
}

/** Returns a connected client, connecting on first use. */
async function getRedis(cfg, logger) {
    if (client && client.isOpen) return client;
    if (connecting) return connecting;

    client = createClient({
        url: urlForConfig(cfg),
        socket: {
            connectTimeout: 5000,
            // Retry with backoff, but give up rather than reconnecting forever:
            // an unbounded retry loop turns "Redis is down" into a silent hang
            // at startup instead of an error someone can act on.
            reconnectStrategy: (attempts) => (attempts > 5 ? new Error('Redis unreachable') : Math.min(attempts * 200, 2000)),
        },
    });
    client.on('error', (err) => {
        // node-redis reconnects on its own; log without crashing the process
        if (logger) logger.error({ err: err.message }, 'redis error');
    });

    connecting = client.connect().then(() => {
        connecting = null;
        return client;
    }).catch((err) => {
        connecting = null;
        client = null;
        throw new Error(`Redis is not reachable at ${urlForConfig(cfg).replace(/\/\/.*@/, '//')}: ${err.message}`);
    });

    return connecting;
}

async function closeRedis() {
    if (client && client.isOpen) await client.quit();
    client = null;
    connecting = null;
}

/**
 * Stores a value that may be read exactly once. Consumption uses GETDEL so two
 * concurrent readers cannot both succeed — the property single-use tokens
 * (ws tickets, OAuth state, one-time links) depend on. (SRS FR-SESS-16)
 */
async function putSingleUse(redis, key, value, ttlSeconds) {
    await redis.set(key, JSON.stringify(value), { EX: ttlSeconds });
}

async function consumeSingleUse(redis, key) {
    const raw = await redis.getDel(key);
    if (raw === null) return null;
    try { return JSON.parse(raw); } catch { return null; }
}

module.exports = { getRedis, closeRedis, putSingleUse, consumeSingleUse, urlForConfig };
