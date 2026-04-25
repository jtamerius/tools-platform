import { useState, useEffect, useRef, useCallback } from 'react';
import ChoiceEditor from './ChoiceEditor';
import './PageEditor.css';

function newChoiceId() {
  return Math.random().toString(36).slice(2, 10);
}

export default function PageEditor({ page, allPages, onSave, onDelete }) {
  const [title, setTitle] = useState(page?.title ?? '');
  const [content, setContent] = useState(page?.content ?? '');
  const [choices, setChoices] = useState(page?.choices ?? []);
  const [isEnd, setIsEnd] = useState(page?.isEnd ?? false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const saveTimer = useRef(null);

  // Re-sync local state when the selected page changes
  useEffect(() => {
    setTitle(page?.title ?? '');
    setContent(page?.content ?? '');
    setChoices(page?.choices ?? []);
    setIsEnd(page?.isEnd ?? false);
    setConfirmDelete(false);
  }, [page?.id]);

  const scheduleSave = useCallback((fields) => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => onSave(fields), 600);
  }, [onSave]);

  const handleTitle = (v) => { setTitle(v); scheduleSave({ title: v, content, choices, isEnd }); };
  const handleContent = (v) => { setContent(v); scheduleSave({ title, content: v, choices, isEnd }); };
  const handleIsEnd = (v) => { setIsEnd(v); const c = v ? [] : choices; setChoices(c); scheduleSave({ title, content, choices: c, isEnd: v }); };

  const handleChoiceChange = (idx, updated) => {
    const next = choices.map((c, i) => i === idx ? updated : c);
    setChoices(next);
    scheduleSave({ title, content, choices: next, isEnd });
  };

  const handleChoiceDelete = (idx) => {
    const next = choices.filter((_, i) => i !== idx);
    setChoices(next);
    scheduleSave({ title, content, choices: next, isEnd });
  };

  const handleAddChoice = () => {
    const next = [...choices, { id: newChoiceId(), text: '', targetPageId: null }];
    setChoices(next);
    scheduleSave({ title, content, choices: next, isEnd });
  };

  if (!page) {
    return (
      <div className="pe-empty">
        <p>Select a page from the map or create a new one.</p>
      </div>
    );
  }

  return (
    <div className="pe-root">
      <div className="pe-field">
        <label className="pe-label">Page Title</label>
        <input
          className="pe-input"
          type="text"
          value={title}
          onChange={e => handleTitle(e.target.value)}
          placeholder="Page title…"
          maxLength={200}
        />
      </div>

      <div className="pe-field pe-content-field">
        <label className="pe-label">Content</label>
        <textarea
          className="pe-textarea"
          value={content}
          onChange={e => handleContent(e.target.value)}
          placeholder="Write the page text here…"
        />
      </div>

      <div className="pe-field">
        <label className="pe-end-row">
          <input
            type="checkbox"
            checked={isEnd}
            onChange={e => handleIsEnd(e.target.checked)}
          />
          <span>This is an ending page (no choices)</span>
        </label>
      </div>

      {!isEnd && (
        <div className="pe-field">
          <div className="pe-choices-header">
            <label className="pe-label">Choices</label>
            <button className="pe-add-choice" onClick={handleAddChoice}>+ Add Choice</button>
          </div>
          <div className="pe-choices-list">
            {choices.map((choice, idx) => (
              <ChoiceEditor
                key={choice.id}
                choice={choice}
                allPages={allPages}
                currentPageId={page.id}
                onChange={(updated) => handleChoiceChange(idx, updated)}
                onDelete={() => handleChoiceDelete(idx)}
              />
            ))}
            {choices.length === 0 && (
              <p className="pe-no-choices">No choices yet. Add one above.</p>
            )}
          </div>
        </div>
      )}

      <div className="pe-delete-row">
        {confirmDelete ? (
          <>
            <button className="pe-del-confirm" onClick={onDelete}>Sure?</button>
            <button className="pe-del-cancel" onClick={() => setConfirmDelete(false)}>Cancel</button>
          </>
        ) : (
          <button className="pe-del-btn" onClick={() => setConfirmDelete(true)}>Delete page</button>
        )}
      </div>
    </div>
  );
}
