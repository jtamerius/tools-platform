import { METRO_LIST } from '../config/metros';
import styles from './MetroSelector.module.css';

export function MetroSelector({ value, onChange, metros = METRO_LIST }) {
  return (
    <div className={styles.wrapper}>
      <label className={styles.label}>Metro Area</label>
      <select
        className={styles.select}
        value={value}
        onChange={e => onChange(e.target.value)}
      >
        {metros.map(m => (
          <option key={m.id} value={m.id}>
            {m.totalSolarExposed != null
              ? `${m.name} — ${m.totalSolarExposed.toFixed(0)} systems`
              : m.name}
          </option>
        ))}
      </select>
    </div>
  );
}
