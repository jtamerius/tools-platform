const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, ScanCommand, DeleteCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({});
const doc = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

const TABLES = {
  accounts: process.env.ACCOUNTS_TABLE,
  payments: process.env.PAYMENTS_TABLE,
  cellOverrides: process.env.CELL_OVERRIDES_TABLE,
  userEmails: process.env.USER_EMAILS_TABLE,
};

const pk = (userId, accountNumber) => `${userId}#${accountNumber}`;

async function listAccounts(userId) {
  const r = await doc.send(new QueryCommand({
    TableName: TABLES.accounts,
    KeyConditionExpression: 'userId = :u',
    ExpressionAttributeValues: { ':u': userId },
  }));
  return r.Items || [];
}

async function getAccount(userId, accountNumber) {
  const r = await doc.send(new GetCommand({
    TableName: TABLES.accounts,
    Key: { userId, accountNumber },
  }));
  return r.Item || null;
}

async function putAccount(item) {
  await doc.send(new PutCommand({
    TableName: TABLES.accounts,
    Item: item,
  }));
}

async function updateAccountClosed(userId, accountNumber, closed) {
  await doc.send(new UpdateCommand({
    TableName: TABLES.accounts,
    Key: { userId, accountNumber },
    UpdateExpression: 'SET is_closed_override = :c, updated_at = :u',
    ExpressionAttributeValues: {
      ':c': closed,
      ':u': new Date().toISOString(),
    },
  }));
}

async function deleteAccountClosedOverride(userId, accountNumber) {
  await doc.send(new UpdateCommand({
    TableName: TABLES.accounts,
    Key: { userId, accountNumber },
    UpdateExpression: 'REMOVE is_closed_override',
  }));
}

async function listPayments(userId, accountNumber) {
  const r = await doc.send(new QueryCommand({
    TableName: TABLES.payments,
    KeyConditionExpression: 'acctKey = :k',
    ExpressionAttributeValues: { ':k': pk(userId, accountNumber) },
  }));
  return r.Items || [];
}

async function listAllPayments(userId) {
  // Query all accounts, then scatter. Keep it simple: scan filtered.
  // For scale, add GSI userId→everything. For now use FilterExpression on userId prefix.
  const r = await doc.send(new ScanCommand({
    TableName: TABLES.payments,
    FilterExpression: 'begins_with(acctKey, :u)',
    ExpressionAttributeValues: { ':u': `${userId}#` },
  }));
  return r.Items || [];
}

async function putPayment(item) {
  await doc.send(new PutCommand({
    TableName: TABLES.payments,
    Item: item,
  }));
}

async function listCellOverrides(userId, accountNumber) {
  const r = await doc.send(new QueryCommand({
    TableName: TABLES.cellOverrides,
    KeyConditionExpression: 'acctKey = :k',
    ExpressionAttributeValues: { ':k': pk(userId, accountNumber) },
  }));
  return r.Items || [];
}

async function listAllCellOverrides(userId) {
  const r = await doc.send(new ScanCommand({
    TableName: TABLES.cellOverrides,
    FilterExpression: 'begins_with(acctKey, :u)',
    ExpressionAttributeValues: { ':u': `${userId}#` },
  }));
  return r.Items || [];
}

async function putCellOverride(item) {
  await doc.send(new PutCommand({
    TableName: TABLES.cellOverrides,
    Item: item,
  }));
}

async function deleteCellOverride(userId, accountNumber, yearMonth) {
  await doc.send(new DeleteCommand({
    TableName: TABLES.cellOverrides,
    Key: { acctKey: pk(userId, accountNumber), yearMonth },
  }));
}

async function getUserEmail(userId) {
  const r = await doc.send(new QueryCommand({
    TableName: TABLES.userEmails,
    IndexName: 'byUserId',
    KeyConditionExpression: 'userId = :u',
    ExpressionAttributeValues: { ':u': userId },
    Limit: 1,
  }));
  return (r.Items && r.Items[0]) || null;
}

async function putUserEmail(localPart, userId) {
  await doc.send(new PutCommand({
    TableName: TABLES.userEmails,
    Item: { localPart, userId, created_at: new Date().toISOString() },
    ConditionExpression: 'attribute_not_exists(localPart)',
  }));
}

module.exports = {
  TABLES,
  pk,
  listAccounts,
  getAccount,
  putAccount,
  updateAccountClosed,
  deleteAccountClosedOverride,
  listPayments,
  listAllPayments,
  putPayment,
  listCellOverrides,
  listAllCellOverrides,
  putCellOverride,
  deleteCellOverride,
  getUserEmail,
  putUserEmail,
};
