const { PrismaClient } = require('@prisma/client');

// Interactive transactions default to a 5s limit, which a remote database
// (the cloud MySQL) can exceed on an ordinary write - creating a vacancy took
// 5.06s there. Past the limit Prisma reports a failure even though MySQL may
// already have committed, so the user sees an error for something that was
// saved. A wider limit keeps the answer honest.
const prisma = new PrismaClient({
  transactionOptions: { maxWait: 10000, timeout: 20000 }
});

module.exports = prisma;
