const express = require('express');
const crypto = require('crypto');
const { GetCommand, PutCommand, UpdateCommand, DeleteCommand, ScanCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { doc } = require('../db/dynamo');
const { TABLES } = require('../db/tables');
const { requireAuth, requireRole } = require('../middleware/auth');
const { isParentOfStudent, isTeacherOfStudent, getStudentIdForUser } = require('../utils/authz');

const router = express.Router();
router.use(requireAuth);

async function classIdsForTeacher(teacherId) {
  const [classes, subjects] = await Promise.all([
    doc.send(new ScanCommand({
      TableName: TABLES.CLASSES,
      FilterExpression: 'classTeacherId = :t',
      ExpressionAttributeValues: { ':t': teacherId }
    })),
    doc.send(new ScanCommand({
      TableName: TABLES.SUBJECTS,
      FilterExpression: 'teacherId = :t',
      ExpressionAttributeValues: { ':t': teacherId }
    }))
  ]);
  const ids = new Set((classes.Items || []).map((c) => c.id));
  (subjects.Items || []).forEach((s) => ids.add(s.classId));
  return ids;
}

async function studentIdsForParent(parentId) {
  const result = await doc.send(new QueryCommand({
    TableName: TABLES.PARENT_STUDENT,
    KeyConditionExpression: 'parentId = :p',
    ExpressionAttributeValues: { ':p': parentId }
  }));
  return new Set((result.Items || []).map((r) => r.studentId));
}

async function enrichStudents(students) {
  const results = [];
  for (const s of students) {
    const [userResult, classResult] = await Promise.all([
      doc.send(new GetCommand({ TableName: TABLES.USERS, Key: { id: s.userId } })),
      s.classId ? doc.send(new GetCommand({ TableName: TABLES.CLASSES, Key: { id: s.classId } })) : Promise.resolve(null)
    ]);
    results.push(toPublicStudent(s, userResult.Item, classResult?.Item));
  }
  return results;
}

// GET /api/students - admin sees all, teacher sees their classes, parent sees linked, student sees self
router.get('/', async (req, res) => {
  const { classId } = req.query;

  let students;
  if (classId) {
    const result = await doc.send(new QueryCommand({
      TableName: TABLES.STUDENTS,
      IndexName: 'class-index',
      KeyConditionExpression: 'classId = :c',
      ExpressionAttributeValues: { ':c': classId }
    }));
    students = result.Items || [];
  } else {
    const result = await doc.send(new ScanCommand({ TableName: TABLES.STUDENTS }));
    students = result.Items || [];
  }

  if (req.user.role === 'teacher') {
    const classIds = await classIdsForTeacher(req.user.id);
    students = students.filter((s) => classIds.has(s.classId));
  } else if (req.user.role === 'parent') {
    const linkedIds = await studentIdsForParent(req.user.id);
    students = students.filter((s) => linkedIds.has(s.id));
  } else if (req.user.role === 'student') {
    students = students.filter((s) => s.userId === req.user.id);
  }

  const enriched = await enrichStudents(students);
  enriched.sort((a, b) => `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`));
  res.json({ students: enriched });
});

// POST /api/students - admin only, links an existing 'student' role user to a class
router.post('/', requireRole('admin'), async (req, res) => {
  const { userId, classId, rollNumber, dateOfBirth } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId is required' });

  const userResult = await doc.send(new GetCommand({ TableName: TABLES.USERS, Key: { id: userId } }));
  if (!userResult.Item) return res.status(404).json({ error: 'User not found' });
  if (userResult.Item.role !== 'student') {
    return res.status(400).json({ error: 'User must have the student role' });
  }

  const existing = await doc.send(new QueryCommand({
    TableName: TABLES.STUDENTS,
    IndexName: 'user-index',
    KeyConditionExpression: 'userId = :u',
    ExpressionAttributeValues: { ':u': userId }
  }));
  if (existing.Items?.length > 0) {
    return res.status(409).json({ error: 'This user is already a student record' });
  }

  const student = {
    id: crypto.randomUUID(),
    userId,
    classId: classId || null,
    rollNumber: rollNumber || null,
    dateOfBirth: dateOfBirth || null,
    createdAt: new Date().toISOString()
  };
  await doc.send(new PutCommand({ TableName: TABLES.STUDENTS, Item: student }));
  res.status(201).json({ student });
});

// GET /api/students/:id - admin, assigned teacher, linked parent, or self
router.get('/:id', async (req, res) => {
  const id = req.params.id;
  const authorized = await isAuthorizedForStudent(req.user, id);
  if (!authorized) return res.status(403).json({ error: 'Not authorized to view this student' });

  const result = await doc.send(new GetCommand({ TableName: TABLES.STUDENTS, Key: { id } }));
  if (!result.Item) return res.status(404).json({ error: 'Student not found' });

  const [enriched] = await enrichStudents([result.Item]);
  res.json({ student: enriched });
});

// PUT /api/students/:id - admin only
router.put('/:id', requireRole('admin'), async (req, res) => {
  const id = req.params.id;
  const { classId, rollNumber, dateOfBirth } = req.body;
  const names = {};
  const values = {};
  const sets = [];

  if (classId !== undefined) { values[':classId'] = classId; sets.push('classId = :classId'); }
  if (rollNumber !== undefined) { values[':rollNumber'] = rollNumber; sets.push('rollNumber = :rollNumber'); }
  if (dateOfBirth !== undefined) { values[':dateOfBirth'] = dateOfBirth; sets.push('dateOfBirth = :dateOfBirth'); }

  if (sets.length === 0) return res.status(400).json({ error: 'No valid fields to update' });

  try {
    await doc.send(new UpdateCommand({
      TableName: TABLES.STUDENTS,
      Key: { id },
      UpdateExpression: `SET ${sets.join(', ')}`,
      ExpressionAttributeNames: Object.keys(names).length ? names : undefined,
      ExpressionAttributeValues: values,
      ConditionExpression: 'attribute_exists(id)'
    }));
    res.json({ message: 'Student updated' });
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') return res.status(404).json({ error: 'Student not found' });
    throw err;
  }
});

// GET /api/students/:id/parents - admin, assigned teacher, linked parent, or self
router.get('/:id/parents', async (req, res) => {
  const studentId = req.params.id;
  const authorized = await isAuthorizedForStudent(req.user, studentId);
  if (!authorized) return res.status(403).json({ error: 'Not authorized' });

  const links = await doc.send(new QueryCommand({
    TableName: TABLES.PARENT_STUDENT,
    IndexName: 'student-index',
    KeyConditionExpression: 'studentId = :s',
    ExpressionAttributeValues: { ':s': studentId }
  }));

  const parents = [];
  for (const link of links.Items || []) {
    const u = await doc.send(new GetCommand({ TableName: TABLES.USERS, Key: { id: link.parentId } }));
    if (u.Item) {
      parents.push({
        id: u.Item.id,
        firstName: u.Item.firstName,
        lastName: u.Item.lastName,
        email: u.Item.email,
        relationship: link.relationship
      });
    }
  }
  res.json({ parents });
});

// POST /api/students/:id/link-parent - admin only
router.post('/:id/link-parent', requireRole('admin'), async (req, res) => {
  const studentId = req.params.id;
  const { parentId, relationship } = req.body;
  if (!parentId) return res.status(400).json({ error: 'parentId is required' });

  const parentResult = await doc.send(new GetCommand({ TableName: TABLES.USERS, Key: { id: parentId } }));
  if (!parentResult.Item || parentResult.Item.role !== 'parent') {
    return res.status(400).json({ error: 'parentId must reference a user with the parent role' });
  }

  await doc.send(new PutCommand({
    TableName: TABLES.PARENT_STUDENT,
    Item: { parentId, studentId, relationship: relationship || 'guardian' }
  }));
  res.status(201).json({ message: 'Parent linked to student' });
});

// DELETE /api/students/:id/link-parent/:parentId - admin only
router.delete('/:id/link-parent/:parentId', requireRole('admin'), async (req, res) => {
  await doc.send(new DeleteCommand({
    TableName: TABLES.PARENT_STUDENT,
    Key: { parentId: req.params.parentId, studentId: req.params.id }
  }));
  res.json({ message: 'Parent unlinked from student' });
});

async function isAuthorizedForStudent(user, studentId) {
  if (user.role === 'admin') return true;
  if (user.role === 'teacher') return isTeacherOfStudent(user.id, studentId);
  if (user.role === 'parent') return isParentOfStudent(user.id, studentId);
  if (user.role === 'student') {
    const ownId = await getStudentIdForUser(user.id);
    return ownId === studentId;
  }
  return false;
}

function toPublicStudent(s, user, cls) {
  return {
    id: s.id,
    userId: s.userId,
    classId: s.classId,
    className: cls?.name ?? null,
    rollNumber: s.rollNumber,
    dateOfBirth: s.dateOfBirth,
    firstName: user?.firstName,
    lastName: user?.lastName,
    email: user?.email
  };
}

module.exports = router;
module.exports.isAuthorizedForStudent = isAuthorizedForStudent;
module.exports.classIdsForTeacher = classIdsForTeacher;
module.exports.studentIdsForParent = studentIdsForParent;
