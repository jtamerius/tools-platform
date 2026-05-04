import { METRO_LIST } from '../config/metros';
import styles from './MetroSelector.module.css';

export function MetroSelector({ value, onChange }) {
  return (
    <div className={styles.wrapper}>
      <label className={styles.label}>Metro Area</label>
      <select
        className={styles.select}
        value={value}
        onChange={e => onChange(e.target.value)}
      >
        {METRO_LIST.map(m => (
          <option key={m.id} value={m.id}>{m.name}</option>
        ))}
      </select>
    </div>
  );
}
