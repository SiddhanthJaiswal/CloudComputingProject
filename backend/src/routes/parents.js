const express = require('express');
const { GetCommand, ScanCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { doc } = require('../db/dynamo');
const { TABLES } = require('../db/tables');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// GET /api/parents - admin only
router.get('/', requireRole('admin'), async (req, res) => {
  const result = await doc.send(new ScanCommand({
    TableName: TABLES.USERS,
    FilterExpression: '#role = :role',
    ExpressionAttributeNames: { '#role': 'role' },
    ExpressionAttributeValues: { ':role': 'parent' }
  }));
  const parents = (result.Items || []).sort((a, b) => a.lastName.localeCompare(b.lastName));
  res.json({ parents: parents.map(toPublicUser) });
});

// GET /api/parents/:id/students - admin or self
router.get('/:id/students', async (req, res) => {
  const id = req.params.id;
  if (req.user.role !== 'admin' && req.user.id !== id) {
    return res.status(403).json({ error: 'Not authorized' });
  }

  const links = await doc.send(new QueryCommand({
    TableName: TABLES.PARENT_STUDENT,
    KeyConditionExpression: 'parentId = :p',
    ExpressionAttributeValues: { ':p': id }
  }));

  const students = [];
  for (const link of links.Items || []) {
    const studentResult = await doc.send(new GetCommand({ TableName: TABLES.STUDENTS, Key: { id: link.studentId } }));
    const student = studentResult.Item;
    if (!student) continue;
    const [userResult, classResult] = await Promise.all([
      doc.send(new GetCommand({ TableName: TABLES.USERS, Key: { id: student.userId } })),
      student.classId ? doc.send(new GetCommand({ TableName: TABLES.CLASSES, Key: { id: student.classId } })) : Promise.resolve(null)
    ]);
    students.push({
      id: student.id,
      rollNumber: student.rollNumber,
      classId: student.classId,
      className: classResult?.Item?.name ?? null,
      firstName: userResult.Item?.firstName,
      lastName: userResult.Item?.lastName
    });
  }

  students.sort((a, b) => `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`));
  res.json({ students });
});

function toPublicUser(u) {
  return { id: u.id, email: u.email, firstName: u.firstName, lastName: u.lastName, status: u.status };
}

module.exports = router;
