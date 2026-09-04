// Schema validation at the service edge. Every route declares what it accepts;
// anything not declared is rejected before a controller ever sees it.
// (SRS FR-VAL-01, FR-VAL-02)

const { AppError } = require('./errors');

// Keys that can poison Object.prototype if a body is ever merged or spread into
// an object literal. Rejected outright rather than stripped, so a caller
// attempting it gets a clear failure. (SRS FR-VAL-12)
const POLLUTING_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function findPollutingKey(value, depth = 0) {
    if (depth > 6 || value === null || typeof value !== 'object') return null;
    for (const key of Object.keys(value)) {
        if (POLLUTING_KEYS.has(key)) return key;
        const found = findPollutingKey(value[key], depth + 1);
        if (found) return found;
    }
    return null;
}

function toDetails(zodError) {
    return zodError.issues.map((issue) => ({
        field: issue.path.length ? issue.path.join('.') : '(body)',
        message: issue.message,
    }));
}

/**
 * @param {{ body?: import('zod').ZodType, query?: import('zod').ZodType, params?: import('zod').ZodType }} schemas
 */
function validate(schemas) {
    return (req, res, next) => {
        for (const source of ['body', 'query', 'params']) {
            if (!schemas[source]) continue;

            const raw = req[source];
            const polluting = findPollutingKey(raw);
            if (polluting) {
                return next(new AppError('VALIDATION_FAILED', {
                    details: [{ field: polluting, message: 'This key is not allowed.' }],
                }));
            }

            const result = schemas[source].safeParse(raw);
            if (!result.success) {
                return next(new AppError('VALIDATION_FAILED', { details: toDetails(result.error) }));
            }

            // express 5 exposes req.query through a getter, so the parsed value
            // is stashed alongside rather than assigned over it
            if (source === 'query') req.validatedQuery = result.data;
            else req[source] = result.data;
        }
        return next();
    };
}

module.exports = { validate, toDetails, findPollutingKey };
