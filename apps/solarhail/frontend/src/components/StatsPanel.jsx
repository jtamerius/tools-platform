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
            <th className={styles.numCol}>Systems</th>
            <th className={styles.numCol}>Est. MW</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.state_abbr}>
              <td>{r.state_abbr}</td>
              <td className={styles.numCol}>{r.total_solar_systems.toFixed(0)}</td>
              <td className={styles.numCol}>{(r.total_solar_systems * 7.2 / 1000).toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FacilityTable({ facilities, onFlyTo }) {
  if (!facilities.length) return <p className={styles.tableNote}>No commercial facilities in view</p>;

  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Facility</th>
            <th className={styles.numCol}>MW</th>
          </tr>
        </thead>
        <tbody>
          {facilities.slice(0, 50).map((f, i) => (
            <tr
              key={`${f.h3_index}-${i}`}
              className={styles.clickableRow}
              onClick={() => onFlyTo && f.xlong != null && onFlyTo({ longitude: f.xlong, latitude: f.ylat, ts: Date.now() })}
              title="Click to zoom to facility"
            >
              <td title={f.p_name}>{f.p_name ?? '—'} <span className={styles.stateTag}>{f.p_state}</span></td>
              <td className={styles.numCol}>{(f.capacity_mwdc ?? 0).toFixed(0)}</td>
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
  onFlyTo,
}) {
  if (loading && !homeStats.cellsAffected) {
    return <div className={styles.loading}>Loading hail data…</div>;
  }

  if (activeTab === 'commercial') {
    const { maxMeshMm, totalMwdc, cellsAffected } = commercialStats;
    return (
      <div className={styles.wrapper}>
        <Stat label="Max Hail Size" value={maxMeshMm > 0 ? `${maxMeshMm.toFixed(1)} mm` : '—'} />
        <Stat label="H3 Cells" value={cellsAffected > 0 ? cellsAffected.toLocaleString() : '—'} />
        <Stat
          label="Commercial MW Exposed"
          value={totalMwdc > 0 ? `${totalMwdc.toFixed(0)} MW` : '—'}
          sub="utility-scale solar in viewport"
        />
        <div className={styles.tableHeader}>Facilities in View</div>
        <FacilityTable facilities={viewportFacilities} onFlyTo={onFlyTo} />
      </div>
    );
  }

  // Home tab
  const { maxMeshMm, totalSolarExposed, totalMwdc, cellsAffected, solarBySize } = homeStats;
  return (
    <div className={styles.wrapper}>
      <Stat label="Max Hail Size" value={maxMeshMm > 0 ? `${maxMeshMm.toFixed(1)} mm` : '—'} />
      <Stat
        label="H3 Cells Affected"
        value={cellsAffected > 0 ? cellsAffected.toLocaleString() : '—'}
        sub="~0.7 km² each"
      />
      <Stat
        label="Residential MW Exposed"
        value={totalMwdc > 0 ? `${totalMwdc.toFixed(1)} MW` : '—'}
        sub={totalSolarExposed > 0 ? `~${totalSolarExposed.toFixed(0)} systems @ 7.2 kW avg` : 'est. residential systems at risk'}
      >
        {solarBySize && <SolarBuckets solarBySize={solarBySize} />}
      </Stat>
    </div>
  );
}
