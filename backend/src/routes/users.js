const express = require('express');
const bcrypt = require('bcryptjs');
const { GetCommand, ScanCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { doc } = require('../db/dynamo');
const { TABLES } = require('../db/tables');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// GET /api/users - admin only, supports ?role= and ?q= (search by name/email)
router.get('/', requireRole('admin'), async (req, res) => {
  const { role, q } = req.query;

  const params = { TableName: TABLES.USERS };
  if (role) {
    params.FilterExpression = '#role = :role';
    params.ExpressionAttributeNames = { '#role': 'role' };
    params.ExpressionAttributeValues = { ':role': role };
  }

  const result = await doc.send(new ScanCommand(params));
  let users = result.Items || [];

  if (q) {
    const needle = q.toLowerCase();
    users = users.filter(
      (u) => u.email.toLowerCase().includes(needle) || `${u.firstName} ${u.lastName}`.toLowerCase().includes(needle)
    );
  }

  users.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  res.json({ users: users.map(toPublicUser) });
});

// GET /api/users/:id - admin or self
router.get('/:id', async (req, res) => {
  const id = req.params.id;
  if (req.user.role !== 'admin' && req.user.id !== id) {
    return res.status(403).json({ error: 'Not authorized to view this user' });
  }
  const result = await doc.send(new GetCommand({ TableName: TABLES.USERS, Key: { id } }));
  if (!result.Item) return res.status(404).json({ error: 'User not found' });
  res.json({ user: toPublicUser(result.Item) });
});

// PUT /api/users/:id - admin can edit anyone; self can edit name/password
router.put('/:id', async (req, res) => {
  const id = req.params.id;
  const isSelf = req.user.id === id;
  const isAdmin = req.user.role === 'admin';
  if (!isSelf && !isAdmin) {
    return res.status(403).json({ error: 'Not authorized to edit this user' });
  }

  const { firstName, lastName, password, status } = req.body;
  const names = {};
  const values = {};
  const sets = [];

  if (firstName) { names['#firstName'] = 'firstName'; values[':firstName'] = firstName; sets.push('#firstName = :firstName'); }
  if (lastName) { names['#lastName'] = 'lastName'; values[':lastName'] = lastName; sets.push('#lastName = :lastName'); }
  if (password) {
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    values[':passwordHash'] = await bcrypt.hash(password, 10);
    sets.push('passwordHash = :passwordHash');
  }
  if (status && isAdmin) {
    if (!['active', 'inactive'].includes(status)) {
      return res.status(400).json({ error: 'status must be active or inactive' });
    }
    values[':status'] = status;
    sets.push('#status = :status');
    names['#status'] = 'status';
  }

  if (sets.length === 0) {
    return res.status(400).json({ error: 'No valid fields to update' });
  }

  values[':updatedAt'] = new Date().toISOString();
  sets.push('updatedAt = :updatedAt');

  try {
    const result = await doc.send(new UpdateCommand({
      TableName: TABLES.USERS,
      Key: { id },
      UpdateExpression: `SET ${sets.join(', ')}`,
      ExpressionAttributeNames: Object.keys(names).length ? names : undefined,
      ExpressionAttributeValues: values,
      ConditionExpression: 'attribute_exists(id)',
      ReturnValues: 'ALL_NEW'
    }));
    res.json({ user: toPublicUser(result.Attributes) });
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') return res.status(404).json({ error: 'User not found' });
    throw err;
  }
});

// DELETE /api/users/:id - admin only, soft delete (deactivate)
router.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    const result = await doc.send(new UpdateCommand({
      TableName: TABLES.USERS,
      Key: { id: req.params.id },
      UpdateExpression: 'SET #status = :status, updatedAt = :updatedAt',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':status': 'inactive', ':updatedAt': new Date().toISOString() },
      ConditionExpression: 'attribute_exists(id)',
      ReturnValues: 'ALL_NEW'
    }));
    res.json({ user: toPublicUser(result.Attributes) });
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') return res.status(404).json({ error: 'User not found' });
    throw err;
  }
});

function toPublicUser(u) {
  return {
    id: u.id,
    email: u.email,
    role: u.role,
    firstName: u.firstName,
    lastName: u.lastName,
    status: u.status,
    createdAt: u.createdAt
  };
}

module.exports = router;
