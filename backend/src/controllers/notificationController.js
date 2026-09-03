const notificationModel = require('../models/notificationModel');

async function listMine(req, res) {
  const notifications = await notificationModel.findUnreadForStaff(req.user.id);
  res.json(notifications);
}

async function markRead(req, res) {
  const notification = await notificationModel.markRead(Number(req.params.id));
  res.json(notification);
}

module.exports = { listMine, markRead };
