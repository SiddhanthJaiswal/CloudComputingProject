// Populates attendance history and assignments for every existing student/class,
// so reports/dashboards have real numbers instead of empty states. Safe to
// re-run: attendance is naturally idempotent (one row per student+date, just
// re-randomizes the status), and assignments are skipped if a matching title
// already exists for that class.
require('dotenv').config();
const crypto = require('crypto');
const { PutCommand, ScanCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { doc } = require('./dynamo');
const { TABLES, ENV } = require('./tables');

const ATTENDANCE_WEEKDAYS = 15;
const CONCURRENCY = 20;

const ASSIGNMENTS_BY_SUBJECT = {
  Mathematics: [
    { title: 'Chapter 3 Worksheet', description: 'Complete exercises 1-20 on fractions and decimals.', offsetDays: -10 },
    { title: 'Algebra Practice Set', description: 'Solve the linear equations handout.', offsetDays: -5 },
    { title: 'Geometry Quiz Review', description: 'Review shapes, angles and perimeter before Friday’s quiz.', offsetDays: -1 },
    { title: 'Fractions Homework', description: 'Textbook pages 42-44, all questions.', offsetDays: 3 },
    { title: 'Mixed Word Problems', description: 'Worksheet covering addition, subtraction and multiplication word problems.', offsetDays: 8 },
    { title: 'Unit 2 Test Prep', description: 'Practice test + review sheet for the upcoming unit test.', offsetDays: 14 }
  ],
  Science: [
    { title: 'Lab Report: Photosynthesis', description: 'Write up observations from the classroom plant experiment.', offsetDays: -9 },
    { title: 'States of Matter Worksheet', description: 'Label examples of solids, liquids and gases.', offsetDays: -4 },
    { title: 'Solar System Poster', description: 'Create a labeled poster of the solar system.', offsetDays: 0 },
    { title: 'Food Chain Diagram', description: 'Draw and label a food chain for a chosen habitat.', offsetDays: 5 },
    { title: 'Weather Journal', description: 'Record daily weather observations for one week.', offsetDays: 9 },
    { title: 'Simple Machines Project', description: 'Build and explain a simple machine of your choice.', offsetDays: 16 }
  ],
  English: [
    { title: 'Essay: My Summer Vacation', description: 'One-page essay, double spaced.', offsetDays: -12 },
    { title: 'Grammar Worksheet Ch.4', description: 'Complete the worksheet on subject-verb agreement.', offsetDays: -6 },
    { title: 'Book Report: Chapter Summary', description: 'Summarize chapters 1-3 of the assigned reading.', offsetDays: -2 },
    { title: 'Spelling List 7', description: 'Practice and study spelling list 7 for Friday’s test.', offsetDays: 2 },
    { title: 'Creative Writing Prompt', description: 'Write a short story using this week’s prompt.', offsetDays: 7 },
    { title: 'Reading Comprehension Quiz', description: 'Quiz covering the assigned reading passage.', offsetDays: 12 }
  ],
  History: [
    { title: 'Timeline Project: Ancient Civilizations', description: 'Create an illustrated timeline of major events.', offsetDays: -11 },
    { title: 'Map Worksheet: World Regions', description: 'Label the major world regions on the blank map.', offsetDays: -3 },
    { title: 'Research Note: Local History', description: 'One page of notes on a local historical landmark.', offsetDays: 1 },
    { title: 'Primary Source Analysis', description: 'Answer the analysis questions for the provided primary source.', offsetDays: 6 },
    { title: 'Quiz: Important Dates', description: 'Study the key dates handout for Monday’s quiz.', offsetDays: 10 },
    { title: 'Presentation: A Historical Figure', description: 'Prepare a short presentation on a historical figure of your choice.', offsetDays: 18 }
  ],
  Art: [
    { title: 'Sketchbook Assignment 1', description: 'Five sketches based on objects around your home.', offsetDays: -8 },
    { title: 'Color Theory Worksheet', description: 'Complete the color wheel and mixing exercise.', offsetDays: -4 },
    { title: 'Self-Portrait Project', description: 'Create a self-portrait using the medium of your choice.', offsetDays: 2 },
    { title: 'Clay Sculpture Plan', description: 'Sketch and plan your clay sculpture for next week.', offsetDays: 6 },
    { title: 'Art History Reflection', description: 'Write a short reflection on the artist discussed in class.', offsetDays: 11 },
    { title: 'Final Project Proposal', description: 'One paragraph proposal for your end-of-term project.', offsetDays: 20 }
  ]
};

function toDateString(d) {
  return d.toISOString().slice(0, 10);
}

function getRecentWeekdays(n) {
  const dates = [];
  const d = new Date();
  while (dates.length < n) {
    const day = d.getDay();
    if (day !== 0 && day !== 6) dates.push(toDateString(d));
    d.setDate(d.getDate() - 1);
  }
  return dates.reverse();
}

function randomStatus() {
  const r = Math.random();
  if (r < 0.82) return 'present';
  if (r < 0.90) return 'late';
  if (r < 0.97) return 'absent';
  return 'excused';
}

function offsetDate(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return toDateString(d);
}

async function inBatches(items, size, worker) {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(worker));
  }
}

async function run() {
  console.log(`Seeding attendance + assignments into TABLE_ENV=${ENV}...`);

  const classes = (await doc.send(new ScanCommand({ TableName: TABLES.CLASSES }))).Items || [];
  const students = (await doc.send(new ScanCommand({ TableName: TABLES.STUDENTS }))).Items || [];

  if (classes.length === 0 || students.length === 0) {
    console.log('No classes/students found - run db:seed:bulk first.');
    return;
  }

  // ---- Assignments: one batch per class, matched to its subject ----
  console.log('Creating assignments...');
  let assignmentsCreated = 0;
  for (const cls of classes) {
    const subjectsResult = await doc.send(new QueryCommand({
      TableName: TABLES.SUBJECTS, IndexName: 'class-index',
      KeyConditionExpression: 'classId = :c', ExpressionAttributeValues: { ':c': cls.id }
    }));
    const subject = (subjectsResult.Items || [])[0];
    if (!subject || !cls.classTeacherId) continue;

    const templates = ASSIGNMENTS_BY_SUBJECT[subject.name];
    if (!templates) continue;

    const existingAssignments = await doc.send(new QueryCommand({
      TableName: TABLES.ASSIGNMENTS, IndexName: 'class-index',
      KeyConditionExpression: 'classId = :c', ExpressionAttributeValues: { ':c': cls.id }
    }));
    const existingTitles = new Set((existingAssignments.Items || []).map((a) => a.title));

    for (const tpl of templates) {
      if (existingTitles.has(tpl.title)) continue;
      await doc.send(new PutCommand({
        TableName: TABLES.ASSIGNMENTS,
        Item: {
          id: crypto.randomUUID(),
          subjectId: subject.id,
          classId: cls.id,
          teacherId: cls.classTeacherId,
          title: tpl.title,
          description: tpl.description,
          dueDate: offsetDate(tpl.offsetDays),
          createdAt: new Date().toISOString()
        }
      }));
      assignmentsCreated++;
    }
  }
  console.log(`  ${assignmentsCreated} new assignments created.`);

  // ---- Attendance: last N weekdays for every student ----
  const weekdays = getRecentWeekdays(ATTENDANCE_WEEKDAYS);
  console.log(`Creating attendance for ${students.length} students x ${weekdays.length} school days (${weekdays[0]} .. ${weekdays[weekdays.length - 1]})...`);

  const jobs = [];
  for (const student of students) {
    if (!student.classId) continue;
    for (const date of weekdays) {
      jobs.push({ studentId: student.id, classId: student.classId, date });
    }
  }

  let done = 0;
  await inBatches(jobs, CONCURRENCY, async (job) => {
    await doc.send(new PutCommand({
      TableName: TABLES.ATTENDANCE,
      Item: {
        studentId: job.studentId,
        date: job.date,
        id: crypto.randomUUID(),
        classId: job.classId,
        status: randomStatus(),
        markedBy: null,
        createdAt: new Date().toISOString()
      }
    }));
    done++;
    if (done % 300 === 0) console.log(`  ${done}/${jobs.length} attendance records done`);
  });

  console.log('');
  console.log('Activity seed complete.');
  console.log(`  Assignments: ${assignmentsCreated} created across ${classes.length} classes`);
  console.log(`  Attendance: ${jobs.length} records across ${students.length} students, ${weekdays.length} school days each`);
}

run().catch((err) => {
  console.error('Activity seed failed:', err);
  process.exit(1);
});
