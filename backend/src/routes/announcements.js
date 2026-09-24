const express = require('express');
const crypto = require('crypto');
const { GetCommand, PutCommand, DeleteCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const { doc } = require('../db/dynamo');
const { TABLES } = require('../db/tables');
const { requireAuth, requireRole } = require('../middleware/auth');
const { isTeacherOfClass, getStudentIdForUser } = require('../utils/authz');
const { classIdsForTeacher, studentIdsForParent } = require('./students');
const { notifyClass, notifySchoolWide } = require('../utils/notify');

const router = express.Router();
router.use(requireAuth);

// GET /api/announcements - role-filtered: school-wide + relevant class(es)
router.get('/', async (req, res) => {
  const result = await doc.send(new ScanCommand({ TableName: TABLES.ANNOUNCEMENTS }));
  let announcements = result.Items || [];

  if (req.user.role === 'teacher') {
    const classIds = await classIdsForTeacher(req.user.id);
    announcements = announcements.filter((a) => !a.classId || classIds.has(a.classId));
  } else if (req.user.role === 'student') {
    const studentId = await getStudentIdForUser(req.user.id);
    const s = studentId ? await doc.send(new GetCommand({ TableName: TABLES.STUDENTS, Key: { id: studentId } })) : null;
    const myClassId = s?.Item?.classId;
    announcements = announcements.filter((a) => !a.classId || a.classId === myClassId);
  } else if (req.user.role === 'parent') {
    const linkedIds = await studentIdsForParent(req.user.id);
    const classIds = new Set();
    for (const sid of linkedIds) {
      const s = await doc.send(new GetCommand({ TableName: TABLES.STUDENTS, Key: { id: sid } }));
      if (s.Item?.classId) classIds.add(s.Item.classId);
    }
    announcements = announcements.filter((a) => !a.classId || classIds.has(a.classId));
  }
  // admin: sees everything

  const enriched = [];
  for (const a of announcements) {
    const [classResult, creatorResult] = await Promise.all([
      a.classId ? doc.send(new GetCommand({ TableName: TABLES.CLASSES, Key: { id: a.classId } })) : Promise.resolve(null),
      doc.send(new GetCommand({ TableName: TABLES.USERS, Key: { id: a.createdBy } }))
    ]);
    enriched.push({
      id: a.id,
      title: a.title,
      body: a.body,
      classId: a.classId ?? null,
      className: classResult?.Item?.name ?? null,
      createdBy: a.createdBy,
      createdByName: creatorResult.Item ? `${creatorResult.Item.firstName} ${creatorResult.Item.lastName}` : null,
      createdAt: a.createdAt
    });
  }
  enriched.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  res.json({ announcements: enriched });
});

// POST /api/announcements - teacher (own class) or admin (any/school-wide)
router.post('/', requireRole('teacher', 'admin'), async (req, res) => {
  const { title, body, classId } = req.body;
  if (!title || !body) return res.status(400).json({ error: 'title and body are required' });

  if (req.user.role === 'teacher') {
    if (!classId) return res.status(400).json({ error: 'Teachers must target a specific class' });
    const allowed = await isTeacherOfClass(req.user.id, classId);
    if (!allowed) return res.status(403).json({ error: 'You are not assigned to this class' });
  }

  const announcement = {
    id: crypto.randomUUID(),
    title,
    body,
    classId: classId || null,
    createdBy: req.user.id,
    createdAt: new Date().toISOString()
  };
  await doc.send(new PutCommand({ TableName: TABLES.ANNOUNCEMENTS, Item: announcement }));

  if (classId) {
    await notifyClass(classId, 'New announcement', title, 'announcement');
  } else {
    await notifySchoolWide('New announcement', title, 'announcement');
  }

  res.status(201).json({ id: announcement.id, message: 'Announcement published' });
});

// DELETE /api/announcements/:id - creator or admin
router.delete('/:id', requireRole('teacher', 'admin'), async (req, res) => {
  const id = req.params.id;
  const existing = await doc.send(new GetCommand({ TableName: TABLES.ANNOUNCEMENTS, Key: { id } }));
  if (!existing.Item) return res.status(404).json({ error: 'Announcement not found' });
  if (req.user.role === 'teacher' && existing.Item.createdBy !== req.user.id) {
    return res.status(403).json({ error: 'You can only delete your own announcements' });
  }
  await doc.send(new DeleteCommand({ TableName: TABLES.ANNOUNCEMENTS, Key: { id } }));
  res.json({ message: 'Announcement deleted' });
});

module.exports = router;
