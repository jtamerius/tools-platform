import './MonthSelector.css';

export default function MonthSelector({ months, selected, onSelect }) {
  return (
    <div className="month-selector">
      <label>Payment:</label>
      <select value={selected || ''} onChange={e => onSelect(e.target.value)}>
        {months.map(m => (
          <option key={m.key} value={m.key}>
            {m.label}
          </option>
        ))}
      </select>
      <span className="month-count">{months.length} total</span>
    </div>
  );
}
