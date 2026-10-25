// Demo positions for the location-sharing feature: gives roughly 80% of the
// students who have a linked parent a "shared" position within a few km of a
// school in Vellore, and marks the rest as not sharing, so parent dashboards
// show both states. Items are tagged source: 'demo'. Real updates from a
// student's device overwrite their demo row. Safe to re-run.
require('dotenv').config();
const { PutCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const { doc } = require('./dynamo');
const { TABLES, ENV } = require('./tables');

const SCHOOL = { lat: 12.9692, lng: 79.1559 };
const RADIUS_KM = 4;
const SHARING_RATIO = 0.8;
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
  const items = studentIds.map((studentId) => {
    const minutesAgo = Math.floor(random() * 50);
    const updatedAt = new Date(now - minutesAgo * 60 * 1000).toISOString();
    if (random() > SHARING_RATIO) return { studentId, sharing: false, updatedAt, source: 'demo' };
    const distanceKm = RADIUS_KM * Math.sqrt(random());
    const angle = random() * 2 * Math.PI;
    return {
      studentId,
      sharing: true,
      lat: Math.round((SCHOOL.lat + (distanceKm / 111) * Math.cos(angle)) * 1e6) / 1e6,
      lng: Math.round((SCHOOL.lng + (distanceKm / (111 * Math.cos(SCHOOL.lat * Math.PI / 180))) * Math.sin(angle)) * 1e6) / 1e6,
      accuracy: 10 + Math.floor(random() * 60),
      updatedAt,
      source: 'demo'
    };
  });

  for (let i = 0; i < items.length; i += CONCURRENCY) {
    await Promise.all(items.slice(i, i + CONCURRENCY).map((Item) => doc.send(new PutCommand({ TableName: TABLES.LOCATIONS, Item }))));
  }
  const sharing = items.filter((i) => i.sharing).length;
  console.log(`Demo locations: ${sharing} sharing, ${items.length - sharing} not sharing.`);
}

run().catch((err) => {
  console.error('Location seed failed:', err);
  process.exit(1);
});
