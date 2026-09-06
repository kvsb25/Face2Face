// Auth request handlers (SRS FR-AUTH-01…09, FR-SESS-05…14).

const { AppError } = require('../../shared/errors');
const { hashIp } = require('../../shared/logger');
const { setAccessCookie, setRefreshCookie, setCsrfCookie, clearAuthCookies, RT_COOKIE } = require('../../shared/cookies');
const { issueCsrfToken } = require('../../shared/csrf');
const { EVENTS } = require('../repositories/event.repo');

const publicUser = (user) => ({
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    emailVerified: user.emailVerified,
    avatarUrl: user.avatarUrl,
    hasPassword: Boolean(user.passwordHash),
});

function createAuthController({ cfg, users, tokens, events, passwords, throttle, logger }) {
    /** Request context that never stores a raw IP (SRS NFR-PRIV-01). */
    const contextOf = (req) => ({
        ipHash: hashIp(req.ip, cfg),
        userAgent: (req.get('user-agent') || '').slice(0, 255) || null,
        findUser: (id) => users.findById(id),
    });

    /** Puts a freshly issued session on the response as cookies. */
    async function establishSession(res, req, user) {
        const session = await tokens.issueSession(user, contextOf(req));
        setAccessCookie(res, cfg, session.accessToken);
        setRefreshCookie(res, cfg, session.refreshToken);
        setCsrfCookie(res, cfg, issueCsrfToken(session.familyId, cfg));
        return session;
    }

    async function signup(req, res) {
        const { email, password, displayName } = req.body;
        const ctx = contextOf(req);

        const existing = await users.findByEmail(email);
        if (existing) {
            // Phase 1 answers honestly; once email verification exists this
            // becomes a generic accepted-response so signup stops being an
            // account-enumeration oracle. (SRS FR-AUTH-10)
            await events.record({ eventType: EVENTS.SIGNUP, success: false, ipHash: ctx.ipHash, userAgent: ctx.userAgent, detail: { reason: 'email_taken' } });
            throw new AppError('EMAIL_TAKEN', { details: [{ field: 'email', message: 'An account with that email already exists.' }] });
        }

        const passwordHash = await passwords.hash(password);
        const user = await users.create({ email, passwordHash, displayName });

        await establishSession(res, req, user);
        await events.record({ userId: user.id, eventType: EVENTS.SIGNUP, success: true, ipHash: ctx.ipHash, userAgent: ctx.userAgent });
        logger.info({ userId: user.id }, 'account created');

        return res.status(201).json({ data: { user: publicUser(user) } });
    }

    async function login(req, res) {
        const { email, password } = req.body;
        const ctx = contextOf(req);

        await throttle.check(email);

        const user = await users.findByEmail(email);

        // The unknown-email path spends the same CPU as a real verification, so
        // response time does not reveal whether the account exists.
        // (SRS FR-AUTH-06, FR-AUTH-07)
        const passwordOk = user && user.passwordHash
            ? await passwords.verify(user.passwordHash, password)
            : await passwords.verifyDummy(password);

        if (!user || !user.passwordHash || !passwordOk || user.status !== 'active') {
            const failures = await throttle.recordFailure(email);
            await events.record({
                userId: user?.id || null,
                eventType: EVENTS.LOGIN,
                success: false,
                ipHash: ctx.ipHash,
                userAgent: ctx.userAgent,
                detail: { failures },
            });
            throw new AppError('INVALID_CREDENTIALS');
        }

        // Parameters get raised over time; an accepted login is the only moment
        // the plaintext is available to upgrade the stored hash.
        if (passwords.needsRehash(user.passwordHash)) {
            const upgraded = await passwords.hash(password);
            await users.updatePasswordHash(user.id, upgraded);
            logger.info({ userId: user.id }, 'password hash upgraded');
        }

        await throttle.clear(email);
        await users.markLoggedIn(user.id);
        await establishSession(res, req, user);
        await events.record({ userId: user.id, eventType: EVENTS.LOGIN, success: true, ipHash: ctx.ipHash, userAgent: ctx.userAgent });

        return res.status(200).json({ data: { user: publicUser(user) } });
    }

    async function refresh(req, res) {
        const presented = req.cookies?.[RT_COOKIE];
        if (!presented) throw new AppError('INVALID_TOKEN', { logMessage: 'no refresh cookie' });

        const ctx = contextOf(req);
        const result = await tokens.rotate(presented, ctx);

        setAccessCookie(res, cfg, result.accessToken);
        setRefreshCookie(res, cfg, result.refreshToken);
        setCsrfCookie(res, cfg, issueCsrfToken(result.familyId, cfg));

        await events.record({ userId: result.user.id, eventType: EVENTS.REFRESH, success: true, ipHash: ctx.ipHash, userAgent: ctx.userAgent });
        return res.status(200).json({ data: { user: publicUser(result.user) } });
    }

    async function logout(req, res) {
        const presented = req.cookies?.[RT_COOKIE];
        await tokens.revokeCurrent(presented, { jti: req.user?.jti });
        clearAuthCookies(res, cfg);

        if (req.user) {
            const ctx = contextOf(req);
            await events.record({ userId: req.user.id, eventType: EVENTS.LOGOUT, success: true, ipHash: ctx.ipHash, userAgent: ctx.userAgent });
        }
        return res.status(204).send();
    }

    async function logoutAll(req, res) {
        await tokens.revokeAllForUser(req.user.id);
        await tokens.denylistJti(req.user.jti);
        clearAuthCookies(res, cfg);

        const ctx = contextOf(req);
        await events.record({ userId: req.user.id, eventType: EVENTS.LOGOUT_ALL, success: true, ipHash: ctx.ipHash, userAgent: ctx.userAgent });
        return res.status(204).send();
    }

    async function me(req, res) {
        const user = await users.findById(req.user.id);
        if (!user || user.status !== 'active') throw new AppError('INVALID_TOKEN');
        return res.status(200).json({ data: { user: publicUser(user) } });
    }

    async function changePassword(req, res) {
        const { currentPassword, newPassword } = req.body;
        const ctx = contextOf(req);

        const user = await users.findById(req.user.id);
        if (!user || user.status !== 'active') throw new AppError('INVALID_TOKEN');

        const ok = user.passwordHash
            ? await passwords.verify(user.passwordHash, currentPassword)
            : await passwords.verifyDummy(currentPassword);
        if (!ok) {
            await events.record({ userId: user.id, eventType: EVENTS.PASSWORD_CHANGE, success: false, ipHash: ctx.ipHash, userAgent: ctx.userAgent });
            throw new AppError('INVALID_CREDENTIALS', { details: [{ field: 'currentPassword', message: 'That password is not correct.' }] });
        }

        await users.updatePasswordHash(user.id, await passwords.hash(newPassword));

        // Every other session dies: if the password was changed because it was
        // exposed, an attacker's session must not survive it. The caller keeps
        // working because a fresh session is issued here.
        await tokens.revokeAllForUser(user.id);
        await establishSession(res, req, user);
        await events.record({ userId: user.id, eventType: EVENTS.PASSWORD_CHANGE, success: true, ipHash: ctx.ipHash, userAgent: ctx.userAgent });

        return res.status(200).json({ data: { user: publicUser(user) } });
    }

    return { signup, login, refresh, logout, logoutAll, me, changePassword, publicUser };
}

module.exports = { createAuthController, publicUser };
