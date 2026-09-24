const express = require('express');
const crypto = require('crypto');
const { GetCommand, PutCommand, UpdateCommand, DeleteCommand, ScanCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { doc } = require('../db/dynamo');
const { TABLES } = require('../db/tables');
const { requireAuth, requireRole } = require('../middleware/auth');
const { isTeacherOfClass, getStudentIdForUser } = require('../utils/authz');
const { notifyClass } = require('../utils/notify');

const router = express.Router();
router.use(requireAuth);

async function enrichAssignment(a) {
  const [subjectResult, classResult, teacherResult] = await Promise.all([
    doc.send(new GetCommand({ TableName: TABLES.SUBJECTS, Key: { id: a.subjectId } })),
    doc.send(new GetCommand({ TableName: TABLES.CLASSES, Key: { id: a.classId } })),
    doc.send(new GetCommand({ TableName: TABLES.USERS, Key: { id: a.teacherId } }))
  ]);
  return {
    id: a.id,
    title: a.title,
    description: a.description,
    dueDate: a.dueDate,
    createdAt: a.createdAt,
    subjectId: a.subjectId,
    subjectName: subjectResult.Item?.name,
    classId: a.classId,
    className: classResult.Item?.name,
    teacherId: a.teacherId,
    teacherName: teacherResult.Item ? `${teacherResult.Item.firstName} ${teacherResult.Item.lastName}` : null
  };
}

// GET /api/assignments?classId= - role-filtered
router.get('/', async (req, res) => {
  const { classId } = req.query;
  let assignments;

  if (classId) {
    const result = await doc.send(new QueryCommand({
      TableName: TABLES.ASSIGNMENTS, IndexName: 'class-index',
      KeyConditionExpression: 'classId = :c', ExpressionAttributeValues: { ':c': classId }
    }));
    assignments = result.Items || [];
  } else if (req.user.role === 'teacher') {
    const result = await doc.send(new QueryCommand({
      TableName: TABLES.ASSIGNMENTS, IndexName: 'teacher-index',
      KeyConditionExpression: 'teacherId = :t', ExpressionAttributeValues: { ':t': req.user.id }
    }));
    assignments = result.Items || [];
  } else if (req.user.role === 'student') {
    const studentId = await getStudentIdForUser(req.user.id);
    const studentResult = studentId ? await doc.send(new GetCommand({ TableName: TABLES.STUDENTS, Key: { id: studentId } })) : null;
    const studentClassId = studentResult?.Item?.classId;
    if (!studentClassId) {
      assignments = [];
    } else {
      const result = await doc.send(new QueryCommand({
        TableName: TABLES.ASSIGNMENTS, IndexName: 'class-index',
        KeyConditionExpression: 'classId = :c', ExpressionAttributeValues: { ':c': studentClassId }
      }));
      assignments = result.Items || [];
    }
  } else if (req.user.role === 'parent') {
    const links = await doc.send(new QueryCommand({
      TableName: TABLES.PARENT_STUDENT,
      KeyConditionExpression: 'parentId = :p', ExpressionAttributeValues: { ':p': req.user.id }
    }));
    const classIds = new Set();
    for (const link of links.Items || []) {
      const s = await doc.send(new GetCommand({ TableName: TABLES.STUDENTS, Key: { id: link.studentId } }));
      if (s.Item?.classId) classIds.add(s.Item.classId);
    }
    assignments = [];
    for (const cid of classIds) {
      const result = await doc.send(new QueryCommand({
        TableName: TABLES.ASSIGNMENTS, IndexName: 'class-index',
        KeyConditionExpression: 'classId = :c', ExpressionAttributeValues: { ':c': cid }
      }));
      assignments.push(...(result.Items || []));
    }
  } else {
    // admin: no restriction
    const result = await doc.send(new ScanCommand({ TableName: TABLES.ASSIGNMENTS }));
    assignments = result.Items || [];
  }

  const enriched = await Promise.all(assignments.map(enrichAssignment));
  enriched.sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999') || (b.createdAt || '').localeCompare(a.createdAt || ''));
  res.json({ assignments: enriched });
});

// POST /api/assignments - teacher (own class/subject) or admin
router.post('/', requireRole('teacher', 'admin'), async (req, res) => {
  const { subjectId, classId, title, description, dueDate } = req.body;
  if (!subjectId || !classId || !title) {
    return res.status(400).json({ error: 'subjectId, classId and title are required' });
  }

  if (req.user.role === 'teacher') {
    const allowed = await isTeacherOfClass(req.user.id, classId);
    if (!allowed) return res.status(403).json({ error: 'You are not assigned to this class' });
  }

  const teacherId = req.user.role === 'teacher' ? req.user.id : req.body.teacherId || req.user.id;
  const assignment = {
    id: crypto.randomUUID(),
    subjectId,
    classId,
    teacherId,
    title,
    description: description || null,
    dueDate: dueDate || null,
    createdAt: new Date().toISOString()
  };
  await doc.send(new PutCommand({ TableName: TABLES.ASSIGNMENTS, Item: assignment }));

  await notifyClass(classId, 'New assignment', `${title} has been posted.`, 'assignment');

  res.status(201).json({ id: assignment.id, message: 'Assignment created' });
});

// PUT /api/assignments/:id - owning teacher or admin
router.put('/:id', requireRole('teacher', 'admin'), async (req, res) => {
  const id = req.params.id;
  const existing = await doc.send(new GetCommand({ TableName: TABLES.ASSIGNMENTS, Key: { id } }));
  if (!existing.Item) return res.status(404).json({ error: 'Assignment not found' });
  if (req.user.role === 'teacher' && existing.Item.teacherId !== req.user.id) {
    return res.status(403).json({ error: 'You can only edit your own assignments' });
  }

  const { title, description, dueDate } = req.body;
  const values = {};
  const sets = [];
  if (title !== undefined) { values[':title'] = title; sets.push('title = :title'); }
  if (description !== undefined) { values[':description'] = description; sets.push('description = :description'); }
  if (dueDate !== undefined) { values[':dueDate'] = dueDate; sets.push('dueDate = :dueDate'); }
  if (sets.length === 0) return res.status(400).json({ error: 'No valid fields to update' });

  await doc.send(new UpdateCommand({
    TableName: TABLES.ASSIGNMENTS,
    Key: { id },
    UpdateExpression: `SET ${sets.join(', ')}`,
    ExpressionAttributeValues: values
  }));
  res.json({ message: 'Assignment updated' });
});

// DELETE /api/assignments/:id - owning teacher or admin
router.delete('/:id', requireRole('teacher', 'admin'), async (req, res) => {
  const id = req.params.id;
  const existing = await doc.send(new GetCommand({ TableName: TABLES.ASSIGNMENTS, Key: { id } }));
  if (!existing.Item) return res.status(404).json({ error: 'Assignment not found' });
  if (req.user.role === 'teacher' && existing.Item.teacherId !== req.user.id) {
    return res.status(403).json({ error: 'You can only delete your own assignments' });
  }
  await doc.send(new DeleteCommand({ TableName: TABLES.ASSIGNMENTS, Key: { id } }));
  res.json({ message: 'Assignment deleted' });
});

module.exports = router;
