const notificationModel = require('../models/notificationModel');
const { linkFor } = require('../utils/notificationLinks');
const { clearResolved } = require('../services/noticeClearingService');

// The staff bell: the signed-in staff member's unread in-app notices, each
// with `link` - where opening it takes them (set when it was sent; worked
// out from its task for rows from before links were kept). A notice asking
// for something someone has since done is cleared first - for everyone it
// went to (noticeClearingService).
async function listMine(req, res) {
  const unread = await notificationModel.findUnreadForStaff(req.user.id);
  const cleared = await clearResolved(unread);
  const notifications = unread.filter((n) => !cleared.has(n.id));
  const withLinks = await Promise.all(notifications.map(async (n) => ({
    ...n, link: n.link || await linkFor(n.taskType, n.taskId).catch(() => '/hr/inbox')
  })));
  res.json(withLinks);
}

// Only the recipient can mark their own notice read.
async function markRead(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid notification' });
  const result = await notificationModel.markReadForStaff(id, req.user.id);
  if (result.count === 0) return res.status(404).json({ error: 'Notification not found' });
  res.json({ id, read: true });
}

async function markAllRead(req, res) {
  const result = await notificationModel.markAllReadForStaff(req.user.id);
  res.json({ read: result.count });
}

module.exports = { listMine, markRead, markAllRead };
