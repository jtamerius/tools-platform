import styles from './StatsPanel.module.css';

function Stat({ label, value, sub }) {
  return (
    <div className={styles.stat}>
      <span className={styles.value}>{value}</span>
      <span className={styles.label}>{label}</span>
      {sub && <span className={styles.sub}>{sub}</span>}
    </div>
  );
}

export function StatsPanel({ stats, loading }) {
  if (loading) {
    return (
      <div className={styles.wrapper}>
        <div className={styles.loading}>Loading…</div>
      </div>
    );
  }

  const { hailDays, maxMeshMm, totalSolarExposed, cellsAffected } = stats;

  return (
    <div className={styles.wrapper}>
      <Stat
        label="Hail Days"
        value={hailDays}
        sub="events above 25mm"
      />
      <Stat
        label="Max Hail Size"
        value={maxMeshMm > 0 ? `${maxMeshMm.toFixed(1)} mm` : '—'}
        sub={maxMeshMm >= 50 ? 'severe' : maxMeshMm >= 35 ? 'significant' : maxMeshMm > 0 ? 'moderate' : undefined}
      />
      <Stat
        label="Solar Systems Exposed"
        value={totalSolarExposed > 0 ? totalSolarExposed.toFixed(1) : '—'}
        sub="estimated systems at risk"
      />
      <Stat
        label="H3 Cells Affected"
        value={cellsAffected > 0 ? cellsAffected.toLocaleString() : '—'}
        sub="~0.7 km² each"
      />
    </div>
  );
}
