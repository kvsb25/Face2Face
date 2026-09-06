// Jest projects (SRS FR-TEST-01). `npm test` runs unit + integration; the
// security project arrives with the P2/P3 work.

const base = {
    testEnvironment: 'node',
    clearMocks: true,
    restoreMocks: true,
};

module.exports = {
    projects: [
        {
            ...base,
            displayName: 'unit',
            testMatch: ['<rootDir>/tests/unit/**/*.test.js'],
            setupFiles: ['<rootDir>/tests/helpers/env.js'],
        },
        {
            ...base,
            displayName: 'integration',
            testMatch: ['<rootDir>/tests/integration/**/*.test.js'],
            setupFiles: ['<rootDir>/tests/helpers/env.js'],
            globalSetup: '<rootDir>/tests/helpers/globalSetup.js',
            testTimeout: 20000,
        },
        {
            ...base,
            displayName: 'security',
            testMatch: ['<rootDir>/tests/security/**/*.test.js'],
            setupFiles: ['<rootDir>/tests/helpers/env.js'],
            globalSetup: '<rootDir>/tests/helpers/globalSetup.js',
            testTimeout: 20000,
        },
    ],

    collectCoverageFrom: [
        'server/**/*.js',
        '!server/**/Dockerfile',
        '!**/node_modules/**',
    ],
    coverageThreshold: {
        // SRS FR-TEST-05 targets authService ≥ 85% and the repo ≥ 75%. The
        // global floor here is lower on purpose: wsServer, roomManager and the
        // room flow are untested until P2/P3, and jest excludes files matched
        // by a path threshold below from this global pool. Raise both as those
        // phases land.
        global: { lines: 55, branches: 45 },
        'server/authService/**/*.js': { lines: 75, branches: 60 },
        'server/shared/csrf.js': { lines: 90, branches: 80 },
    },
};
