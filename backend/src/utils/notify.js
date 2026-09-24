const crypto = require('crypto');
const { PutCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { doc } = require('../db/dynamo');
const { TABLES } = require('../db/tables');

async function putNotification(userId, title, body, type) {
  const now = new Date().toISOString();
  await doc.send(new PutCommand({
    TableName: TABLES.NOTIFICATIONS,
    Item: {
      userId,
      sortKey: `${now}#${crypto.randomUUID()}`,
      id: crypto.randomUUID(),
      title,
      body,
      type,
      isRead: false,
      createdAt: now
    }
  }));
}

// Notifies every student in the class, plus every parent linked to any of those students.
async function notifyClass(classId, title, body, type) {
  const studentsResult = await doc.send(new QueryCommand({
    TableName: TABLES.STUDENTS,
    IndexName: 'class-index',
    KeyConditionExpression: 'classId = :c',
    ExpressionAttributeValues: { ':c': classId }
  }));
  const students = studentsResult.Items || [];

  await Promise.all(students.map((s) => putNotification(s.userId, title, body, type)));

  const parentSets = await Promise.all(
    students.map((s) => doc.send(new QueryCommand({
      TableName: TABLES.PARENT_STUDENT,
      IndexName: 'student-index',
      KeyConditionExpression: 'studentId = :s',
      ExpressionAttributeValues: { ':s': s.id }
    })))
  );
  const parentIds = new Set();
  parentSets.forEach((r) => (r.Items || []).forEach((link) => parentIds.add(link.parentId)));

  await Promise.all([...parentIds].map((pid) => putNotification(pid, title, body, type)));
}

// Notifies every teacher, parent and student in the system (school-wide announcements).
async function notifySchoolWide(title, body, type) {
  const { ScanCommand } = require('@aws-sdk/lib-dynamodb');
  const result = await doc.send(new ScanCommand({
    TableName: TABLES.USERS,
    FilterExpression: '#role IN (:teacher, :parent, :student)',
    ExpressionAttributeNames: { '#role': 'role' },
    ExpressionAttributeValues: { ':teacher': 'teacher', ':parent': 'parent', ':student': 'student' }
  }));
  await Promise.all((result.Items || []).map((u) => putNotification(u.id, title, body, type)));
}

module.exports = { putNotification, notifyClass, notifySchoolWide };
