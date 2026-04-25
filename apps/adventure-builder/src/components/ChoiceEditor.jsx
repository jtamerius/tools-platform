import './ChoiceEditor.css';

export default function ChoiceEditor({ choice, allPages, currentPageId, onChange, onDelete }) {
  return (
    <div className="ce-row">
      <input
        className="ce-text"
        type="text"
        placeholder="Choice text…"
        value={choice.text}
        onChange={e => onChange({ ...choice, text: e.target.value })}
        maxLength={300}
      />
      <select
        className="ce-target"
        value={choice.targetPageId ?? ''}
        onChange={e => onChange({ ...choice, targetPageId: e.target.value || null })}
      >
        <option value="">— unlinked —</option>
        {allPages
          .filter(p => p.id !== currentPageId)
          .map(p => (
            <option key={p.id} value={p.id}>{p.title}</option>
          ))}
      </select>
      <button className="ce-del" onClick={onDelete} title="Remove choice">✕</button>
    </div>
  );
}
