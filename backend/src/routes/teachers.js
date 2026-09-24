const express = require('express');
const { ScanCommand, BatchGetCommand } = require('@aws-sdk/lib-dynamodb');
const { doc } = require('../db/dynamo');
const { TABLES } = require('../db/tables');
const { requireAuth, requireRole } = require('../middleware/auth');
const { classIdsForTeacher } = require('./students');

const router = express.Router();
router.use(requireAuth);

// GET /api/teachers - admin, teacher
router.get('/', requireRole('admin', 'teacher'), async (req, res) => {
  const result = await doc.send(new ScanCommand({
    TableName: TABLES.USERS,
    FilterExpression: '#role = :role',
    ExpressionAttributeNames: { '#role': 'role' },
    ExpressionAttributeValues: { ':role': 'teacher' }
  }));
  const teachers = (result.Items || []).sort((a, b) => a.lastName.localeCompare(b.lastName));
  res.json({ teachers: teachers.map(toPublicUser) });
});

// GET /api/teachers/:id/classes - admin, or the teacher themself
router.get('/:id/classes', async (req, res) => {
  const id = req.params.id;
  if (req.user.role !== 'admin' && req.user.id !== id) {
    return res.status(403).json({ error: 'Not authorized' });
  }
  const classIds = await classIdsForTeacher(id);
  if (classIds.size === 0) return res.json({ classes: [] });

  const result = await doc.send(new BatchGetCommand({
    RequestItems: { [TABLES.CLASSES]: { Keys: [...classIds].map((cid) => ({ id: cid })) } }
  }));
  const classes = (result.Responses?.[TABLES.CLASSES] || []).sort((a, b) => a.name.localeCompare(b.name));
  res.json({ classes: classes.map((c) => ({ id: c.id, name: c.name })) });
});

function toPublicUser(u) {
  return { id: u.id, email: u.email, firstName: u.firstName, lastName: u.lastName, status: u.status };
}

module.exports = router;
