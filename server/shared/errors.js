// One error envelope for every service: { error: { code, message, details } }.
// Codes are stable strings clients can branch on; messages are safe to display
// and never carry SQL, stack traces or which half of a credential was wrong.
// (SRS §3.2)

const CODES = {
    VALIDATION_FAILED: { status: 400, message: 'Some of the submitted values are not valid.' },
    INVALID_CREDENTIALS: { status: 401, message: 'That email and password combination is not correct.' },
    AUTH_REQUIRED: { status: 401, message: 'Sign in to continue.' },
    INVALID_TOKEN: { status: 401, message: 'Your session is no longer valid. Sign in again.' },
    TOKEN_REUSE_DETECTED: { status: 401, message: 'Your session was ended for security reasons. Sign in again.' },
    CSRF_FAILED: { status: 403, message: 'This request could not be verified. Reload the page and try again.' },
    FORBIDDEN: { status: 403, message: 'You do not have access to this.' },
    NOT_FOUND: { status: 404, message: 'Not found.' },
    EMAIL_TAKEN: { status: 409, message: 'An account with that email already exists.' },
    ROOM_FULL: { status: 409, message: 'That room is full.' },
    PAYLOAD_TOO_LARGE: { status: 413, message: 'That request was too large.' },
    RATE_LIMITED: { status: 429, message: 'Too many attempts. Wait a moment and try again.' },
    ACCOUNT_LOCKED: { status: 429, message: 'Too many failed attempts. Try again later.' },
    INTERNAL: { status: 500, message: 'Something went wrong on our side.' },
    SERVICE_UNAVAILABLE: { status: 503, message: 'That service is temporarily unavailable.' },
};

class AppError extends Error {
    /**
     * @param {keyof CODES} code
     * @param {{ details?: Array<{field: string, message: string}>, headers?: object, cause?: Error, logMessage?: string }} [options]
     */
    constructor(code, options = {}) {
        const known = CODES[code] || CODES.INTERNAL;
        super(options.logMessage || known.message);
        this.name = 'AppError';
        this.code = CODES[code] ? code : 'INTERNAL';
        this.status = known.status;
        this.publicMessage = known.message;
        this.details = options.details;
        this.headers = options.headers;
        if (options.cause) this.cause = options.cause;
    }
}

function errorBody(err) {
    const body = { error: { code: err.code, message: err.publicMessage } };
    if (err.details && err.details.length) body.error.details = err.details;
    return body;
}

/**
 * Terminal error handler. Anything that is not an AppError is logged in full
 * and reported as a generic 500 — the client never sees internals.
 */
function errorHandler(logger) {
    // eslint-disable-next-line no-unused-vars -- express identifies the handler by arity
    return (err, req, res, next) => {
        // body-parser rejections arrive as plain errors with a status
        let appError = err;
        if (!(err instanceof AppError)) {
            if (err.type === 'entity.too.large') appError = new AppError('PAYLOAD_TOO_LARGE', { cause: err });
            else if (err.type === 'entity.parse.failed' || err instanceof SyntaxError) {
                appError = new AppError('VALIDATION_FAILED', {
                    details: [{ field: 'body', message: 'Request body is not valid JSON.' }],
                    cause: err,
                });
            } else {
                appError = new AppError('INTERNAL', { cause: err });
            }
        }

        const log = req.log || logger;
        const payload = { err: appError.cause || appError, code: appError.code, path: req.originalUrl, method: req.method };
        if (appError.status >= 500) log.error(payload, 'request failed');
        else log.warn({ ...payload, err: undefined }, 'request rejected');

        if (res.headersSent) return;
        if (appError.headers) res.set(appError.headers);
        res.status(appError.status).json(errorBody(appError));
    };
}

// Wraps an async handler so a rejected promise reaches the error handler
// instead of becoming an unhandled rejection (SRS NFR-REL-04).
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const notFoundHandler = (req, res, next) => next(new AppError('NOT_FOUND'));

module.exports = { AppError, CODES, errorBody, errorHandler, asyncHandler, notFoundHandler };
