import styles from './Legend.module.css';

export function Legend({ showRadar, showSolar, showCommercial }) {
  return (
    <div className={styles.wrapper}>
      {showRadar && (
        <div className={styles.entry}>
          <span className={styles.title}>Radar — Max MESH</span>
          <div className={styles.bar} style={{ background: 'linear-gradient(to right, #ffe500, #ff8800, #cc0000)' }} />
          <div className={styles.ticks}>
            <div className={styles.tick}><span className={styles.dot} style={{ background: '#ffe500' }} /><span className={styles.tickLabel}>25mm</span></div>
            <div className={styles.tick}><span className={styles.dot} style={{ background: '#ff8800' }} /><span className={styles.tickLabel}>38mm</span></div>
            <div className={styles.tick}><span className={styles.dot} style={{ background: '#cc0000' }} /><span className={styles.tickLabel}>50mm+</span></div>
          </div>
        </div>
      )}
      {showSolar && (
        <div className={styles.entry}>
          <span className={styles.title}>Home Solar — Est. Systems</span>
          <div className={styles.bar} style={{ background: 'linear-gradient(to right, #145020, #00b4a0, #1464ff)' }} />
          <div className={styles.ticks}>
            <div className={styles.tick}><span className={styles.dot} style={{ background: '#145020' }} /><span className={styles.tickLabel}>1</span></div>
            <div className={styles.tick}><span className={styles.dot} style={{ background: '#00b4a0' }} /><span className={styles.tickLabel}>10</span></div>
            <div className={styles.tick}><span className={styles.dot} style={{ background: '#1464ff' }} /><span className={styles.tickLabel}>20+</span></div>
          </div>
        </div>
      )}
      {showCommercial && (
        <div className={styles.entry}>
          <span className={styles.title}>Commercial Solar</span>
          <div className={styles.ticks}>
            <div className={styles.tick}><span className={styles.dot} style={{ background: '#ff8c00' }} /><span className={styles.tickLabel}>Hit by hail</span></div>
            <div className={styles.tick}><span className={styles.dot} style={{ background: '#828282' }} /><span className={styles.tickLabel}>Below threshold</span></div>
          </div>
        </div>
      )}
    </div>
  );
}
