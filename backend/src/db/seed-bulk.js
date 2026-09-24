// Bulk demo-data generator: 5 teachers + 5 classes/subjects + 100 students +
// 60 parents (linked as families - 40 single-child, 20 two-child households),
// all with realistic names. Safe to re-run: existing accounts (matched by
// email) get their name updated in place rather than being duplicated, so
// re-running this after changing the name lists fixes names on accounts that
// already exist.
//
// Credentials follow a predictable pattern so they're easy to remember:
//   Teachers: teacher1@parentpulse.local .. teacher5@parentpulse.local   / Teacher<N>@123
//   Students: student1@parentpulse.local .. student100@parentpulse.local / Student<N>@123
//   Parents:  parent1@parentpulse.local .. parent60@parentpulse.local    / Parent<N>@123
require('dotenv').config();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { PutCommand, UpdateCommand, ScanCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { doc } = require('./dynamo');
const { TABLES, ENV } = require('./tables');

const TEACHER_COUNT = 5;
const STUDENT_COUNT = 100;
const STUDENTS_PER_CLASS = STUDENT_COUNT / TEACHER_COUNT;
const SUBJECT_NAMES = ['Mathematics', 'Science', 'English', 'History', 'Art'];
const CONCURRENCY = 10;

// Single-child households: students 1-40, one parent each -> parents 1-40.
// Two-child households: students 41-80 paired up, one parent each -> parents 41-60.
const SINGLE_CHILD_STUDENTS = 40;
const SIBLING_PAIR_STUDENTS = 40; // students 41-80, 20 pairs
const PARENT_COUNT = SINGLE_CHILD_STUDENTS + SIBLING_PAIR_STUDENTS / 2; // 40 + 20 = 60

const FIRST_NAMES = [
  'Aiden', 'Olivia', 'Liam', 'Emma', 'Noah', 'Ava', 'Elijah', 'Sophia', 'James', 'Isabella',
  'William', 'Mia', 'Benjamin', 'Charlotte', 'Lucas', 'Amelia', 'Henry', 'Harper', 'Alexander', 'Evelyn',
  'Michael', 'Abigail', 'Daniel', 'Emily', 'Jacob', 'Elizabeth', 'Logan', 'Sofia', 'Jackson', 'Avery',
  'Sebastian', 'Ella', 'Jack', 'Scarlett', 'Owen', 'Grace', 'Samuel', 'Chloe', 'Matthew', 'Victoria',
  'Joseph', 'Riley', 'Levi', 'Aria', 'Mateo', 'Lily', 'David', 'Zoey'
];

const LAST_NAMES = [
  'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez',
  'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson', 'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin',
  'Lee', 'Perez', 'Thompson', 'White', 'Harris', 'Sanchez', 'Clark', 'Ramirez', 'Lewis', 'Robinson',
  'Walker', 'Young', 'Allen', 'King', 'Wright', 'Scott', 'Torres', 'Nguyen', 'Hill', 'Flores',
  'Green', 'Adams', 'Nelson', 'Baker', 'Hall', 'Rivera', 'Campbell', 'Carter'
];

function nameFromIndex(i, firstStride, lastStride, offset = 0) {
  const firstName = FIRST_NAMES[(i * firstStride + offset) % FIRST_NAMES.length];
  const lastName = LAST_NAMES[(i * lastStride + offset) % LAST_NAMES.length];
  return { firstName, lastName };
}

// Siblings (students in the paired range) must share a surname. Everyone else
// gets an independently-derived one.
function familyLastNameForStudent(num) {
  const inSiblingRange = num > SINGLE_CHILD_STUDENTS && num <= SINGLE_CHILD_STUDENTS + SIBLING_PAIR_STUDENTS;
  if (inSiblingRange) {
    const offsetFromStart = num - SINGLE_CHILD_STUDENTS - 1;
    const pairBase = SINGLE_CHILD_STUDENTS + 1 + Math.floor(offsetFromStart / 2) * 2;
    return nameFromIndex(pairBase, 7, 11, 0).lastName;
  }
  return nameFromIndex(num, 7, 11, 0).lastName;
}

async function findUserByEmail(email) {
  const result = await doc.send(new QueryCommand({
    TableName: TABLES.USERS,
    IndexName: 'email-index',
    KeyConditionExpression: 'email = :e',
    ExpressionAttributeValues: { ':e': email }
  }));
  return result.Items?.[0] || null;
}

// Creates the user if it doesn't exist; if it does, updates the name in place
// (so re-running this script after changing the name lists fixes existing
// accounts instead of skipping them) without touching its password.
async function upsertUser({ email, password, role, firstName, lastName }) {
  const existing = await findUserByEmail(email);
  if (existing) {
    if (existing.firstName !== firstName || existing.lastName !== lastName) {
      await doc.send(new UpdateCommand({
        TableName: TABLES.USERS,
        Key: { id: existing.id },
        UpdateExpression: 'SET firstName = :f, lastName = :l, updatedAt = :u',
        ExpressionAttributeValues: { ':f': firstName, ':l': lastName, ':u': new Date().toISOString() }
      }));
    }
    return existing.id;
  }

  const id = crypto.randomUUID();
  const passwordHash = await bcrypt.hash(password, 10);
  const now = new Date().toISOString();
  await doc.send(new PutCommand({
    TableName: TABLES.USERS,
    Item: { id, email, passwordHash, role, firstName, lastName, status: 'active', createdAt: now, updatedAt: now }
  }));
  return id;
}

async function inBatches(items, size, worker) {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(worker));
  }
}

async function run() {
  console.log(`Bulk-seeding ${TEACHER_COUNT} teachers, ${STUDENT_COUNT} students and ${PARENT_COUNT} parents into TABLE_ENV=${ENV}...`);

  console.log('Creating teachers...');
  const teacherIds = [];
  for (let i = 1; i <= TEACHER_COUNT; i++) {
    const { firstName, lastName } = nameFromIndex(i, 3, 5, 1);
    const id = await upsertUser({ email: `teacher${i}@parentpulse.local`, password: `Teacher${i}@123`, role: 'teacher', firstName, lastName });
    teacherIds.push(id);
  }

  console.log('Creating classes and subjects...');
  const existingClasses = (await doc.send(new ScanCommand({ TableName: TABLES.CLASSES }))).Items || [];
  const classIds = [];
  for (let i = 1; i <= TEACHER_COUNT; i++) {
    const name = `Class ${i}`;
    let classId = existingClasses.find((c) => c.name === name)?.id;
    if (!classId) {
      classId = crypto.randomUUID();
      await doc.send(new PutCommand({
        TableName: TABLES.CLASSES,
        Item: { id: classId, name, classTeacherId: teacherIds[i - 1], createdAt: new Date().toISOString() }
      }));
    } else {
      await doc.send(new UpdateCommand({
        TableName: TABLES.CLASSES, Key: { id: classId },
        UpdateExpression: 'SET classTeacherId = :t', ExpressionAttributeValues: { ':t': teacherIds[i - 1] }
      }));
    }
    classIds.push(classId);

    const existingSubjects = await doc.send(new QueryCommand({
      TableName: TABLES.SUBJECTS, IndexName: 'class-index',
      KeyConditionExpression: 'classId = :c', ExpressionAttributeValues: { ':c': classId }
    }));
    const subjectName = SUBJECT_NAMES[i - 1];
    if (!(existingSubjects.Items || []).some((s) => s.name === subjectName)) {
      await doc.send(new PutCommand({
        TableName: TABLES.SUBJECTS,
        Item: { id: crypto.randomUUID(), name: subjectName, classId, teacherId: teacherIds[i - 1], createdAt: new Date().toISOString() }
      }));
    }
  }

  console.log(`Creating ${STUDENT_COUNT} students...`);
  const studentJobs = [];
  let studentNum = 1;
  for (let c = 0; c < TEACHER_COUNT; c++) {
    for (let r = 1; r <= STUDENTS_PER_CLASS; r++) {
      studentJobs.push({ num: studentNum, classId: classIds[c], rollNumber: `R-${String(r).padStart(3, '0')}` });
      studentNum++;
    }
  }

  // studentRecordId[n] = the students-table row id for student n (needed below for parent linking)
  const studentRecordId = {};
  const studentLastName = {};

  let created = 0;
  await inBatches(studentJobs, CONCURRENCY, async (job) => {
    const email = `student${job.num}@parentpulse.local`;
    const firstName = nameFromIndex(job.num, 7, 11, 0).firstName;
    const lastName = familyLastNameForStudent(job.num);
    studentLastName[job.num] = lastName;

    const userId = await upsertUser({ email, password: `Student${job.num}@123`, role: 'student', firstName, lastName });

    const existing = await doc.send(new QueryCommand({
      TableName: TABLES.STUDENTS, IndexName: 'user-index',
      KeyConditionExpression: 'userId = :u', ExpressionAttributeValues: { ':u': userId }
    }));
    let studentId = existing.Items?.[0]?.id;
    if (!studentId) {
      studentId = crypto.randomUUID();
      await doc.send(new PutCommand({
        TableName: TABLES.STUDENTS,
        Item: {
          id: studentId, userId, classId: job.classId, rollNumber: job.rollNumber,
          dateOfBirth: null, createdAt: new Date().toISOString()
        }
      }));
    }
    studentRecordId[job.num] = studentId;

    created++;
    if (created % 20 === 0) console.log(`  ${created}/${STUDENT_COUNT} students done`);
  });

  console.log(`Creating ${PARENT_COUNT} parents and linking them to children...`);

  // Build the linking plan: parent N -> [student numbers]
  const parentPlan = [];
  for (let s = 1; s <= SINGLE_CHILD_STUDENTS; s++) {
    parentPlan.push({ parentNum: s, studentNums: [s] });
  }
  let parentNum = SINGLE_CHILD_STUDENTS + 1;
  for (let s = SINGLE_CHILD_STUDENTS + 1; s <= SINGLE_CHILD_STUDENTS + SIBLING_PAIR_STUDENTS; s += 2) {
    parentPlan.push({ parentNum, studentNums: [s, s + 1] });
    parentNum++;
  }

  let parentsCreated = 0;
  await inBatches(parentPlan, CONCURRENCY, async (plan) => {
    const familyLastName = studentLastName[plan.studentNums[0]];
    const { firstName } = nameFromIndex(plan.parentNum, 17, 1, 2);
    const email = `parent${plan.parentNum}@parentpulse.local`;

    const parentId = await upsertUser({
      email, password: `Parent${plan.parentNum}@123`, role: 'parent', firstName, lastName: familyLastName
    });

    await Promise.all(plan.studentNums.map((sn) => doc.send(new PutCommand({
      TableName: TABLES.PARENT_STUDENT,
      Item: { parentId, studentId: studentRecordId[sn], relationship: 'guardian' }
    }))));

    parentsCreated++;
    if (parentsCreated % 20 === 0) console.log(`  ${parentsCreated}/${PARENT_COUNT} parents done`);
  });

  console.log('');
  console.log('Bulk seed complete.');
  console.log(`  Teachers: teacher1@parentpulse.local .. teacher${TEACHER_COUNT}@parentpulse.local  (password: Teacher<N>@123)`);
  console.log(`  Students: student1@parentpulse.local .. student${STUDENT_COUNT}@parentpulse.local  (password: Student<N>@123)`);
  console.log(`  Parents:  parent1@parentpulse.local .. parent${PARENT_COUNT}@parentpulse.local  (password: Parent<N>@123)`);
  console.log(`  Classes:  Class 1 .. Class ${TEACHER_COUNT}, ${STUDENTS_PER_CLASS} students each`);
  console.log(`  Families: parents 1-${SINGLE_CHILD_STUDENTS} each have 1 child (students 1-${SINGLE_CHILD_STUDENTS}); parents ${SINGLE_CHILD_STUDENTS + 1}-${PARENT_COUNT} each have 2 children (students ${SINGLE_CHILD_STUDENTS + 1}-${SINGLE_CHILD_STUDENTS + SIBLING_PAIR_STUDENTS}); students ${SINGLE_CHILD_STUDENTS + SIBLING_PAIR_STUDENTS + 1}-${STUDENT_COUNT} have no linked parent.`);
}

run().catch((err) => {
  console.error('Bulk seed failed:', err);
  process.exit(1);
});
