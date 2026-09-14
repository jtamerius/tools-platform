import { useState, useEffect } from 'react';
import { fetchStories, createStory, deleteStory } from '../services/api';
import './StoryList.css';

export default function StoryList({ onOpenStory, onReadStory, user, onSignOut }) {
  const [stories, setStories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchStories()
      .then(setStories)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    setSaving(true);
    try {
      const story = await createStory(newTitle.trim(), newDesc.trim());
      setStories(prev => [story, ...prev]);
      setNewTitle('');
      setNewDesc('');
      setCreating(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      await deleteStory(id);
      setStories(prev => prev.filter(s => s.id !== id));
      setConfirmDelete(null);
    } catch (err) {
      setError(err.message);
    }
  };

  if (loading) return <div className="sl-loading">Loading stories…</div>;

  return (
    <div className="sl-root">
      <header className="sl-header">
        <div className="sl-title-row">
          <h1>Adventure Builder</h1>
          <button className="sl-signout" onClick={onSignOut}>{user?.email}</button>
        </div>
        <button className="sl-new-btn" onClick={() => setCreating(c => !c)}>
          {creating ? 'Cancel' : '+ New Story'}
        </button>
      </header>

      {creating && (
        <form className="sl-create-form" onSubmit={handleCreate}>
          <input
            autoFocus
            type="text"
            placeholder="Story title"
            value={newTitle}
            onChange={e => setNewTitle(e.target.value)}
            maxLength={200}
            required
          />
          <input
            type="text"
            placeholder="Short description (optional)"
            value={newDesc}
            onChange={e => setNewDesc(e.target.value)}
            maxLength={1000}
          />
          <button type="submit" disabled={saving || !newTitle.trim()}>
            {saving ? 'Creating…' : 'Create Story'}
          </button>
        </form>
      )}

      {error && <p className="sl-error">{error}</p>}

      {stories.length === 0 && !creating && (
        <p className="sl-empty">No stories yet. Create one to get started.</p>
      )}

      <ul className="sl-list">
        {stories.map(story => (
          <li key={story.id} className="sl-card">
            <button className="sl-card-body" onClick={() => onOpenStory(story.id)}>
              <span className="sl-card-title">{story.title}</span>
              {story.description && <span className="sl-card-desc">{story.description}</span>}
              <span className="sl-card-meta">{story.pageCount ?? 0} pages · {new Date(story.updatedAt).toLocaleDateString()}</span>
            </button>
            <div className="sl-card-actions">
              <button className="sl-read-btn" onClick={() => onReadStory(story.id)}>Read</button>
              {confirmDelete === story.id ? (
                <>
                  <button className="sl-del-confirm" onClick={() => handleDelete(story.id)}>Sure?</button>
                  <button className="sl-del-cancel" onClick={() => setConfirmDelete(null)}>Cancel</button>
                </>
              ) : (
                <button className="sl-del-btn" onClick={() => setConfirmDelete(story.id)}>Delete</button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
