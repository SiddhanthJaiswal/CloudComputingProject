const express = require('express');
const crypto = require('crypto');
const { GetCommand, PutCommand, UpdateCommand, DeleteCommand, ScanCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { doc } = require('../db/dynamo');
const { TABLES } = require('../db/tables');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// GET /api/subjects?classId= - any authenticated role
router.get('/', async (req, res) => {
  const { classId } = req.query;

  let subjects;
  if (classId) {
    const result = await doc.send(new QueryCommand({
      TableName: TABLES.SUBJECTS,
      IndexName: 'class-index',
      KeyConditionExpression: 'classId = :c',
      ExpressionAttributeValues: { ':c': classId }
    }));
    subjects = result.Items || [];
  } else {
    const result = await doc.send(new ScanCommand({ TableName: TABLES.SUBJECTS }));
    subjects = result.Items || [];
  }

  const enriched = [];
  for (const s of subjects) {
    let teacherName = null;
    if (s.teacherId) {
      const t = await doc.send(new GetCommand({ TableName: TABLES.USERS, Key: { id: s.teacherId } }));
      if (t.Item) teacherName = `${t.Item.firstName} ${t.Item.lastName}`;
    }
    enriched.push({ id: s.id, name: s.name, classId: s.classId, teacherId: s.teacherId ?? null, teacherName });
  }
  enriched.sort((a, b) => a.name.localeCompare(b.name));
  res.json({ subjects: enriched });
});

// POST /api/subjects - admin only
router.post('/', requireRole('admin'), async (req, res) => {
  const { name, classId, teacherId } = req.body;
  if (!name || !classId) return res.status(400).json({ error: 'name and classId are required' });
  const subject = {
    id: crypto.randomUUID(), name, classId, teacherId: teacherId || null, createdAt: new Date().toISOString()
  };
  await doc.send(new PutCommand({ TableName: TABLES.SUBJECTS, Item: subject }));
  res.status(201).json({ subject });
});

// PUT /api/subjects/:id - admin only
router.put('/:id', requireRole('admin'), async (req, res) => {
  const id = req.params.id;
  const { name, teacherId } = req.body;
  const values = {};
  const sets = [];
  if (name !== undefined) { values[':name'] = name; sets.push('#name = :name'); }
  if (teacherId !== undefined) { values[':teacherId'] = teacherId; sets.push('teacherId = :teacherId'); }
  if (sets.length === 0) return res.status(400).json({ error: 'No valid fields to update' });

  try {
    await doc.send(new UpdateCommand({
      TableName: TABLES.SUBJECTS,
      Key: { id },
      UpdateExpression: `SET ${sets.join(', ')}`,
      ExpressionAttributeNames: name !== undefined ? { '#name': 'name' } : undefined,
      ExpressionAttributeValues: values,
      ConditionExpression: 'attribute_exists(id)'
    }));
    res.json({ message: 'Subject updated' });
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') return res.status(404).json({ error: 'Subject not found' });
    throw err;
  }
});

// DELETE /api/subjects/:id - admin only
router.delete('/:id', requireRole('admin'), async (req, res) => {
  await doc.send(new DeleteCommand({ TableName: TABLES.SUBJECTS, Key: { id: req.params.id } }));
  res.json({ message: 'Subject deleted' });
});

module.exports = router;
