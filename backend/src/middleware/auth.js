const jwt = require('jsonwebtoken');

function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing token' });

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Cumulative role hierarchy, matching the 5-tier RBAC model:
// HR Officer < Senior HR Officer < Principal HR Officer < Manager < Director
const ROLE_RANK = {
  HR_Officer: 1,
  Senior_HR_Officer: 2,
  Principal_HR_Officer: 3,
  Manager: 4,
  Director: 5
};

// While a delegation is active, the delegate gains the delegator's
// permissions IN ADDITION to their own - the delegator does not lose
// access, in case they remain reachable despite being on leave. This
// checks for an active delegation only when the user's own role
// wouldn't otherwise pass, to avoid an extra database query on every
// single request for staff who were never delegated to.
function requireStaffRole(minRole) {
  return async (req, res, next) => {
    if (req.user.type !== 'staff') {
      return res.status(403).json({ error: 'Staff access required' });
    }

    const ownRank = ROLE_RANK[req.user.role] || 0;
    const minRank = ROLE_RANK[minRole] || 0;
    if (ownRank >= minRank) return next();

    // Own role doesn't qualify - check for an active delegation before
    // refusing outright.
    const delegationModel = require('../models/delegationModel');
    const delegation = await delegationModel.findActiveForDelegate(req.user.id, new Date());
    if (delegation) {
      const delegatedRank = ROLE_RANK[delegation.delegator.role] || 0;
      if (delegatedRank >= minRank) {
        // Log that this specific request relied on the delegation, not
        // just that a delegation exists - the audit trail should show
        // exactly when it was actually used, not merely when it was active.
        await delegationModel.logUsage(delegation.id, `${req.method} ${req.originalUrl}`);
        req.actingAsDelegateFor = delegation.delegatorId; // available to controllers/audit logging downstream
        return next();
      }
    }

    return res.status(403).json({ error: 'Insufficient role for this action' });
  };
}

function requireCandidate(req, res, next) {
  if (req.user.type !== 'candidate') {
    return res.status(403).json({ error: 'Candidate access required' });
  }
  next();
}

function optionalAuthenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next(); // proceed anonymously - this endpoint is public

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    // Invalid/expired token on a public browsing endpoint - fail open to
    // anonymous rather than blocking the request entirely.
  }
  next();
}

module.exports = { authenticate, optionalAuthenticate, requireStaffRole, requireCandidate, ROLE_RANK };
