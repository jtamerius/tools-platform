import { useMemo, useCallback } from 'react';
import { BACKFILL_START, BACKFILL_END } from '../config/metros';
import styles from './DateRangeSlider.module.css';

const START_MS = new Date(BACKFILL_START).getTime();
const END_MS   = new Date(BACKFILL_END).getTime();
const TOTAL_MS = END_MS - START_MS;
const DAY_MS   = 86_400_000;

function msToIso(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function isoToMs(iso) {
  return new Date(iso).getTime();
}

function formatDate(iso) {
  return new Date(iso + 'T12:00:00').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric',
  });
}

/** Dual-handle range slider backed by two overlaid <input type="range"> */
export function DateRangeSlider({ startDate, endDate, onChange }) {
  const startMs = isoToMs(startDate);
  const endMs   = isoToMs(endDate);

  const startPct = ((startMs - START_MS) / TOTAL_MS) * 100;
  const endPct   = ((endMs   - START_MS) / TOTAL_MS) * 100;

  const totalDays = Math.round((endMs - startMs) / DAY_MS) + 1;

  const steps = Math.round(TOTAL_MS / DAY_MS);

  const handleStart = useCallback(e => {
    const ms = Math.min(isoToMs(msToIso(START_MS + Number(e.target.value) * DAY_MS)), endMs - DAY_MS);
    onChange(msToIso(ms), endDate);
  }, [endMs, endDate, onChange]);

  const handleEnd = useCallback(e => {
    const ms = Math.max(isoToMs(msToIso(START_MS + Number(e.target.value) * DAY_MS)), startMs + DAY_MS);
    onChange(startDate, msToIso(ms));
  }, [startMs, startDate, onChange]);

  const startVal = Math.round((startMs - START_MS) / DAY_MS);
  const endVal   = Math.round((endMs   - START_MS) / DAY_MS);

  const trackStyle = useMemo(() => ({
    background: `linear-gradient(to right,
      #2a3050 ${startPct}%,
      #5b8cff ${startPct}%,
      #5b8cff ${endPct}%,
      #2a3050 ${endPct}%)`,
  }), [startPct, endPct]);

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <span className={styles.label}>Date Range</span>
        <span className={styles.span}>{totalDays} day{totalDays !== 1 ? 's' : ''}</span>
      </div>

      <div className={styles.track} style={trackStyle}>
        <input
          type="range"
          className={styles.thumb}
          min={0} max={steps}
          value={startVal}
          onChange={handleStart}
        />
        <input
          type="range"
          className={styles.thumb}
          min={0} max={steps}
          value={endVal}
          onChange={handleEnd}
        />
      </div>

      <div className={styles.labels}>
        <span>{formatDate(startDate)}</span>
        <span>{formatDate(endDate)}</span>
      </div>
    </div>
  );
}
