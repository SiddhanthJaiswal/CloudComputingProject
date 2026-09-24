const express = require('express');
const crypto = require('crypto');
const { GetCommand, PutCommand, QueryCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const { doc } = require('../db/dynamo');
const { TABLES } = require('../db/tables');
const { requireAuth, requireRole } = require('../middleware/auth');
const { isTeacherOfClass, getStudentIdForUser } = require('../utils/authz');
const { isAuthorizedForStudent, studentIdsForParent } = require('./students');

const router = express.Router();
router.use(requireAuth);

async function nameForStudent(studentId) {
  const s = await doc.send(new GetCommand({ TableName: TABLES.STUDENTS, Key: { id: studentId } }));
  if (!s.Item) return null;
  const u = await doc.send(new GetCommand({ TableName: TABLES.USERS, Key: { id: s.Item.userId } }));
  return u.Item ? `${u.Item.firstName} ${u.Item.lastName}` : null;
}

// GET /api/attendance?studentId=&classId=&date= - role-filtered
router.get('/', async (req, res) => {
  const { studentId, classId, date } = req.query;
  let records = [];

  if (studentId) {
    const authorized = await isAuthorizedForStudent(req.user, studentId);
    if (!authorized) return res.status(403).json({ error: "Not authorized to view this student's attendance" });
    const result = await doc.send(new QueryCommand({
      TableName: TABLES.ATTENDANCE,
      KeyConditionExpression: 'studentId = :s' + (date ? ' AND #date = :date' : ''),
      ExpressionAttributeNames: date ? { '#date': 'date' } : undefined,
      ExpressionAttributeValues: { ':s': studentId, ...(date ? { ':date': date } : {}) }
    }));
    records = result.Items || [];
  } else if (classId) {
    if (req.user.role === 'teacher') {
      const allowed = await isTeacherOfClass(req.user.id, classId);
      if (!allowed) return res.status(403).json({ error: 'You are not assigned to this class' });
    }
    const result = await doc.send(new QueryCommand({
      TableName: TABLES.ATTENDANCE,
      IndexName: 'class-date-index',
      KeyConditionExpression: 'classId = :c' + (date ? ' AND #date = :date' : ''),
      ExpressionAttributeNames: date ? { '#date': 'date' } : undefined,
      ExpressionAttributeValues: { ':c': classId, ...(date ? { ':date': date } : {}) }
    }));
    records = result.Items || [];
  } else if (req.user.role === 'student') {
    const ownId = await getStudentIdForUser(req.user.id);
    if (ownId) {
      const result = await doc.send(new QueryCommand({
        TableName: TABLES.ATTENDANCE, KeyConditionExpression: 'studentId = :s', ExpressionAttributeValues: { ':s': ownId }
      }));
      records = result.Items || [];
    }
  } else if (req.user.role === 'parent') {
    const linkedIds = await studentIdsForParent(req.user.id);
    for (const sid of linkedIds) {
      const result = await doc.send(new QueryCommand({
        TableName: TABLES.ATTENDANCE, KeyConditionExpression: 'studentId = :s', ExpressionAttributeValues: { ':s': sid }
      }));
      records.push(...(result.Items || []));
    }
  } else {
    // admin with no filters: full scan
    const result = await doc.send(new ScanCommand({ TableName: TABLES.ATTENDANCE }));
    records = result.Items || [];
  }

  const enriched = await Promise.all(records.map(async (r) => ({
    id: r.id,
    studentId: r.studentId,
    studentName: await nameForStudent(r.studentId),
    classId: r.classId,
    date: r.date,
    status: r.status,
    markedBy: r.markedBy
  })));
  enriched.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  res.json({ attendance: enriched });
});

// POST /api/attendance - teacher or admin, bulk mark: { classId, date, records: [{studentId, status}] }
router.post('/', requireRole('teacher', 'admin'), async (req, res) => {
  const { classId, date, records } = req.body;
  if (!classId || !date || !Array.isArray(records) || records.length === 0) {
    return res.status(400).json({ error: 'classId, date and a non-empty records array are required' });
  }

  if (req.user.role === 'teacher') {
    const allowed = await isTeacherOfClass(req.user.id, classId);
    if (!allowed) return res.status(403).json({ error: 'You are not assigned to this class' });
  }

  await Promise.all(records.filter((r) => r.studentId && r.status).map((r) => doc.send(new PutCommand({
    TableName: TABLES.ATTENDANCE,
    Item: {
      studentId: r.studentId,
      date,
      id: crypto.randomUUID(),
      classId,
      status: r.status,
      markedBy: req.user.id,
      createdAt: new Date().toISOString()
    }
  }))));

  res.status(201).json({ message: 'Attendance recorded' });
});

// GET /api/attendance/summary/:studentId - attendance percentage + counts
router.get('/summary/:studentId', async (req, res) => {
  const studentId = req.params.studentId;
  const authorized = await isAuthorizedForStudent(req.user, studentId);
  if (!authorized) return res.status(403).json({ error: 'Not authorized' });

  const result = await doc.send(new QueryCommand({
    TableName: TABLES.ATTENDANCE, KeyConditionExpression: 'studentId = :s', ExpressionAttributeValues: { ':s': studentId }
  }));
  const records = result.Items || [];

  const counts = { present: 0, absent: 0, late: 0, excused: 0 };
  records.forEach((r) => { if (counts[r.status] !== undefined) counts[r.status]++; });
  const total = records.length;
  const percentage = total > 0 ? Math.round(((counts.present + counts.late) / total) * 1000) / 10 : null;

  res.json({ studentId, counts, total, attendancePercentage: percentage });
});

module.exports = router;
