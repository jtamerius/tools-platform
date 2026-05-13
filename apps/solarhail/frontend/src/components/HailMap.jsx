import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import DeckGL from '@deck.gl/react';
import { WebMercatorViewport, FlyToInterpolator } from '@deck.gl/core';
import { H3HexagonLayer } from '@deck.gl/geo-layers';
import { ScatterplotLayer } from '@deck.gl/layers';
import { Map } from 'react-map-gl/mapbox';
import styles from './HailMap.module.css';

const STYLES = {
  dark:      'mapbox://styles/mapbox/dark-v10',
  satellite: 'mapbox://styles/mapbox/satellite-streets-v12',
};
const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;

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

const INITIAL_VIEW = { longitude: -97, latitude: 38, zoom: 4, pitch: 0, bearing: 0 };

export function HailMap({
  cells,
  commercialFeatures = [],
  minMeshMm = 25,
  showRadar = true,
  showSolar = true,
  showCommercial = false,
  opacity = 0.8,
  allLoaded = true,
  onViewportChange,
  flyToTarget = null,
}) {
  const [viewState, setViewState] = useState(INITIAL_VIEW);
  const [roundedZoom, setRoundedZoom] = useState(Math.round(INITIAL_VIEW.zoom));
  const [tooltip, setTooltip] = useState(null);
  const [basemap, setBasemap] = useState('dark');

  const containerRef = useRef(null);
  const sizeRef = useRef({ width: 0, height: 0 });
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

  const roundedZoomRef = useRef(Math.round(INITIAL_VIEW.zoom));

  // Stable callback — never recreated, so DeckGL's drag state is never interrupted
  const handleViewStateChange = useCallback(({ viewState: vs }) => {
    setViewState(vs);
    setTooltip(null);
    latestVsRef.current = vs;
    const rz = Math.round(vs.zoom);
    if (rz !== roundedZoomRef.current) {
      roundedZoomRef.current = rz;
      setRoundedZoom(rz);
    }

    clearTimeout(vpTimerRef.current);
    vpTimerRef.current = setTimeout(() => {
      const { width, height } = sizeRef.current;
      if (!width || !height || !onViewportChangeRef.current) return;
      const vp = new WebMercatorViewport({ ...latestVsRef.current, width, height });
      const [west, south] = vp.unproject([0, height]);
      const [east, north] = vp.unproject([width, 0]);
      onViewportChangeRef.current({ north, south, east, west });
    }, 150);
  }, []);

  useEffect(() => {
    if (!flyToTarget) return;
    setViewState(vs => ({
      ...vs,
      longitude: flyToTarget.longitude,
      latitude: flyToTarget.latitude,
      zoom: 12,
      transitionDuration: 1200,
      transitionInterpolator: new FlyToInterpolator(),
    }));
  }, [flyToTarget]);

  const radarCells   = useMemo(() => cells.filter(c => c.maxMeshMm >= minMeshMm), [cells, minMeshMm]);

  // Pixel radius shrinks as you zoom in: ~6px at zoom 4, ~2px at zoom 10+
  const commercialRadius = useMemo(
    () => Math.max(2, 7 - (roundedZoom - 4) * 0.75),
    [roundedZoom],
  );

  const layers = useMemo(() => {
    const out = [];

    if (showRadar) out.push(new H3HexagonLayer({
      id: 'hail-hex',
      data: radarCells,
      getHexagon: d => d.h3_index,
      getFillColor: d => meshToColor(d.maxMeshMm),
      getElevation: 0,
      extruded: false,
      filled: true,
      stroked: false,
      opacity,
      pickable: true,
      updateTriggers: { getFillColor: radarCells },
    }));

    if (showSolar) out.push(new H3HexagonLayer({
      id: 'solar-hex',
      data: radarCells.filter(d => d.totalSolarExposed > 0),
      getHexagon: d => d.h3_index,
      getFillColor: d => solarToColor(d.totalSolarExposed),
      getElevation: 0,
      extruded: false,
      filled: true,
      stroked: false,
      opacity,
      pickable: true,
      updateTriggers: { getFillColor: radarCells },
    }));

    if (showCommercial) out.push(new ScatterplotLayer({
      id: 'commercial-points',
      data: commercialFeatures,
      getPosition: d => [d.xlong, d.ylat],
      getFillColor: d => d.maxMeshMm >= minMeshMm
        ? [255, 230, 80, 210]
        : [160, 160, 160, 130],
      getLineColor: d => d.maxMeshMm >= minMeshMm
        ? [180, 100, 0, 230]
        : [80, 80, 80, 160],
      // Scale dot radius by capacity (sqrt keeps large sites from dominating)
      getRadius: d => {
        const base = commercialRadius;
        const scale = Math.min(2.5, Math.sqrt(Math.max(1, d.capacity_mwdc) / 20) + 0.4);
        return base * scale;
      },
      radiusUnits: 'pixels',
      stroked: true,
      lineWidthMinPixels: 1.2,
      pickable: true,
      updateTriggers: {
        getFillColor: [minMeshMm],
        getLineColor: [minMeshMm],
        getRadius: [commercialRadius],
      },
    }));

    return out;
  }, [showRadar, showSolar, showCommercial, radarCells, commercialFeatures, minMeshMm, opacity, commercialRadius]);

  const onHover = useCallback(({ object, x, y }) => {
    setTooltip(object ? { object, x, y } : null);
  }, []);

  return (
    <div ref={containerRef} className={styles.wrapper}>
      <DeckGL
        viewState={viewState}
        onViewStateChange={handleViewStateChange}
        controller={true}
        layers={layers}
        onHover={onHover}
      >
        <Map reuseMaps mapStyle={STYLES[basemap]} mapboxAccessToken={MAPBOX_TOKEN} />
      </DeckGL>

      {tooltip && (
        <div className={styles.tooltip} style={{ left: tooltip.x + 12, top: tooltip.y - 10 }}>
          {tooltip.object.p_name ? (
            <>
              <div className={styles.tooltipTitle}>{tooltip.object.p_name}</div>
              {(tooltip.object.p_county || tooltip.object.p_state) && (
                <div className={styles.tooltipSubtitle}>
                  {[tooltip.object.p_county, tooltip.object.p_state].filter(Boolean).join(', ')}
                </div>
              )}
              <div className={styles.tooltipRow}>
                <span>Capacity</span>
                <strong>{tooltip.object.capacity_mwdc.toFixed(1)} MW</strong>
              </div>
              <div className={styles.tooltipRow}>
                <span>Max MESH</span>
                <strong>{tooltip.object.maxMeshMm.toFixed(1)} mm</strong>
              </div>
            </>
          ) : (
            <>
              <div className={styles.tooltipRow}>
                <span>Max MESH</span>
                <strong>{tooltip.object.maxMeshMm.toFixed(1)} mm</strong>
              </div>
              {tooltip.object.totalSolarExposed > 0 && (
                <div className={styles.tooltipRow}>
                  <span>Solar systems</span>
                  <strong>{tooltip.object.totalSolarExposed.toFixed(0)}</strong>
                </div>
              )}
              {tooltip.object.totalCommercialMwdc > 0 && (
                <div className={styles.tooltipRow}>
                  <span>Commercial MW</span>
                  <strong>{tooltip.object.totalCommercialMwdc.toFixed(1)}</strong>
                </div>
              )}
            </>
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

      {!allLoaded && (
        <div className={styles.loadingBadge}>Loading data…</div>
      )}

      {allLoaded && cells.length === 0 && (
        <div className={styles.empty}>No hail events in selected range</div>
      )}
    </div>
  );
}
