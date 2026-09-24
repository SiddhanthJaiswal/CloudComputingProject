require('dotenv').config();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { PutCommand, QueryCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const { doc } = require('./dynamo');
const { TABLES, ENV } = require('./tables');

async function findUserByEmail(email) {
  const result = await doc.send(new QueryCommand({
    TableName: TABLES.USERS,
    IndexName: 'email-index',
    KeyConditionExpression: 'email = :e',
    ExpressionAttributeValues: { ':e': email }
  }));
  return result.Items?.[0] || null;
}

async function upsertUser({ email, password, role, firstName, lastName }) {
  const existing = await findUserByEmail(email);
  if (existing) return existing.id;

  const id = crypto.randomUUID();
  const passwordHash = await bcrypt.hash(password, 10);
  const now = new Date().toISOString();

  await doc.send(new PutCommand({
    TableName: TABLES.USERS,
    Item: { id, email, passwordHash, role, firstName, lastName, status: 'active', createdAt: now, updatedAt: now }
  }));
  return id;
}

async function seed() {
  console.log(`Seeding demo data into TABLE_ENV=${ENV}...`);

  const adminId = await upsertUser({
    email: 'admin@parentpulse.local', password: 'Admin@123', role: 'admin', firstName: 'System', lastName: 'Admin'
  });
  const teacherId = await upsertUser({
    email: 'teacher@parentpulse.local', password: 'Teacher@123', role: 'teacher', firstName: 'Jane', lastName: 'Smith'
  });
  const parentId = await upsertUser({
    email: 'parent@parentpulse.local', password: 'Parent@123', role: 'parent', firstName: 'John', lastName: 'Doe'
  });
  const studentUserId = await upsertUser({
    email: 'student@parentpulse.local', password: 'Student@123', role: 'student', firstName: 'Alex', lastName: 'Doe'
  });

  const classes = await doc.send(new ScanCommand({ TableName: TABLES.CLASSES }));
  let classId = classes.Items?.find((c) => c.name === 'Grade 5 - A')?.id;
  if (!classId) {
    classId = crypto.randomUUID();
    await doc.send(new PutCommand({
      TableName: TABLES.CLASSES,
      Item: { id: classId, name: 'Grade 5 - A', classTeacherId: teacherId, createdAt: new Date().toISOString() }
    }));
  }

  const subjects = await doc.send(new QueryCommand({
    TableName: TABLES.SUBJECTS, IndexName: 'class-index',
    KeyConditionExpression: 'classId = :c', ExpressionAttributeValues: { ':c': classId }
  }));
  let subjectId = subjects.Items?.find((s) => s.name === 'Mathematics')?.id;
  if (!subjectId) {
    subjectId = crypto.randomUUID();
    await doc.send(new PutCommand({
      TableName: TABLES.SUBJECTS,
      Item: { id: subjectId, name: 'Mathematics', classId, teacherId, createdAt: new Date().toISOString() }
    }));
  }

  const existingStudent = await doc.send(new QueryCommand({
    TableName: TABLES.STUDENTS, IndexName: 'user-index',
    KeyConditionExpression: 'userId = :u', ExpressionAttributeValues: { ':u': studentUserId }
  }));
  let studentId = existingStudent.Items?.[0]?.id;
  if (!studentId) {
    studentId = crypto.randomUUID();
    await doc.send(new PutCommand({
      TableName: TABLES.STUDENTS,
      Item: {
        id: studentId,
        userId: studentUserId,
        classId,
        rollNumber: 'R-001',
        dateOfBirth: '2014-05-12',
        createdAt: new Date().toISOString()
      }
    }));
  }

  await doc.send(new PutCommand({
    TableName: TABLES.PARENT_STUDENT,
    Item: { parentId, studentId, relationship: 'guardian' }
  }));

  const assignments = await doc.send(new QueryCommand({
    TableName: TABLES.ASSIGNMENTS, IndexName: 'class-index',
    KeyConditionExpression: 'classId = :c', ExpressionAttributeValues: { ':c': classId }
  }));
  if (!assignments.Items?.some((a) => a.title === 'Chapter 3 Worksheet')) {
    await doc.send(new PutCommand({
      TableName: TABLES.ASSIGNMENTS,
      Item: {
        id: crypto.randomUUID(),
        subjectId,
        classId,
        teacherId,
        title: 'Chapter 3 Worksheet',
        description: 'Complete exercises 1-10',
        dueDate: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
        createdAt: new Date().toISOString()
      }
    }));
  }

  const announcements = await doc.send(new ScanCommand({ TableName: TABLES.ANNOUNCEMENTS }));
  if (!announcements.Items?.some((a) => a.title === 'Welcome to the new term')) {
    await doc.send(new PutCommand({
      TableName: TABLES.ANNOUNCEMENTS,
      Item: {
        id: crypto.randomUUID(),
        title: 'Welcome to the new term',
        body: 'Classes resume on Monday. Please check the updated timetable.',
        classId,
        createdBy: teacherId,
        createdAt: new Date().toISOString()
      }
    }));
  }

  console.log('Seed complete. Demo accounts:');
  console.log('  admin@parentpulse.local / Admin@123');
  console.log('  teacher@parentpulse.local / Teacher@123');
  console.log('  parent@parentpulse.local / Parent@123');
  console.log('  student@parentpulse.local / Student@123');
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
