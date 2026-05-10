import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import DeckGL from '@deck.gl/react';
import { WebMercatorViewport } from '@deck.gl/core';
import { H3HexagonLayer } from '@deck.gl/geo-layers';
import { Map } from 'react-map-gl/mapbox';
import styles from './HailMap.module.css';

const MAP_STYLE = 'mapbox://styles/mapbox/satellite-streets-v12';
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
  const containerRef = useRef(null);
  const sizeRef = useRef({ width: 0, height: 0 });

  // Track container dimensions for viewport bbox computation
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      sizeRef.current = { width, height };
      if (onViewportChange && width && height) {
        const vp = new WebMercatorViewport({ ...viewState, width, height });
        const [[west, south], [east, north]] = vp.getBounds();
        onViewportChange({ north, south, east, west });
      }
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleViewStateChange = useCallback(({ viewState: vs }) => {
    setViewState(vs);
    setTooltip(null);
    if (onViewportChange) {
      const { width, height } = sizeRef.current;
      if (width && height) {
        const vp = new WebMercatorViewport({ ...vs, width, height });
        const [[west, south], [east, north]] = vp.getBounds();
        onViewportChange({ north, south, east, west });
      }
    }
  }, [onViewportChange]);

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
        <Map reuseMaps mapStyle={MAP_STYLE} mapboxAccessToken={MAPBOX_TOKEN} />
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

      {cells.length === 0 && (
        <div className={styles.empty}>No hail events in selected range</div>
      )}
    </div>
  );
}
