const prisma = require('../config/db');

module.exports = {
  findByEmail: (email) => prisma.pendingCandidateRegistration.findUnique({ where: { email } }),
  findByToken: (token) => prisma.pendingCandidateRegistration.findUnique({ where: { token } }),
  upsertByEmail: (email, data) => prisma.pendingCandidateRegistration.upsert({
    where: { email },
    create: { email, ...data },
    update: data
  }),
  updateToken: (id, data) => prisma.pendingCandidateRegistration.update({ where: { id }, data }),
  deleteById: (id) => prisma.pendingCandidateRegistration.delete({ where: { id } })
};
