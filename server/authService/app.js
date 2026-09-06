// authService — the only service that holds the signing key and talks to
// PostgreSQL. (SRS §2.1)

const express = require('express');
const cookieParser = require('cookie-parser');

const { load } = require('../shared/config');
const { createLogger } = require('../shared/logger');
const { getPrisma, closePrisma } = require('../shared/prisma');
const { getRedis, closeRedis } = require('../shared/redis');
const { createSigner, buildJwks, createLocalVerifier } = require('../shared/jwt');
const { createAuthMiddleware } = require('../shared/auth.middleware');
const { csrfProtection, originGuard } = require('../shared/csrf');
const { validate } = require('../shared/validate');
const { asyncHandler, errorHandler, notFoundHandler } = require('../shared/errors');

const { createUserRepo } = require('./repositories/user.repo');
const { createTokenRepo } = require('./repositories/token.repo');
const { createEventRepo } = require('./repositories/event.repo');
const { createPasswordService } = require('./services/password.service');
const { createTokenService } = require('./services/token.service');
const { createThrottleService } = require('./services/throttle.service');
const { createAuthController } = require('./controllers/auth.controller');
const { signupSchema, loginSchema, changePasswordSchema } = require('./validators/auth.schemas');

/**
 * Builds the express app. Exported so tests can drive it with supertest without
 * binding a port.
 */
async function createApp(overrides = {}) {
    const cfg = overrides.cfg || load('auth');
    const logger = overrides.logger || createLogger(cfg);
    const prisma = overrides.prisma || getPrisma(cfg, logger);
    const redis = overrides.redis !== undefined ? overrides.redis : await getRedis(cfg, logger);

    const users = createUserRepo(prisma);
    const tokenRepo = createTokenRepo(prisma);
    const events = createEventRepo(prisma, logger);
    const passwords = createPasswordService(cfg);
    const signer = await createSigner(cfg);
    const tokens = createTokenService({ cfg, signer, tokenRepo, eventRepo: events, redis, logger });
    const throttle = createThrottleService({ cfg, redis, logger });
    const controller = createAuthController({ cfg, users, tokens, events, passwords, throttle, logger });

    const verify = await createLocalVerifier(cfg);
    const { requireAuth } = createAuthMiddleware({ cfg, verify, getRedis: async () => redis, logger });

    const app = express();
    app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS || 1));
    app.disable('x-powered-by');

    // Auth bodies are small; anything larger is refused before it is parsed.
    // (SRS FR-RL-12)
    app.use(express.json({ limit: '10kb', strict: true }));
    app.use(cookieParser());

    app.use((req, res, next) => {
        req.log = logger.child({ requestId: req.get('x-request-id') || undefined });
        next();
    });

    app.get('/healthz', (req, res) => res.json({ data: { status: 'ok' } }));
    app.get('/readyz', asyncHandler(async (req, res) => {
        await prisma.$queryRaw`SELECT 1`;
        if (redis) await redis.ping();
        res.json({ data: { status: 'ready' } });
    }));

    const jwks = await buildJwks(cfg);
    app.get('/.well-known/jwks.json', (req, res) => {
        res.set('Cache-Control', 'public, max-age=300');
        res.json(jwks);
    });

    // CSRF applies to every state-changing route below. The session id comes
    // from the access token when one is present; unauthenticated routes
    // (signup, login) still get the origin and cookie/header checks.
    const csrf = csrfProtection(cfg, (req) => req.user?.sid || null);

    // Pre-session routes cannot carry a session-bound CSRF token, but they can
    // still be required to originate from this site.
    const origin = originGuard(cfg);

    const router = express.Router();
    router.post('/signup', origin, validate({ body: signupSchema }), asyncHandler(controller.signup));
    router.post('/login', origin, validate({ body: loginSchema }), asyncHandler(controller.login));
    router.post('/refresh', origin, asyncHandler(controller.refresh));
    router.post('/logout', requireAuth, csrf, asyncHandler(controller.logout));
    router.post('/logout-all', requireAuth, csrf, asyncHandler(controller.logoutAll));
    router.get('/me', requireAuth, asyncHandler(controller.me));
    router.post('/password', requireAuth, csrf, validate({ body: changePasswordSchema }), asyncHandler(controller.changePassword));

    app.use('/api/auth', router);

    app.use(notFoundHandler);
    app.use(errorHandler(logger));

    app.locals.close = async () => {
        await closePrisma();
        if (!overrides.redis) await closeRedis();
    };

    return { app, cfg, logger, prisma, redis };
}

// started directly (npm run auth) rather than imported by a test
if (require.main === module) {
    createApp()
        .then(({ app, cfg, logger }) => {
            const server = app.listen(cfg.AUTH_PORT, () => logger.info(`authService listening at ${cfg.AUTH_PORT}`));

            // drain in-flight requests before exiting (SRS NFR-REL-03)
            const shutdown = (signal) => {
                logger.info({ signal }, 'shutting down');
                server.close(async () => {
                    await app.locals.close();
                    process.exit(0);
                });
            };
            process.on('SIGTERM', () => shutdown('SIGTERM'));
            process.on('SIGINT', () => shutdown('SIGINT'));
        })
        .catch((err) => {
            console.error('authService failed to start:', err.message);
            process.exit(1);
        });
}

module.exports = { createApp };
