import { useState, useMemo } from 'react';
import { METRO_LIST, BACKFILL_START, BACKFILL_END } from './config/metros';
import { useHailData } from './hooks/useHailData';
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

  const selectedMetro = useMemo(
    () => METRO_LIST.find(m => m.id === selectedMetroId),
    [selectedMetroId],
  );

  const { cells, stats, loading, error } = useHailData(selectedMetroId, startDate, endDate);

  return (
    <div className={styles.layout}>
      <aside className={styles.sidebar}>
        <header className={styles.sidebarHeader}>
          <h1 className={styles.appTitle}>SolarHail</h1>
          <p className={styles.appSubtitle}>Hail exposure for solar portfolios</p>
        </header>

        <section className={styles.section}>
          <MetroSelector value={selectedMetroId} onChange={setSelectedMetroId} />
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
          <Legend />
        </section>
      </aside>

      <main className={styles.mapArea}>
        <HailMap cells={cells} metro={selectedMetro} />
      </main>
    </div>
  );
}
