const { PrismaClient } = require('@prisma/client');
const { auditFields } = require('../utils/requestContext');

// Interactive transactions default to a 5s limit, which a remote database
// (the cloud MySQL) can exceed on an ordinary write - creating a vacancy took
// 5.06s there. Past the limit Prisma reports a failure even though MySQL may
// already have committed, so the user sees an error for something that was
// saved. A wider limit keeps the answer honest.
const client = new PrismaClient({
  transactionOptions: { maxWait: 10000, timeout: 20000 }
});

// Every audit row says who acted, from which address and browser, and by
// which request (utils/requestContext.js) - however it is written, and
// inside transactions too. What the writer sets itself wins.
//
// Each row is also a live update (services/liveUpdateService.js): open pages
// are told what changed, a moment later so a surrounding transaction has
// normally committed before they re-read.
const LIVE_UPDATE_DELAY_MS = 300;
const prisma = client.$extends({
  query: {
    auditLog: {
      async create({ args, query }) {
        const row = await query({ ...args, data: { ...auditFields(), ...args.data } });
        // Resolved now, not when the timer fires: under the tests nothing is
        // wanted, and a timer outliving a test file must not load modules.
        const live = require('../services/liveUpdateService');
        if (live.wanted()) {
          const { entityType, entityId, action, performedById } = { ...args.data, ...row };
          setTimeout(() => live.afterAudit({ entityType, entityId, action, performedById }), LIVE_UPDATE_DELAY_MS).unref?.();
        }
        return row;
      }
    }
  }
});

module.exports = prisma;
