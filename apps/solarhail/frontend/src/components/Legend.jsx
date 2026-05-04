import styles from './Legend.module.css';

const STOPS = [
  { mm: 25, color: '#ffe500', label: '25mm' },
  { mm: 35, color: '#ff8800', label: '35mm' },
  { mm: 50, color: '#cc0000', label: '50mm+' },
];

export function Legend() {
  return (
    <div className={styles.wrapper}>
      <span className={styles.title}>Max MESH (mm)</span>
      <div className={styles.bar} />
      <div className={styles.ticks}>
        {STOPS.map(s => (
          <div key={s.mm} className={styles.tick}>
            <span className={styles.dot} style={{ background: s.color }} />
            <span className={styles.tickLabel}>{s.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
