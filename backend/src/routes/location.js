const express = require('express');
const rateLimit = require('express-rate-limit');
const { GetCommand, PutCommand, QueryCommand, BatchGetCommand } = require('@aws-sdk/lib-dynamodb');
const { doc } = require('../db/dynamo');
const { TABLES } = require('../db/tables');
const { requireAuth, requireRole } = require('../middleware/auth');
const { getStudentIdForUser } = require('../utils/authz');

// Child location sharing. A student shares their own device's position while
// they have the app open; only parents linked to that student can see it.
// Teachers and admins have no access. Only the latest position is stored, and
// it is deleted as soon as the student stops sharing.
const router = express.Router();
router.use(requireAuth);

const updateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 12,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Location updates are being sent too often.' }
});

function isValidPosition({ lat, lng, accuracy }) {
  return Number.isFinite(lat) && lat >= -90 && lat <= 90 &&
    Number.isFinite(lng) && lng >= -180 && lng <= 180 &&
    (accuracy === undefined || (Number.isFinite(accuracy) && accuracy >= 0 && accuracy < 100000));
}

async function getLocation(studentId) {
  const result = await doc.send(new GetCommand({ TableName: TABLES.LOCATIONS, Key: { studentId } }));
  return result.Item || null;
}

function toPublicLocation(item) {
  if (!item || !item.sharing) return { sharing: false, updatedAt: item?.updatedAt ?? null };
  return { sharing: true, lat: item.lat, lng: item.lng, accuracy: item.accuracy ?? null, updatedAt: item.updatedAt };
}

async function requireStudentRecord(req, res) {
  const studentId = await getStudentIdForUser(req.user.id);
  if (!studentId) {
    res.status(404).json({ error: 'Your account is not enrolled as a student yet' });
    return null;
  }
  return studentId;
}

// GET /api/location/me - student: own sharing status
router.get('/me', requireRole('student'), async (req, res) => {
  const studentId = await requireStudentRecord(req, res);
  if (!studentId) return;
  res.json({ location: toPublicLocation(await getLocation(studentId)) });
});

// PUT /api/location/me - student: share current position
router.put('/me', requireRole('student'), updateLimiter, async (req, res) => {
  const lat = Number(req.body.lat);
  const lng = Number(req.body.lng);
  const accuracy = req.body.accuracy === undefined ? undefined : Number(req.body.accuracy);
  if (!isValidPosition({ lat, lng, accuracy })) {
    return res.status(400).json({ error: 'lat/lng (and optional accuracy) must be valid numbers' });
  }
  const studentId = await requireStudentRecord(req, res);
  if (!studentId) return;

  const item = {
    studentId,
    sharing: true,
    lat: Math.round(lat * 1e6) / 1e6,
    lng: Math.round(lng * 1e6) / 1e6,
    accuracy: accuracy === undefined ? null : Math.round(accuracy),
    updatedAt: new Date().toISOString()
  };
  await doc.send(new PutCommand({ TableName: TABLES.LOCATIONS, Item: item }));
  res.json({ location: toPublicLocation(item) });
});

// DELETE /api/location/me - student: stop sharing; the stored position is erased
router.delete('/me', requireRole('student'), async (req, res) => {
  const studentId = await requireStudentRecord(req, res);
  if (!studentId) return;
  const item = { studentId, sharing: false, updatedAt: new Date().toISOString() };
  await doc.send(new PutCommand({ TableName: TABLES.LOCATIONS, Item: item }));
  res.json({ location: toPublicLocation(item) });
});

// GET /api/location/children - parent: latest location of each linked child
router.get('/children', requireRole('parent'), async (req, res) => {
  const links = await doc.send(new QueryCommand({
    TableName: TABLES.PARENT_STUDENT,
    KeyConditionExpression: 'parentId = :p',
    ExpressionAttributeValues: { ':p': req.user.id }
  }));
  const studentIds = (links.Items || []).map((l) => l.studentId);
  if (studentIds.length === 0) return res.json({ children: [] });

  const batch = await doc.send(new BatchGetCommand({
    RequestItems: {
      [TABLES.STUDENTS]: { Keys: studentIds.map((id) => ({ id })) },
      [TABLES.LOCATIONS]: { Keys: studentIds.map((studentId) => ({ studentId })) }
    }
  }));
  const students = batch.Responses?.[TABLES.STUDENTS] || [];
  const locations = Object.fromEntries((batch.Responses?.[TABLES.LOCATIONS] || []).map((l) => [l.studentId, l]));

  const userKeys = [...new Set(students.map((s) => s.userId))].map((id) => ({ id }));
  const classKeys = [...new Set(students.map((s) => s.classId).filter(Boolean))].map((id) => ({ id }));
  const lookups = await doc.send(new BatchGetCommand({
    RequestItems: {
      [TABLES.USERS]: { Keys: userKeys, ProjectionExpression: 'id, firstName, lastName' },
      ...(classKeys.length ? { [TABLES.CLASSES]: { Keys: classKeys, ProjectionExpression: 'id, #n', ExpressionAttributeNames: { '#n': 'name' } } } : {})
    }
  }));
  const users = Object.fromEntries((lookups.Responses?.[TABLES.USERS] || []).map((u) => [u.id, u]));
  const classes = Object.fromEntries((lookups.Responses?.[TABLES.CLASSES] || []).map((c) => [c.id, c]));

  const children = students.map((s) => ({
    studentId: s.id,
    firstName: users[s.userId]?.firstName,
    lastName: users[s.userId]?.lastName,
    className: classes[s.classId]?.name ?? null,
    location: toPublicLocation(locations[s.id])
  }));
  children.sort((a, b) => `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`));
  res.json({ children });
});

module.exports = router;
