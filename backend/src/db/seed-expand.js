// Expands the bulk demo data (run after seed.js and seed-bulk.js):
//   1. Adds students 101-200 (student101@parentpulse.local .. / Student<N>@123),
//      each placed in whichever class currently has the fewest students.
//   2. Rebuilds every parent-child link so each parent has 1-4 children, drawn
//      at random from all students. Children take their parent's surname so
//      siblings match. Students not picked for a family have no linked parent.
// Deterministic (seeded RNG) and safe to re-run: existing accounts are reused
// and the family plan comes out the same each time.
require('dotenv').config();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { PutCommand, UpdateCommand, ScanCommand, QueryCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const { doc } = require('./dynamo');
const { TABLES, ENV } = require('./tables');

const FIRST_NEW_STUDENT = 101;
const LAST_NEW_STUDENT = 200;
const MIN_CHILDREN = 1;
const MAX_CHILDREN = 4;
const CONCURRENCY = 10;
const SEED = 20261026;

const FIRST_NAMES = [
  'Aarav', 'Diya', 'Vihaan', 'Ananya', 'Arjun', 'Isha', 'Kabir', 'Meera', 'Rohan', 'Saanvi',
  'Zara', 'Ethan', 'Maya', 'Leo', 'Nora', 'Ryan', 'Hannah', 'Kai', 'Layla', 'Adam',
  'Aisha', 'Omar', 'Priya', 'Dev', 'Tara', 'Nikhil', 'Sara', 'Yusuf', 'Ira', 'Max',
  'Ruby', 'Theo', 'Anika', 'Felix', 'Naomi', 'Jonah', 'Elena', 'Arya', 'Hugo', 'Leah'
];
const LAST_NAMES = [
  'Sharma', 'Patel', 'Reddy', 'Iyer', 'Kapoor', 'Mehta', 'Nair', 'Gupta', 'Khan', 'Das',
  'Fernandes', 'Rao', 'Bose', 'Singh', 'Joshi', 'Chopra', 'Menon', 'Verma', 'Pillai', 'Shah'
];

// mulberry32: tiny seeded PRNG so re-runs produce the same plan.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(items, random) {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function scanAll(params) {
  const items = [];
  let ExclusiveStartKey;
  do {
    const page = await doc.send(new ScanCommand({ ...params, ExclusiveStartKey }));
    items.push(...(page.Items || []));
    ExclusiveStartKey = page.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

async function inBatches(items, size, worker) {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(worker));
  }
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

// Sort key that orders parent@ first, then parent1, parent2, ... numerically.
function parentOrder(email) {
  const m = email.match(/^parent(\d*)@/);
  return m ? Number(m[1] || 0) : Number.MAX_SAFE_INTEGER;
}

async function addStudents() {
  const classes = await scanAll({ TableName: TABLES.CLASSES });
  if (classes.length === 0) throw new Error('No classes found - run seed.js and seed-bulk.js first.');
  const students = await scanAll({ TableName: TABLES.STUDENTS });

  const count = Object.fromEntries(classes.map((c) => [c.id, 0]));
  const maxRoll = Object.fromEntries(classes.map((c) => [c.id, 0]));
  for (const s of students) {
    if (!(s.classId in count)) continue;
    count[s.classId]++;
    const n = Number(String(s.rollNumber || '').replace(/\D/g, '')) || 0;
    maxRoll[s.classId] = Math.max(maxRoll[s.classId], n);
  }

  // Plan placements up front (sequentially) so concurrent writes stay balanced.
  const jobs = [];
  for (let num = FIRST_NEW_STUDENT; num <= LAST_NEW_STUDENT; num++) {
    const target = classes.reduce((best, c) => (count[c.id] < count[best.id] ? c : best), classes[0]);
    count[target.id]++;
    maxRoll[target.id]++;
    jobs.push({ num, classId: target.id, rollNumber: `R-${String(maxRoll[target.id]).padStart(3, '0')}` });
  }

  let created = 0;
  await inBatches(jobs, CONCURRENCY, async (job) => {
    const email = `student${job.num}@parentpulse.local`;
    let user = await findUserByEmail(email);
    if (!user) {
      const now = new Date().toISOString();
      user = {
        id: crypto.randomUUID(),
        email,
        passwordHash: await bcrypt.hash(`Student${job.num}@123`, 10),
        role: 'student',
        firstName: FIRST_NAMES[(job.num * 7) % FIRST_NAMES.length],
        lastName: LAST_NAMES[(job.num * 3) % LAST_NAMES.length],
        status: 'active',
        tokenVersion: 0,
        createdAt: now,
        updatedAt: now
      };
      await doc.send(new PutCommand({ TableName: TABLES.USERS, Item: user }));
    }
    const existing = await doc.send(new QueryCommand({
      TableName: TABLES.STUDENTS, IndexName: 'user-index',
      KeyConditionExpression: 'userId = :u', ExpressionAttributeValues: { ':u': user.id }
    }));
    if (!existing.Items?.length) {
      await doc.send(new PutCommand({
        TableName: TABLES.STUDENTS,
        Item: {
          id: crypto.randomUUID(), userId: user.id, classId: job.classId, rollNumber: job.rollNumber,
          dateOfBirth: null, createdAt: new Date().toISOString()
        }
      }));
      created++;
    }
  });

  const names = Object.fromEntries(classes.map((c) => [c.id, c.name]));
  console.log(`Students: ${created} new (student${FIRST_NEW_STUDENT}..student${LAST_NEW_STUDENT}). Class sizes now:`);
  for (const c of classes.sort((a, b) => a.name.localeCompare(b.name))) console.log(`  ${names[c.id]}: ${count[c.id]}`);
}

async function rebuildFamilies() {
  const random = rng(SEED);
  const users = await scanAll({ TableName: TABLES.USERS });
  const userById = Object.fromEntries(users.map((u) => [u.id, u]));
  const parents = users.filter((u) => u.role === 'parent').sort((a, b) => parentOrder(a.email) - parentOrder(b.email));
  const students = (await scanAll({ TableName: TABLES.STUDENTS })).filter((s) => userById[s.userId]);
  students.sort((a, b) => userById[a.userId].email.localeCompare(userById[b.userId].email));

  // Keep the original demo pair (parent@ -> student@) together.
  const demoStudent = students.find((s) => userById[s.userId].email === 'student@parentpulse.local');
  let pool = shuffle(students.filter((s) => s !== demoStudent), random);

  const plan = [];
  for (const parent of parents) {
    const want = MIN_CHILDREN + Math.floor(random() * (MAX_CHILDREN - MIN_CHILDREN + 1));
    const children = [];
    if (parent.email === 'parent@parentpulse.local' && demoStudent) children.push(demoStudent);
    while (children.length < want && pool.length > 0) children.push(pool.shift());
    if (children.length === 0) throw new Error('Ran out of students to assign - add more students or lower MAX_CHILDREN.');
    plan.push({ parent, children });
  }

  console.log('Removing existing parent-child links...');
  const oldLinks = await scanAll({ TableName: TABLES.PARENT_STUDENT });
  await inBatches(oldLinks, CONCURRENCY, (l) => doc.send(new DeleteCommand({
    TableName: TABLES.PARENT_STUDENT, Key: { parentId: l.parentId, studentId: l.studentId }
  })));

  console.log('Creating new families...');
  const links = plan.flatMap(({ parent, children }) => children.map((child) => ({ parent, child })));
  await inBatches(links, CONCURRENCY, async ({ parent, child }) => {
    await doc.send(new PutCommand({
      TableName: TABLES.PARENT_STUDENT,
      Item: { parentId: parent.id, studentId: child.id, relationship: 'guardian' }
    }));
    const childUser = userById[child.userId];
    if (childUser.lastName !== parent.lastName) {
      await doc.send(new UpdateCommand({
        TableName: TABLES.USERS,
        Key: { id: childUser.id },
        UpdateExpression: 'SET lastName = :l, updatedAt = :u',
        ExpressionAttributeValues: { ':l': parent.lastName, ':u': new Date().toISOString() }
      }));
    }
  });

  const histogram = { 1: 0, 2: 0, 3: 0, 4: 0 };
  plan.forEach((p) => { histogram[p.children.length]++; });
  console.log(`Families: ${plan.length} parents linked to ${links.length} children; ${students.length - links.length} students have no linked parent.`);
  console.log(`  Parents with 1/2/3/4 children: ${histogram[1]}/${histogram[2]}/${histogram[3]}/${histogram[4]}`);
}

async function run() {
  console.log(`Expanding demo data in TABLE_ENV=${ENV}...`);
  await addStudents();
  await rebuildFamilies();
  console.log('Expand seed complete. Run seed-activity.js next to give the new students attendance records.');
}

run().catch((err) => {
  console.error('Expand seed failed:', err);
  process.exit(1);
});
