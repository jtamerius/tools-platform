import { useState } from 'react';
import { METROS, BACKFILL_START, BACKFILL_END } from './config/metros';
import { useHailData } from './hooks/useHailData';
import { MetroSelector } from './components/MetroSelector';
import { DateRangeSlider } from './components/DateRangeSlider';
import { StatsPanel } from './components/StatsPanel';
import { Legend } from './components/Legend';
import { HailMap } from './components/HailMap';
import styles from './App.module.css';

const DEFAULT_METRO = METROS[0];

export function App() {
  const [selectedMetro, setSelectedMetro] = useState(DEFAULT_METRO);
  const [startDate, setStartDate] = useState(BACKFILL_START);
  const [endDate, setEndDate] = useState(BACKFILL_END);

  const { cells, stats, loading, error } = useHailData(selectedMetro, startDate, endDate);

  return (
    <div className={styles.layout}>
      <aside className={styles.sidebar}>
        <header className={styles.sidebarHeader}>
          <h1 className={styles.appTitle}>SolarHail</h1>
          <p className={styles.appSubtitle}>Hail exposure for solar portfolios</p>
        </header>

        <section className={styles.section}>
          <MetroSelector metros={METROS} value={selectedMetro} onChange={setSelectedMetro} />
        </section>

        <section className={styles.section}>
          <DateRangeSlider
            min={BACKFILL_START}
            max={BACKFILL_END}
            start={startDate}
            end={endDate}
            onStartChange={setStartDate}
            onEndChange={setEndDate}
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
