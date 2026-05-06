import { useState, useCallback, useMemo, useEffect } from 'react';
import DeckGL from '@deck.gl/react';
import { H3HexagonLayer } from '@deck.gl/geo-layers';
import { PolygonLayer } from '@deck.gl/layers';
import { Map } from 'react-map-gl/maplibre';
import styles from './HailMap.module.css';

const MAP_STYLE = {
  version: 8,
  sources: {
    satellite: {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      attribution: 'Esri, Maxar, Earthstar Geographics',
    },
  },
  layers: [{ id: 'satellite', type: 'raster', source: 'satellite' }],
};

const LOG_CAP = Math.log(51); // log(51) ≈ 3.93 — ~50 systems = full opacity

/** Teal color scaled by log(estimated_solar_systems), capped at ~50 systems */
function solarToColor(systems) {
  const alpha = Math.round(Math.min(Math.log(systems + 1) / LOG_CAP, 1) * 180);
  return [0, 180, 160, alpha];
}

/** Map MESH mm (25–60+) to RGBA [r,g,b,a] */
function meshToColor(mm, alpha = 200) {
  const t = Math.min(Math.max((mm - 25) / 35, 0), 1); // 0 at 25mm, 1 at 60mm
  let r, g, b;
  if (t < 0.5) {
    const s = t * 2;
    r = 255;
    g = Math.round(229 - (229 - 136) * s); // 229→136
    b = Math.round(0);
  } else {
    const s = (t - 0.5) * 2;
    r = Math.round(255 - (255 - 204) * s); // 255→204
    g = Math.round(136 * (1 - s));          // 136→0
    b = 0;
  }
  return [r, g, b, alpha];
}

export function HailMap({ cells, metro, solarCells = [], showSolar = false, opacity = 0.8 }) {
  const [tooltip, setTooltip] = useState(null);

  const initialViewState = useMemo(() => ({
    longitude: metro?.lon ?? -97.4,
    latitude:  metro?.lat ?? 38.0,
    zoom: 9,
    pitch: 0,
    bearing: 0,
  }), [metro?.lon, metro?.lat]);

  const [viewState, setViewState] = useState(initialViewState);

  // Re-center when metro changes
  useEffect(() => {
    if (metro) {
      setViewState(vs => ({
        ...vs,
        longitude: metro.lon,
        latitude: metro.lat,
        zoom: 9,
        transitionDuration: 600,
      }));
    }
  }, [metro?.lon, metro?.lat]);

  const metroOutlineLayer = useMemo(() => {
    if (!metro) return null;
    const { latMin, latMax, lonMin, lonMax } = metro;
    return new PolygonLayer({
      id: 'metro-outline',
      data: [{ polygon: [[lonMin, latMin], [lonMax, latMin], [lonMax, latMax], [lonMin, latMax]] }],
      getPolygon: d => d.polygon,
      stroked: true,
      filled: false,
      getLineColor: [255, 255, 255, 160],
      getLineWidth: 2,
      lineWidthUnits: 'pixels',
      lineWidthMinPixels: 1,
    });
  }, [metro]);

  const solarLayer = useMemo(() => showSolar && solarCells.length > 0
    ? new H3HexagonLayer({
        id: 'solar-hex',
        data: solarCells,
        getHexagon: d => d.h3_index,
        getFillColor: d => solarToColor(d.estimated_solar_systems),
        getElevation: 0,
        extruded: false,
        filled: true,
        stroked: false,
        opacity,
        pickable: false,
        updateTriggers: { getFillColor: solarCells },
      })
    : null,
  [solarCells, showSolar, opacity]);

  const hailLayer = useMemo(() => new H3HexagonLayer({
    id: 'hail-hex',
    data: cells,
    getHexagon: d => d.h3_index,
    getFillColor: d => meshToColor(d.maxMeshMm),
    getElevation: 0,
    extruded: false,
    filled: true,
    stroked: false,
    opacity,
    pickable: true,
    updateTriggers: { getFillColor: cells },
  }), [cells, opacity]);

  const onHover = useCallback(({ object, x, y }) => {
    setTooltip(object ? { object, x, y } : null);
  }, []);

  return (
    <div className={styles.wrapper}>
      <DeckGL
        viewState={viewState}
        onViewStateChange={({ viewState: vs }) => setViewState(vs)}
        controller={true}
        layers={[metroOutlineLayer, solarLayer, hailLayer].filter(Boolean)}
        onHover={onHover}
      >
        <Map mapStyle={MAP_STYLE} />
      </DeckGL>

      {tooltip && (
        <div
          className={styles.tooltip}
          style={{ left: tooltip.x + 12, top: tooltip.y - 10 }}
        >
          <div className={styles.tooltipRow}>
            <span>Max MESH</span>
            <strong>{tooltip.object.maxMeshMm.toFixed(1)} mm</strong>
          </div>
          <div className={styles.tooltipRow}>
            <span>Solar systems</span>
            <strong>{tooltip.object.totalSolarExposed.toFixed(2)}</strong>
          </div>
          <div className={styles.tooltipRow}>
            <span>Hail days</span>
            <strong>{tooltip.object.hailDays}</strong>
          </div>
        </div>
      )}

      {cells.length === 0 && (
        <div className={styles.empty}>No hail events in selected range</div>
      )}
    </div>
  );
}
