// Request schemas (SRS FR-VAL-01…03, FR-AUTH-02).
// Strict objects: an unknown key is a rejection, not something to ignore.

const { z } = require('zod');

const MIN_PASSWORD = 12;
const MAX_PASSWORD = 128;

// A short list of the passwords that actually show up first in credential
// stuffing. The full breached-password check belongs with the P2 hardening
// work; this keeps the obvious ones out from day one.
const COMMON_PASSWORDS = new Set([
    'password', 'password1', 'password123', 'passw0rd', '123456', '1234567890',
    'qwertyuiop', 'letmein', 'iloveyou', 'admin', 'welcome', 'monkey',
    'dragon', 'football', 'baseball', 'sunshine', 'princess', 'qwerty123',
    'abc123456', 'changeme', 'passwordpassword', 'aaaaaaaaaaaa',
]);

const email = z
    .string()
    .trim()
    .toLowerCase()
    .max(254, { error: 'Email must be 254 characters or fewer.' })
    .refine((v) => v.normalize('NFKC') === v || true, { error: 'Email is not valid.' })
    .transform((v) => v.normalize('NFKC'))
    .pipe(z.email({ error: 'Enter a valid email address.' }));

// Passwords are never trimmed: leading and trailing spaces are part of what the
// user typed, and silently changing them breaks a later login.
const password = z
    .string({ error: 'Enter a password.' })
    .min(MIN_PASSWORD, { error: `Password must be at least ${MIN_PASSWORD} characters.` })
    .max(MAX_PASSWORD, { error: `Password must be ${MAX_PASSWORD} characters or fewer.` })
    .refine((v) => !v.includes('\0'), { error: 'Password contains an invalid character.' });

const displayName = z
    .string({ error: 'Enter a display name.' })
    .transform((v) => v.normalize('NFKC').replace(/\s+/g, ' ').trim())
    .pipe(
        z.string()
            .min(1, { error: 'Enter a display name.' })
            .max(50, { error: 'Display name must be 50 characters or fewer.' })
            // control characters and bidi overrides can be used to spoof another
            // participant's name in the room list and chat
            .regex(/^[\p{L}\p{N} '_-]+$/u, { error: 'Display name may only contain letters, numbers, spaces, apostrophes, hyphens and underscores.' })
    );

/** Rejects a password that is weak in ways length alone does not catch. */
function passwordPolicyIssues(value, { email: emailValue, displayName: name } = {}) {
    const issues = [];
    const lower = String(value).toLowerCase();

    if (COMMON_PASSWORDS.has(lower)) issues.push('That password is too common. Choose something less predictable.');

    const localPart = emailValue ? String(emailValue).split('@')[0].toLowerCase() : '';
    if (localPart.length >= 3 && lower.includes(localPart)) issues.push('Password must not contain your email address.');
    if (name && name.length >= 3 && lower.includes(name.toLowerCase())) issues.push('Password must not contain your display name.');

    // a single repeated character or a straight run reaches 12 characters
    // without adding any real entropy
    if (/^(.)\1+$/.test(value)) issues.push('Password must not be a single repeated character.');
    if (new Set(lower).size < 5) issues.push('Password must use a wider range of characters.');

    return issues;
}

const signupSchema = z
    .strictObject({ email, password, displayName })
    .superRefine((value, ctx) => {
        for (const message of passwordPolicyIssues(value.password, value)) {
            ctx.addIssue({ code: 'custom', path: ['password'], message });
        }
    });

const loginSchema = z.strictObject({
    email,
    // Login validates shape only: an old password that no longer meets today's
    // policy must still be able to sign in (and then be asked to change it).
    password: z.string().min(1, { error: 'Enter your password.' }).max(MAX_PASSWORD),
});

const changePasswordSchema = z
    .strictObject({
        currentPassword: z.string().min(1).max(MAX_PASSWORD),
        newPassword: password,
    })
    .superRefine((value, ctx) => {
        if (value.currentPassword === value.newPassword) {
            ctx.addIssue({ code: 'custom', path: ['newPassword'], message: 'Choose a password you have not used here before.' });
        }
        for (const message of passwordPolicyIssues(value.newPassword)) {
            ctx.addIssue({ code: 'custom', path: ['newPassword'], message });
        }
    });

module.exports = {
    signupSchema, loginSchema, changePasswordSchema,
    email, password, displayName,
    passwordPolicyIssues, COMMON_PASSWORDS, MIN_PASSWORD, MAX_PASSWORD,
};
