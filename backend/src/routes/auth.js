const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { GetCommand, PutCommand, QueryCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { doc } = require('../db/dynamo');
const { TABLES } = require('../db/tables');
const { requireAuth } = require('../middleware/auth');
const { startSession, clearSession, sessionInfo } = require('../utils/session');
const { passwordPolicyError } = require('../utils/password');

const router = express.Router();

const ALLOWED_SELF_REGISTER_ROLES = ['parent', 'student', 'teacher'];

// Account lockout: after MAX_FAILED_LOGINS wrong passwords the account refuses
// logins for LOCKOUT_MINUTES, regardless of which IP the attempts come from.
const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MINUTES = 15;

// Per-IP throttles, on top of the per-account lockout above.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many sign-in attempts from this network. Please try again in 15 minutes.' }
});
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many accounts created from this network. Please try again later.' }
});

// Compared against when the email is unknown, so a miss takes as long as a
// wrong password and response timing doesn't reveal which emails exist.
const DUMMY_HASH = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), 10);

async function findUserByEmail(email) {
  const result = await doc.send(new QueryCommand({
    TableName: TABLES.USERS,
    IndexName: 'email-index',
    KeyConditionExpression: 'email = :e',
    ExpressionAttributeValues: { ':e': email }
  }));
  return result.Items?.[0] || null;
}

function isEmail(value) {
  return typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

// POST /api/auth/register
router.post('/register', registerLimiter, async (req, res) => {
  try {
    const { email, password, role, firstName, lastName } = req.body;
    if (!email || !password || !role || !firstName || !lastName) {
      return res.status(400).json({ error: 'email, password, role, firstName, lastName are required' });
    }
    if (!isEmail(email)) return res.status(400).json({ error: 'Please enter a valid email address' });
    if (!ALLOWED_SELF_REGISTER_ROLES.includes(role)) {
      return res.status(400).json({ error: `role must be one of: ${ALLOWED_SELF_REGISTER_ROLES.join(', ')}` });
    }
    const policyError = passwordPolicyError(password);
    if (policyError) return res.status(400).json({ error: policyError });

    const normalizedEmail = email.toLowerCase();
    const existing = await findUserByEmail(normalizedEmail);
    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }

    // Teacher accounts can post announcements and mark attendance, so a
    // self-registered teacher waits for an administrator to activate it.
    const status = role === 'teacher' ? 'pending' : 'active';
    const passwordHash = await bcrypt.hash(password, 10);
    const now = new Date().toISOString();
    const user = {
      id: crypto.randomUUID(),
      email: normalizedEmail,
      passwordHash,
      role,
      firstName: String(firstName).slice(0, 80),
      lastName: String(lastName).slice(0, 80),
      status,
      tokenVersion: 0,
      createdAt: now,
      updatedAt: now
    };

    await doc.send(new PutCommand({
      TableName: TABLES.USERS,
      Item: user,
      ConditionExpression: 'attribute_not_exists(id)'
    }));

    if (status === 'pending') {
      return res.status(201).json({
        pending: true,
        message: 'Account created. An administrator must approve teacher accounts before you can sign in.'
      });
    }
    const session = startSession(res, user);
    res.status(201).json({ user: toPublicUser(user), session });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// POST /api/auth/login
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
      return res.status(400).json({ error: 'email and password are required' });
    }

    const user = await findUserByEmail(email.toLowerCase());
    if (!user) {
      await bcrypt.compare(password, DUMMY_HASH);
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    if (user.lockUntil && new Date(user.lockUntil) > new Date()) {
      return res.status(429).json({ error: `Too many failed attempts. This account is locked for up to ${LOCKOUT_MINUTES} minutes.` });
    }

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) {
      await recordFailedLogin(user);
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    if (user.status === 'pending') {
      return res.status(403).json({ error: 'Your account is awaiting administrator approval.' });
    }
    if (user.status !== 'active') {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    if (user.failedLogins || user.lockUntil) {
      await doc.send(new UpdateCommand({
        TableName: TABLES.USERS,
        Key: { id: user.id },
        UpdateExpression: 'REMOVE failedLogins, lockUntil'
      }));
    }

    const session = startSession(res, user);
    res.json({ user: toPublicUser(user), session });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed' });
  }
});

async function recordFailedLogin(user) {
  const failures = (user.failedLogins || 0) + 1;
  if (failures >= MAX_FAILED_LOGINS) {
    await doc.send(new UpdateCommand({
      TableName: TABLES.USERS,
      Key: { id: user.id },
      UpdateExpression: 'SET lockUntil = :l REMOVE failedLogins',
      ExpressionAttributeValues: { ':l': new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000).toISOString() }
    }));
  } else {
    await doc.send(new UpdateCommand({
      TableName: TABLES.USERS,
      Key: { id: user.id },
      UpdateExpression: 'SET failedLogins = :f',
      ExpressionAttributeValues: { ':f': failures }
    }));
  }
}

// POST /api/auth/logout - revokes every outstanding session for this user (the
// token version bump invalidates copies of the cookie anywhere else too).
router.post('/logout', requireAuth, async (req, res) => {
  await doc.send(new UpdateCommand({
    TableName: TABLES.USERS,
    Key: { id: req.user.id },
    UpdateExpression: 'SET tokenVersion = if_not_exists(tokenVersion, :zero) + :one',
    ExpressionAttributeValues: { ':zero': 0, ':one': 1 }
  }));
  clearSession(res);
  res.json({ message: 'Logged out' });
});

// POST /api/auth/refresh - keep-alive while the user is active; requireAuth
// already re-issues the cookie.
router.post('/refresh', requireAuth, (req, res) => {
  res.json({ session: sessionInfo(req.session.authTime) });
});

// GET /api/auth/me
router.get('/me', requireAuth, async (req, res) => {
  const result = await doc.send(new GetCommand({ TableName: TABLES.USERS, Key: { id: req.user.id } }));
  if (!result.Item) {
    return res.status(404).json({ error: 'User not found' });
  }
  res.json({ user: toPublicUser(result.Item), session: sessionInfo(req.session.authTime) });
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
