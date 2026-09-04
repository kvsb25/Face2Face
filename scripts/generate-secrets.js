#!/usr/bin/env node
// Generates .env from .env.example, filling in every CHANGE_ME with fresh CSPRNG
// material and an RS256 key pair. Refuses to overwrite an existing .env unless
// --force is passed, so it can never silently invalidate live sessions.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const examplePath = path.join(root, '.env.example');
const envPath = path.join(root, '.env');
const force = process.argv.includes('--force');

if (fs.existsSync(envPath) && !force) {
    console.error('.env already exists. Re-run with --force to replace it (this invalidates all issued tokens).');
    process.exit(1);
}

const b64secret = (bytes = 32) => crypto.randomBytes(bytes).toString('base64');

// RS256 key pair; PEMs are base64-encoded so each one fits on a single .env line.
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const publicPem = publicKey.export({ type: 'spki', format: 'pem' });

// Local development passwords for the two database roles; they match what the
// project's setup creates. Change them here and in Postgres together.
const DB_APP_PASSWORD = process.env.DB_APP_PASSWORD || 'f2f_app_dev_pw';
const DB_OWNER_PASSWORD = process.env.DB_OWNER_PASSWORD || 'f2f_owner_dev_pw';

const replacements = {
    JWT_PRIVATE_KEY: Buffer.from(privatePem).toString('base64'),
    JWT_PUBLIC_KEY: Buffer.from(publicPem).toString('base64'),
    JWT_KEY_ID: crypto.randomBytes(8).toString('hex'),
    PASSWORD_PEPPER: b64secret(),
    CSRF_SECRET: b64secret(),
    INTERNAL_SERVICE_TOKEN: b64secret(),
    IP_HASH_SECRET: b64secret(),
};

const lines = fs.readFileSync(examplePath, 'utf8').split(/\r?\n/).map((line) => {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (!match) return line;

    const [, key, value] = match;
    if (Object.prototype.hasOwnProperty.call(replacements, key)) {
        return `${key}=${replacements[key]}`;
    }
    if (value.includes('CHANGE_ME')) {
        // the database URLs carry their password inline
        const filled = value
            .replace('f2f_app:CHANGE_ME', `f2f_app:${DB_APP_PASSWORD}`)
            .replace('f2f_owner:CHANGE_ME', `f2f_owner:${DB_OWNER_PASSWORD}`);
        return `${key}=${filled}`;
    }
    return line;
});

fs.writeFileSync(envPath, lines.join('\n'), { mode: 0o600 });
console.log(`Wrote ${envPath}`);
console.log('Secrets generated: JWT key pair, pepper, CSRF secret, internal service token, IP hash secret.');
