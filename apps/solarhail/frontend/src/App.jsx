import { useState, useMemo, useCallback } from 'react';
import { BACKFILL_START, BACKFILL_END } from './config/metros';
import { useHailData } from './hooks/useHailData';
import { useStateSummary } from './hooks/useStateSummary';
import { useCommercialFacilities } from './hooks/useCommercialFacilities';
import { DateRangeSlider } from './components/DateRangeSlider';
import { StatsPanel } from './components/StatsPanel';
import { Legend } from './components/Legend';
import { HailMap } from './components/HailMap';
import styles from './App.module.css';

export function App() {
  const [startDate, setStartDate] = useState(BACKFILL_START);
  const [endDate, setEndDate] = useState(BACKFILL_END);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activeTab, setActiveTab] = useState('home');
  const [opacity, setOpacity] = useState(0.8);
  const [minMeshMm, setMinMeshMm] = useState(25);
  const [showRadar, setShowRadar] = useState(true);
  const [showSolar, setShowSolar] = useState(true);
  const [showCommercial, setShowCommercial] = useState(false);
  const [viewportBounds, setViewportBounds] = useState(null);

  const { cells, loading, allLoaded, error } = useHailData(startDate, endDate);
  const { rows: stateRows, loading: stateLoading } = useStateSummary(startDate, endDate);
  const { facilitiesByH3 } = useCommercialFacilities();

  // Filter by min hail size
  const filteredCells = useMemo(
    () => cells.filter(c => c.maxMeshMm >= minMeshMm),
    [cells, minMeshMm],
  );

  // Further filter by current viewport
  const viewportCells = useMemo(() => {
    if (!viewportBounds) return filteredCells;
    const { north, south, east, west } = viewportBounds;
    return filteredCells.filter(
      c => c.lat >= south && c.lat <= north && c.lng >= west && c.lng <= east,
    );
  }, [filteredCells, viewportBounds]);

  // Home tab stats — computed from viewport
  const homeStats = useMemo(() => {
    if (!viewportCells.length) return {
      hailDays: 0, maxMeshMm: 0, totalSolarExposed: 0, cellsAffected: 0,
      solarBySize: { moderate: 0, significant: 0, severe: 0 },
    };
    return {
      hailDays:          viewportCells.reduce((s, c) => s + c.hailDays, 0),
      maxMeshMm:         Math.max(...viewportCells.map(c => c.maxMeshMm)),
      totalSolarExposed: viewportCells.reduce((s, c) => s + c.totalSolarExposed, 0),
      cellsAffected:     viewportCells.length,
      solarBySize: {
        moderate:    viewportCells.filter(c => c.maxMeshMm >= 25 && c.maxMeshMm < 38).reduce((s, c) => s + c.totalSolarExposed, 0),
        significant: viewportCells.filter(c => c.maxMeshMm >= 38 && c.maxMeshMm < 50).reduce((s, c) => s + c.totalSolarExposed, 0),
        severe:      viewportCells.filter(c => c.maxMeshMm >= 50).reduce((s, c) => s + c.totalSolarExposed, 0),
      },
    };
  }, [viewportCells]);

  // Commercial tab stats — computed from viewport
  const commercialStats = useMemo(() => {
    if (!viewportCells.length) return { hailDays: 0, maxMeshMm: 0, totalCommercialMwdc: 0, cellsAffected: 0 };
    return {
      hailDays:           viewportCells.reduce((s, c) => s + c.hailDays, 0),
      maxMeshMm:          Math.max(...viewportCells.map(c => c.maxMeshMm)),
      totalCommercialMwdc: viewportCells.reduce((s, c) => s + c.totalCommercialMwdc, 0),
      cellsAffected:      viewportCells.length,
    };
  }, [viewportCells]);

  // All commercial facilities joined with hail cell data (for map layer)
  const commercialFeatures = useMemo(() => {
    if (!facilitiesByH3) return [];
    const result = [];
    for (const cell of cells) {
      if (cell.totalCommercialMwdc <= 0) continue;
      const facs = facilitiesByH3.get(cell.h3_index);
      if (facs) {
        for (const f of facs) {
          result.push({ ...f, lng: cell.lng, lat: cell.lat, maxMeshMm: cell.maxMeshMm, hailDays: cell.hailDays });
        }
      }
    }
    return result;
  }, [facilitiesByH3, cells]);

  // Facility list for commercial tab — join viewport cells with facility lookup
  const viewportFacilities = useMemo(() => {
    if (!facilitiesByH3) return [];
    const result = [];
    for (const cell of viewportCells) {
      const facs = facilitiesByH3.get(cell.h3_index);
      if (facs) {
        for (const f of facs) {
          result.push({ ...f, maxMeshMm: cell.maxMeshMm, hailDays: cell.hailDays });
        }
      }
    }
    return result.sort((a, b) => b.capacity_mwdc - a.capacity_mwdc);
  }, [facilitiesByH3, viewportCells]);

  const handleViewportChange = useCallback(bounds => {
    setViewportBounds(bounds);
  }, []);

  return (
    <div className={styles.layout}>
      <aside className={`${styles.sidebar} ${sidebarOpen ? '' : styles.sidebarCollapsed}`}>
        <button
          className={styles.collapseBtn}
          onClick={() => setSidebarOpen(o => !o)}
          title={sidebarOpen ? 'Collapse panel' : 'Expand panel'}
        >
          <span className={styles.collapseBtnDesktopIcon}>{sidebarOpen ? '‹' : '›'}</span>
          <span className={styles.collapseBtnMobileIcon}>{sidebarOpen ? '↓' : '↑'}</span>
        </button>

        {sidebarOpen && (
          <>
            <header className={styles.sidebarHeader}>
              <h1 className={styles.appTitle}>Hailstoned</h1>
              <p className={styles.appSubtitle}>Hail exposure for solar portfolios</p>
            </header>

            <section className={styles.section}>
              <DateRangeSlider
                startDate={startDate}
                endDate={endDate}
                onChange={(start, end) => { setStartDate(start); setEndDate(end); }}
              />
              <div className={styles.sliderRow} style={{ marginTop: 12 }}>
                <span className={styles.sliderLabel}>Min Hail Size</span>
                <span className={styles.sliderLabel}>≥{minMeshMm} mm</span>
              </div>
              <input
                type="range"
                min="25"
                max="65"
                step="5"
                value={minMeshMm}
                onChange={e => setMinMeshMm(Number(e.target.value))}
                className={styles.slider}
              />
            </section>

            <section className={styles.section}>
              <div className={styles.layerLabel}>Layers</div>
              <div className={styles.layerToggles}>
                <button
                  className={`${styles.layerBtn} ${showRadar ? styles.layerBtnActive : ''}`}
                  onClick={() => setShowRadar(v => !v)}
                >⬡ Radar</button>
                <button
                  className={`${styles.layerBtn} ${showSolar ? styles.layerBtnActive : ''} ${styles.layerBtnSolar}`}
                  onClick={() => setShowSolar(v => !v)}
                >● Home Solar</button>
                <button
                  className={`${styles.layerBtn} ${showCommercial ? styles.layerBtnActive : ''} ${styles.layerBtnCommercial}`}
                  onClick={() => setShowCommercial(v => !v)}
                >● Commercial</button>
              </div>
            </section>

            <div className={styles.tabBar}>
              <button
                className={`${styles.tab} ${activeTab === 'home' ? styles.tabActive : ''}`}
                onClick={() => setActiveTab('home')}
              >
                Home Solar
              </button>
              <button
                className={`${styles.tab} ${activeTab === 'commercial' ? styles.tabActive : ''}`}
                onClick={() => setActiveTab('commercial')}
              >
                Commercial
              </button>
            </div>

            <section className={styles.tabContent}>
              {error ? (
                <div className={styles.error}>{error}</div>
              ) : (
                <StatsPanel
                  activeTab={activeTab}
                  homeStats={homeStats}
                  commercialStats={commercialStats}
                  stateRows={stateRows}
                  stateLoading={stateLoading}
                  viewportFacilities={viewportFacilities}
                  loading={loading}
                />
              )}
            </section>

            <section className={styles.legendSection}>
              <Legend showRadar={showRadar} showSolar={showSolar} showCommercial={showCommercial} />
              <div className={styles.sliderRow} style={{ marginTop: 12 }}>
                <span className={styles.sliderLabel}>Opacity</span>
                <span className={styles.sliderLabel}>{Math.round(opacity * 100)}%</span>
              </div>
              <input
                type="range"
                min="0.1"
                max="1"
                step="0.05"
                value={opacity}
                onChange={e => setOpacity(Number(e.target.value))}
                className={styles.slider}
              />
            </section>
          </>
        )}
      </aside>

      <main className={styles.mapArea}>
        <HailMap
          cells={cells}
          commercialFeatures={commercialFeatures}
          minMeshMm={minMeshMm}
          showRadar={showRadar}
          showSolar={showSolar}
          showCommercial={showCommercial}
          opacity={opacity}
          allLoaded={allLoaded}
          onViewportChange={handleViewportChange}
        />
      </main>
    </div>
  );
}
