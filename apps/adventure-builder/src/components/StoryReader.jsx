import { useState, useEffect } from 'react';
import { fetchStory } from '../services/api';
import './StoryReader.css';

export default function StoryReader({ storyId, onBack }) {
  const [story, setStory] = useState(null);
  const [currentPageId, setCurrentPageId] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchStory(storyId)
      .then(data => {
        setStory(data);
        setCurrentPageId(data.startPageId ?? data.pages?.[0]?.id ?? null);
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [storyId]);

  const currentPage = story?.pages?.find(p => p.id === currentPageId) ?? null;
  const linkedChoices = currentPage?.choices?.filter(c => c.targetPageId !== null) ?? [];

  const handleChoice = (targetPageId) => {
    setHistory(prev => [...prev, currentPageId]);
    setCurrentPageId(targetPageId);
  };

  const handleBack = () => {
    setHistory(prev => {
      const next = [...prev];
      setCurrentPageId(next.pop());
      return next;
    });
  };

  const handleRestart = () => {
    setHistory([]);
    setCurrentPageId(story.startPageId ?? story.pages?.[0]?.id ?? null);
  };

  if (loading) return <div className="sr-root"><p className="sr-status">Loading…</p></div>;
  if (error)   return <div className="sr-root"><p className="sr-status sr-error">{error}</p></div>;
  if (!story)  return null;

  return (
    <div className="sr-root">
      <div className="sr-topbar">
        <button className="sr-back-btn" onClick={onBack}>← Back</button>
        <span className="sr-story-title">{story.title}</span>
        {history.length > 0 && (
          <button className="sr-undo-btn" onClick={handleBack}>↩ Previous page</button>
        )}
      </div>

      <div className="sr-scroll">
        <div className="sr-card">
          {!currentPage && (
            <p className="sr-status">This story has no starting page yet.</p>
          )}

          {currentPage && (
            <>
              <h2 className="sr-page-title">{currentPage.title}</h2>
              <div className="sr-content">
                {currentPage.content
                  ? currentPage.content.split('\n').map((line, i) =>
                      line.trim() ? <p key={i}>{line}</p> : <br key={i} />
                    )
                  : <p className="sr-empty-content">(No content on this page yet.)</p>
                }
              </div>

              {currentPage.isEnd ? (
                <div className="sr-end">
                  <p className="sr-end-banner">— The End —</p>
                  <div className="sr-end-actions">
                    <button className="sr-restart-btn" onClick={handleRestart}>Read Again</button>
                    <button className="sr-exit-btn" onClick={onBack}>Back to Stories</button>
                  </div>
                </div>
              ) : (
                <div className="sr-choices">
                  {linkedChoices.length > 0
                    ? linkedChoices.map(choice => (
                        <button
                          key={choice.id}
                          className="sr-choice-btn"
                          onClick={() => handleChoice(choice.targetPageId)}
                        >
                          {choice.text || '(Unnamed choice)'}
                        </button>
                      ))
                    : <p className="sr-status">No choices on this page.</p>
                  }
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
