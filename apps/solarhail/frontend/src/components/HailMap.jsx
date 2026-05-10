import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import DeckGL from '@deck.gl/react';
import { WebMercatorViewport } from '@deck.gl/core';
import { H3HexagonLayer } from '@deck.gl/geo-layers';
import { Map } from 'react-map-gl/mapbox';
import styles from './HailMap.module.css';

const STYLES = {
  dark:      'mapbox://styles/mapbox/dark-v10',
  satellite: 'mapbox://styles/mapbox/satellite-streets-v12',
};
const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;

const COMMERCIAL_CAP_MW = 100;
const LOG_CAP = Math.log(21);

function meshToColor(mm) {
  const t = Math.min(Math.max((mm - 25) / 35, 0), 1);
  if (t < 0.5) {
    const s = t * 2;
    return [255, Math.round(229 - (229 - 136) * s), 0, 200];
  }
  const s = (t - 0.5) * 2;
  return [Math.round(255 - (255 - 204) * s), Math.round(136 * (1 - s)), 0, 200];
}

function solarToColor(systems) {
  if (systems <= 0) return [0, 0, 0, 0];
  const t = Math.min(Math.log(systems + 1) / LOG_CAP, 1);
  return [Math.round(t * 20), Math.round(200 - t * 100), Math.round(80 + t * 175), Math.round(120 + t * 135)];
}

function commercialToColor(mwdc) {
  if (mwdc <= 0) return [0, 0, 0, 0];
  const t = Math.min(mwdc / COMMERCIAL_CAP_MW, 1);
  return [255, Math.round(200 - t * 200), 0, Math.round(120 + t * 135)];
}

function getColor(d, mapMode) {
  if (mapMode === 'home') return solarToColor(d.totalSolarExposed);
  if (mapMode === 'commercial') return commercialToColor(d.totalCommercialMwdc);
  return meshToColor(d.maxMeshMm);
}

const INITIAL_VIEW = { longitude: -97, latitude: 38, zoom: 4, pitch: 0, bearing: 0 };

export function HailMap({ cells, mapMode = 'hail', opacity = 0.8, onViewportChange }) {
  const [viewState, setViewState] = useState(INITIAL_VIEW);
  const [tooltip, setTooltip] = useState(null);
  const [basemap, setBasemap] = useState('dark');

  const containerRef = useRef(null);
  const sizeRef = useRef({ width: 0, height: 0 });
  // Keep latest values accessible from the stable callback without recreating it
  const onViewportChangeRef = useRef(onViewportChange);
  onViewportChangeRef.current = onViewportChange;
  const latestVsRef = useRef(INITIAL_VIEW);
  const vpTimerRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      sizeRef.current = { width, height };
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // Stable callback — never recreated, so DeckGL's drag state is never interrupted
  const handleViewStateChange = useCallback(({ viewState: vs }) => {
    setViewState(vs);
    setTooltip(null);
    latestVsRef.current = vs;

    // Debounce the expensive parent update: recomputing viewportCells on every
    // animation frame (60fps) causes jank. 150ms means ~7 updates/sec while panning.
    clearTimeout(vpTimerRef.current);
    vpTimerRef.current = setTimeout(() => {
      const { width, height } = sizeRef.current;
      if (!width || !height || !onViewportChangeRef.current) return;
      const vp = new WebMercatorViewport({ ...latestVsRef.current, width, height });
      const [[west, south], [east, north]] = vp.getBounds();
      onViewportChangeRef.current({ north, south, east, west });
    }, 150);
  }, []); // empty deps — callback identity never changes

  const layer = useMemo(() => new H3HexagonLayer({
    id: 'hail-hex',
    data: cells,
    getHexagon: d => d.h3_index,
    getFillColor: d => getColor(d, mapMode),
    getElevation: 0,
    extruded: false,
    filled: true,
    stroked: false,
    opacity,
    pickable: true,
    updateTriggers: { getFillColor: [mapMode, cells] },
  }), [cells, mapMode, opacity]);

  const onHover = useCallback(({ object, x, y }) => {
    setTooltip(object ? { object, x, y } : null);
  }, []);

  return (
    <div ref={containerRef} className={styles.wrapper}>
      <DeckGL
        viewState={viewState}
        onViewStateChange={handleViewStateChange}
        controller={true}
        layers={[layer]}
        onHover={onHover}
      >
        <Map reuseMaps mapStyle={STYLES[basemap]} mapboxAccessToken={MAPBOX_TOKEN} />
      </DeckGL>

      {tooltip && (
        <div className={styles.tooltip} style={{ left: tooltip.x + 12, top: tooltip.y - 10 }}>
          <div className={styles.tooltipRow}>
            <span>Max MESH</span>
            <strong>{tooltip.object.maxMeshMm.toFixed(1)} mm</strong>
          </div>
          <div className={styles.tooltipRow}>
            <span>Hail days</span>
            <strong>{tooltip.object.hailDays}</strong>
          </div>
          <div className={styles.tooltipRow}>
            <span>Solar systems</span>
            <strong>{tooltip.object.totalSolarExposed.toFixed(1)}</strong>
          </div>
          {tooltip.object.totalCommercialMwdc > 0 && (
            <div className={styles.tooltipRow}>
              <span>Commercial MW</span>
              <strong>{tooltip.object.totalCommercialMwdc.toFixed(1)}</strong>
            </div>
          )}
        </div>
      )}

      <button
        className={styles.basemapToggle}
        onClick={() => setBasemap(b => b === 'dark' ? 'satellite' : 'dark')}
        title="Toggle basemap"
      >
        {basemap === 'dark' ? '🛰 Satellite' : '◼ Dark'}
      </button>

      {cells.length === 0 && (
        <div className={styles.empty}>No hail events in selected range</div>
      )}
    </div>
  );
}
