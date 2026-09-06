// Refresh-token persistence (SRS FR-SESS-03, FR-SESS-05, FR-SESS-06).
// Only the SHA-256 of a token is stored, so the table is useless to a thief.

function createTokenRepo(prisma) {
    return {
        create(data) {
            return prisma.refreshToken.create({ data });
        },

        findByHash(tokenHash) {
            return prisma.refreshToken.findUnique({ where: { tokenHash } });
        },

        /**
         * Compare-and-swap consumption: the WHERE clause requires the token to
         * still be unconsumed and unrevoked, so of two concurrent refreshes
         * exactly one gets count === 1 and the other loses. This is the same
         * guarantee as SELECT … FOR UPDATE without holding a row lock across
         * the round trip.
         */
        async consume(id, now = new Date()) {
            const result = await prisma.refreshToken.updateMany({
                where: { id, consumedAt: null, revokedAt: null },
                data: { consumedAt: now },
            });
            return result.count === 1;
        },

        linkReplacement(id, replacedBy) {
            return prisma.refreshToken.update({ where: { id }, data: { replacedBy } });
        },

        /** Revokes every live token in a family — the reuse-detection response. */
        async revokeFamily(familyId, now = new Date()) {
            const result = await prisma.refreshToken.updateMany({
                where: { familyId, revokedAt: null },
                data: { revokedAt: now },
            });
            return result.count;
        },

        async revokeAllForUser(userId, now = new Date()) {
            const result = await prisma.refreshToken.updateMany({
                where: { userId, revokedAt: null },
                data: { revokedAt: now },
            });
            return result.count;
        },

        /** Access-token ids issued within a family, for the revocation denylist. */
        listFamilyJtis(familyId) {
            return prisma.refreshToken.findMany({
                where: { familyId },
                select: { jti: true, issuedAt: true },
                orderBy: { issuedAt: 'desc' },
                take: 50,
            });
        },

        listSessions(userId) {
            return prisma.refreshToken.findMany({
                where: { userId, revokedAt: null, consumedAt: null, expiresAt: { gt: new Date() } },
                select: { id: true, familyId: true, issuedAt: true, expiresAt: true, userAgent: true },
                orderBy: { issuedAt: 'desc' },
            });
        },
    };
}

module.exports = { createTokenRepo };
