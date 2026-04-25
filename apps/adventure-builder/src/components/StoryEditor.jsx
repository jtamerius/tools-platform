import { useState, useEffect, useCallback } from 'react';
import { fetchStory, createPage, updatePage, deletePage, updateStory } from '../services/api';
import PageEditor from './PageEditor';
import StoryMap from './StoryMap';
import AIAssistant from './AIAssistant';
import './StoryEditor.css';

export default function StoryEditor({ storyId, onBack }) {
  const [story, setStory] = useState(null);
  const [selectedPageId, setSelectedPageId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLoading(true);
    fetchStory(storyId)
      .then(data => {
        setStory(data);
        setSelectedPageId(data.startPageId ?? data.pages?.[0]?.id ?? null);
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [storyId]);

  const selectedPage = story?.pages?.find(p => p.id === selectedPageId) ?? null;

  const handlePageSave = useCallback(async (pageId, updates) => {
    try {
      await updatePage(storyId, pageId, updates);
      setStory(prev => ({
        ...prev,
        pages: prev.pages.map(p => p.id === pageId ? { ...p, ...updates } : p),
      }));
    } catch (err) {
      console.error('Page save failed:', err);
    }
  }, [storyId]);

  const handleCreatePage = useCallback(async () => {
    try {
      const page = await createPage(storyId, { title: 'New Page' });
      setStory(prev => ({
        ...prev,
        startPageId: prev.startPageId ?? page.id,
        pageCount: (prev.pageCount ?? 0) + 1,
        pages: [...prev.pages, page],
      }));
      setSelectedPageId(page.id);
    } catch (err) {
      setError(err.message);
    }
  }, [storyId]);

  const handleDeletePage = useCallback(async () => {
    if (!selectedPageId) return;
    try {
      await deletePage(storyId, selectedPageId);
      setStory(prev => {
        const remaining = prev.pages.filter(p => p.id !== selectedPageId);
        const newStart = prev.startPageId === selectedPageId
          ? (remaining[0]?.id ?? null)
          : prev.startPageId;
        return {
          ...prev,
          startPageId: newStart,
          pageCount: Math.max(0, (prev.pageCount ?? 1) - 1),
          pages: remaining,
        };
      });
      setSelectedPageId(prev => {
        const remaining = story?.pages?.filter(p => p.id !== prev) ?? [];
        return remaining[0]?.id ?? null;
      });
    } catch (err) {
      setError(err.message);
    }
  }, [storyId, selectedPageId, story?.pages]);

  if (loading) return <div className="se-loading">Loading story…</div>;
  if (error) return <div className="se-error">{error}</div>;
  if (!story) return null;

  return (
    <div className="se-root">
      <header className="se-header">
        <button className="se-back" onClick={onBack}>← Stories</button>
        <h2 className="se-title">{story.title}</h2>
        <span className="se-meta">{story.pages?.length ?? 0} pages</span>
      </header>

      <div className="se-body">
        <aside className="se-editor-col">
          <PageEditor
            page={selectedPage}
            allPages={story.pages ?? []}
            onSave={(updates) => handlePageSave(selectedPageId, updates)}
            onDelete={handleDeletePage}
          />
        </aside>

        <main className="se-map-col">
          <StoryMap
            pages={story.pages ?? []}
            selectedPageId={selectedPageId}
            startPageId={story.startPageId}
            onSelectPage={setSelectedPageId}
            onPageSave={handlePageSave}
            onCreatePage={handleCreatePage}
          />
        </main>

        <aside className="se-ai-col">
          <AIAssistant currentPage={selectedPage} story={story} />
        </aside>
      </div>
    </div>
  );
}
