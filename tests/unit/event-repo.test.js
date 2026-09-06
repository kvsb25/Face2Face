// The audit trail must never break the operation it is describing.
// SRS FR-OBS-03

const { createEventRepo, EVENTS } = require('../../server/authService/repositories/event.repo');

const fakeLogger = () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn() });

describe('auth event recording', () => {
    it('writes the event with its defaults filled in', async () => {
        const create = jest.fn(async () => ({}));
        const repo = createEventRepo({ authEvent: { create } }, fakeLogger());

        await repo.record({ eventType: EVENTS.LOGIN, success: true });

        expect(create).toHaveBeenCalledWith({
            data: { userId: null, eventType: 'login', success: true, ipHash: null, userAgent: null, detail: {} },
        });
    });

    it('passes through the caller-supplied fields', async () => {
        const create = jest.fn(async () => ({}));
        const repo = createEventRepo({ authEvent: { create } }, fakeLogger());
        const ipHash = Buffer.alloc(32, 1);

        await repo.record({
            userId: 'a-user-id',
            eventType: EVENTS.TOKEN_REUSE,
            success: false,
            ipHash,
            userAgent: 'jest',
            detail: { familyId: 'fam' },
        });

        expect(create).toHaveBeenCalledWith({
            data: expect.objectContaining({ userId: 'a-user-id', eventType: 'token_reuse_detected', success: false, ipHash, userAgent: 'jest' }),
        });
    });

    it('swallows a database failure and logs it instead of rejecting', async () => {
        const logger = fakeLogger();
        const boom = new Error('connection lost');
        const repo = createEventRepo({ authEvent: { create: jest.fn(async () => { throw boom; }) } }, logger);

        // the caller's login must still succeed even if the audit write fails
        await expect(repo.record({ eventType: EVENTS.LOGIN, success: true })).resolves.toBeUndefined();
        expect(logger.error).toHaveBeenCalledWith(
            expect.objectContaining({ err: boom, eventType: 'login' }),
            'failed to write auth event'
        );
    });
});
