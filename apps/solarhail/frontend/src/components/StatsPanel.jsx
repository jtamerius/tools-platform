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

function SolarBuckets({ solarBySize }) {
  const { moderate, significant, severe } = solarBySize;
  const total = moderate + significant + severe;
  if (total === 0) return null;
  return (
    <div className={styles.buckets}>
      {severe > 0 && (
        <div className={styles.bucket}>
          <span className={styles.bucketDot} style={{ background: '#cc4400' }} />
          <span className={styles.bucketLabel}>Severe (≥50mm)</span>
          <span className={styles.bucketCount}>{severe.toFixed(1)}</span>
        </div>
      )}
      {significant > 0 && (
        <div className={styles.bucket}>
          <span className={styles.bucketDot} style={{ background: '#ff8800' }} />
          <span className={styles.bucketLabel}>Significant (38–50mm)</span>
          <span className={styles.bucketCount}>{significant.toFixed(1)}</span>
        </div>
      )}
      {moderate > 0 && (
        <div className={styles.bucket}>
          <span className={styles.bucketDot} style={{ background: '#ffe500' }} />
          <span className={styles.bucketLabel}>Moderate (25–38mm)</span>
          <span className={styles.bucketCount}>{moderate.toFixed(1)}</span>
        </div>
      )}
    </div>
  );
}

function StateTable({ rows, loading }) {
  if (loading) return <p className={styles.tableNote}>Loading state summary…</p>;
  if (!rows.length) return <p className={styles.tableNote}>State summary not yet available</p>;

  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>State</th>
            <th className={styles.numCol}>Hail Days</th>
            <th className={styles.numCol}>Systems</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.state_abbr}>
              <td>{r.state_abbr}</td>
              <td className={styles.numCol}>{r.hail_days}</td>
              <td className={styles.numCol}>{r.total_solar_systems.toFixed(0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FacilityTable({ facilities }) {
  if (!facilities.length) return <p className={styles.tableNote}>No commercial facilities in view</p>;

  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Facility</th>
            <th className={styles.numCol}>MW</th>
            <th className={styles.numCol}>Days</th>
          </tr>
        </thead>
        <tbody>
          {facilities.slice(0, 50).map((f, i) => (
            <tr key={`${f.h3_index}-${i}`}>
              <td title={f.p_name}>{f.p_name ?? '—'} <span className={styles.stateTag}>{f.p_state}</span></td>
              <td className={styles.numCol}>{(f.capacity_mwdc ?? 0).toFixed(0)}</td>
              <td className={styles.numCol}>{f.hailDays}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function StatsPanel({
  activeTab,
  homeStats,
  commercialStats,
  stateRows,
  stateLoading,
  viewportFacilities,
  loading,
}) {
  if (loading && !homeStats.cellsAffected) {
    return <div className={styles.loading}>Loading hail data…</div>;
  }

  if (activeTab === 'commercial') {
    const { hailDays, maxMeshMm, totalCommercialMwdc, cellsAffected } = commercialStats;
    return (
      <div className={styles.wrapper}>
        <Stat label="Hail Days" value={hailDays} sub="in viewport" />
        <Stat label="Max Hail Size" value={maxMeshMm > 0 ? `${maxMeshMm.toFixed(1)} mm` : '—'} />
        <Stat label="H3 Cells" value={cellsAffected > 0 ? cellsAffected.toLocaleString() : '—'} />
        <Stat
          label="Commercial MW Exposed"
          value={totalCommercialMwdc > 0 ? `${totalCommercialMwdc.toFixed(0)} MW` : '—'}
          sub="utility-scale solar"
        />
        <div className={styles.tableHeader}>Facilities in View</div>
        <FacilityTable facilities={viewportFacilities} />
      </div>
    );
  }

  // Home tab
  const { hailDays, maxMeshMm, totalSolarExposed, cellsAffected, solarBySize } = homeStats;
  return (
    <div className={styles.wrapper}>
      <Stat label="Hail Days" value={hailDays} sub="in viewport" />
      <Stat label="Max Hail Size" value={maxMeshMm > 0 ? `${maxMeshMm.toFixed(1)} mm` : '—'} />
      <Stat
        label="H3 Cells Affected"
        value={cellsAffected > 0 ? cellsAffected.toLocaleString() : '—'}
        sub="~0.7 km² each"
      />
      <Stat
        label="Solar Systems Exposed"
        value={totalSolarExposed > 0 ? totalSolarExposed.toFixed(1) : '—'}
        sub="est. residential systems at risk"
      >
        {solarBySize && <SolarBuckets solarBySize={solarBySize} />}
      </Stat>
      <div className={styles.tableHeader}>By State (full range)</div>
      <StateTable rows={stateRows} loading={stateLoading} />
    </div>
  );
}
