const staffModel = require('../models/staffModel');
const delegationModel = require('../models/delegationModel');
const { ROLE_RANK } = require('../middleware/auth');

// Returns the role name exactly one rank below the given role, or null
// if none exists (HR Officer has no tier below it - the lowest rank has
// nobody to delegate to, which is exactly why this feature is SHRO+ only).
function tierBelow(role) {
  const targetRank = ROLE_RANK[role] - 1;
  return Object.keys(ROLE_RANK).find((r) => ROLE_RANK[r] === targetRank) || null;
}

// Self-service delegation: a staff member delegates their OWN authority
// to a subordinate exactly one tier below them (e.g. a Senior HR
// Officer delegating to an HR Officer) - there is no separate
// authorizer, since it's their own authority being delegated, not
// someone else's. delegatorId is therefore never taken from the
// request - it is always the caller.
async function create(req, res) {
  const { delegateId, startDate, endDate, reason } = req.body;

  const requiredDelegateRole = tierBelow(req.user.role);
  if (!requiredDelegateRole) {
    return res.status(422).json({
      error: `${req.user.role.replace(/_/g, ' ')} has no tier below it - there is nobody to delegate to`
    });
  }

  const delegate = await staffModel.findById(Number(delegateId));
  if (!delegate) return res.status(400).json({ error: 'Delegate must be a valid staff account' });
  if (delegate.role !== requiredDelegateRole) {
    return res.status(400).json({
      error: `Delegate must be a ${requiredDelegateRole.replace(/_/g, ' ')}`
    });
  }

  if (!reason || !reason.trim()) return res.status(400).json({ error: 'A reason is required' });

  const start = new Date(startDate);
  const end = new Date(endDate);
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) {
    return res.status(400).json({ error: 'End date must be a valid date after the start date' });
  }

  const delegation = await delegationModel.create({
    delegatorId: req.user.id, delegateId: delegate.id,
    startDate: start, endDate: end, reason: reason.trim(),
    authorizedById: req.user.id
  });
  res.status(201).json(delegation);
}

// Principal HR Officer+ gets the full cross-team history (oversight);
// everyone else (Senior HR Officer, who can also reach this feature)
// only sees delegations they made themselves.
async function list(req, res) {
  const isOversight = (ROLE_RANK[req.user.role] || 0) >= ROLE_RANK.Principal_HR_Officer;
  const delegations = isOversight
    ? await delegationModel.findAll()
    : await delegationModel.findAllByDelegator(req.user.id);
  res.json(delegations);
}

module.exports = { create, list, tierBelow };
