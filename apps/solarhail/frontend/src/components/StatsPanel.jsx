import styles from './StatsPanel.module.css';

function Stat({ label, value, sub, children }) {
  return (
    <div className={styles.stat}>
      <span className={styles.value}>{value}</span>
      <span className={styles.label}>{label}</span>
      {sub && <span className={styles.sub}>{sub}</span>}
      {children}
    </div>
  );
}

function SizeBuckets({ cellsBySize }) {
  const { moderate, significant, severe } = cellsBySize;
  const total = moderate + significant + severe;
  if (total === 0) return null;
  return (
    <div className={styles.buckets}>
      {severe > 0 && (
        <div className={styles.bucket}>
          <span className={styles.bucketDot} style={{ background: '#cc4400' }} />
          <span className={styles.bucketLabel}>Severe (≥50mm)</span>
          <span className={styles.bucketCount}>{severe.toLocaleString()}</span>
        </div>
      )}
      {significant > 0 && (
        <div className={styles.bucket}>
          <span className={styles.bucketDot} style={{ background: '#ff8800' }} />
          <span className={styles.bucketLabel}>Significant (35–50mm)</span>
          <span className={styles.bucketCount}>{significant.toLocaleString()}</span>
        </div>
      )}
      {moderate > 0 && (
        <div className={styles.bucket}>
          <span className={styles.bucketDot} style={{ background: '#ffe500' }} />
          <span className={styles.bucketLabel}>Moderate (25–35mm)</span>
          <span className={styles.bucketCount}>{moderate.toLocaleString()}</span>
        </div>
      )}
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

  const { hailDays, maxMeshMm, totalSolarExposed, cellsAffected, cellsBySize } = stats;

  return (
    <div className={styles.wrapper}>
      <Stat label="Hail Days" value={hailDays} sub="events above 25mm" />
      <Stat
        label="Max Hail Size"
        value={maxMeshMm > 0 ? `${maxMeshMm.toFixed(1)} mm` : '—'}
        sub={maxMeshMm >= 50 ? 'severe' : maxMeshMm >= 35 ? 'significant' : maxMeshMm > 0 ? 'moderate' : undefined}
      />
      <Stat
        label="H3 Cells Affected"
        value={cellsAffected > 0 ? cellsAffected.toLocaleString() : '—'}
        sub="~0.7 km² each"
      >
        {cellsBySize && <SizeBuckets cellsBySize={cellsBySize} />}
      </Stat>
      <Stat
        label="Solar Systems Exposed"
        value={totalSolarExposed > 0 ? totalSolarExposed.toFixed(1) : '—'}
        sub="estimated systems at risk"
      />
    </div>
  );
}
