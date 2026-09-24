const express = require('express');
const crypto = require('crypto');
const { GetCommand, PutCommand, UpdateCommand, DeleteCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const { doc } = require('../db/dynamo');
const { TABLES } = require('../db/tables');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// GET /api/classes - any authenticated role can list classes (needed for dropdowns, dashboards)
router.get('/', async (req, res) => {
  const result = await doc.send(new ScanCommand({ TableName: TABLES.CLASSES }));
  const classes = result.Items || [];

  const enriched = [];
  for (const c of classes) {
    let teacherName = null;
    if (c.classTeacherId) {
      const t = await doc.send(new GetCommand({ TableName: TABLES.USERS, Key: { id: c.classTeacherId } }));
      if (t.Item) teacherName = `${t.Item.firstName} ${t.Item.lastName}`;
    }
    enriched.push({ id: c.id, name: c.name, classTeacherId: c.classTeacherId ?? null, classTeacherName: teacherName });
  }
  enriched.sort((a, b) => a.name.localeCompare(b.name));
  res.json({ classes: enriched });
});

// POST /api/classes - admin only
router.post('/', requireRole('admin'), async (req, res) => {
  const { name, classTeacherId } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  const cls = { id: crypto.randomUUID(), name, classTeacherId: classTeacherId || null, createdAt: new Date().toISOString() };
  await doc.send(new PutCommand({ TableName: TABLES.CLASSES, Item: cls }));
  res.status(201).json({ class: cls });
});

// PUT /api/classes/:id - admin only
router.put('/:id', requireRole('admin'), async (req, res) => {
  const id = req.params.id;
  const { name, classTeacherId } = req.body;
  const values = {};
  const sets = [];
  if (name !== undefined) { values[':name'] = name; sets.push('#name = :name'); }
  if (classTeacherId !== undefined) { values[':classTeacherId'] = classTeacherId; sets.push('classTeacherId = :classTeacherId'); }
  if (sets.length === 0) return res.status(400).json({ error: 'No valid fields to update' });

  try {
    await doc.send(new UpdateCommand({
      TableName: TABLES.CLASSES,
      Key: { id },
      UpdateExpression: `SET ${sets.join(', ')}`,
      ExpressionAttributeNames: name !== undefined ? { '#name': 'name' } : undefined,
      ExpressionAttributeValues: values,
      ConditionExpression: 'attribute_exists(id)'
    }));
    res.json({ message: 'Class updated' });
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') return res.status(404).json({ error: 'Class not found' });
    throw err;
  }
});

// DELETE /api/classes/:id - admin only
router.delete('/:id', requireRole('admin'), async (req, res) => {
  await doc.send(new DeleteCommand({ TableName: TABLES.CLASSES, Key: { id: req.params.id } }));
  res.json({ message: 'Class deleted' });
});

module.exports = router;
