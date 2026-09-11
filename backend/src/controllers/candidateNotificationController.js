const candidateNotificationModel = require('../models/candidateNotificationModel');

async function listMine(req, res) {
  const notifications = await candidateNotificationModel.findUnreadForCandidate(req.user.id);
  res.json(notifications);
}

async function markRead(req, res) {
  const result = await candidateNotificationModel.markRead(Number(req.params.id), req.user.id);
  if (result.count === 0) return res.status(404).json({ error: 'Notification not found' });
  res.json({ message: 'Marked as read' });
}

module.exports = { listMine, markRead };
