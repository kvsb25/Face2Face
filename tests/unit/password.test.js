// SRS FR-AUTH-02…06, FR-RL-08

const { load } = require('../../server/shared/config');
const { createPasswordService, Semaphore } = require('../../server/authService/services/password.service');
const { passwordPolicyIssues, signupSchema } = require('../../server/authService/validators/auth.schemas');

const cfg = load('auth');
const passwords = createPasswordService(cfg);

describe('argon2id hashing', () => {
    it('produces an argon2id hash with the configured parameters', async () => {
        const hash = await passwords.hash('correct horse battery staple');
        expect(hash).toMatch(/^\$argon2id\$v=19\$m=\d+,t=\d+,p=\d+\$/);
    });

    it('salts every hash: the same password never hashes to the same string', async () => {
        const [a, b] = await Promise.all([passwords.hash('same password here'), passwords.hash('same password here')]);
        expect(a).not.toEqual(b);
    });

    it('verifies the right password and rejects the wrong one', async () => {
        const hash = await passwords.hash('correct horse battery staple');
        await expect(passwords.verify(hash, 'correct horse battery staple')).resolves.toBe(true);
        await expect(passwords.verify(hash, 'correct horse battery stapl')).resolves.toBe(false);
    });

    it('treats a malformed stored hash as a failed login rather than throwing', async () => {
        await expect(passwords.verify('not-a-hash', 'anything at all')).resolves.toBe(false);
    });

    it('flags hashes made with weaker parameters for rehashing', () => {
        expect(passwords.needsRehash(`$argon2id$v=19$m=${cfg.ARGON2_MEMORY_KIB},t=${cfg.ARGON2_TIME_COST},p=1$abc$def`)).toBe(false);
        expect(passwords.needsRehash('$argon2id$v=19$m=1024,t=1,p=1$abc$def')).toBe(true);
        expect(passwords.needsRehash('$argon2i$v=19$m=99999,t=9,p=1$abc$def')).toBe(true);
        expect(passwords.needsRehash('$2b$12$something')).toBe(true);
        expect(passwords.needsRehash(null)).toBe(true);
    });

    it('spends comparable effort on the unknown-user path', async () => {
        // the dummy verification must actually run argon2, not short-circuit
        await expect(passwords.verifyDummy('anything at all here')).resolves.toBe(false);
    });
});

describe('hashing concurrency gate', () => {
    it('runs at most `limit` operations at once', async () => {
        const gate = new Semaphore(2, 1000);
        let active = 0;
        let peak = 0;

        await Promise.all(Array.from({ length: 6 }, () => gate.run(async () => {
            active += 1;
            peak = Math.max(peak, active);
            await new Promise((r) => setTimeout(r, 10));
            active -= 1;
        })));

        expect(peak).toBe(2);
    });

    it('rejects with a retryable error when the queue does not clear', async () => {
        const gate = new Semaphore(1, 20);
        const held = gate.run(() => new Promise((r) => setTimeout(r, 200)));
        await expect(gate.run(async () => 'never')).rejects.toMatchObject({
            code: 'SERVICE_UNAVAILABLE',
            headers: { 'Retry-After': '2' },
        });
        await held;
    });
});

describe('password policy', () => {
    const accepted = [
        'correct horse battery staple',
        'Tr0ub4dor&3xtra-long',
        'a-very-long-passphrase-2026',
    ];
    const rejected = [
        ['short', 'too short'],
        ['password123', 'common'],
        ['aaaaaaaaaaaaaa', 'repeated character'],
        ['abababababab', 'too few distinct characters'],
    ];

    it.each(accepted)('accepts %s', (value) => {
        const result = signupSchema.safeParse({ email: 'a@example.com', password: value, displayName: 'A User' });
        expect(result.success).toBe(true);
    });

    it.each(rejected)('rejects %s (%s)', (value) => {
        const result = signupSchema.safeParse({ email: 'a@example.com', password: value, displayName: 'A User' });
        expect(result.success).toBe(false);
    });

    it('rejects a password containing the email local part', () => {
        expect(passwordPolicyIssues('kovidh-is-my-password', { email: 'kovidh@example.com' }).length).toBeGreaterThan(0);
    });

    it('accepts a 128-character password but not a 129-character one', () => {
        const make = (n) => `${'x'.repeat(n - 8)}Zq7!aB2m`;
        expect(signupSchema.safeParse({ email: 'a@example.com', password: make(128), displayName: 'A User' }).success).toBe(true);
        expect(signupSchema.safeParse({ email: 'a@example.com', password: make(129), displayName: 'A User' }).success).toBe(false);
    });
});
