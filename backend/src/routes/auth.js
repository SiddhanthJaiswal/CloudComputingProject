const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { GetCommand, PutCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { doc } = require('../db/dynamo');
const { TABLES } = require('../db/tables');
const { signToken } = require('../utils/jwt');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const ALLOWED_SELF_REGISTER_ROLES = ['parent', 'student', 'teacher'];

async function findUserByEmail(email) {
  const result = await doc.send(new QueryCommand({
    TableName: TABLES.USERS,
    IndexName: 'email-index',
    KeyConditionExpression: 'email = :e',
    ExpressionAttributeValues: { ':e': email }
  }));
  return result.Items?.[0] || null;
}

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { email, password, role, firstName, lastName } = req.body;
    if (!email || !password || !role || !firstName || !lastName) {
      return res.status(400).json({ error: 'email, password, role, firstName, lastName are required' });
    }
    if (!ALLOWED_SELF_REGISTER_ROLES.includes(role)) {
      return res.status(400).json({ error: `role must be one of: ${ALLOWED_SELF_REGISTER_ROLES.join(', ')}` });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const normalizedEmail = email.toLowerCase();
    const existing = await findUserByEmail(normalizedEmail);
    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const now = new Date().toISOString();
    const user = {
      id: crypto.randomUUID(),
      email: normalizedEmail,
      passwordHash,
      role,
      firstName,
      lastName,
      status: 'active',
      createdAt: now,
      updatedAt: now
    };

    await doc.send(new PutCommand({
      TableName: TABLES.USERS,
      Item: user,
      ConditionExpression: 'attribute_not_exists(id)'
    }));

    const token = signToken(user);
    res.status(201).json({ token, user: toPublicUser(user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'email and password are required' });
    }

    const user = await findUserByEmail(email.toLowerCase());
    if (!user || user.status !== 'active') {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = signToken(user);
    res.json({ token, user: toPublicUser(user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// POST /api/auth/logout - stateless JWT, client discards the token.
router.post('/logout', requireAuth, (req, res) => {
  res.json({ message: 'Logged out' });
});

// GET /api/auth/me
router.get('/me', requireAuth, async (req, res) => {
  const result = await doc.send(new GetCommand({ TableName: TABLES.USERS, Key: { id: req.user.id } }));
  if (!result.Item) {
    return res.status(404).json({ error: 'User not found' });
  }
  res.json({ user: toPublicUser(result.Item) });
});

function toPublicUser(u) {
  return {
    id: u.id,
    email: u.email,
    role: u.role,
    firstName: u.firstName,
    lastName: u.lastName,
    status: u.status
  };
}

module.exports = router;
