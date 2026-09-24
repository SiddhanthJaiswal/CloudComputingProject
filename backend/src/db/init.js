require('dotenv').config();
const { CreateTableCommand, DescribeTableCommand, waitUntilTableExists } = require('@aws-sdk/client-dynamodb');
const { client } = require('./dynamo');
const { TABLE_DEFINITIONS, ENV } = require('./tables');

async function tableExists(tableName) {
  try {
    await client.send(new DescribeTableCommand({ TableName: tableName }));
    return true;
  } catch (err) {
    if (err.name === 'ResourceNotFoundException') return false;
    throw err;
  }
}

async function init() {
  console.log(`Creating DynamoDB tables for TABLE_ENV=${ENV} in region ${process.env.AWS_REGION || 'ap-south-1'}...`);

  for (const def of TABLE_DEFINITIONS) {
    const exists = await tableExists(def.TableName);
    if (exists) {
      console.log(`  already exists: ${def.TableName}`);
      continue;
    }
    console.log(`  creating: ${def.TableName}`);
    await client.send(new CreateTableCommand(def));
    await waitUntilTableExists({ client, maxWaitTime: 120 }, { TableName: def.TableName });
    console.log(`  active: ${def.TableName}`);
  }

  console.log('All tables ready.');
}

init().catch((err) => {
  console.error('Failed to initialize tables:', err.message);
  process.exit(1);
});
