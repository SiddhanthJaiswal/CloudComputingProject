const express = require('express');
const { QueryCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { doc } = require('../db/dynamo');
const { TABLES } = require('../db/tables');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

async function listForUser(userId) {
  const result = await doc.send(new QueryCommand({
    TableName: TABLES.NOTIFICATIONS,
    KeyConditionExpression: 'userId = :u',
    ExpressionAttributeValues: { ':u': userId },
    ScanIndexForward: false,
    Limit: 100
  }));
  return result.Items || [];
}

// GET /api/notifications - self only
router.get('/', async (req, res) => {
  const items = await listForUser(req.user.id);
  res.json({
    notifications: items.map((n) => ({
      id: n.id,
      title: n.title,
      body: n.body,
      type: n.type,
      isRead: n.isRead,
      createdAt: n.createdAt
    }))
  });
});

// PUT /api/notifications/:id/read - self only
router.put('/:id/read', async (req, res) => {
  const items = await listForUser(req.user.id);
  const match = items.find((n) => n.id === req.params.id);
  if (!match) return res.status(404).json({ error: 'Notification not found' });

  await doc.send(new UpdateCommand({
    TableName: TABLES.NOTIFICATIONS,
    Key: { userId: match.userId, sortKey: match.sortKey },
    UpdateExpression: 'SET isRead = :true',
    ExpressionAttributeValues: { ':true': true }
  }));
  res.json({ message: 'Marked as read' });
});

// PUT /api/notifications/read-all - self only
router.put('/read-all', async (req, res) => {
  const items = await listForUser(req.user.id);
  await Promise.all(items.filter((n) => !n.isRead).map((n) => doc.send(new UpdateCommand({
    TableName: TABLES.NOTIFICATIONS,
    Key: { userId: n.userId, sortKey: n.sortKey },
    UpdateExpression: 'SET isRead = :true',
    ExpressionAttributeValues: { ':true': true }
  }))));
  res.json({ message: 'All notifications marked as read' });
});

module.exports = router;
