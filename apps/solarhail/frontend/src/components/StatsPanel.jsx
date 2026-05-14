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
  viewportFacilities,
  loading,
  onFlyTo,
}) {
  if (loading && !homeStats.cellsAffected) {
    return <div className={styles.loading}>Loading hail data…</div>;
  }

  if (activeTab === 'commercial') {
    const { maxMeshMm, totalMwdc, cellsAffected } = commercialStats;
    const facilityBuckets = {
      severe:      viewportFacilities.filter(f => f.maxMeshMm >= 50),
      significant: viewportFacilities.filter(f => f.maxMeshMm >= 38 && f.maxMeshMm < 50),
      moderate:    viewportFacilities.filter(f => f.maxMeshMm >= 25 && f.maxMeshMm < 38),
    };
    return (
      <div className={styles.wrapper}>
        <Stat
          label="Commercial MW Exposed"
          value={totalMwdc > 0 ? `${totalMwdc.toFixed(0)} MW` : '—'}
          sub="utility-scale solar in viewport"
        >
          {totalMwdc > 0 && (
            <div className={styles.buckets}>
              {facilityBuckets.severe.length > 0 && (
                <div className={styles.bucket}>
                  <span className={styles.bucketDot} style={{ background: '#cc4400' }} />
                  <span className={styles.bucketLabel}>Severe (≥50mm)</span>
                  <span className={styles.bucketCount}>{facilityBuckets.severe.reduce((s, f) => s + (f.capacity_mwdc || 0), 0).toFixed(0)} MW</span>
                </div>
              )}
              {facilityBuckets.significant.length > 0 && (
                <div className={styles.bucket}>
                  <span className={styles.bucketDot} style={{ background: '#ff8800' }} />
                  <span className={styles.bucketLabel}>Significant (38–50mm)</span>
                  <span className={styles.bucketCount}>{facilityBuckets.significant.reduce((s, f) => s + (f.capacity_mwdc || 0), 0).toFixed(0)} MW</span>
                </div>
              )}
              {facilityBuckets.moderate.length > 0 && (
                <div className={styles.bucket}>
                  <span className={styles.bucketDot} style={{ background: '#ffe500' }} />
                  <span className={styles.bucketLabel}>Moderate (25–38mm)</span>
                  <span className={styles.bucketCount}>{facilityBuckets.moderate.reduce((s, f) => s + (f.capacity_mwdc || 0), 0).toFixed(0)} MW</span>
                </div>
              )}
            </div>
          )}
        </Stat>
        <Stat
          label="Facilities Exposed"
          value={viewportFacilities.length > 0 ? viewportFacilities.length.toLocaleString() : '—'}
          sub="utility-scale facilities in viewport"
        >
          {viewportFacilities.length > 0 && (
            <div className={styles.buckets}>
              {facilityBuckets.severe.length > 0 && (
                <div className={styles.bucket}>
                  <span className={styles.bucketDot} style={{ background: '#cc4400' }} />
                  <span className={styles.bucketLabel}>Severe (≥50mm)</span>
                  <span className={styles.bucketCount}>{facilityBuckets.severe.length}</span>
                </div>
              )}
              {facilityBuckets.significant.length > 0 && (
                <div className={styles.bucket}>
                  <span className={styles.bucketDot} style={{ background: '#ff8800' }} />
                  <span className={styles.bucketLabel}>Significant (38–50mm)</span>
                  <span className={styles.bucketCount}>{facilityBuckets.significant.length}</span>
                </div>
              )}
              {facilityBuckets.moderate.length > 0 && (
                <div className={styles.bucket}>
                  <span className={styles.bucketDot} style={{ background: '#ffe500' }} />
                  <span className={styles.bucketLabel}>Moderate (25–38mm)</span>
                  <span className={styles.bucketCount}>{facilityBuckets.moderate.length}</span>
                </div>
              )}
            </div>
          )}
        </Stat>
        <Stat label="Max Hail Size" value={maxMeshMm > 0 ? `${maxMeshMm.toFixed(1)} mm` : '—'} />
        <Stat label="H3 Cells" value={cellsAffected > 0 ? cellsAffected.toLocaleString() : '—'} />
        <div className={styles.tableHeader}>Facilities in View</div>
        <FacilityTable facilities={viewportFacilities} onFlyTo={onFlyTo} />
      </div>
    );
  }

  // Home tab
  const { maxMeshMm, totalSolarExposed, totalMwdc, cellsAffected, solarBySize } = homeStats;
  return (
    <div className={styles.wrapper}>
      <Stat
        label="Residential MW Exposed"
        value={totalMwdc > 0 ? `${totalMwdc.toFixed(1)} MW` : '—'}
        sub="est. residential systems at risk"
      >
        {solarBySize && totalMwdc > 0 && (
          <div className={styles.buckets}>
            {solarBySize.severe > 0 && (
              <div className={styles.bucket}>
                <span className={styles.bucketDot} style={{ background: '#cc4400' }} />
                <span className={styles.bucketLabel}>Severe (≥50mm)</span>
                <span className={styles.bucketCount}>{(solarBySize.severe * 7.2 / 1000).toFixed(1)} MW</span>
              </div>
            )}
            {solarBySize.significant > 0 && (
              <div className={styles.bucket}>
                <span className={styles.bucketDot} style={{ background: '#ff8800' }} />
                <span className={styles.bucketLabel}>Significant (38–50mm)</span>
                <span className={styles.bucketCount}>{(solarBySize.significant * 7.2 / 1000).toFixed(1)} MW</span>
              </div>
            )}
            {solarBySize.moderate > 0 && (
              <div className={styles.bucket}>
                <span className={styles.bucketDot} style={{ background: '#ffe500' }} />
                <span className={styles.bucketLabel}>Moderate (25–38mm)</span>
                <span className={styles.bucketCount}>{(solarBySize.moderate * 7.2 / 1000).toFixed(1)} MW</span>
              </div>
            )}
          </div>
        )}
      </Stat>
      <Stat
        label="Systems Exposed"
        value={totalSolarExposed > 0 ? `~${totalSolarExposed.toFixed(0)}` : '—'}
        sub="@ 7.2 kW avg"
      >
        {solarBySize && <SolarBuckets solarBySize={solarBySize} />}
      </Stat>
      <Stat label="Max Hail Size" value={maxMeshMm > 0 ? `${maxMeshMm.toFixed(1)} mm` : '—'} />
      <Stat
        label="H3 Cells Affected"
        value={cellsAffected > 0 ? cellsAffected.toLocaleString() : '—'}
        sub="~0.7 km² each"
      />
    </div>
  );
}
