// Table naming: every table is suffixed with TABLE_ENV so local development
// (TABLE_ENV=dev) never touches the deployed data (TABLE_ENV=prod), even
// though both point at the same real AWS DynamoDB account.
const ENV = process.env.TABLE_ENV || 'dev';
const PREFIX = 'parentpulse';

function tableName(entity) {
  return `${PREFIX}_${entity}_${ENV}`;
}

const TABLES = {
  USERS: tableName('users'),
  CLASSES: tableName('classes'),
  SUBJECTS: tableName('subjects'),
  STUDENTS: tableName('students'),
  PARENT_STUDENT: tableName('parent_student'),
  ASSIGNMENTS: tableName('assignments'),
  ATTENDANCE: tableName('attendance'),
  ANNOUNCEMENTS: tableName('announcements'),
  NOTIFICATIONS: tableName('notifications')
};

// Definitions used only by db/init.js to create tables (CreateTableCommand).
// Every table is on-demand billing (PAY_PER_REQUEST) - no capacity to manage,
// appropriate for a course project's traffic.
const TABLE_DEFINITIONS = [
  {
    TableName: TABLES.USERS,
    KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
    AttributeDefinitions: [
      { AttributeName: 'id', AttributeType: 'S' },
      { AttributeName: 'email', AttributeType: 'S' }
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'email-index',
        KeySchema: [{ AttributeName: 'email', KeyType: 'HASH' }],
        Projection: { ProjectionType: 'ALL' }
      }
    ],
    BillingMode: 'PAY_PER_REQUEST'
  },
  {
    TableName: TABLES.CLASSES,
    KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
    AttributeDefinitions: [{ AttributeName: 'id', AttributeType: 'S' }],
    BillingMode: 'PAY_PER_REQUEST'
  },
  {
    TableName: TABLES.SUBJECTS,
    KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
    AttributeDefinitions: [
      { AttributeName: 'id', AttributeType: 'S' },
      { AttributeName: 'classId', AttributeType: 'S' }
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'class-index',
        KeySchema: [{ AttributeName: 'classId', KeyType: 'HASH' }],
        Projection: { ProjectionType: 'ALL' }
      }
    ],
    BillingMode: 'PAY_PER_REQUEST'
  },
  {
    TableName: TABLES.STUDENTS,
    KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
    AttributeDefinitions: [
      { AttributeName: 'id', AttributeType: 'S' },
      { AttributeName: 'classId', AttributeType: 'S' },
      { AttributeName: 'userId', AttributeType: 'S' }
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'class-index',
        KeySchema: [{ AttributeName: 'classId', KeyType: 'HASH' }],
        Projection: { ProjectionType: 'ALL' }
      },
      {
        IndexName: 'user-index',
        KeySchema: [{ AttributeName: 'userId', KeyType: 'HASH' }],
        Projection: { ProjectionType: 'ALL' }
      }
    ],
    BillingMode: 'PAY_PER_REQUEST'
  },
  {
    TableName: TABLES.PARENT_STUDENT,
    KeySchema: [
      { AttributeName: 'parentId', KeyType: 'HASH' },
      { AttributeName: 'studentId', KeyType: 'RANGE' }
    ],
    AttributeDefinitions: [
      { AttributeName: 'parentId', AttributeType: 'S' },
      { AttributeName: 'studentId', AttributeType: 'S' }
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'student-index',
        KeySchema: [{ AttributeName: 'studentId', KeyType: 'HASH' }],
        Projection: { ProjectionType: 'ALL' }
      }
    ],
    BillingMode: 'PAY_PER_REQUEST'
  },
  {
    TableName: TABLES.ASSIGNMENTS,
    KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
    AttributeDefinitions: [
      { AttributeName: 'id', AttributeType: 'S' },
      { AttributeName: 'classId', AttributeType: 'S' },
      { AttributeName: 'teacherId', AttributeType: 'S' }
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'class-index',
        KeySchema: [{ AttributeName: 'classId', KeyType: 'HASH' }],
        Projection: { ProjectionType: 'ALL' }
      },
      {
        IndexName: 'teacher-index',
        KeySchema: [{ AttributeName: 'teacherId', KeyType: 'HASH' }],
        Projection: { ProjectionType: 'ALL' }
      }
    ],
    BillingMode: 'PAY_PER_REQUEST'
  },
  {
    TableName: TABLES.ATTENDANCE,
    KeySchema: [
      { AttributeName: 'studentId', KeyType: 'HASH' },
      { AttributeName: 'date', KeyType: 'RANGE' }
    ],
    AttributeDefinitions: [
      { AttributeName: 'studentId', AttributeType: 'S' },
      { AttributeName: 'date', AttributeType: 'S' },
      { AttributeName: 'classId', AttributeType: 'S' }
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'class-date-index',
        KeySchema: [
          { AttributeName: 'classId', KeyType: 'HASH' },
          { AttributeName: 'date', KeyType: 'RANGE' }
        ],
        Projection: { ProjectionType: 'ALL' }
      }
    ],
    BillingMode: 'PAY_PER_REQUEST'
  },
  {
    TableName: TABLES.ANNOUNCEMENTS,
    KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
    AttributeDefinitions: [{ AttributeName: 'id', AttributeType: 'S' }],
    BillingMode: 'PAY_PER_REQUEST'
  },
  {
    TableName: TABLES.NOTIFICATIONS,
    KeySchema: [
      { AttributeName: 'userId', KeyType: 'HASH' },
      { AttributeName: 'sortKey', KeyType: 'RANGE' }
    ],
    AttributeDefinitions: [
      { AttributeName: 'userId', AttributeType: 'S' },
      { AttributeName: 'sortKey', AttributeType: 'S' }
    ],
    BillingMode: 'PAY_PER_REQUEST'
  }
];

module.exports = { TABLES, TABLE_DEFINITIONS, ENV };
