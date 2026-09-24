const express = require('express');
const { GetCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { doc } = require('../db/dynamo');
const { TABLES } = require('../db/tables');
const { requireAuth, requireRole } = require('../middleware/auth');
const { isTeacherOfClass } = require('../utils/authz');
const { isAuthorizedForStudent } = require('./students');

const router = express.Router();
router.use(requireAuth);

// GET /api/reports/student/:studentId - attendance % + assignment count for one student
router.get('/student/:studentId', async (req, res) => {
  const studentId = req.params.studentId;
  const authorized = await isAuthorizedForStudent(req.user, studentId);
  if (!authorized) return res.status(403).json({ error: 'Not authorized' });

  const [attendanceResult, studentResult] = await Promise.all([
    doc.send(new QueryCommand({
      TableName: TABLES.ATTENDANCE, KeyConditionExpression: 'studentId = :s', ExpressionAttributeValues: { ':s': studentId }
    })),
    doc.send(new GetCommand({ TableName: TABLES.STUDENTS, Key: { id: studentId } }))
  ]);

  const records = attendanceResult.Items || [];
  const counts = { present: 0, absent: 0, late: 0, excused: 0 };
  records.forEach((r) => { if (counts[r.status] !== undefined) counts[r.status]++; });
  const total = records.length;
  const attendancePercentage = total > 0 ? Math.round(((counts.present + counts.late) / total) * 1000) / 10 : null;

  let assignmentTotal = 0;
  const classId = studentResult.Item?.classId;
  if (classId) {
    const assignmentsResult = await doc.send(new QueryCommand({
      TableName: TABLES.ASSIGNMENTS, IndexName: 'class-index',
      KeyConditionExpression: 'classId = :c', ExpressionAttributeValues: { ':c': classId }
    }));
    assignmentTotal = (assignmentsResult.Items || []).length;
  }

  res.json({
    studentId,
    attendance: { counts, total, percentage: attendancePercentage },
    assignments: { total: assignmentTotal }
  });
});

// GET /api/reports/class/:classId/summary - admin, or the class's teacher
router.get('/class/:classId/summary', requireRole('admin', 'teacher'), async (req, res) => {
  const classId = req.params.classId;
  if (req.user.role === 'teacher') {
    const allowed = await isTeacherOfClass(req.user.id, classId);
    if (!allowed) return res.status(403).json({ error: 'You are not assigned to this class' });
  }

  const [studentsResult, assignmentsResult, attendanceResult] = await Promise.all([
    doc.send(new QueryCommand({
      TableName: TABLES.STUDENTS, IndexName: 'class-index',
      KeyConditionExpression: 'classId = :c', ExpressionAttributeValues: { ':c': classId }
    })),
    doc.send(new QueryCommand({
      TableName: TABLES.ASSIGNMENTS, IndexName: 'class-index',
      KeyConditionExpression: 'classId = :c', ExpressionAttributeValues: { ':c': classId }
    })),
    doc.send(new QueryCommand({
      TableName: TABLES.ATTENDANCE, IndexName: 'class-date-index',
      KeyConditionExpression: 'classId = :c', ExpressionAttributeValues: { ':c': classId }
    }))
  ]);

  const attendanceRecords = attendanceResult.Items || [];
  const today = new Date().toISOString().slice(0, 10);
  const attendanceToday = {};
  attendanceRecords.filter((r) => r.date === today).forEach((r) => {
    attendanceToday[r.status] = (attendanceToday[r.status] || 0) + 1;
  });

  const totalAttendance = attendanceRecords.length;
  const presentOrLate = attendanceRecords.filter((r) => r.status === 'present' || r.status === 'late').length;
  const averageAttendancePercentage = totalAttendance > 0 ? Math.round((presentOrLate / totalAttendance) * 1000) / 10 : null;

  res.json({
    classId,
    studentCount: (studentsResult.Items || []).length,
    assignmentCount: (assignmentsResult.Items || []).length,
    attendanceToday,
    averageAttendancePercentage
  });
});

module.exports = router;
