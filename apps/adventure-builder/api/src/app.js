const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { getCurrentInvoke } = require('@vendia/serverless-express');
const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');
const {
  listStories, getStory, putStory, updateStory, deleteStory,
  listPages, getPage, putPage, updatePage, deletePage,
  cleanOrphanedChoices, adjustPageCount,
} = require('./db');

const bedrock = new BedrockRuntimeClient({ region: process.env.BEDROCK_REGION || 'us-east-1' });
const BEDROCK_MODEL = process.env.BEDROCK_MODEL_ID || 'amazon.nova-lite-v1:0';

const app = express();
const _originsEnv = process.env.ALLOWED_ORIGINS || '*';
app.use(cors({ origin: _originsEnv === '*' ? '*' : _originsEnv.split(',') }));
app.use(express.json({ limit: '1mb' }));

app.get(['/health', '/api/health'], (_req, res) => res.json({ ok: true }));

// ── Auth middleware ──────────────────────────────────────────────────────────
app.use((req, res, next) => {
  const { event } = getCurrentInvoke();
  const ctx = event?.requestContext;
  const claims = ctx?.authorizer?.jwt?.claims || ctx?.authorizer?.claims || null;
  if (claims?.sub) {
    req.userId = claims.sub;
    return next();
  }
  return res.status(401).json({ error: 'Unauthenticated' });
});

// ── Stories ──────────────────────────────────────────────────────────────────

app.get('/api/stories', async (req, res) => {
  try {
    res.json(await listStories(req.userId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/stories', async (req, res) => {
  try {
    const { title, description = '' } = req.body || {};
    if (!title || typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({ error: 'title is required' });
    }
    const storyId = crypto.randomUUID();
    const now = new Date().toISOString();
    const item = {
      PK: `USER#${req.userId}`,
      SK: `STORY#${storyId}`,
      id: storyId,
      userId: req.userId,
      title: title.trim().slice(0, 200),
      description: String(description).slice(0, 1000),
      startPageId: null,
      pageCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    await putStory(item);
    res.status(201).json(item);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/stories/:id', async (req, res) => {
  try {
    const story = await getStory(req.userId, req.params.id);
    if (!story) return res.status(404).json({ error: 'Not found' });
    const pages = await listPages(req.params.id);
    res.json({ ...story, pages });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/stories/:id', async (req, res) => {
  try {
    const story = await getStory(req.userId, req.params.id);
    if (!story) return res.status(404).json({ error: 'Not found' });
    const { title, description, startPageId } = req.body || {};
    await updateStory(req.userId, req.params.id, { title, description, startPageId });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/stories/:id', async (req, res) => {
  try {
    const story = await getStory(req.userId, req.params.id);
    if (!story) return res.status(404).json({ error: 'Not found' });
    const pages = await listPages(req.params.id);
    await Promise.all(pages.map(p => deletePage(req.params.id, p.id)));
    await deleteStory(req.userId, req.params.id);
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Pages ────────────────────────────────────────────────────────────────────

app.post('/api/stories/:id/pages', async (req, res) => {
  try {
    const story = await getStory(req.userId, req.params.id);
    if (!story) return res.status(404).json({ error: 'Not found' });

    const { title = 'New Page', content = '', choices = [], isEnd = false, position } = req.body || {};
    const pageId = crypto.randomUUID();
    const now = new Date().toISOString();
    const isFirstPage = !story.startPageId;

    const item = {
      PK: `STORY#${req.params.id}`,
      SK: `PAGE#${pageId}`,
      id: pageId,
      storyId: req.params.id,
      title: String(title).trim().slice(0, 200),
      content: String(content),
      choices: Array.isArray(choices) ? choices : [],
      isEnd: Boolean(isEnd),
      position: position ?? { x: 100 + Math.round(Math.random() * 400), y: 100 + Math.round(Math.random() * 300) },
      createdAt: now,
      updatedAt: now,
    };

    await putPage(item);
    await adjustPageCount(req.userId, req.params.id, 1, isFirstPage ? { startPageId: pageId } : {});

    res.status(201).json(item);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/stories/:id/pages/:pageId', async (req, res) => {
  try {
    const story = await getStory(req.userId, req.params.id);
    if (!story) return res.status(404).json({ error: 'Not found' });
    const page = await getPage(req.params.id, req.params.pageId);
    if (!page) return res.status(404).json({ error: 'Page not found' });

    const { title, content, choices, isEnd, position } = req.body || {};
    await updatePage(req.params.id, req.params.pageId, { title, content, choices, isEnd, position });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/stories/:id/pages/:pageId', async (req, res) => {
  try {
    const story = await getStory(req.userId, req.params.id);
    if (!story) return res.status(404).json({ error: 'Not found' });
    const page = await getPage(req.params.id, req.params.pageId);
    if (!page) return res.status(404).json({ error: 'Page not found' });

    await deletePage(req.params.id, req.params.pageId);
    await cleanOrphanedChoices(req.params.id, req.params.pageId);

    const wasStart = story.startPageId === req.params.pageId;
    await adjustPageCount(req.userId, req.params.id, -1, wasStart ? { startPageId: null } : {});

    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── AI Assist ────────────────────────────────────────────────────────────────

app.post('/api/assist', async (req, res) => {
  try {
    const { storyContext = '', prompt = '' } = req.body || {};
    if (!prompt.trim()) return res.status(400).json({ error: 'prompt is required' });
    if (prompt.length > 2000) return res.status(400).json({ error: 'prompt too long' });
    if (storyContext.length > 8000) return res.status(400).json({ error: 'storyContext too long' });

    const userMessage = storyContext
      ? `Story context:\n${storyContext}\n\nRequest: ${prompt}`
      : prompt;

    const body = JSON.stringify({
      messages: [{ role: 'user', content: userMessage }],
      system: [{ text: 'You are a creative writing assistant helping a user write an interactive choose-your-own-adventure story. Be concise, imaginative, and match the tone of the existing content.' }],
      inferenceConfig: { max_new_tokens: 1024, temperature: 0.8, top_p: 0.9 },
    });

    const response = await bedrock.send(new InvokeModelCommand({
      modelId: BEDROCK_MODEL,
      contentType: 'application/json',
      accept: 'application/json',
      body,
    }));

    const parsed = JSON.parse(Buffer.from(response.body).toString('utf-8'));
    const suggestion = parsed?.output?.message?.content?.[0]?.text ?? '';
    res.json({ suggestion });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = app;
