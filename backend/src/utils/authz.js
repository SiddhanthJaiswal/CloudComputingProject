const { GetCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { doc } = require('../db/dynamo');
const { TABLES } = require('../db/tables');

async function getStudentById(studentId) {
  const result = await doc.send(new GetCommand({ TableName: TABLES.STUDENTS, Key: { id: studentId } }));
  return result.Item || null;
}

async function getClassById(classId) {
  if (!classId) return null;
  const result = await doc.send(new GetCommand({ TableName: TABLES.CLASSES, Key: { id: classId } }));
  return result.Item || null;
}

async function subjectsForClass(classId) {
  const result = await doc.send(new QueryCommand({
    TableName: TABLES.SUBJECTS,
    IndexName: 'class-index',
    KeyConditionExpression: 'classId = :c',
    ExpressionAttributeValues: { ':c': classId }
  }));
  return result.Items || [];
}

// True if the given parent user is linked to the given student.
async function isParentOfStudent(parentUserId, studentId) {
  const result = await doc.send(new GetCommand({
    TableName: TABLES.PARENT_STUDENT,
    Key: { parentId: String(parentUserId), studentId: String(studentId) }
  }));
  return !!result.Item;
}

// True if the given teacher teaches the class the student belongs to
// (either as class teacher or as a subject teacher for that class).
async function isTeacherOfStudent(teacherUserId, studentId) {
  const student = await getStudentById(studentId);
  if (!student || !student.classId) return false;
  return isTeacherOfClass(teacherUserId, student.classId);
}

async function isTeacherOfClass(teacherUserId, classId) {
  if (!classId) return false;
  const cls = await getClassById(classId);
  if (cls && cls.classTeacherId === teacherUserId) return true;
  const subjects = await subjectsForClass(classId);
  return subjects.some((s) => s.teacherId === teacherUserId);
}

async function getStudentIdForUser(userId) {
  const result = await doc.send(new QueryCommand({
    TableName: TABLES.STUDENTS,
    IndexName: 'user-index',
    KeyConditionExpression: 'userId = :u',
    ExpressionAttributeValues: { ':u': String(userId) }
  }));
  return result.Items?.[0]?.id ?? null;
}

module.exports = {
  isParentOfStudent,
  isTeacherOfStudent,
  isTeacherOfClass,
  getStudentIdForUser,
  getStudentById,
  getClassById,
  subjectsForClass
};
