import styles from './Legend.module.css';

const MODES = {
  hail: {
    title: 'Max MESH (mm)',
    bar: 'linear-gradient(to right, #ffe500, #ff8800, #cc0000)',
    stops: [{ color: '#ffe500', label: '25mm' }, { color: '#ff8800', label: '38mm' }, { color: '#cc0000', label: '50mm+' }],
  },
  home: {
    title: 'Est. Solar Systems',
    bar: 'linear-gradient(to right, #145020, #00b4a0, #1464ff)',
    stops: [{ color: '#145020', label: '1' }, { color: '#00b4a0', label: '10' }, { color: '#1464ff', label: '20+' }],
  },
  commercial: {
    title: 'Commercial MW Exposed',
    bar: 'linear-gradient(to right, #ffe500, #ff8800, #cc0000)',
    stops: [{ color: '#ffe500', label: '1 MW' }, { color: '#ff8800', label: '50 MW' }, { color: '#cc0000', label: '100+ MW' }],
  },
};

export function Legend({ mapMode = 'hail' }) {
  const { title, bar, stops } = MODES[mapMode] ?? MODES.hail;
  return (
    <div className={styles.wrapper}>
      <span className={styles.title}>{title}</span>
      <div className={styles.bar} style={{ background: bar }} />
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
