const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const { z } = require('zod');

const { load } = require('../shared/config');
const { createLogger } = require('../shared/logger');
const { getRedis, closeRedis } = require('../shared/redis');
const { createRemoteVerifier } = require('../shared/jwt');
const { createAuthMiddleware } = require('../shared/auth.middleware');
const { validate } = require('../shared/validate');
const { AppError, asyncHandler, errorHandler } = require('../shared/errors');
const { createRoom, checkRoom } = require('./roomManager.js');

// Room codes are the only user input this service passes downstream, and they
// end up in a URL sent to roomManager — so the shape is enforced before
// anything is built from it. (SRS FR-VAL-03, SVC-3)
const roomCode = z.string().regex(/^[a-z]{3}-[a-z]{3}-[a-z]{3}$/, { error: 'That is not a valid room code.' });
const roomQuerySchema = z.object({ roomId: roomCode });
const roomParamsSchema = z.object({ roomId: roomCode });

const FORWARD_REQUEST_HEADERS = ['content-type', 'cookie', 'x-csrf-token', 'user-agent', 'x-request-id'];
const FORWARD_RESPONSE_HEADERS = ['content-type', 'cache-control', 'retry-after', 'www-authenticate'];

/** Builds the app. Exported so tests can drive it without binding a port. */
function createApp(overrides = {}) {
    const cfg = overrides.cfg || load('http');
    const logger = overrides.logger || createLogger(cfg);
    const app = express();

    app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS || 1));
    app.disable('x-powered-by');

    app.use(express.json({ limit: '10kb', strict: true }));
    app.use(express.urlencoded({ extended: true, limit: '10kb' }));
    app.use(cookieParser());

    app.use((req, res, next) => {
        res.set('X-Content-Type-Options', 'nosniff');
        res.set('X-Frame-Options', 'DENY');
        res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
        res.set('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=()');
        next();
    });

    // Access tokens are verified here with the public key from authService's
    // JWKS: this service holds no signing material and makes no auth call on
    // the request path. (SRS §2.1, C-5)
    const verify = overrides.verify || createRemoteVerifier(cfg);
    const { requireAuth, optionalAuth } = createAuthMiddleware({
        cfg,
        verify,
        getRedis: () => getRedis(cfg, logger),
        logger,
    });

    // Auth is served from this origin so session cookies stay first-party; in
    // production the reverse proxy can route /api/auth directly instead.
    // (SRS FR-DEP-03)
    const proxyToAuth = asyncHandler(async (req, res) => {
        const headers = {};
        for (const name of FORWARD_REQUEST_HEADERS) {
            const value = req.get(name);
            if (value) headers[name] = value;
        }
        // authService applies the origin check and (from P3) per-IP limits, so
        // it must see the real client address rather than this hop
        headers.origin = req.get('origin') || `${req.protocol}://${req.get('host')}`;
        headers['x-forwarded-for'] = req.ip;

        const hasBody = !['GET', 'HEAD'].includes(req.method);
        let upstream;
        try {
            upstream = await fetch(`${cfg.AUTH_SERVICE_URL}${req.originalUrl}`, {
                method: req.method,
                headers,
                body: hasBody ? JSON.stringify(req.body ?? {}) : undefined,
                redirect: 'manual',
            });
        } catch (err) {
            logger.error({ err: err.message }, 'auth service unreachable');
            throw new AppError('SERVICE_UNAVAILABLE', { cause: err });
        }

        const setCookie = typeof upstream.headers.getSetCookie === 'function' ? upstream.headers.getSetCookie() : [];
        if (setCookie.length) res.setHeader('Set-Cookie', setCookie);
        for (const name of FORWARD_RESPONSE_HEADERS) {
            const value = upstream.headers.get(name);
            if (value) res.set(name, value);
        }

        res.status(upstream.status);
        return res.send(Buffer.from(await upstream.arrayBuffer()));
    });

    app.all('/api/auth/*splat', proxyToAuth);

    // --- pages -----------------------------------------------------------
    const page = (name) => (req, res) => res.sendFile(path.join(cfg.STATIC_PATH, 'html', name));

    app.get('/', page('home.html'));
    app.get('/login', page('login.html'));
    app.get('/signup', page('signup.html'));

    app.use(express.static(cfg.STATIC_PATH));

    // --- room API --------------------------------------------------------
    app.route('/api/room')
        // join room: check existence and capacity; the actual join is counted
        // by the wsServer when the peer's WebSocket connects from the room
        // page. Open to guests — a valid code is enough. (SRS FR-AUTHZ-02)
        .get(validate({ query: roomQuerySchema }), asyncHandler(async (req, res) => {
            const room = req.validatedQuery.roomId;
            const status = await checkRoom(room);

            if (!status) throw new AppError('SERVICE_UNAVAILABLE');
            if (!status.exists) throw new AppError('NOT_FOUND', { logMessage: 'no such room' });
            if (status.full) throw new AppError('ROOM_FULL');

            return res.status(200).json({ data: { roomId: room } });
        }))
        // create room: members only. Hiding the button on the page is
        // presentation; this is the actual rule. (SRS FR-AUTHZ-01, FR-AUTHZ-03)
        .post(requireAuth, asyncHandler(async (req, res) => {
            const room = await createRoom();
            if (!room) throw new AppError('SERVICE_UNAVAILABLE');

            logger.info({ userId: req.user.id, room }, 'room created');
            return res.status(201).json({ data: { roomId: room } });
        }));

    // room page
    // this endpoint checks the room again because it can be reached directly:
    // someone can open a room URL without going through the home page
    app.get('/room/:roomId', validate({ params: roomParamsSchema }), optionalAuth, asyncHandler(async (req, res) => {
        const status = await checkRoom(req.params.roomId);

        if (!status) return res.redirect('/?error=server');
        if (!status.exists) return res.redirect('/?error=no_room');
        if (status.full) return res.redirect('/?error=room_full');
        return res.sendFile(path.join(cfg.STATIC_PATH, 'html', 'room.html'));
    }));

    app.get('/healthz', (req, res) => res.json({ data: { status: 'ok' } }));

    // A malformed room code in a page URL is a bad request, not a server
    // error: send the browser home with a reason instead of an error page.
    app.use((err, req, res, next) => {
        const wantsHtml = req.accepts(['html', 'json']) === 'html' && !req.originalUrl.startsWith('/api/');
        if (wantsHtml && err instanceof AppError && err.status < 500) {
            return res.redirect(err.code === 'NOT_FOUND' ? '/?error=no_room' : '/?error=server');
        }
        return next(err);
    });
    app.use(errorHandler(logger));

    return { app, cfg, logger };
}

// started directly (npm run https) rather than imported by a test
if (require.main === module) {
    const { app, cfg, logger } = createApp();
    const server = app.listen(cfg.HTTP_PORT, () => logger.info(`http listening at ${cfg.HTTP_PORT}`));

    const shutdown = (signal) => {
        logger.info({ signal }, 'shutting down');
        server.close(async () => {
            await closeRedis();
            process.exit(0);
        });
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
}

module.exports = { createApp };
