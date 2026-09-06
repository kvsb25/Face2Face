// Runs before every test file. Forces the test environment before any module
// reads config, so a test can never point at the development database.

const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '../../.env'), quiet: true });

process.env.NODE_ENV = 'test';

// Cheap hashing: the suite runs hundreds of them and these hashes protect
// nothing. server/shared/config.js enforces the real floor everywhere else.
process.env.ARGON2_MEMORY_KIB = process.env.ARGON2_MEMORY_KIB_TEST || '8192';
process.env.ARGON2_TIME_COST = '1';
process.env.ARGON2_PARALLELISM = '1';

// Short windows so throttle tests do not have to wait.
process.env.LOGIN_BACKOFF_CAP_SECONDS = process.env.LOGIN_BACKOFF_CAP_SECONDS || '900';
