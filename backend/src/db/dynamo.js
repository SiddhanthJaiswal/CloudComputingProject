const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');

// Credentials come from the standard AWS SDK chain: on EC2 this is the attached
// IAM instance role (no keys needed); locally it's the AWS_PROFILE env var
// pointing at a profile in ~/.aws/credentials.
const client = new DynamoDBClient({ region: process.env.AWS_REGION || 'ap-south-1' });

const doc = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true }
});

module.exports = { client, doc };
