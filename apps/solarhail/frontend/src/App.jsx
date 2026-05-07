import { useState, useMemo, useEffect, useRef } from 'react';
import { METRO_LIST, BACKFILL_START, BACKFILL_END } from './config/metros';
import { useHailData } from './hooks/useHailData';
import { useSolarData } from './hooks/useSolarData';
import { useMetroSummary } from './hooks/useMetroSummary';
import { MetroSelector } from './components/MetroSelector';
import { DateRangeSlider } from './components/DateRangeSlider';
import { StatsPanel } from './components/StatsPanel';
import { Legend } from './components/Legend';
import { HailMap } from './components/HailMap';
import styles from './App.module.css';

export function App() {
  const [selectedMetroId, setSelectedMetroId] = useState(METRO_LIST[0].id);
  const [startDate, setStartDate] = useState(BACKFILL_START);
  const [endDate, setEndDate] = useState(BACKFILL_END);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showSolar, setShowSolar] = useState(false);
  const [opacity, setOpacity] = useState(0.8);

  const selectedMetro = useMemo(
    () => METRO_LIST.find(m => m.id === selectedMetroId),
    [selectedMetroId],
  );

  const { cells, stats, loading, error } = useHailData(selectedMetroId, startDate, endDate);
  const { solarCells } = useSolarData(selectedMetroId);
  const { sortedMetros, isResolved } = useMetroSummary();
  const autoSelectedRef = useRef(false);

  useEffect(() => {
    if (isResolved && !autoSelectedRef.current && sortedMetros.length > 0) {
      autoSelectedRef.current = true;
      setSelectedMetroId(sortedMetros[0].id);
    }
  }, [isResolved, sortedMetros]);

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

        {!sidebarOpen && (
          <div className={styles.collapsedSummary}>
            <span className={styles.collapsedMetroName}>{selectedMetro?.name ?? '—'}</span>
          </div>
        )}

        {sidebarOpen && (
          <>
            <header className={styles.sidebarHeader}>
              <h1 className={styles.appTitle}>Hail-No</h1>
              <p className={styles.appSubtitle}>Hail exposure for solar portfolios</p>
            </header>

            <section className={styles.section}>
              <MetroSelector value={selectedMetroId} onChange={setSelectedMetroId} metros={sortedMetros} />
            </section>

            <section className={styles.section}>
              <DateRangeSlider
                startDate={startDate}
                endDate={endDate}
                onChange={(start, end) => { setStartDate(start); setEndDate(end); }}
              />
            </section>

            <section className={styles.section}>
              {error ? (
                <div className={styles.error}>{error}</div>
              ) : (
                <StatsPanel stats={stats} loading={loading} />
              )}
            </section>

            <section className={styles.legendSection}>
              <Legend showSolar={showSolar} />
              <button
                className={`${styles.toggleBtn} ${showSolar ? styles.toggleBtnActive : ''}`}
                onClick={() => setShowSolar(s => !s)}
              >
                {showSolar ? '← Hail Events' : 'Solar Density →'}
              </button>
              <div className={styles.sliderRow}>
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
        <HailMap cells={cells} metro={selectedMetro} solarCells={solarCells} showSolar={showSolar} opacity={opacity} />
      </main>
    </div>
  );
}
