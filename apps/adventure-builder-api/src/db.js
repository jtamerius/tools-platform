const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand,
  DeleteCommand, UpdateCommand,
} = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({});
const doc = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

const TABLE = process.env.TABLE_NAME;
const STORY_INDEX = 'storyId-index';

// ── Story helpers ────────────────────────────────────────────────────────────

function storyPK(userId) { return `USER#${userId}`; }
function storySK(storyId) { return `STORY#${storyId}`; }
function pagePK(storyId)  { return `STORY#${storyId}`; }
function pageSK(pageId)   { return `PAGE#${pageId}`; }

async function listStories(userId) {
  const r = await doc.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: { ':pk': storyPK(userId), ':prefix': 'STORY#' },
  }));
  return (r.Items || []).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

async function getStory(userId, storyId) {
  const r = await doc.send(new GetCommand({
    TableName: TABLE,
    Key: { PK: storyPK(userId), SK: storySK(storyId) },
  }));
  return r.Item || null;
}

async function putStory(item) {
  await doc.send(new PutCommand({ TableName: TABLE, Item: item }));
}

async function updateStory(userId, storyId, fields) {
  const sets = [];
  const vals = { ':u': new Date().toISOString() };
  const names = {};

  if (fields.title !== undefined)       { sets.push('#title = :title');       vals[':title']       = fields.title;       names['#title']       = 'title'; }
  if (fields.description !== undefined) { sets.push('description = :desc');   vals[':desc']        = fields.description; }
  if (fields.startPageId !== undefined) { sets.push('startPageId = :spid');   vals[':spid']        = fields.startPageId; }

  sets.push('updatedAt = :u');

  await doc.send(new UpdateCommand({
    TableName: TABLE,
    Key: { PK: storyPK(userId), SK: storySK(storyId) },
    UpdateExpression: `SET ${sets.join(', ')}`,
    ExpressionAttributeValues: vals,
    ...(Object.keys(names).length ? { ExpressionAttributeNames: names } : {}),
  }));
}

async function deleteStory(userId, storyId) {
  await doc.send(new DeleteCommand({
    TableName: TABLE,
    Key: { PK: storyPK(userId), SK: storySK(storyId) },
  }));
}

// ── Page helpers ─────────────────────────────────────────────────────────────

async function listPages(storyId) {
  const r = await doc.send(new QueryCommand({
    TableName: TABLE,
    IndexName: STORY_INDEX,
    KeyConditionExpression: 'storyId = :sid AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: { ':sid': storyId, ':prefix': 'PAGE#' },
  }));
  return r.Items || [];
}

async function getPage(storyId, pageId) {
  const r = await doc.send(new GetCommand({
    TableName: TABLE,
    Key: { PK: pagePK(storyId), SK: pageSK(pageId) },
  }));
  return r.Item || null;
}

async function putPage(item) {
  await doc.send(new PutCommand({ TableName: TABLE, Item: item }));
}

async function updatePage(storyId, pageId, fields) {
  const sets = [];
  const vals = { ':u': new Date().toISOString() };
  const names = {};

  if (fields.title !== undefined)   { sets.push('#title = :title'); vals[':title'] = fields.title; names['#title'] = 'title'; }
  if (fields.content !== undefined) { sets.push('content = :content'); vals[':content'] = fields.content; }
  if (fields.choices !== undefined) { sets.push('choices = :choices'); vals[':choices'] = fields.choices; }
  if (fields.isEnd !== undefined)   { sets.push('isEnd = :isEnd'); vals[':isEnd'] = fields.isEnd; }
  if (fields.position !== undefined){ sets.push('#pos = :pos'); vals[':pos'] = fields.position; names['#pos'] = 'position'; }

  sets.push('updatedAt = :u');

  await doc.send(new UpdateCommand({
    TableName: TABLE,
    Key: { PK: pagePK(storyId), SK: pageSK(pageId) },
    UpdateExpression: `SET ${sets.join(', ')}`,
    ExpressionAttributeValues: vals,
    ...(Object.keys(names).length ? { ExpressionAttributeNames: names } : {}),
  }));
}

async function deletePage(storyId, pageId) {
  await doc.send(new DeleteCommand({
    TableName: TABLE,
    Key: { PK: pagePK(storyId), SK: pageSK(pageId) },
  }));
}

// Remove references to a deleted page from choices on all other pages
async function cleanOrphanedChoices(storyId, deletedPageId) {
  const pages = await listPages(storyId);
  const affected = pages.filter(p =>
    p.id !== deletedPageId &&
    Array.isArray(p.choices) &&
    p.choices.some(c => c.targetPageId === deletedPageId)
  );
  await Promise.all(affected.map(p => {
    const cleaned = p.choices.filter(c => c.targetPageId !== deletedPageId);
    return updatePage(storyId, p.id, { choices: cleaned });
  }));
}

async function adjustPageCount(userId, storyId, delta, extraSets = {}) {
  const now = new Date().toISOString();
  const sets = ['updatedAt = :u'];
  const vals = { ':u': now, ':delta': delta };
  const names = {};

  if (extraSets.startPageId !== undefined) {
    if (extraSets.startPageId === null) {
      sets.push('startPageId = :null');
      vals[':null'] = null;
    } else {
      sets.push('startPageId = :spid');
      vals[':spid'] = extraSets.startPageId;
    }
  }

  await doc.send(new UpdateCommand({
    TableName: TABLE,
    Key: { PK: storyPK(userId), SK: storySK(storyId) },
    UpdateExpression: `ADD pageCount :delta SET ${sets.join(', ')}`,
    ExpressionAttributeValues: vals,
    ...(Object.keys(names).length ? { ExpressionAttributeNames: names } : {}),
  }));
}

module.exports = {
  listStories, getStory, putStory, updateStory, deleteStory,
  listPages, getPage, putPage, updatePage, deletePage, cleanOrphanedChoices,
  adjustPageCount,
};
