import { createUserPool, getIdTokenJwt } from '@tools/auth';

const BASE = (import.meta.env.VITE_API_URL ?? 'http://localhost:3001').replace(/\/$/, '') + '/api';

const USER_POOL_ID = import.meta.env.VITE_COGNITO_USER_POOL_ID ?? '';
const CLIENT_ID = import.meta.env.VITE_COGNITO_CLIENT_ID ?? '';
let poolRef = null;
function getPool() {
  if (!poolRef && USER_POOL_ID && CLIENT_ID) {
    poolRef = createUserPool(USER_POOL_ID, CLIENT_ID);
  }
  return poolRef;
}

async function authHeaders() {
  const pool = getPool();
  if (!pool) return {};
  const jwt = await getIdTokenJwt(pool);
  return jwt ? { Authorization: `Bearer ${jwt}` } : {};
}

async function request(path, { method = 'GET', body } = {}) {
  const auth = await authHeaders();
  const init = {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...auth,
    },
  };
  if (body) init.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, init);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Server returned ${res.status}${text ? `: ${text}` : ''}`);
  }
  return res.json();
}

// Stories
export const fetchStories = () => request('/stories');
export const createStory = (title, description = '') => request('/stories', { method: 'POST', body: { title, description } });
export const fetchStory = (id) => request(`/stories/${id}`);
export const updateStory = (id, updates) => request(`/stories/${id}`, { method: 'PUT', body: updates });
export const deleteStory = (id) => request(`/stories/${id}`, { method: 'DELETE' });

// Pages
export const createPage = (storyId, data) => request(`/stories/${storyId}/pages`, { method: 'POST', body: data });
export const updatePage = (storyId, pageId, updates) => request(`/stories/${storyId}/pages/${pageId}`, { method: 'PUT', body: updates });
export const deletePage = (storyId, pageId) => request(`/stories/${storyId}/pages/${pageId}`, { method: 'DELETE' });

// AI Assist
export const requestAssist = (storyContext, prompt) => request('/assist', { method: 'POST', body: { storyContext, prompt } });
