const prisma = require('../config/db');

// One vacancy's interview session on one day - see InterviewDay in
// schema.prisma. Rows are created on demand (starting the session, or the
// not-started alert), so "no row" means "never started, never alerted".
const key = (vacancyId, day) => ({ vacancyId_day: { vacancyId, day } });

module.exports = {
  find: (vacancyId, day) => prisma.interviewDay.findUnique({ where: key(vacancyId, day) }),
  ensure: (vacancyId, day) => prisma.interviewDay.upsert({
    where: key(vacancyId, day), create: { vacancyId, day }, update: {}
  }),
  // Each of these is conditional on the current state, so two people acting
  // at once can't both win - count 0 means someone got there first.
  start: (id, staffId, at) => prisma.interviewDay.updateMany({
    where: { id, startedAt: null }, data: { startedAt: at, startedById: staffId }
  }),
  end: (id, staffId, at, closesAt) => prisma.interviewDay.updateMany({
    where: { id, startedAt: { not: null }, endedAt: null }, data: { endedAt: at, endedById: staffId, closesAt }
  }),
  markNotStartedAlert: (id, at) => prisma.interviewDay.updateMany({
    where: { id, startedAt: null, notStartedAlertAt: null }, data: { notStartedAlertAt: at }
  })
};
