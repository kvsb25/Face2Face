// Prisma client singleton. The URL comes from validated config rather than
// ambient process.env so tests can run against face2face_test without the
// application ever choosing its own database. (SRS FR-DB-02)

const { PrismaClient } = require('@prisma/client');

let prisma = null;

function getPrisma(cfg, logger) {
    if (prisma) return prisma;

    prisma = new PrismaClient({
        datasourceUrl: cfg.DATABASE_URL,
        log: [
            { level: 'warn', emit: 'event' },
            { level: 'error', emit: 'event' },
        ],
    });

    if (logger) {
        prisma.$on('warn', (e) => logger.warn({ prisma: e.message }, 'prisma warning'));
        prisma.$on('error', (e) => logger.error({ prisma: e.message }, 'prisma error'));
    }

    return prisma;
}

async function closePrisma() {
    if (prisma) await prisma.$disconnect();
    prisma = null;
}

module.exports = { getPrisma, closePrisma };
