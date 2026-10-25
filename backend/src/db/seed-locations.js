// Demo positions for the location-sharing feature: gives roughly 90% of the
// students who have a linked parent a last known position within a few km of
// a school in Vellore, last updated between a few minutes and two days ago;
// the rest have never shared. Items are tagged source: 'demo'. Real updates
// from a student's device overwrite their demo row. Safe to re-run.
require('dotenv').config();
const { PutCommand, ScanCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const { doc } = require('./dynamo');
const { TABLES, ENV } = require('./tables');

const SCHOOL = { lat: 12.9692, lng: 79.1559 };
const RADIUS_KM = 4;
const HAS_LOCATION_RATIO = 0.9;
const MAX_AGE_MINUTES = 2 * 24 * 60;
const CONCURRENCY = 20;

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

async function run() {
  console.log(`Seeding demo locations into TABLE_ENV=${ENV}...`);
  const random = rng(7);
  const links = await scanAll({ TableName: TABLES.PARENT_STUDENT });
  const studentIds = [...new Set(links.map((l) => l.studentId))].sort();

  const now = Date.now();
  const stale = [];
  const items = studentIds.map((studentId) => {
    // Skewed towards recent: most children were seen within the last few hours.
    const minutesAgo = 5 + Math.floor(random() ** 3 * MAX_AGE_MINUTES);
    const updatedAt = new Date(now - minutesAgo * 60 * 1000).toISOString();
    if (random() > HAS_LOCATION_RATIO) {
      stale.push(studentId);
      return null;
    }
    const distanceKm = RADIUS_KM * Math.sqrt(random());
    const angle = random() * 2 * Math.PI;
    return {
      studentId,
      sharing: false,
      lat: Math.round((SCHOOL.lat + (distanceKm / 111) * Math.cos(angle)) * 1e6) / 1e6,
      lng: Math.round((SCHOOL.lng + (distanceKm / (111 * Math.cos(SCHOOL.lat * Math.PI / 180))) * Math.sin(angle)) * 1e6) / 1e6,
      accuracy: 10 + Math.floor(random() * 60),
      updatedAt,
      source: 'demo'
    };
  });

  const rows = items.filter(Boolean);
  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    await Promise.all(rows.slice(i, i + CONCURRENCY).map((Item) => doc.send(new PutCommand({ TableName: TABLES.LOCATIONS, Item }))));
  }
  // Students left without a location should have no demo row from an earlier run.
  for (let i = 0; i < stale.length; i += CONCURRENCY) {
    await Promise.all(stale.slice(i, i + CONCURRENCY).map((studentId) => doc.send(new DeleteCommand({ TableName: TABLES.LOCATIONS, Key: { studentId } }))));
  }
  console.log(`Demo locations: ${rows.length} with a last known location, ${stale.length} never shared.`);
}

run().catch((err) => {
  console.error('Location seed failed:', err);
  process.exit(1);
});
