#!/usr/bin/env node
// Applies migrations to the test database. Kept as a script rather than an npm
// env prefix because Windows shells do not expand $VAR in package.json scripts.

const { spawnSync } = require('child_process');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '../.env'), quiet: true });

if (!process.env.TEST_DATABASE_URL || !process.env.TEST_DATABASE_URL_MIGRATIONS) {
    console.error('TEST_DATABASE_URL and TEST_DATABASE_URL_MIGRATIONS must be set (see .env.example).');
    process.exit(1);
}

const result = spawnSync('npx', ['prisma', 'migrate', 'deploy'], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    cwd: path.join(__dirname, '..'),
    env: {
        ...process.env,
        DATABASE_URL: process.env.TEST_DATABASE_URL,
        DATABASE_URL_MIGRATIONS: process.env.TEST_DATABASE_URL_MIGRATIONS,
    },
});

process.exit(result.status === null ? 1 : result.status);
