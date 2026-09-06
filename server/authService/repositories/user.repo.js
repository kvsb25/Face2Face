// All user SQL lives here (SRS NFR-MNT-01). Every value reaches the database
// through Prisma's parameterised queries — no string interpolation, ever.
// (SRS FR-VAL-04)

function createUserRepo(prisma) {
    return {
        findByEmail(email) {
            // email is citext, so the comparison is case-insensitive in the database
            return prisma.user.findUnique({ where: { email } });
        },

        findById(id) {
            return prisma.user.findUnique({ where: { id } });
        },

        create({ email, passwordHash, displayName, emailVerified = false }) {
            return prisma.user.create({
                data: { email, passwordHash, displayName, emailVerified },
            });
        },

        updatePasswordHash(id, passwordHash) {
            return prisma.user.update({ where: { id }, data: { passwordHash } });
        },

        markLoggedIn(id) {
            return prisma.user.update({ where: { id }, data: { lastLoginAt: new Date() } });
        },
    };
}

module.exports = { createUserRepo };
