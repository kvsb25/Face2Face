// Brings the test database up to the current migration before any integration
// test runs. (SRS FR-TEST-03)

const { spawnSync } = require('child_process');
const path = require('path');

module.exports = async () => {
    require('dotenv').config({ path: path.join(__dirname, '../../.env'), quiet: true });

    if (!process.env.TEST_DATABASE_URL) {
        throw new Error('TEST_DATABASE_URL is not set — see .env.example');
    }

    // Fail with a usable message instead of letting every test hang on a
    // connection that will never open.
    const { createClient } = require('redis');
    const probe = createClient({
        url: process.env.REDIS_URL,
        socket: { connectTimeout: 3000, reconnectStrategy: false },
    });
    probe.on('error', () => {});
    try {
        await probe.connect();
        await probe.ping();
        await probe.quit();
    } catch (err) {
        throw new Error(
            `Redis is not reachable at ${process.env.REDIS_URL} (${err.message}).\n`
            + 'Start it first — on this machine: wsl -e sh -c "redis-server --daemonize yes"'
        );
    }

    const result = spawnSync('npx', ['prisma', 'migrate', 'deploy'], {
        cwd: path.join(__dirname, '../..'),
        shell: process.platform === 'win32',
        encoding: 'utf8',
        env: {
            ...process.env,
            DATABASE_URL: process.env.TEST_DATABASE_URL,
            DATABASE_URL_MIGRATIONS: process.env.TEST_DATABASE_URL_MIGRATIONS,
        },
    });

    if (result.status !== 0) {
        throw new Error(`Test database migration failed:\n${result.stdout}\n${result.stderr}`);
    }
};
