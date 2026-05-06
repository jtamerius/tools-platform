import styles from './Legend.module.css';

const HAIL_STOPS = [
  { color: '#ffe500', label: '25mm' },
  { color: '#ff8800', label: '35mm' },
  { color: '#cc0000', label: '50mm+' },
];

const SOLAR_STOPS = [
  { color: '#00c850', label: '1' },
  { color: '#00b4a0', label: '10' },
  { color: '#1464ff', label: '20+' },
];

export function Legend({ showSolar = false }) {
  const stops = showSolar ? SOLAR_STOPS : HAIL_STOPS;
  const title = showSolar ? 'Est. Solar Systems' : 'Max MESH (mm)';
  const barStyle = showSolar
    ? { background: 'linear-gradient(to right, #00c850, #00b4a0, #1464ff)' }
    : { background: 'linear-gradient(to right, #ffe500, #ff8800, #cc0000)' };

  return (
    <div className={styles.wrapper}>
      <span className={styles.title}>{title}</span>
      <div className={styles.bar} style={barStyle} />
      <div className={styles.ticks}>
        {stops.map(s => (
          <div key={s.label} className={styles.tick}>
            <span className={styles.dot} style={{ background: s.color }} />
            <span className={styles.tickLabel}>{s.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
