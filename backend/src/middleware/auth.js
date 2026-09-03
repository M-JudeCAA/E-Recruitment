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

function requireStaffRole(minRole) {
  return (req, res, next) => {
    if (req.user.type !== 'staff') {
      return res.status(403).json({ error: 'Staff access required' });
    }
    const userRank = ROLE_RANK[req.user.role] || 0;
    const minRank = ROLE_RANK[minRole] || 0;
    if (userRank < minRank) {
      return res.status(403).json({ error: 'Insufficient role for this action' });
    }
    next();
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
