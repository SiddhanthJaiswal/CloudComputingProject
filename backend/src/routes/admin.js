const express = require('express');
const { ScanCommand } = require('@aws-sdk/lib-dynamodb');
const { doc } = require('../db/dynamo');
const { TABLES } = require('../db/tables');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requireRole('admin'));

async function countItems(tableName) {
  const result = await doc.send(new ScanCommand({ TableName: tableName, Select: 'COUNT' }));
  return result.Count || 0;
}

// GET /api/admin/overview - counts for the admin dashboard
router.get('/overview', async (req, res) => {
  const [users, classCount, assignmentCount, announcementCount] = await Promise.all([
    doc.send(new ScanCommand({ TableName: TABLES.USERS })),
    countItems(TABLES.CLASSES),
    countItems(TABLES.ASSIGNMENTS),
    countItems(TABLES.ANNOUNCEMENTS)
  ]);

  const usersByRole = { admin: 0, teacher: 0, parent: 0, student: 0 };
  (users.Items || []).forEach((u) => { if (usersByRole[u.role] !== undefined) usersByRole[u.role]++; });

  res.json({ usersByRole, classCount, assignmentCount, announcementCount });
});

module.exports = router;
