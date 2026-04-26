"""visualization/precip_interactive.py — Interactive Plotly forecast explorer.

Public API
----------
plot_precip_interactive(result, events, output_dir, show, s3_bucket, locations) → Path

Features
--------
- Cumulative precipitation ensemble spaghetti with IQR band
- Temperature 2m ensemble IQR + median
- Wind speed 10m ensemble IQR + median
- Precipitation occurrence tick strip
- Translucent storm event windows with labels
- "Now" reference line
- Location dropdown (switches via S3 fetch when s3_bucket is provided)
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Union
from zoneinfo import ZoneInfo

# Third-party imports — optional in Lambda (stdlib-only) context
try:
    import numpy as np
    from scipy.ndimage import uniform_filter1d
    import plotly.graph_objects as go
    from plotly.subplots import make_subplots
    _HAS_PLOTTING = True
except ImportError:
    _HAS_PLOTTING = False

try:
    from .plotter import MODEL_COLORS, _FALLBACK_COLORS
except ImportError:
    MODEL_COLORS = {
        "gfs_seamless":          "#1f77b4",
        "ecmwf_ifs025":          "#d62728",
        "icon_seamless":         "#2ca02c",
        "gem_global":            "#9467bd",
        "gfs_hrrr":              "#ff7f0e",
    }
    _FALLBACK_COLORS = ["#1f77b4", "#d62728", "#2ca02c", "#9467bd", "#ff7f0e", "#17becf"]

_MT = ZoneInfo("America/Denver")
_PLOT_DIV_ID = "forecast-plot"
_KDE_DIV_ID  = "kde-plot"

_EVENT_PALETTE = [
    "rgba(255, 193, 7, 0.13)",
    "rgba(76, 175, 80, 0.13)",
    "rgba(33, 150, 243, 0.13)",
    "rgba(233, 30, 99, 0.13)",
    "rgba(156, 39, 176, 0.13)",
]
_EVENT_BORDER_PALETTE = [
    "rgba(255, 160, 0, 0.6)",
    "rgba(56, 142, 60, 0.6)",
    "rgba(25, 118, 210, 0.6)",
    "rgba(194, 24, 91, 0.6)",
    "rgba(123, 31, 162, 0.6)",
]


def _to_array(values: list) -> np.ndarray:
    return np.array([np.nan if v is None else v for v in values], dtype=float)


def _parse_times(time_strings: list[str]) -> list[datetime]:
    return [datetime.fromisoformat(t).replace(tzinfo=timezone.utc) for t in time_strings]


def _mt_label(t) -> str:
    if isinstance(t, str):
        dt = datetime.fromisoformat(t).replace(tzinfo=timezone.utc)
    else:
        dt = t  # already a tz-aware datetime
    return dt.astimezone(_MT).strftime("%b %-d %-I%p MT")


def _to_mt_iso(dt: datetime) -> str:
    """Naive MT ISO string suitable as a Plotly x-axis value (Plotly displays as-is)."""
    return dt.astimezone(_MT).strftime("%Y-%m-%dT%H:%M")


def _hex_to_rgb(hex_color: str) -> str:
    h = hex_color.lstrip("#")
    return ",".join(str(int(h[i:i+2], 16)) for i in (0, 2, 4))


def _add_ens_iqr(
    fig,
    time_axis: list,
    series_list: list,
    model: str,
    m_idx: int,
    row: int,
    y_label: str,
    cumulative: bool = False,
    primary_row: bool = False,
) -> float | None:
    """Add IQR band (40–60%) + median trace for one model to one subplot row.

    Args:
        primary_row: If True, adds legend entries. If False, joins same legendgroup
                     so the traces toggle with the primary row's legend entries.

    Returns:
        Peak of the median, or None if insufficient data.
    """
    if not series_list:
        return None

    color = MODEL_COLORS.get(model, _FALLBACK_COLORS[m_idx % len(_FALLBACK_COLORS)])
    model_label = "GFS-HRRR" if model == "gfs_hrrr" else model.split("_")[0].upper()
    rgba = f"rgba({_hex_to_rgb(color)},0.18)"

    raw_arrs: list[np.ndarray] = [_to_array(s) for s in series_list]

    if len(raw_arrs) < 2:
        return None

    # Clip to the last timestep where at least one member has non-NaN data.
    # This prevents short-range models (e.g. ICON, ~8 days) from extending a
    # flat line all the way to the 16-day axis edge.
    col_any_valid = np.any(~np.isnan(np.vstack(raw_arrs)), axis=0)
    if col_any_valid.any():
        valid_end = int(np.where(col_any_valid)[0][-1]) + 1
        time_axis = time_axis[:valid_end]
        raw_arrs = [a[:valid_end] for a in raw_arrs]

    member_arrs: list[np.ndarray] = []
    for arr in raw_arrs:
        member_arrs.append(np.nancumsum(arr) if cumulative else arr)

    stacked = np.vstack(member_arrs)
    _win = 6
    q40 = uniform_filter1d(np.nanpercentile(stacked, 40, axis=0), _win)
    q50 = uniform_filter1d(np.nanpercentile(stacked, 50, axis=0), _win)
    q60 = uniform_filter1d(np.nanpercentile(stacked, 60, axis=0), _win)

    # Convert clipped UTC time axis to Mountain Time naive strings for Plotly
    time_mt = [_to_mt_iso(t) for t in time_axis]

    # Upper bound (invisible)
    fig.add_trace(go.Scatter(
        x=time_mt, y=q60, mode="lines", line=dict(width=0),
        legendgroup=f"{model}_iqr", showlegend=False, hoverinfo="skip",
    ), row=row, col=1)

    # Lower bound + fill
    fig.add_trace(go.Scatter(
        x=time_mt, y=q40, mode="lines", line=dict(width=0),
        fill="tonexty", fillcolor=rgba,
        name=f"{model_label} IQR (40–60%)",
        legendgroup=f"{model}_iqr",
        showlegend=primary_row,
        hoverinfo="skip",
    ), row=row, col=1)

    # Median line — x is now MT, so %{x|format} displays correct local time
    fig.add_trace(go.Scatter(
        x=time_mt, y=q50,
        mode="lines",
        line=dict(color=color, width=2.5 if primary_row else 2.0),
        name=f"{model_label}",
        legendgroup=f"{model}_mean",
        showlegend=primary_row,
        hovertemplate=(
            f"<b>{model_label}</b><br>"
            "Time: %{x|%a %b %d %-I%p} MT<br>"
            f"{y_label}: %{{y:.2f}}<extra></extra>"
        ),
    ), row=row, col=1)

    return float(np.nanmax(q50))


def plot_precip_interactive(
    result: dict,
    events: list[dict],
    output_dir: Union[str, Path] = "plots",
    show: bool = False,
    s3_bucket: str | None = None,
    locations: list[dict] | None = None,
    kde_plot_html: str | None = None,
    cdn_domain: str | None = None,
) -> Path:
    """Create an interactive Plotly HTML forecast explorer with location dropdown.

    Generates four stacked subplots: cumulative precipitation, precipitation
    occurrence strip, temperature 2m, and wind speed 10m. A location dropdown
    at the top can switch between S3-stored forecasts for other named locations.

    Args:
        result:     Forecast result dict from ``fetch_forecast()``.
        events:     List of ``StormEvent`` dicts from ``detect_storm_events()``.
        output_dir: Output directory.
        show:       Open in browser after saving.
        s3_bucket:  S3 bucket name — enables location-switching dropdown.
        locations:  List of location dicts from ``locations.json``.

    Returns:
        Path to the saved HTML file.
    """
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)
    out_file = output_path / "precipitation_interactive.html"

    members = result.get("members")
    meta = result["meta"]
    ens_models = meta.get("ensemble_models", [])

    if not members or not ens_models:
        if not (s3_bucket or kde_plot_html):
            _write_placeholder(out_file)
            return out_file
        # No ensemble members available — create an empty 3-row subplot so
        # the JS layer can still populate it from S3 data.
        fig = make_subplots(
            rows=3, cols=1, shared_xaxes=True,
            row_heights=[0.44, 0.10, 0.44], vertical_spacing=0.04,
        )
        lat = meta.get("lat", "?")
        lon = meta.get("lon", 0)
        lon_label = f"{abs(lon)}°W" if lon < 0 else f"{lon}°E"
        fig.update_layout(
            title=dict(text=f"Ensemble Forecast — {lat}°N, {lon_label}", font=dict(size=15)),
            template="plotly_white", height=950, hovermode="x unified",
            legend=dict(orientation="h", yanchor="top", y=-0.08, xanchor="center", x=0.5,
                        font=dict(size=10), tracegroupgap=5),
            margin=dict(t=80, b=100), dragmode="pan",
        )
        fig.update_yaxes(title_text="Cumul. Precip (in)", range=[0, 1],
                         gridcolor="rgba(200,200,200,0.4)", row=1, col=1)
        fig.update_yaxes(range=[-0.5, 0.5], showgrid=False, row=2, col=1)
        fig.update_yaxes(title_text="Temperature (°F)",
                         gridcolor="rgba(200,200,200,0.4)", row=3, col=1)
        fig.update_xaxes(title_text="Time (Mountain)", tickformat="%a<br>%b %d",
                         gridcolor="rgba(200,200,200,0.4)", row=3, col=1)
        for row in [1, 2]:
            fig.update_xaxes(gridcolor="rgba(200,200,200,0.4)", row=row, col=1)
        plot_html = fig.to_html(
            full_html=False, div_id=_PLOT_DIV_ID, include_plotlyjs=True,
            config={"displayModeBar": True, "scrollZoom": False},
        )
        out_file = output_path / "forecast_interactive.html"
        full_html = _build_combined_html(
            precip_plot_html=plot_html,
            kde_html_fragment=kde_plot_html,
            title=f"Forecast — {lat}°N {lon_label}",
            current_lat=float(lat),
            current_lon=float(lon),
            s3_bucket=s3_bucket or "",
            locations=locations or [],
            events=events,
        )
        out_file.write_text(full_html, encoding="utf-8")
        print(f"  saved → {out_file}")
        return out_file

    time_axis = _parse_times(members["time"])
    precip_data = members.get("precipitation", {})
    temp_data   = members.get("temperature_2m", {})
    now_utc = datetime.now(timezone.utc)

    # ── 3-row subplot layout ───────────────────────────────────────────────────
    fig = make_subplots(
        rows=3, cols=1,
        shared_xaxes=True,
        row_heights=[0.44, 0.10, 0.23],
        vertical_spacing=0.04,
    )

    # ── Row 1: Cumulative precipitation ───────────────────────────────────────
    mean_maxes: list[float] = []
    for m_idx, model in enumerate(ens_models):
        peak = _add_ens_iqr(
            fig, time_axis, precip_data.get(model, []),
            model, m_idx, row=1,
            y_label="Cumul. Precip (in)",
            cumulative=True, primary_row=True,
        )
        if peak is not None:
            mean_maxes.append(peak)

    # ── Row 2: Precipitation occurrence tick strip ─────────────────────────────
    thresh = 1e-3
    strip_models: list[str] = []
    for m_idx, model in enumerate(ens_models):
        series_list = precip_data.get(model, [])
        if not series_list:
            continue
        color = MODEL_COLORS.get(model, _FALLBACK_COLORS[m_idx % len(_FALLBACK_COLORS)])
        model_label = "GFS-HRRR" if model == "gfs_hrrr" else model.split("_")[0].upper()
        strip_models.append(model_label)

        n_members = len(series_list)
        n_times = len(time_axis)
        wet_count = np.zeros(n_times, dtype=float)
        for series in series_list:
            arr = _to_array(series)
            wet_count += (arr > thresh).astype(float)
        wet_frac = wet_count / max(n_members, 1)

        wet_idx = [i for i in range(n_times) if wet_frac[i] > 0]
        if wet_idx:
            wt = [_to_mt_iso(time_axis[i]) for i in wet_idx]
            wy = [m_idx] * len(wet_idx)
            widths   = [max(0.5, wet_frac[i] * 4.0) for i in wet_idx]
            opacities = [max(0.25, wet_frac[i]) for i in wet_idx]

            fig.add_trace(go.Scatter(
                x=wt, y=wy, mode="markers",
                marker=dict(
                    symbol="line-ns", size=8,
                    line=dict(
                        width=widths,
                        color=[f"rgba({_hex_to_rgb(color)},{op:.2f})" for op in opacities],
                    ),
                    color=color,
                ),
                name=f"{model_label} precip occur.",
                legendgroup=f"{model}_mean",
                showlegend=False,
                hovertemplate=(
                    f"<b>{model_label}</b><br>"
                    "Time: %{x|%a %b %d %-I%p} MT<br>"
                    "Members wet: %{customdata:.0%}<extra></extra>"
                ),
                customdata=[wet_frac[i] for i in wet_idx],
            ), row=2, col=1)

    # ── Row 3: Temperature 2m ──────────────────────────────────────────────────
    for m_idx, model in enumerate(ens_models):
        _add_ens_iqr(
            fig, time_axis, temp_data.get(model, []),
            model, m_idx, row=3,
            y_label="Temp (°F)",
            cumulative=False, primary_row=False,
        )

    # ── Event windows (all rows) ───────────────────────────────────────────────
    if events:
        for ev_i, ev in enumerate(events):
            start_dt = datetime.fromisoformat(ev["start_time"]).replace(tzinfo=timezone.utc)
            end_dt   = datetime.fromisoformat(ev["end_time"]).replace(tzinfo=timezone.utc)
            mid_dt   = start_dt + (end_dt - start_dt) / 2
            fill_c   = _EVENT_PALETTE[ev_i % len(_EVENT_PALETTE)]
            border_c = _EVENT_BORDER_PALETTE[ev_i % len(_EVENT_BORDER_PALETTE)]

            fig.add_vrect(
                x0=_to_mt_iso(start_dt), x1=_to_mt_iso(end_dt),
                fillcolor=fill_c,
                line=dict(color=border_c, width=1.5, dash="dot"),
                layer="below", row="all", col=1,
            )
            fig.add_annotation(
                x=_to_mt_iso(mid_dt), y=0.97, xref="x", yref="y domain",
                text=(
                    f"<b>Event {ev['event_index']}</b><br>"
                    f"<span style='font-size:9px'>"
                    f"{_mt_label(ev['start_time'])} – {_mt_label(ev['end_time'])}<br>"
                    f"{ev['duration_hours']}h · peak {ev['peak_rate']:.3f} in/h</span>"
                ),
                showarrow=False, font=dict(size=11, color="#333"),
                bgcolor="rgba(255,255,255,0.82)",
                bordercolor=border_c.replace("0.6", "0.8"),
                borderwidth=1, borderpad=4, yanchor="top",
            )

    # ── "Now" reference line ───────────────────────────────────────────────────
    if time_axis[0] <= now_utc <= time_axis[-1]:
        now_mt = _to_mt_iso(now_utc)
        yref_map = {1: "y domain", 2: "y2 domain", 3: "y3 domain"}
        for row in [1, 2, 3]:
            fig.add_shape(
                type="line", x0=now_mt, x1=now_mt, y0=0, y1=1,
                yref=yref_map[row], xref="x",
                line=dict(color="black", width=1.5, dash="dash"),
            )
        fig.add_annotation(
            x=now_mt, y=0.97, xref="x", yref="y domain",
            text="<b>Now</b>", showarrow=False,
            font=dict(size=10, color="black"),
            bgcolor="rgba(255,255,255,0.7)", yanchor="top",
        )

    # ── Layout ────────────────────────────────────────────────────────────────
    lat = meta.get("lat", "?")
    lon = meta.get("lon", 0)
    lon_label = f"{abs(lon)}°W" if lon < 0 else f"{lon}°E"
    n_total = sum(len(precip_data.get(m, [])) for m in ens_models)

    fig.update_layout(
        title=dict(
            text=(
                f"Ensemble Forecast — {lat}°N, {lon_label}<br>"
                f"<sub>{n_total} ensemble members · "
                f"{len(events)} storm event(s) · "
                f"fetched {meta.get('fetched_at', '?')[:16]} UTC</sub>"
            ),
            font=dict(size=15),
        ),
        template="plotly_white",
        height=950,
        hovermode="x unified",
        legend=dict(
            orientation="h", yanchor="top", y=-0.08,
            xanchor="center", x=0.5,
            font=dict(size=10),
            itemclick="toggle", itemdoubleclick="toggleothers",
            tracegroupgap=5,
        ),
        margin=dict(t=80, b=100),
        dragmode="pan",
    )

    # Row 1: cumulative precip
    y_cap = max(mean_maxes) * 1.25 if mean_maxes else 1.0
    fig.update_yaxes(title_text="Cumul. Precip (in)", range=[0, y_cap],
                     gridcolor="rgba(200,200,200,0.4)", row=1, col=1)
    # Row 2: tick strip
    fig.update_yaxes(
        tickvals=list(range(len(strip_models))), ticktext=strip_models,
        tickfont=dict(size=9), range=[-0.5, len(strip_models) - 0.5],
        showgrid=False, row=2, col=1,
    )
    # Row 3: temperature (bottom — also gets x-axis label)
    fig.update_yaxes(title_text="Temperature (°F)",
                     gridcolor="rgba(200,200,200,0.4)", row=3, col=1)
    fig.update_xaxes(
        title_text="Time (Mountain)",
        tickformat="%a<br>%b %d",
        gridcolor="rgba(200,200,200,0.4)",
        row=3, col=1,
    )
    for row in [1, 2]:
        fig.update_xaxes(gridcolor="rgba(200,200,200,0.4)", row=row, col=1)

    # ── Render to custom HTML ─────────────────────────────────────────────────
    plot_html = fig.to_html(
        full_html=False,
        div_id=_PLOT_DIV_ID,
        include_plotlyjs=True,
        config={
            "displayModeBar": True,
            "modeBarButtonsToAdd": ["drawrect", "eraseshape"],
            "scrollZoom": False,
        },
    )

    if kde_plot_html is not None or s3_bucket:
        out_file = output_path / "forecast_interactive.html"
        full_html = _build_combined_html(
            precip_plot_html=plot_html,
            kde_html_fragment=kde_plot_html,
            title=f"Forecast — {lat}°N {lon_label}",
            current_lat=lat,
            current_lon=lon,
            s3_bucket=s3_bucket or "",
            locations=locations or [],
            events=events,
            cdn_domain=cdn_domain or "",
        )
    else:
        full_html = _build_full_html(
            plot_html=plot_html,
            title=f"Forecast — {lat}°N {lon_label}",
            current_lat=lat,
            current_lon=lon,
            s3_bucket=s3_bucket or "",
            locations=locations or [],
            plot_type="precip",
            cdn_domain=cdn_domain or "",
        )

    out_file.write_text(full_html, encoding="utf-8")
    print(f"  saved → {out_file}")

    if show:
        import webbrowser
        webbrowser.open(out_file.as_uri())

    return out_file


def _build_full_html(
    plot_html: str,
    title: str,
    current_lat: float,
    current_lon: float,
    s3_bucket: str,
    locations: list[dict],
    plot_type: str,  # "precip" or "kde"
    cdn_domain: str = "",
) -> str:
    """Wrap a Plotly HTML fragment in a full HTML page with a location dropdown."""

    locations_json = json.dumps(locations, separators=(",", ":"))
    model_colors_json = json.dumps(MODEL_COLORS, separators=(",", ":"))

    # Dropdown bar HTML (hidden if no locations)
    show_dropdown = "flex" if locations else "none"

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{title}</title>
  <style>
    * {{ box-sizing: border-box; margin: 0; padding: 0; }}
    body {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #fff; }}
    #loc-bar {{
      display: {show_dropdown};
      align-items: center;
      gap: 12px;
      padding: 10px 16px;
      background: #f8f9fa;
      border-bottom: 1px solid #dee2e6;
      flex-wrap: wrap;
    }}
    #loc-bar label {{ font-weight: 600; font-size: 14px; color: #333; white-space: nowrap; }}
    #loc-wrap {{ position: relative; }}
    #loc-input {{
      font-size: 14px;
      padding: 5px 10px;
      border: 1px solid #ced4da;
      border-radius: 6px;
      background: white;
      min-width: 220px;
      cursor: text;
      outline: none;
    }}
    #loc-input:focus {{ border-color: #86b7fe; box-shadow: 0 0 0 3px rgba(13,110,253,.15); }}
    #loc-suggestions {{
      display: none;
      position: absolute;
      top: 100%;
      left: 0;
      min-width: 100%;
      background: white;
      border: 1px solid #ced4da;
      border-top: none;
      border-radius: 0 0 6px 6px;
      list-style: none;
      max-height: 240px;
      overflow-y: auto;
      z-index: 1000;
      box-shadow: 0 4px 12px rgba(0,0,0,0.1);
    }}
    #loc-suggestions li {{
      padding: 6px 12px;
      cursor: pointer;
      font-size: 14px;
      white-space: nowrap;
    }}
    #loc-suggestions li:hover, #loc-suggestions li.ac-active {{ background: #e9ecef; }}
    #loc-suggestions li .state-tag {{ float: right; font-size: 11px; color: #888; margin-left: 12px; }}
    #loc-status {{ font-size: 12px; color: #6c757d; font-style: italic; }}
    #loc-bar .s3-note {{
      font-size: 11px;
      color: #aaa;
      margin-left: auto;
    }}
    #run-bar {{
      display: none;
      align-items: center;
      gap: 10px;
      padding: 8px 16px;
      background: #eef2f7;
      border-bottom: 1px solid #dee2e6;
      flex-wrap: wrap;
    }}
    #run-bar label {{ font-weight: 600; font-size: 13px; color: #333; white-space: nowrap; }}
    #run-bar .run-edge {{ font-size: 11px; color: #999; }}
    #run-slider {{ width: 220px; cursor: pointer; accent-color: #4a6fa5; }}
    #run-label {{ font-size: 13px; color: #444; font-family: monospace; }}
    #iqr-slider {{ width: 120px; cursor: pointer; accent-color: #4a6fa5; }}
    #iqr-label {{ font-size: 13px; color: #444; font-family: monospace; white-space: nowrap; }}
    .bar-sep {{ width: 1px; height: 16px; background: #ccc; margin: 0 6px; align-self: center; }}
  </style>
</head>
<body>
  <div id="loc-bar">
    <label>Location:</label>
    <div id="loc-wrap">
      <input type="text" id="loc-input" placeholder="Type a city\u2026" autocomplete="off" spellcheck="false">
      <ul id="loc-suggestions"></ul>
    </div>
    <span id="loc-status"></span>
    <span class="s3-note" id="s3-note"></span>
  </div>
  <div id="run-bar">
    <span id="run-controls" style="display:none;align-items:center;gap:10px;">
      <label>Forecast run:</label>
      <span class="run-edge">older</span>
      <input type="range" id="run-slider" min="0" max="0" value="0" step="1">
      <span class="run-edge">latest</span>
      <span id="run-label"></span>
      <span class="bar-sep"></span>
    </span>
    <label for="iqr-slider">Band:</label>
    <input type="range" id="iqr-slider" min="0" max="50" value="10" step="1">
    <span id="iqr-label">40\u201360%</span>
  </div>
  {plot_html}
  <script type="text/javascript">
  (function() {{
    'use strict';

    var LOCATIONS   = {locations_json};
    var S3_BUCKET   = {json.dumps(s3_bucket)};
    var DATA_ORIGIN = {json.dumps("https://" + cdn_domain if cdn_domain else "")};
    var CURRENT_LAT = {json.dumps(current_lat)};
    var CURRENT_LON = {json.dumps(current_lon)};
    var MODEL_COLORS = {model_colors_json};
    var DIV_ID = {json.dumps(_PLOT_DIV_ID)};
    var PLOT_TYPE = {json.dumps(plot_type)};

    // Match Python's _EVENT_PALETTE / _EVENT_BORDER_PALETTE exactly
    var EVENT_COLORS = ['rgba(255,193,7,0.13)','rgba(76,175,80,0.13)',
      'rgba(33,150,243,0.13)','rgba(233,30,99,0.13)','rgba(156,39,176,0.13)'];
    var EVENT_BORDER = ['rgba(255,160,0,0.6)','rgba(56,142,60,0.6)',
      'rgba(25,118,210,0.6)','rgba(194,24,91,0.6)','rgba(123,31,162,0.6)'];

    // ── Autocomplete setup ───────────────────────────────────────────────────
    var input    = document.getElementById('loc-input');
    var suggest  = document.getElementById('loc-suggestions');
    var statusEl = document.getElementById('loc-status');
    var s3note   = document.getElementById('s3-note');

    if (!LOCATIONS.length) return;

    if (!S3_BUCKET) {{
      s3note.textContent = 'Set ENSEMBLE_S3_BUCKET and re-run to enable switching';
    }}

    // Pre-select current location in the input box
    (function() {{
      var cur = LOCATIONS.find(function(l) {{
        return Math.abs(l.lat - CURRENT_LAT) < 0.02 && Math.abs(l.lon - CURRENT_LON) < 0.02;
      }});
      if (cur) input.value = cur.name + ', ' + cur.state;
    }})();

    var activeIdx = -1;

    function getMatches(q) {{
      q = q.trim().toLowerCase();
      if (!q) return [];
      return LOCATIONS.filter(function(l) {{
        return l.name.toLowerCase().indexOf(q) !== -1 ||
               l.state.toLowerCase() === q;
      }}).slice(0, 10);
    }}

    function renderSuggestions(matches) {{
      suggest.innerHTML = '';
      activeIdx = -1;
      if (!matches.length) {{ suggest.style.display = 'none'; return; }}
      matches.forEach(function(loc) {{
        var li = document.createElement('li');
        li.innerHTML = loc.name + ' <span class="state-tag">' + loc.state + '</span>';
        li.addEventListener('mousedown', function(e) {{
          e.preventDefault();
          selectLoc(loc);
        }});
        suggest.appendChild(li);
      }});
      suggest.style.display = 'block';
    }}

    function selectLoc(loc) {{
      input.value = loc.name + ', ' + loc.state;
      suggest.style.display = 'none';
      activeIdx = -1;
      if (!S3_BUCKET) {{
        statusEl.textContent = 'Run: python make_plots.py --location "' + loc.name + '"';
        return;
      }}
      statusEl.textContent = 'Loading ' + loc.name + ' \u2026';
      fetchAndRender(loc);
    }}

    input.addEventListener('input', function() {{
      renderSuggestions(getMatches(this.value));
    }});

    input.addEventListener('keydown', function(e) {{
      var items = suggest.querySelectorAll('li');
      if (e.key === 'ArrowDown') {{
        e.preventDefault();
        activeIdx = Math.min(activeIdx + 1, items.length - 1);
        items.forEach(function(li, i) {{ li.classList.toggle('ac-active', i === activeIdx); }});
      }} else if (e.key === 'ArrowUp') {{
        e.preventDefault();
        activeIdx = Math.max(activeIdx - 1, 0);
        items.forEach(function(li, i) {{ li.classList.toggle('ac-active', i === activeIdx); }});
      }} else if (e.key === 'Enter') {{
        e.preventDefault();
        var matches = getMatches(input.value);
        var pick = activeIdx >= 0 ? matches[activeIdx] : matches[0];
        if (pick) selectLoc(pick);
      }} else if (e.key === 'Escape') {{
        suggest.style.display = 'none';
      }}
    }});

    document.addEventListener('click', function(e) {{
      if (!document.getElementById('loc-wrap').contains(e.target)) {{
        suggest.style.display = 'none';
      }}
    }});

    // ── Math helpers ─────────────────────────────────────────────────────────

    // Return the index one past the last non-null value across all member series.
    // Prevents short-range models (ICON ~8 days) from extending a flat line to
    // the 16-day axis edge.
    function lastValidIdx(seriesList) {{
      var last = 0;
      (seriesList || []).forEach(function(s) {{
        for (var i = (s || []).length - 1; i >= 0; i--) {{
          if (s[i] != null) {{ if (i + 1 > last) last = i + 1; break; }}
        }}
      }});
      return last > 0 ? last : (seriesList[0] ? seriesList[0].length : 0);
    }}

    function cumsum(arr) {{
      var s = 0;
      return arr.map(function(v) {{ s += (v == null ? 0 : +v || 0); return s; }});
    }}

    function quantile(sortedArr, p) {{
      if (!sortedArr.length) return 0;
      var pos = (sortedArr.length - 1) * p;
      var lo = Math.floor(pos), hi = Math.ceil(pos);
      return sortedArr[lo] + (sortedArr[hi] - sortedArr[lo]) * (pos - lo);
    }}

    function colQuantile(arrays, p) {{
      var n = arrays[0].length;
      var res = new Array(n);
      for (var i = 0; i < n; i++) {{
        var col = arrays.map(function(a) {{ return a[i]; }})
                        .filter(function(v) {{ return v != null && !isNaN(+v); }})
                        .map(Number).sort(function(a, b) {{ return a - b; }});
        res[i] = quantile(col, p);
      }}
      return res;
    }}

    function boxSmooth(arr, win) {{
      var h = Math.floor(win / 2);
      return arr.map(function(v, i) {{
        var s = 0, c = 0;
        for (var j = Math.max(0, i-h); j <= Math.min(arr.length-1, i+h); j++) {{
          s += arr[j]; c++;
        }}
        return s / c;
      }});
    }}

    function hexToRgb(hex) {{
      var h = hex.replace('#','');
      return parseInt(h.slice(0,2),16)+','+parseInt(h.slice(2,4),16)+','+parseInt(h.slice(4,6),16);
    }}

    var FALLBACKS = ['#1f77b4','#d62728','#2ca02c','#9467bd','#ff7f0e','#17becf'];

    // ── Build Plotly traces from a ForecastResult dict ────────────────────────
    function buildTraces(data) {{
      var traces = [];
      var members = data.members;
      if (!members) return traces;

      var timeArr = members.time || [];
      var precipData = members.precipitation || {{}};
      // Fall back to precipitation keys so cities with missing ensemble_models still render
      var ensModels = (data.meta || {{}}).ensemble_models || Object.keys(precipData);
      var WIN = 6;

      ensModels.forEach(function(model, mIdx) {{
        var color = MODEL_COLORS[model] || FALLBACKS[mIdx % FALLBACKS.length];
        var rgb   = hexToRgb(color);
        var mlabel = model === 'gfs_hrrr' ? 'GFS-HRRR' : model.split('_')[0].toUpperCase();
        var rgba  = 'rgba(' + rgb + ',0.18)';

        // Clip this model's traces to its last non-null timestep so short-range
        // models (e.g. ICON ~8 days) don't extend a flat line to the 16-day edge.
        var precipSeries = precipData[model] || [];
        var tempSeries   = (members.temperature_2m || {{}})[model] || [];
        var allSeries = precipSeries.concat(tempSeries);
        var vEnd = allSeries.length ? lastValidIdx(allSeries) : timeArr.length;
        var tArr = vEnd < timeArr.length ? timeArr.slice(0, vEnd) : timeArr;
        var tArrMt = tArr.map(toMtIso);  // MT naive strings for Plotly x-axis
        var _latestT0 = availableRuns.length ? (((availableRuns[0].data.members||{{}}).time||(availableRuns[0].data.hourly||{{}}).time||[])[0]||null) : null;
        var _refMs = _latestT0 ? new Date(_latestT0.slice(-1)!=='Z'?_latestT0+'Z':_latestT0).getTime() : 0;
        var _refIdx = 0;
        if (_refMs) {{ for (var _ni = 0; _ni < tArr.length; _ni++) {{ var _t = tArr[_ni]; if (new Date(_t.slice(-1)!=='Z'?_t+'Z':_t).getTime() >= _refMs) {{ _refIdx = _ni; break; }} }} }}

        // ── Row 1: cumulative precip ──────────────────────────────────────────
        if (precipSeries.length > 1) {{
          var clipped = precipSeries.map(function(s) {{ return s.slice(0, vEnd); }});
          var cumsums = clipped.map(cumsum);
          if (_refIdx > 0) {{ cumsums = cumsums.map(function(cs) {{ var b = cs[_refIdx]||0; return cs.map(function(v) {{ return v - b; }}); }}); }}
          var qLo = boxSmooth(colQuantile(cumsums, 0.5 - iqrHalf/100), WIN);
          var q50 = boxSmooth(colQuantile(cumsums, 0.50), WIN);
          var qHi = boxSmooth(colQuantile(cumsums, 0.5 + iqrHalf/100), WIN);

          traces.push({{ type:'scatter', x:tArrMt, y:qHi, mode:'lines',
            line:{{width:0}}, hoverinfo:'skip', showlegend:false,
            legendgroup:model+'_iqr', xaxis:'x', yaxis:'y' }});
          traces.push({{ type:'scatter', x:tArrMt, y:qLo, mode:'lines',
            line:{{width:0}}, fill:'tonexty', fillcolor:rgba,
            name:mlabel+' IQR', hoverinfo:'skip',
            legendgroup:model+'_iqr', xaxis:'x', yaxis:'y' }});
          traces.push({{ type:'scatter', x:tArrMt, y:q50, mode:'lines',
            line:{{color:color,width:2.5}},
            name:mlabel,
            legendgroup:model+'_mean', xaxis:'x', yaxis:'y',
            hovertemplate:'<b>'+mlabel+'</b><br>Cumul. Precip: %{{y:.2f}} in<extra></extra>' }});
        }}

        // ── Row 2: precipitation occurrence tick strip ────────────────────────
        if (precipSeries.length > 1) {{
          var clippedP = precipSeries.map(function(s) {{ return s.slice(0, vEnd); }});
          var wetTimes = [], wetY = [], wetFracs = [];
          for (var t = 0; t < tArr.length; t++) {{
            var wetCnt = 0;
            for (var m = 0; m < clippedP.length; m++) {{
              var v = clippedP[m][t];
              if (v != null && v > 1e-3) wetCnt++;
            }}
            var frac = wetCnt / clippedP.length;
            if (frac > 0) {{
              wetTimes.push(tArrMt[t]);
              wetY.push(mIdx);
              wetFracs.push(frac);
            }}
          }}
          if (wetTimes.length) {{
            var tickColor1 = 'rgba('+rgb+',0.75)';
            var widths1 = wetFracs.map(function(f){{ return 0.3+f*1.7; }});
            traces.push({{
              type:'scatter',x:wetTimes,y:wetY,mode:'markers',
              marker:{{symbol:'line-ns',size:8,color:tickColor1,line:{{color:tickColor1,width:widths1}}}},
              name:mlabel+' precip occur.',legendgroup:model+'_mean',showlegend:false,
              xaxis:'x2',yaxis:'y2',hoverinfo:'skip',
            }});
          }}
        }}

        // ── Row 3: temperature ────────────────────────────────────────────────
        if (tempSeries.length > 1) {{
          var tempArrs = tempSeries.map(function(s) {{ return s.slice(0, vEnd).map(function(v) {{ return v==null?NaN:+v; }}); }});
          var tqLo = colQuantile(tempArrs, 0.5 - iqrHalf/100);
          var tq50 = colQuantile(tempArrs, 0.50);
          var tqHi = colQuantile(tempArrs, 0.5 + iqrHalf/100);

          traces.push({{ type:'scatter', x:tArrMt, y:tqHi, mode:'lines',
            line:{{width:0}}, hoverinfo:'skip', showlegend:false,
            legendgroup:model+'_iqr', xaxis:'x3', yaxis:'y3' }});
          traces.push({{ type:'scatter', x:tArrMt, y:tqLo, mode:'lines',
            line:{{width:0}}, fill:'tonexty', fillcolor:rgba,
            hoverinfo:'skip', showlegend:false,
            legendgroup:model+'_iqr', xaxis:'x3', yaxis:'y3' }});
          traces.push({{ type:'scatter', x:tArrMt, y:tq50, mode:'lines',
            line:{{color:color,width:2.0}},
            name:mlabel+' temp', showlegend:false,
            legendgroup:model+'_mean', xaxis:'x3', yaxis:'y3',
            hovertemplate:'<b>'+mlabel+'</b><br>Temp: %{{y:.1f}} °F<extra></extra>' }});
        }}

      }});

      return traces;
    }}

    // ── MT time helpers ──────────────────────────────────────────────────────
    var _mtFmtIso = new Intl.DateTimeFormat('en-CA', {{
      timeZone:'America/Denver', year:'numeric', month:'2-digit', day:'2-digit',
      hour:'2-digit', minute:'2-digit', hour12:false
    }});
    function toMtIso(iso) {{
      var d = new Date(iso.indexOf('+') < 0 && iso.slice(-1) !== 'Z' ? iso+'Z' : iso);
      var parts = _mtFmtIso.formatToParts(d);
      var yr='', mo='', dy='', hh='', mm='';
      parts.forEach(function(p) {{
        if (p.type==='year')   yr=p.value;
        if (p.type==='month')  mo=p.value;
        if (p.type==='day')    dy=p.value;
        if (p.type==='hour')   hh=p.value;
        if (p.type==='minute') mm=p.value;
      }});
      if (hh==='24') hh='00';
      return yr+'-'+mo+'-'+dy+'T'+hh+':'+mm;
    }}
    function midMtIso(t0, t1) {{
      var ms0 = new Date(t0.indexOf('+') < 0 && t0.slice(-1) !== 'Z' ? t0+'Z' : t0).getTime();
      var ms1 = new Date(t1.indexOf('+') < 0 && t1.slice(-1) !== 'Z' ? t1+'Z' : t1).getTime();
      return toMtIso(new Date((ms0+ms1)/2).toISOString());
    }}
    function midIso(t0, t1) {{
      return new Date((new Date(t0).getTime() + new Date(t1).getTime()) / 2).toISOString();
    }}

    function fmtMt(iso) {{
      var d = new Date(iso.indexOf('+') < 0 && iso.slice(-1) !== 'Z' ? iso + 'Z' : iso);
      var parts = new Intl.DateTimeFormat('en-US', {{
        timeZone:'America/Denver', weekday:'short', month:'short', day:'numeric',
        hour:'numeric', hour12:true
      }}).formatToParts(d);
      var dy='', mo='', dt='', h='', ap='';
      parts.forEach(function(p) {{
        if (p.type==='weekday')   dy=p.value;
        if (p.type==='month')     mo=p.value;
        if (p.type==='day')       dt=p.value;
        if (p.type==='hour')      h=p.value;
        if (p.type==='dayPeriod') ap=p.value.toLowerCase();
      }});
      return dy+' '+mo+' '+dt+' '+h+ap+' MT';
    }}

    function buildEventShapes(events) {{
      // Create one rect per subplot row (y domain, y2 domain, …) so gaps between
      // subplots remain visible — matches Python add_vrect(row="all") behaviour.
      var shapes = [];
      var rowRefs = ['y domain', 'y2 domain', 'y3 domain'];
      (events || []).forEach(function(ev, i) {{
        var fc = EVENT_COLORS[i % EVENT_COLORS.length];
        var bc = EVENT_BORDER[i % EVENT_BORDER.length];
        rowRefs.forEach(function(yref) {{
          shapes.push({{
            type: 'rect', xref: 'x', yref: yref,
            x0: toMtIso(ev.start_time), x1: toMtIso(ev.end_time), y0: 0, y1: 1,
            fillcolor: fc,
            line: {{ width: 1.5, color: bc, dash: 'dot' }},
            layer: 'below'
          }});
        }});
      }});
      return shapes;
    }}

    function buildEventAnnotations(events) {{
      return (events || []).map(function(ev, i) {{
        var bc = EVENT_BORDER[i % EVENT_BORDER.length];
        return {{
          xref: 'x', yref: 'y domain',
          x: midMtIso(ev.start_time, ev.end_time), y: 0.97,
          text: '<b>Event ' + ev.event_index + '</b><br>' +
                '<span style="font-size:9px">' +
                fmtMt(ev.start_time) + ' \u2013 ' + fmtMt(ev.end_time) + '<br>' +
                ev.duration_hours + 'h' + (ev.peak_rate != null ? ' \u00b7 peak ' + ev.peak_rate.toFixed(3) + ' in/h' : '') +
                '</span>',
          showarrow: false,
          font: {{ size: 11, color: '#333' }},
          bgcolor: 'rgba(255,255,255,0.82)',
          bordercolor: bc,
          borderwidth: 1,
          borderpad: 4,
          xanchor: 'center', yanchor: 'top',
        }};
      }});
    }}

    function buildNowShapes(data, rowRefs) {{
      var times = ((data.hourly || {{}}).time || []);
      if (!times.length) return [];
      var nowMt = toMtIso(new Date().toISOString());
      var t0Mt  = toMtIso(times[0]);
      var tNMt  = toMtIso(times[times.length - 1]);
      if (nowMt <= t0Mt || nowMt >= tNMt) return [];
      return rowRefs.map(function(yref) {{
        return {{ type:'line', xref:'x', yref:yref, x0:nowMt, x1:nowMt, y0:0, y1:1,
                 line:{{ color:'black', width:1.5, dash:'dash' }} }};
      }});
    }}
    function buildNowAnnotation(data) {{
      var times = ((data.hourly || {{}}).time || []);
      if (!times.length) return null;
      var nowMt = toMtIso(new Date().toISOString());
      var t0Mt  = toMtIso(times[0]);
      var tNMt  = toMtIso(times[times.length - 1]);
      if (nowMt <= t0Mt || nowMt >= tNMt) return null;
      return {{ x:nowMt, y:0.97, xref:'x', yref:'y domain', text:'<b>Now</b>',
               showarrow:false, font:{{ size:10, color:'black' }},
               bgcolor:'rgba(255,255,255,0.7)', yanchor:'top' }};
    }}

    // ── Run history state ────────────────────────────────────────────────────
    var availableRuns  = [];   // [{{dateStr, data}}, ...] newest-first
    var latestXRange   = null; // [isoStart, isoEnd] from newest run; locked for all renders
    var latestYRanges  = null; // {{yaxis, yaxis3, yaxis4}} captured after latest render
    var currentRun     = null; // currently displayed run; needed to re-render on IQR change
    var iqrHalf        = 10;   // half-width of band in pct points; 10 → 40–60% band

    // ── Render one run ───────────────────────────────────────────────────────
    function renderRun(run) {{
      currentRun = run;
      var data = run.data;
      var plotDiv = document.getElementById(DIV_ID);
      if (!plotDiv) return;

      var meta     = data.meta || {{}};
      var lat      = meta.lat || 0;
      var lon      = meta.lon || 0;
      var lonLabel = lon < 0 ? Math.abs(lon).toFixed(4)+'°W' : lon.toFixed(4)+'°E';
      var fetchedAt = (meta.fetched_at || '').slice(0, 16);
      var events   = data.events || [];
      var traces   = buildTraces(data);

      var prevLayout    = plotDiv.layout || {{}};
      var nowShapes     = buildNowShapes(data, ['y domain','y2 domain','y3 domain']);
      var nowAnnotation = buildNowAnnotation(data);

      var newLayout = Object.assign({{}}, prevLayout, {{
        title: {{
          text: 'Ensemble Forecast \u2014 ' + lat + '\u00b0N, ' + lonLabel +
                '<br><sub>Run: ' + run.dateStr + ' \u00b7 fetched ' + fetchedAt + ' UTC</sub>',
          font: {{size: 15}},
        }},
        shapes:      nowShapes.concat(buildEventShapes(events)),
        annotations: (nowAnnotation ? [nowAnnotation] : []).concat(buildEventAnnotations(events)),
      }});

      // Y-axes: lock to latest run's computed ranges so all historical runs share
      // the same scale.  yaxis2 (tick strip) is always auto — its height depends
      // on how many models are present, not on data magnitude.
      ['yaxis', 'yaxis3'].forEach(function(k) {{
        if (newLayout[k]) {{
          newLayout[k] = Object.assign({{}}, newLayout[k]);
          if (latestYRanges && latestYRanges[k]) {{
            newLayout[k].range    = latestYRanges[k];
            newLayout[k].autorange = false;
          }} else {{
            delete newLayout[k].range;
            newLayout[k].autorange = true;
          }}
        }}
      }});
      var stripEnsMs2 = (meta.ensemble_models || []);
      var stripVals2 = [], stripText2 = [];
      stripEnsMs2.forEach(function(m, i) {{
        var pd = ((data.members || {{}}).precipitation || {{}})[m];
        if (pd && pd.length > 1) {{ stripVals2.push(i); stripText2.push(m.split('_')[0].toUpperCase()); }}
      }});
      newLayout.yaxis2 = Object.assign({{}}, newLayout.yaxis2 || {{}}, {{
        autorange: false,
        range: [-0.5, stripVals2.length > 0 ? stripVals2.length - 0.5 : 0.5],
        zeroline: false,
        tickvals: stripVals2.length ? stripVals2 : undefined,
        ticktext: stripText2.length ? stripText2 : undefined,
        tickfont: {{size: 9}},
      }});

      // X-axis: LOCKED to latest run's range so all historical runs share the
      // same window.  Older runs' traces simply end before the right edge.
      newLayout.xaxis3 = Object.assign({{}}, newLayout.xaxis3 || {{}}, {{
        showticklabels: true,
        tickformat: '%a<br>%b %d',
        autorange: false,
        range: latestXRange,
      }});
      ['xaxis', 'xaxis2'].forEach(function(k) {{
        if (newLayout[k]) {{
          newLayout[k] = Object.assign({{}}, newLayout[k], {{
            showticklabels: false,
            autorange: false,
            range: latestXRange,
          }});
        }}
      }});

      Plotly.react(plotDiv, traces, newLayout, {{scrollZoom:false,displayModeBar:'hover'}});

      var evStr = events.length ? events.length + ' event(s)' : 'no events';
      statusEl.textContent = 'Run ' + run.dateStr + ' \u00b7 fetched ' + fetchedAt + ' UTC \u00b7 ' + evStr;
    }}

    // ── Slider label ─────────────────────────────────────────────────────────
    function updateRunLabel(sliderVal) {{
      var el     = document.getElementById('run-label');
      // slider right (max) = newest = availableRuns[0]; invert for index.
      var runIdx  = availableRuns.length - 1 - parseInt(sliderVal);
      var run     = availableRuns[runIdx];
      var daysAgo = Math.round(
        (new Date(availableRuns[0].dateStr.slice(0, 10)) - new Date(run.dateStr.slice(0, 10))) / 86400000
      );
      var suffix = runIdx === 0 ? ' (latest)'
                 : daysAgo === 0 ? ' (today)'
                 : ' (' + daysAgo + ' day' + (daysAgo === 1 ? '' : 's') + ' ago)';
      el.textContent = run.dateStr + suffix;
    }}

    // ── Run slider event ─────────────────────────────────────────────────────
    document.getElementById('run-slider').addEventListener('input', function() {{
      if (!availableRuns.length) return;
      var sliderVal = parseInt(this.value);
      var runIdx    = availableRuns.length - 1 - sliderVal;
      updateRunLabel(sliderVal);
      renderRun(availableRuns[runIdx]);
    }});

    // ── IQR slider event ─────────────────────────────────────────────────────
    function updateIqrLabel() {{
      var lo = Math.round(50 - iqrHalf);
      var hi = Math.round(50 + iqrHalf);
      document.getElementById('iqr-label').textContent =
        iqrHalf === 0 ? 'median only' : lo + '\u2013' + hi + '%';
    }}

    document.getElementById('iqr-slider').addEventListener('input', function() {{
      iqrHalf = parseInt(this.value);
      updateIqrLabel();
      if (currentRun) renderRun(currentRun);
    }});

    // ── Load all available runs then render latest ───────────────────────────
    async function fetchAndRender(loc) {{
      var lat4  = loc.lat.toFixed(4);
      var lon4  = loc.lon.toFixed(4);
      var today = new Date();
      var found = [];

      statusEl.textContent = 'Loading runs for ' + loc.name + ', ' + loc.state + ' \u2026';
      var base = (DATA_ORIGIN || ('https://'+S3_BUCKET+'.s3.amazonaws.com')) + '/forecasts/' + lat4 + '_' + lon4 + '/';
      for (var i = 0; i < 10; i++) {{
        var d = new Date(today);
        d.setDate(d.getDate() - i);
        var dateStr = d.toISOString().slice(0, 10);
        // Try twice-daily keys (T12 = later run first, then T00); fall back to
        // the old date-only key for files written before the format change.
        var dayFound = false;
        var runKeys = [dateStr + 'T12', dateStr + 'T00'];
        for (var ki = 0; ki < runKeys.length; ki++) {{
          try {{
            var r = await fetch(base + runKeys[ki] + '.json');
            if (r.ok) {{ found.push({{dateStr: runKeys[ki], data: await r.json()}}); dayFound = true; }}
          }} catch(e) {{}}
        }}
        if (!dayFound) {{ // legacy fallback
          try {{
            var r2 = await fetch(base + dateStr + '.json');
            if (r2.ok) found.push({{dateStr: dateStr, data: await r2.json()}});
          }} catch(e) {{}}
        }}
      }}

      if (!found.length) {{
        statusEl.textContent = 'No S3 data for ' + loc.name + ', ' + loc.state + '. Run Lambda first.';
        document.getElementById('run-bar').style.display = 'none';
        return;
      }}

      availableRuns = found; // newest-first
      latestYRanges = null;  // reset so first renderRun uses autorange

      // Lock x-axis to latest run's full forecast window.
      var latestTimes = availableRuns[0].data.hourly.time;
      latestXRange = [toMtIso(latestTimes[0]), toMtIso(latestTimes[latestTimes.length - 1])];

      // Configure sliders.  Run-controls shown only when multiple runs available.
      var sliderEl    = document.getElementById('run-slider');
      var runBar      = document.getElementById('run-bar');
      var runControls = document.getElementById('run-controls');
      sliderEl.min   = 0;
      sliderEl.max   = availableRuns.length - 1;
      sliderEl.value = availableRuns.length - 1; // rightmost = latest
      runBar.style.display = 'flex';
      if (runControls) runControls.style.display = availableRuns.length > 1 ? 'flex' : 'none';
      updateRunLabel(availableRuns.length - 1);

      // Render latest run with autorange, then capture those ranges to lock all
      // subsequent slider positions to the same y-scale.
      renderRun(availableRuns[0]);
      var plotDiv = document.getElementById(DIV_ID);
      latestYRanges = {{}};
      ['yaxis', 'yaxis3'].forEach(function(k) {{
        if (plotDiv.layout && plotDiv.layout[k] && plotDiv.layout[k].range) {{
          latestYRanges[k] = plotDiv.layout[k].range.slice();
        }}
      }});
    }}

    // ── Auto-initialize for the current (Python-rendered) city on page load ──
    if (S3_BUCKET) {{
      var initLoc = LOCATIONS.find(function(l) {{
        return Math.abs(l.lat - CURRENT_LAT) < 0.02 && Math.abs(l.lon - CURRENT_LON) < 0.02;
      }}) || {{lat: CURRENT_LAT, lon: CURRENT_LON, name: 'Current', state: ''}};
      fetchAndRender(initLoc);
    }}
  }})();
  </script>
</body>
</html>"""


def _build_combined_html(
    precip_plot_html: str,
    kde_html_fragment: str | None,
    title: str,
    current_lat: float,
    current_lon: float,
    s3_bucket: str,
    locations: list[dict],
    events: list[dict],
    cdn_domain: str = "",
) -> str:
    """Build a combined tabbed HTML page: Ensemble Forecast + Storm KDE."""
    locations_json = json.dumps(locations, separators=(",", ":"))
    model_colors_json = json.dumps(MODEL_COLORS, separators=(",", ":"))
    events_for_js = [
        {
            "event_index": ev["event_index"],
            "start_time": ev["start_time"],
            "end_time": ev["end_time"],
            "duration_hours": ev["duration_hours"],
            "peak_rate": ev.get("peak_rate", 0),
        }
        for ev in events
    ]
    events_json = json.dumps(events_for_js, separators=(",", ":"))
    n_events = len(events)
    show_dropdown = "flex" if locations else "none"
    kde_tab_content = kde_html_fragment or (
        f'<div id="{_KDE_DIV_ID}" style="width:100%;height:750px;touch-action:pan-y;">'
        '<p style="text-align:center;padding:80px;color:#888;font-family:sans-serif;">Loading…</p>'
        '</div>'
    )
    _precip_div = _PLOT_DIV_ID
    _kde_div    = _KDE_DIV_ID

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{title}</title>
  <style>
    * {{ box-sizing: border-box; margin: 0; padding: 0; }}
    body {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #fff; }}
    #loc-bar {{
      display: {show_dropdown};
      align-items: center;
      gap: 12px;
      padding: 10px 16px;
      background: #f8f9fa;
      border-bottom: 1px solid #dee2e6;
      flex-wrap: wrap;
    }}
    #loc-bar label {{ font-weight: 600; font-size: 14px; color: #333; white-space: nowrap; }}
    #loc-wrap {{ position: relative; }}
    #loc-input {{
      font-size: 14px; padding: 5px 10px; border: 1px solid #ced4da;
      border-radius: 6px; background: white; min-width: 220px; cursor: text; outline: none;
    }}
    #loc-input:focus {{ border-color: #86b7fe; box-shadow: 0 0 0 3px rgba(13,110,253,.15); }}
    #loc-suggestions {{
      display: none; position: absolute; top: 100%; left: 0; min-width: 100%;
      background: white; border: 1px solid #ced4da; border-top: none;
      border-radius: 0 0 6px 6px; list-style: none; max-height: 240px;
      overflow-y: auto; z-index: 1000; box-shadow: 0 4px 12px rgba(0,0,0,0.1);
    }}
    #loc-suggestions li {{ padding: 6px 12px; cursor: pointer; font-size: 14px; white-space: nowrap; }}
    #loc-suggestions li:hover, #loc-suggestions li.ac-active {{ background: #e9ecef; }}
    #loc-suggestions li .state-tag {{ float: right; font-size: 11px; color: #888; margin-left: 12px; }}
    #loc-status {{ font-size: 12px; color: #6c757d; font-style: italic; }}
    #loc-bar .s3-note {{ font-size: 11px; color: #aaa; margin-left: auto; }}
    #run-bar, #kde-run-bar, #var-run-bar {{
      display: none; align-items: center; gap: 10px; padding: 8px 16px;
      background: #eef2f7; border-bottom: 1px solid #dee2e6; flex-wrap: wrap;
    }}
    #run-bar label, #kde-run-bar label, #var-run-bar label {{ font-weight: 600; font-size: 13px; color: #333; white-space: nowrap; }}
    #run-bar .run-edge, #kde-run-bar .run-edge, #var-run-bar .run-edge {{ font-size: 11px; color: #999; }}
    #run-slider, #kde-run-slider, #var-run-slider {{ width: 220px; cursor: pointer; accent-color: #4a6fa5; }}
    #run-label, #kde-run-label, #var-run-label {{ font-size: 13px; color: #444; font-family: monospace; }}
    #var-select-bar {{ display: none; align-items: center; gap: 10px; padding: 7px 16px; background: #f4f7fb; border-bottom: 1px solid #dee2e6; flex-wrap: wrap; }}
    #var-select-bar label {{ font-weight: 600; font-size: 13px; color: #333; white-space: nowrap; }}
    #var-select {{ font-size: 13px; padding: 4px 10px; border: 1px solid #ced4da; border-radius: 5px; background: white; cursor: pointer; color: #333; min-width: 220px; }}
    #tab-header {{
      display: flex; background: #f0f4f8;
      border-bottom: 2px solid #dee2e6; padding: 0 16px;
    }}
    .tab-btn {{
      padding: 9px 22px; border: none; border-bottom: 3px solid transparent;
      background: transparent; font-size: 14px; font-weight: 500; color: #555;
      cursor: pointer; outline: none; margin-bottom: -2px;
    }}
    .tab-btn:hover {{ color: #333; }}
    .tab-btn.active {{ color: #1a66c3; border-bottom-color: #1a66c3; font-weight: 600; }}
    .tab-panel {{ display: none; }}
    .tab-panel.active {{ display: block; }}
  </style>
</head>
<body>
  <div id="loc-bar">
    <label>Location:</label>
    <div id="loc-wrap">
      <input type="text" id="loc-input" placeholder="Type a city\u2026" autocomplete="off" spellcheck="false">
      <ul id="loc-suggestions"></ul>
    </div>
    <span id="loc-status"></span>
    <span class="s3-note" id="s3-note"></span>
  </div>
  <div id="tab-header">
    <button class="tab-btn active" data-tab="precip">Ensemble Forecast</button>
    <button class="tab-btn" data-tab="kde">Storm KDE</button>
    <button class="tab-btn" data-tab="var">Variable</button>
  </div>
  <div id="tab-precip" class="tab-panel active">
    <div id="run-bar">
      <label>Forecast run:</label>
      <span class="run-edge">older</span>
      <input type="range" id="run-slider" min="0" max="0" value="0" step="1">
      <span class="run-edge">latest</span>
      <span id="run-label"></span>
    </div>
    {precip_plot_html}
  </div>
  <div id="tab-kde" class="tab-panel">
    <div id="kde-run-bar">
      <label>Forecast run:</label>
      <span class="run-edge">older</span>
      <input type="range" id="kde-run-slider" min="0" max="0" value="0" step="1">
      <span class="run-edge">latest</span>
      <span id="kde-run-label"></span>
    </div>
    {kde_tab_content}
  </div>
  <div id="tab-var" class="tab-panel">
    <div id="var-select-bar">
      <label>Variable:</label>
      <select id="var-select">
        <option value="temperature_2m" selected>Temperature (\u00b0F)</option>
        <option value="precipitation">Precipitation (in, accum.)</option>
        <option value="wind_speed_10m">Wind Speed (mph)</option>
        <option value="snowfall">Snowfall (in/hr)</option>
        <option value="freezing_level_height">Freezing Level (ft)</option>
        <option value="wind_gusts_10m">Wind Gusts (mph)</option>
        <option value="cape">CAPE (J/kg)</option>
        <option value="surface_pressure">Surface Pressure (hPa)</option>
      </select>
    </div>
    <div id="var-run-bar">
      <label>Forecast run:</label>
      <span class="run-edge">older</span>
      <input type="range" id="var-run-slider" min="0" max="0" value="0" step="1">
      <span class="run-edge">latest</span>
      <span id="var-run-label"></span>
    </div>
    <div id="var-plot" style="width:100%;height:520px;touch-action:pan-y;"></div>
    <p id="var-status" style="text-align:center;color:#666;font-size:13px;margin:8px 0;"></p>
  </div>
  <script type="text/javascript">
    var LOCATIONS    = {locations_json};
    var S3_BUCKET    = {json.dumps(s3_bucket)};
    var DATA_ORIGIN  = {json.dumps("https://" + cdn_domain if cdn_domain else "")};
    var CURRENT_LAT  = {json.dumps(current_lat)};
    var CURRENT_LON  = {json.dumps(current_lon)};
    var MODEL_COLORS = {model_colors_json};
    var EVENTS       = {events_json};
    var N_EVENTS     = {n_events};
    var VAR_META = {{
      temperature_2m:        {{ label: 'Temperature',      unit: '\u00b0F',  fmt: '.1f' }},
      precipitation:         {{ label: 'Precipitation',    unit: 'in',       fmt: '.2f' }},
      wind_speed_10m:        {{ label: 'Wind Speed',       unit: 'mph',      fmt: '.1f' }},
      snowfall:              {{ label: 'Snowfall',         unit: 'in/hr',    fmt: '.2f' }},
      freezing_level_height: {{ label: 'Freezing Level',  unit: 'ft',       fmt: '.0f' }},
      wind_gusts_10m:        {{ label: 'Wind Gusts',       unit: 'mph',      fmt: '.1f' }},
      cape:                  {{ label: 'CAPE',             unit: 'J/kg',     fmt: '.0f' }},
      surface_pressure:      {{ label: 'Surface Pressure', unit: 'hPa',      fmt: '.1f' }},
    }};
  </script>
  <script type="text/javascript">
  var PrecipPlot = (function() {{
    'use strict';
    var DIV_ID = {json.dumps(_precip_div)};
    var EVENT_COLORS = ['rgba(255,193,7,0.13)','rgba(76,175,80,0.13)',
      'rgba(33,150,243,0.13)','rgba(233,30,99,0.13)','rgba(156,39,176,0.13)'];
    var EVENT_BORDER = ['rgba(255,160,0,0.6)','rgba(56,142,60,0.6)',
      'rgba(25,118,210,0.6)','rgba(194,24,91,0.6)','rgba(123,31,162,0.6)'];
    var availableRuns = [];
    var latestXRange  = null;
    var latestYRanges = null;

    function lastValidIdx(seriesList) {{
      var last = 0;
      (seriesList || []).forEach(function(s) {{
        for (var i = (s || []).length - 1; i >= 0; i--) {{
          if (s[i] != null) {{ if (i + 1 > last) last = i + 1; break; }}
        }}
      }});
      return last > 0 ? last : (seriesList[0] ? seriesList[0].length : 0);
    }}
    function cumsum(arr) {{
      var s = 0;
      return arr.map(function(v) {{ s += (v == null ? 0 : +v || 0); return s; }});
    }}
    function quantile(sortedArr, p) {{
      if (!sortedArr.length) return 0;
      var pos = (sortedArr.length - 1) * p;
      var lo = Math.floor(pos), hi = Math.ceil(pos);
      return sortedArr[lo] + (sortedArr[hi] - sortedArr[lo]) * (pos - lo);
    }}
    function colQuantile(arrays, p) {{
      var n = arrays[0].length, res = new Array(n);
      for (var i = 0; i < n; i++) {{
        var col = arrays.map(function(a) {{ return a[i]; }})
                        .filter(function(v) {{ return v != null && !isNaN(+v); }})
                        .map(Number).sort(function(a, b) {{ return a - b; }});
        res[i] = quantile(col, p);
      }}
      return res;
    }}
    function boxSmooth(arr, win) {{
      var h = Math.floor(win / 2);
      return arr.map(function(v, i) {{
        var s = 0, c = 0;
        for (var j = Math.max(0, i-h); j <= Math.min(arr.length-1, i+h); j++) {{ s += arr[j]; c++; }}
        return s / c;
      }});
    }}
    function hexToRgb(hex) {{
      var h = hex.replace('#','');
      return parseInt(h.slice(0,2),16)+','+parseInt(h.slice(2,4),16)+','+parseInt(h.slice(4,6),16);
    }}
    var FALLBACKS = ['#1f77b4','#d62728','#2ca02c','#9467bd','#ff7f0e','#17becf'];

    var _mtFmtIso = new Intl.DateTimeFormat('en-US', {{
      timeZone:'America/Denver', year:'numeric', month:'2-digit', day:'2-digit',
      hour:'2-digit', minute:'2-digit', hour12:false
    }});
    function toMtIso(iso) {{
      var d = new Date(iso.indexOf('+') < 0 && iso.slice(-1) !== 'Z' ? iso+'Z' : iso);
      var parts = _mtFmtIso.formatToParts(d);
      var yr='', mo='', dy='', hh='', mm='';
      parts.forEach(function(p) {{
        if (p.type==='year')   yr=p.value;
        if (p.type==='month')  mo=p.value;
        if (p.type==='day')    dy=p.value;
        if (p.type==='hour')   hh=p.value;
        if (p.type==='minute') mm=p.value;
      }});
      if (hh==='24') hh='00';
      return yr+'-'+mo+'-'+dy+'T'+hh+':'+mm;
    }}
    function midMtIso(t0, t1) {{
      var ms0 = new Date(t0.indexOf('+') < 0 && t0.slice(-1) !== 'Z' ? t0+'Z' : t0).getTime();
      var ms1 = new Date(t1.indexOf('+') < 0 && t1.slice(-1) !== 'Z' ? t1+'Z' : t1).getTime();
      return toMtIso(new Date((ms0+ms1)/2).toISOString());
    }}

    function buildVarBand(varKey, memberSeries, tArrMt, xaxis, yaxis, color, rgba, mlabel, model, vEnd) {{
      if (!memberSeries || memberSeries.length < 1) return [];
      var meta = VAR_META[varKey] || {{ label: varKey, unit: '', fmt: '.2f' }};
      var A = memberSeries.map(function(s) {{ return s.slice(0, vEnd).map(function(v) {{ return v == null ? NaN : +v; }}); }});
      var hover = '<b>'+mlabel+'</b><br>'+meta.label+': %{{y:'+meta.fmt+'}} '+meta.unit+'<extra></extra>';
      if (A.length === 1) {{
        return [{{ type:'scatter', x:tArrMt, y:A[0], mode:'lines', line:{{color:color, width:1.5, dash: model === 'gfs_hrrr' ? 'solid' : 'dot'}},
          name:mlabel, showlegend:false, legendgroup:model+'_mean', xaxis:xaxis, yaxis:yaxis,
          hovertemplate:hover }}];
      }}
      var qLo = colQuantile(A, 0.5 - iqrHalf/100), q50 = colQuantile(A, 0.50), qHi = colQuantile(A, 0.5 + iqrHalf/100);
      return [
        {{ type:'scatter', x:tArrMt, y:qHi, mode:'lines', line:{{width:0}}, hoverinfo:'skip', showlegend:false, legendgroup:model+'_iqr', xaxis:xaxis, yaxis:yaxis }},
        {{ type:'scatter', x:tArrMt, y:qLo, mode:'lines', line:{{width:0}}, fill:'tonexty', fillcolor:rgba, hoverinfo:'skip', showlegend:false, legendgroup:model+'_iqr', xaxis:xaxis, yaxis:yaxis }},
        {{ type:'scatter', x:tArrMt, y:q50, mode:'lines', line:{{color:color, width:2.0}}, name:mlabel, showlegend:false, legendgroup:model+'_mean', xaxis:xaxis, yaxis:yaxis,
          hovertemplate:hover }},
      ];
    }}

    function buildTraces(data) {{
      var traces  = [];
      var members = data.members || {{}};
      var hourly  = data.hourly  || {{}};
      var meta    = data.meta    || {{}};
      // Use ensemble time if available, else fall back to hourly time.
      var timeArr    = members.time || hourly.time || [];
      var precipData = members.precipitation || {{}};
      // All deterministic models first; add any ensemble-only models after.
      // This ensures det-only models (e.g. gfs_hrrr) are always rendered.
      var ensModels = meta.ensemble_models || [];
      var detModels = meta.models || [];
      var models    = detModels.length ? detModels : ensModels;
      var WIN = 6;
      models.forEach(function(model, mIdx) {{
        var color  = MODEL_COLORS[model] || FALLBACKS[mIdx % FALLBACKS.length];
        var rgb    = hexToRgb(color);
        var mlabel = model === 'gfs_hrrr' ? 'GFS-HRRR' : model.split('_')[0].toUpperCase();
        var rgba   = 'rgba(' + rgb + ',0.18)';
        var precipSeries = precipData[model] || [];
        var tempSeries   = (members.temperature_2m || {{}})[model] || [];
        // Fall back to hourly deterministic data when ensemble members are absent.
        if (!precipSeries.length) {{ var fbP = (hourly.precipitation   || {{}})[model]; if (fbP) precipSeries = [fbP]; }}
        if (!tempSeries.length)   {{ var fbt = (hourly.temperature_2m  || {{}})[model]; if (fbt) tempSeries   = [fbt]; }}
        var useHourlyTime = !members.time && hourly.time;
        var baseTimeArr = useHourlyTime ? hourly.time : timeArr;
        var allSeries = precipSeries.concat(tempSeries);
        var vEnd = allSeries.length ? lastValidIdx(allSeries) : baseTimeArr.length;
        var tArr = vEnd < baseTimeArr.length ? baseTimeArr.slice(0, vEnd) : baseTimeArr;
        var tArrMt = tArr.map(toMtIso);
        var _latestT0 = availableRuns.length ? (((availableRuns[0].data.members||{{}}).time||(availableRuns[0].data.hourly||{{}}).time||[])[0]||null) : null;
        var _refMs = _latestT0 ? new Date(_latestT0.slice(-1)!=='Z'?_latestT0+'Z':_latestT0).getTime() : 0;
        var _refIdx = 0;
        if (_refMs) {{ for (var _ni = 0; _ni < tArr.length; _ni++) {{ var _t = tArr[_ni]; if (new Date(_t.slice(-1)!=='Z'?_t+'Z':_t).getTime() >= _refMs) {{ _refIdx = _ni; break; }} }} }}

        if (precipSeries.length === 1) {{
          // Single deterministic series — show cumulative line without IQR band.
          var detCumsum = cumsum(precipSeries[0].slice(0, vEnd).map(function(v) {{ return v == null ? 0 : +v; }}));
          var _pBase = _refIdx < detCumsum.length ? detCumsum[_refIdx] : 0; if (_pBase > 0) detCumsum = detCumsum.map(function(v) {{ return v - _pBase; }});
          traces.push({{ type:'scatter', x:tArrMt, y:detCumsum, mode:'lines',
            line:{{color:color, width:2.0, dash: model === 'gfs_hrrr' ? 'solid' : 'dot'}}, name:mlabel,
            legendgroup:model+'_mean', xaxis:'x', yaxis:'y',
            hovertemplate:'<b>'+mlabel+'</b><br>Cumul. Precip: %{{y:.2f}} in<extra></extra>' }});
        }} else if (precipSeries.length > 1) {{
          var clipped = precipSeries.map(function(s) {{ return s.slice(0, vEnd); }});
          var cumsums = clipped.map(cumsum);
          if (_refIdx > 0) {{ cumsums = cumsums.map(function(cs) {{ var b = cs[_refIdx]||0; return cs.map(function(v) {{ return v - b; }}); }}); }}
          var qLo = boxSmooth(colQuantile(cumsums, 0.5 - iqrHalf/100), WIN);
          var q50 = boxSmooth(colQuantile(cumsums, 0.50), WIN);
          var qHi = boxSmooth(colQuantile(cumsums, 0.5 + iqrHalf/100), WIN);
          traces.push({{ type:'scatter', x:tArrMt, y:qHi, mode:'lines', line:{{width:0}},
            hoverinfo:'skip', showlegend:false, legendgroup:model+'_iqr', xaxis:'x', yaxis:'y' }});
          traces.push({{ type:'scatter', x:tArrMt, y:qLo, mode:'lines', line:{{width:0}},
            fill:'tonexty', fillcolor:rgba, name:mlabel+' IQR', hoverinfo:'skip',
            legendgroup:model+'_iqr', xaxis:'x', yaxis:'y' }});
          traces.push({{ type:'scatter', x:tArrMt, y:q50, mode:'lines',
            line:{{color:color, width:2.5}}, name:mlabel,
            legendgroup:model+'_mean', xaxis:'x', yaxis:'y',
            hovertemplate:'<b>'+mlabel+'</b><br>Cumul. Precip: %{{y:.2f}} in<extra></extra>' }});
          var clippedP = precipSeries.map(function(s) {{ return s.slice(0, vEnd); }});
          var wetTimes = [], wetY = [], wetFracs = [];
          for (var t = 0; t < tArr.length; t++) {{
            var wetCnt = 0;
            for (var m = 0; m < clippedP.length; m++) {{
              var v = clippedP[m][t]; if (v != null && v > 1e-3) wetCnt++;
            }}
            var frac = wetCnt / clippedP.length;
            if (frac > 0) {{ wetTimes.push(tArrMt[t]); wetY.push(mIdx); wetFracs.push(frac); }}
          }}
          if (wetTimes.length) {{
            var tickColor2 = 'rgba('+rgb+',0.75)';
            var widths2 = wetFracs.map(function(f){{ return 0.3+f*1.7; }});
            traces.push({{
              type:'scatter',x:wetTimes,y:wetY,mode:'markers',
              marker:{{symbol:'line-ns',size:8,color:tickColor2,line:{{color:tickColor2,width:widths2}}}},
              name:mlabel+' precip occur.',legendgroup:model+'_mean',showlegend:false,
              xaxis:'x2',yaxis:'y2',hoverinfo:'skip',
            }});
          }}
        }}
        traces = traces.concat(buildVarBand('temperature_2m', tempSeries, tArrMt, 'x3', 'y3', color, rgba, mlabel, model, vEnd));
      }});
      return traces;
    }}
    function fmtMt(iso) {{
      var d = new Date(iso.indexOf('+') < 0 && iso.slice(-1) !== 'Z' ? iso + 'Z' : iso);
      var parts = new Intl.DateTimeFormat('en-US', {{
        timeZone:'America/Denver', month:'short', day:'numeric',
        hour:'numeric', hour12:true
      }}).formatToParts(d);
      var mo='', dt='', h='', ap='';
      parts.forEach(function(p) {{
        if (p.type==='month')     mo=p.value;
        if (p.type==='day')       dt=p.value;
        if (p.type==='hour')      h=p.value;
        if (p.type==='dayPeriod') ap=p.value.toLowerCase();
      }});
      return mo+' '+dt+' '+h+ap+' MT';
    }}
    function buildEventShapes(events) {{
      var shapes = [];
      var rowRefs = ['y domain','y2 domain','y3 domain'];
      (events || []).forEach(function(ev, i) {{
        var fc = EVENT_COLORS[i % EVENT_COLORS.length];
        var bc = EVENT_BORDER[i % EVENT_BORDER.length];
        rowRefs.forEach(function(yref) {{
          shapes.push({{ type:'rect', xref:'x', yref:yref,
            x0:toMtIso(ev.start_time), x1:toMtIso(ev.end_time), y0:0, y1:1,
            fillcolor:fc, line:{{width:1.5, color:bc, dash:'dot'}}, layer:'below' }});
        }});
      }});
      return shapes;
    }}
    function buildEventAnnotations(events) {{
      return (events || []).map(function(ev, i) {{
        var bc = EVENT_BORDER[i % EVENT_BORDER.length];
        return {{
          xref:'x', yref:'y domain',
          x:midMtIso(ev.start_time, ev.end_time), y:0.97,
          text:'<b>Event '+ev.event_index+'</b><br><span style="font-size:9px">'+
               fmtMt(ev.start_time)+' \u2013 '+fmtMt(ev.end_time)+'<br>'+
               ev.duration_hours+'h'+(ev.peak_rate!=null?' \u00b7 peak '+ev.peak_rate.toFixed(3)+' in/h':'')+' </span>',
          showarrow:false, font:{{size:11, color:'#333'}},
          bgcolor:'rgba(255,255,255,0.82)', bordercolor:bc,
          borderwidth:1, borderpad:4, xanchor:'center', yanchor:'top',
        }};
      }});
    }}

    function buildNowShapes(data, rowRefs) {{
      var times = ((data.hourly || {{}}).time || []);
      if (!times.length) return [];
      var nowMt = toMtIso(new Date().toISOString());
      var t0Mt  = toMtIso(times[0]);
      var tNMt  = toMtIso(times[times.length - 1]);
      if (nowMt <= t0Mt || nowMt >= tNMt) return [];
      return rowRefs.map(function(yref) {{
        return {{ type:'line', xref:'x', yref:yref, x0:nowMt, x1:nowMt, y0:0, y1:1,
                 line:{{ color:'black', width:1.5, dash:'dash' }} }};
      }});
    }}
    function buildNowAnnotation(data) {{
      var times = ((data.hourly || {{}}).time || []);
      if (!times.length) return null;
      var nowMt = toMtIso(new Date().toISOString());
      var t0Mt  = toMtIso(times[0]);
      var tNMt  = toMtIso(times[times.length - 1]);
      if (nowMt <= t0Mt || nowMt >= tNMt) return null;
      return {{ x:nowMt, y:0.97, xref:'x', yref:'y domain', text:'<b>Now</b>',
               showarrow:false, font:{{ size:10, color:'black' }},
               bgcolor:'rgba(255,255,255,0.7)', yanchor:'top' }};
    }}

    function renderRun(run) {{
      var data    = run.data;
      var plotDiv = document.getElementById(DIV_ID);
      if (!plotDiv) return;
      var meta      = data.meta || {{}};
      var lat       = meta.lat || 0;
      var lon       = meta.lon || 0;
      var lonLabel  = lon < 0 ? Math.abs(lon).toFixed(4)+'\u00b0W' : lon.toFixed(4)+'\u00b0E';
      var fetchedAt = (meta.fetched_at || '').slice(0, 16);
      var events    = data.events || [];
      var traces    = buildTraces(data);
      var prevLayout    = plotDiv.layout || {{}};
      var nowShapes     = buildNowShapes(data, ['y domain','y2 domain','y3 domain']);
      var nowAnnotation = buildNowAnnotation(data);
      var newLayout = Object.assign({{}}, prevLayout, {{
        title: {{ text:'Ensemble Forecast \u2014 '+lat+'\u00b0N, '+lonLabel+
                       '<br><sub>Run: '+run.dateStr+' \u00b7 fetched '+fetchedAt+' UTC</sub>',
                 font:{{size:15}} }},
        shapes:      nowShapes.concat(buildEventShapes(events)),
        annotations: (nowAnnotation ? [nowAnnotation] : []).concat(buildEventAnnotations(events)),
      }});
      ['yaxis','yaxis3'].forEach(function(k) {{
        if (newLayout[k]) {{
          newLayout[k] = Object.assign({{}}, newLayout[k]);
          if (latestYRanges && latestYRanges[k]) {{
            newLayout[k].range = latestYRanges[k]; newLayout[k].autorange = false;
          }} else {{ delete newLayout[k].range; newLayout[k].autorange = true; }}
        }}
      }});
      // Build precipitation strip tick labels from whichever models have ensemble members.
      var stripEnsMs = (meta.ensemble_models || []);
      var stripVals = [], stripText = [];
      stripEnsMs.forEach(function(m, i) {{
        var pd = ((data.members || {{}}).precipitation || {{}})[m];
        if (pd && pd.length > 1) {{ stripVals.push(i); stripText.push(m.split('_')[0].toUpperCase()); }}
      }});
      newLayout.yaxis2 = Object.assign({{}}, newLayout.yaxis2 || {{}}, {{
        autorange: false,
        range: [-0.5, stripVals.length > 0 ? stripVals.length - 0.5 : 0.5],
        zeroline: false,
        tickvals: stripVals.length ? stripVals : undefined,
        ticktext: stripText.length ? stripText : undefined,
        tickfont: {{size: 9}},
      }});
      newLayout.xaxis3 = Object.assign({{}}, newLayout.xaxis3 || {{}}, {{
        showticklabels:true, tickformat:'%a<br>%b %d', autorange:false, range:latestXRange,
      }});
      ['xaxis','xaxis2'].forEach(function(k) {{
        if (newLayout[k]) newLayout[k] = Object.assign({{}}, newLayout[k], {{
          showticklabels:false, autorange:false, range:latestXRange,
        }});
      }});
      Plotly.react(plotDiv, traces, newLayout, {{scrollZoom:false,displayModeBar:'hover'}});
      var evStr = events.length ? events.length+' event(s)' : 'no events';
      document.getElementById('loc-status').textContent =
        'Run '+run.dateStr+' \u00b7 fetched '+fetchedAt+' UTC \u00b7 '+evStr;
    }}

    function updateRunLabel(sliderVal) {{
      var el     = document.getElementById('run-label');
      var runIdx = availableRuns.length - 1 - parseInt(sliderVal);
      var run    = availableRuns[runIdx];
      var daysAgo = Math.round(
        (new Date(availableRuns[0].dateStr.slice(0, 10)) - new Date(run.dateStr.slice(0, 10))) / 86400000
      );
      var suffix = runIdx === 0 ? ' (latest)'
                 : daysAgo === 0 ? ' (today)'
                 : ' ('+daysAgo+' day'+(daysAgo===1?'':'s')+' ago)';
      el.textContent = run.dateStr + suffix;
    }}
    document.getElementById('run-slider').addEventListener('input', function() {{
      if (!availableRuns.length) return;
      var sliderVal = parseInt(this.value);
      var runIdx    = availableRuns.length - 1 - sliderVal;
      updateRunLabel(sliderVal);
      renderRun(availableRuns[runIdx]);
    }});

    async function fetchAndRender(loc) {{
      var lat4  = loc.lat.toFixed(4);
      var lon4  = loc.lon.toFixed(4);
      var today = new Date();
      var found = [];
      document.getElementById('loc-status').textContent =
        'Loading runs for ' + loc.name + ', ' + loc.state + ' \u2026';
      var base = (DATA_ORIGIN || ('https://'+S3_BUCKET+'.s3.amazonaws.com')) + '/forecasts/'+lat4+'_'+lon4+'/';
      for (var i = 0; i < 10; i++) {{
        var d = new Date(today); d.setDate(d.getDate() - i);
        var dateStr  = d.toISOString().slice(0, 10);
        var dayFound = false;
        var runKeys  = [dateStr+'T12', dateStr+'T00'];
        for (var ki = 0; ki < runKeys.length; ki++) {{
          try {{
            var r = await fetch(base + runKeys[ki] + '.json');
            if (r.ok) {{ found.push({{dateStr:runKeys[ki], data:await r.json()}}); dayFound = true; }}
          }} catch(e) {{}}
        }}
        if (!dayFound) {{
          try {{
            var r2 = await fetch(base + dateStr + '.json');
            if (r2.ok) found.push({{dateStr:dateStr, data:await r2.json()}});
          }} catch(e) {{}}
        }}
      }}
      if (!found.length) {{
        document.getElementById('loc-status').textContent =
          'No S3 data for ' + loc.name + ', ' + loc.state + '. Run Lambda first.';
        document.getElementById('run-bar').style.display = 'none';
        return;
      }}
      availableRuns = found;
      latestYRanges = null;
      var latestTimes = availableRuns[0].data.hourly.time;
      latestXRange = [toMtIso(latestTimes[0]), toMtIso(latestTimes[latestTimes.length - 1])];
      var sliderEl = document.getElementById('run-slider');
      var runBar   = document.getElementById('run-bar');
      sliderEl.min = 0; sliderEl.max = availableRuns.length - 1;
      runBar.style.display = availableRuns.length > 1 ? 'flex' : 'none';
      // Default to most recent run WITH ensemble members; fall back to latest if none have members.
      var initRunIdx = 0;
      for (var ri = 0; ri < availableRuns.length; ri++) {{
        if (availableRuns[ri].data.members) {{ initRunIdx = ri; break; }}
      }}
      var initSliderVal = availableRuns.length - 1 - initRunIdx;
      sliderEl.value = initSliderVal;
      updateRunLabel(initSliderVal);
      renderRun(availableRuns[initRunIdx]);
      var plotDiv = document.getElementById(DIV_ID);
      latestYRanges = {{}};
      ['yaxis','yaxis3'].forEach(function(k) {{
        if (plotDiv.layout && plotDiv.layout[k] && plotDiv.layout[k].range)
          latestYRanges[k] = plotDiv.layout[k].range.slice();
      }});
    }}

    return {{ fetchAndRender: fetchAndRender }};
  }})();
  </script>
  <script type="text/javascript">
  var KdePlot = (function() {{
    'use strict';
    var DIV_ID   = {json.dumps(_kde_div)};
    var FALLBACKS = ['#1f77b4','#d62728','#2ca02c','#9467bd','#ff7f0e','#17becf'];

    function hexToRgba(hex, alpha) {{
      var r = parseInt(hex.slice(1,3),16);
      var g = parseInt(hex.slice(3,5),16);
      var b = parseInt(hex.slice(5,7),16);
      return 'rgba('+r+','+g+','+b+','+alpha+')';
    }}

    function scottBandwidth(vals) {{
      var n = vals.length;
      if (n < 2) return 0.01;
      var mean = 0;
      for (var i = 0; i < n; i++) mean += vals[i];
      mean /= n;
      var variance = 0;
      for (var i = 0; i < n; i++) variance += (vals[i] - mean) * (vals[i] - mean);
      variance /= (n - 1);
      var sigma = Math.sqrt(variance);
      return sigma * Math.pow(n, -0.2) || 0.01;
    }}

    function evalKde(vals, bw, xGrid) {{
      var out = new Array(xGrid.length);
      var c = 1.0 / (vals.length * bw * Math.sqrt(2 * Math.PI));
      for (var j = 0; j < xGrid.length; j++) {{
        var s = 0;
        for (var i = 0; i < vals.length; i++) {{
          var z = (xGrid[j] - vals[i]) / bw;
          s += Math.exp(-0.5 * z * z);
        }}
        out[j] = c * s;
      }}
      return out;
    }}

    function buildKdeTraces(data, events) {{
      var traces     = [];
      var members    = data.members;
      if (!members) return traces;
      var timeArr    = members.time || [];
      var precipData = members.precipitation || {{}};
      var ensModels  = (data.meta || {{}}).ensemble_models || Object.keys(precipData);
      events.forEach(function(ev, ev_i) {{
        var startIdx = 0;
        for (var i = 0; i < timeArr.length; i++) {{
          if (timeArr[i] >= ev.start_time) {{ startIdx = i; break; }}
        }}
        var endIdx = timeArr.length;
        for (var i = startIdx; i < timeArr.length; i++) {{
          if (timeArr[i] > ev.end_time) {{ endIdx = i; break; }}
        }}
        var xAxis = ev_i === 0 ? 'x' : 'x' + (ev_i + 1);
        var yAxis = ev_i === 0 ? 'y' : 'y' + (ev_i + 1);
        // Collect all totals across models to build a shared x-grid
        var allTotals = [];
        var modelTotals = [];
        ensModels.forEach(function(model) {{
          var seriesList   = precipData[model] || [];
          var memberSeries = seriesList.length > 1 ? seriesList.slice(1) : seriesList;
          var totals = memberSeries.map(function(series) {{
            var sum = 0;
            for (var i = startIdx; i < endIdx; i++) {{
              var v = series[i]; sum += (v == null ? 0 : Math.max(0, +v));
            }}
            return sum;
          }});
          modelTotals.push(totals);
          for (var k = 0; k < totals.length; k++) allTotals.push(totals[k]);
        }});
        var xMin = Math.min.apply(null, allTotals);
        var xMax = Math.max.apply(null, allTotals);
        var pad  = Math.max((xMax - xMin) * 0.15, 0.02);
        xMin = Math.max(0, xMin - pad);
        xMax = xMax + pad;
        var N_GRID = 200;
        var xGrid = new Array(N_GRID);
        for (var gi = 0; gi < N_GRID; gi++) {{
          xGrid[gi] = xMin + (xMax - xMin) * gi / (N_GRID - 1);
        }}
        ensModels.forEach(function(model, m_i) {{
          var color  = MODEL_COLORS[model] || FALLBACKS[m_i % FALLBACKS.length];
          var totals = modelTotals[m_i];
          if (!totals.length) return;
          var bw     = scottBandwidth(totals);
          var yGrid  = evalKde(totals, bw, xGrid);
          var mlabel = model === 'gfs_hrrr' ? 'GFS-HRRR' : model.split('_')[0].toUpperCase();
          traces.push({{
            type:'scatter', mode:'lines',
            x:xGrid, y:yGrid,
            name:mlabel+' (n\u202f=\u202f'+totals.length+')',
            fill:'tozeroy',
            line:{{color:color, width:2}},
            fillcolor:hexToRgba(color, 0.20),
            legendgroup:model, showlegend:ev_i===0,
            xaxis:xAxis, yaxis:yAxis,
            hovertemplate:'<b>'+mlabel+'</b><br>Accum: %{{x:.2f}} in<br>Density: %{{y:.3f}}<extra></extra>',
          }});
        }});
      }});
      return traces;
    }}

    var availableKdeRuns = [];
    var currentKdeLoc   = null;
    var lockedKdeRanges = null;  // captured after first render; reset on new location
    var latestEvents    = [];    // events from the newest run; sets the fixed subplot count

    function renderKdeRun(run) {{
      var plotDiv = document.getElementById(DIV_ID);
      if (!plotDiv || !currentKdeLoc) return;
      var data          = run.data;
      var eventsForCity = (data.events && data.events.length) ? data.events : [];
      var traces = buildKdeTraces(data, eventsForCity);
      var n       = latestEvents.length || eventsForCity.length;
      var spacing = 0.06;
      var panelH  = (1.0 - spacing * Math.max(n - 1, 0)) / Math.max(n, 1);
      var layout  = {{
        title: {{
          text:'Storm Event Precip Distribution \u2014 '+currentKdeLoc.name+', '+currentKdeLoc.state+
               '<br><sub>Run: '+run.dateStr+' \u00b7 KDE of ensemble members per event</sub>',
          font:{{size:14}},
        }},
        showlegend: true,
        legend: {{x:1.02, y:1, xanchor:'left', yanchor:'top'}},
        margin: {{l:60, r:160, t:80, b:50}},
        paper_bgcolor:'#f8faff',
        annotations: [],
      }};
      for (var i = 0; i < n; i++) {{
        var refEv  = latestEvents[i];
        var hasEv  = i < eventsForCity.length;
        var yBot   = 1.0 - (i + 1) * panelH - i * spacing;
        var yTop   = 1.0 - i * panelH - i * spacing;
        var xKey   = i === 0 ? 'xaxis'  : 'xaxis'  + (i + 1);
        var yKey   = i === 0 ? 'yaxis'  : 'yaxis'  + (i + 1);
        var anchor = i === 0 ? ''       : String(i + 1);
        var xRange = lockedKdeRanges && lockedKdeRanges[xKey];
        var yRange = lockedKdeRanges && lockedKdeRanges[yKey];
        layout[xKey] = {{ title:{{text:'Accumulated Precip (in)'}}, domain:[0,1], anchor:'y'+anchor, automargin:true,
                          autorange:!xRange, range:xRange||undefined }};
        layout[yKey] = {{ title:{{text:'Density', standoff:15}}, domain:[yBot, yTop], anchor:'x'+anchor,
                          autorange:!yRange, range:yRange||undefined }};
        var label = refEv
          ? 'Event '+refEv.event_index+': '+refEv.start_time.slice(5,10)+' \u2013 '+refEv.end_time.slice(5,10)+' ('+refEv.duration_hours+'h)'+(hasEv?'':' \u2014 not in this run')
          : 'Event '+(i+1)+(hasEv?'':' \u2014 not in this run');
        layout.annotations.push({{
          text:label, xref:'paper', yref:'paper', x:0.5, y:yTop,
          xanchor:'center', yanchor:'bottom', showarrow:false,
          font:{{size:11, color: hasEv ? '#555' : '#aaa'}},
        }});
      }}
      Plotly.react(plotDiv, traces, layout, {{scrollZoom:false,displayModeBar:'hover'}}).then(function() {{
        if (!lockedKdeRanges) {{
          lockedKdeRanges = {{}};
          for (var j = 0; j < n; j++) {{
            var xk = j === 0 ? 'xaxis' : 'xaxis' + (j + 1);
            var yk = j === 0 ? 'yaxis' : 'yaxis' + (j + 1);
            if (plotDiv.layout && plotDiv.layout[xk] && plotDiv.layout[xk].range)
              lockedKdeRanges[xk] = plotDiv.layout[xk].range.slice();
            if (plotDiv.layout && plotDiv.layout[yk] && plotDiv.layout[yk].range)
              lockedKdeRanges[yk] = plotDiv.layout[yk].range.slice();
          }}
        }}
      }});
      var evStr = eventsForCity.length+' / '+n+' event(s)';
      document.getElementById('loc-status').textContent =
        'KDE: '+currentKdeLoc.name+', '+currentKdeLoc.state+
        ' \u00b7 smooth KDE \u00b7 '+run.dateStr+' \u00b7 '+evStr;
    }}

    function updateKdeRunLabel(sliderVal) {{
      var el     = document.getElementById('kde-run-label');
      var runIdx = availableKdeRuns.length - 1 - parseInt(sliderVal);
      var run    = availableKdeRuns[runIdx];
      var daysAgo = Math.round(
        (new Date(availableKdeRuns[0].dateStr.slice(0, 10)) - new Date(run.dateStr.slice(0, 10))) / 86400000
      );
      var suffix = runIdx === 0 ? ' (latest)'
                 : daysAgo === 0 ? ' (today)'
                 : ' ('+daysAgo+' day'+(daysAgo===1?'':'s')+' ago)';
      el.textContent = run.dateStr + suffix;
    }}

    document.getElementById('kde-run-slider').addEventListener('input', function() {{
      if (!availableKdeRuns.length) return;
      var sliderVal = parseInt(this.value);
      var runIdx    = availableKdeRuns.length - 1 - sliderVal;
      updateKdeRunLabel(sliderVal);
      renderKdeRun(availableKdeRuns[runIdx]);
    }});

    async function fetchAndRender(loc) {{
      currentKdeLoc = loc;
      lockedKdeRanges = null;
      var lat4  = loc.lat.toFixed(4);
      var lon4  = loc.lon.toFixed(4);
      var today = new Date();
      var found = [];
      document.getElementById('loc-status').textContent =
        'Loading KDE runs for ' + loc.name + ', ' + loc.state + ' \u2026';
      var base = (DATA_ORIGIN || ('https://'+S3_BUCKET+'.s3.amazonaws.com')) + '/forecasts/'+lat4+'_'+lon4+'/';
      for (var i = 0; i < 10; i++) {{
        var d = new Date(today); d.setDate(d.getDate() - i);
        var dateStr  = d.toISOString().slice(0, 10);
        var dayFound = false;
        var runKeys  = [dateStr+'T12', dateStr+'T00'];
        for (var ki = 0; ki < runKeys.length; ki++) {{
          try {{
            var r = await fetch(base + runKeys[ki] + '.json');
            if (r.ok) {{ found.push({{dateStr:runKeys[ki], data:await r.json()}}); dayFound = true; }}
          }} catch(e) {{}}
        }}
        if (!dayFound) {{
          try {{
            var r2 = await fetch(base + dateStr + '.json');
            if (r2.ok) found.push({{dateStr:dateStr, data:await r2.json()}});
          }} catch(e) {{}}
        }}
      }}
      if (!found.length) {{
        document.getElementById('loc-status').textContent =
          'No S3 data for ' + loc.name + ', ' + loc.state + '. Run Lambda first.';
        document.getElementById('kde-run-bar').style.display = 'none';
        return;
      }}
      availableKdeRuns = found;
      var latestData = availableKdeRuns[0].data;
      latestEvents = (latestData.events && latestData.events.length) ? latestData.events : EVENTS;
      var sliderEl = document.getElementById('kde-run-slider');
      var runBar   = document.getElementById('kde-run-bar');
      sliderEl.min = 0; sliderEl.max = availableKdeRuns.length - 1;
      sliderEl.value = availableKdeRuns.length - 1;
      runBar.style.display = availableKdeRuns.length > 1 ? 'flex' : 'none';
      updateKdeRunLabel(availableKdeRuns.length - 1);
      renderKdeRun(availableKdeRuns[0]);
    }}

    return {{ fetchAndRender: fetchAndRender }};
  }})();
  </script>
  <script type="text/javascript">
  var VarPlot = (function() {{
    'use strict';
    var DIV_ID    = 'var-plot';
    var FALLBACKS = ['#1f77b4','#d62728','#2ca02c','#9467bd','#ff7f0e','#17becf'];
    var availableRuns = [];
    var currentVar    = 'temperature_2m';
    var latestXRange  = null;
    var latestYRange  = null;

    function hexToRgb(h) {{
      h = h.replace('#','');
      return parseInt(h.slice(0,2),16)+','+parseInt(h.slice(2,4),16)+','+parseInt(h.slice(4,6),16);
    }}
    function toMtIso(iso) {{
      var d = new Date(iso.indexOf('+') < 0 && iso.slice(-1) !== 'Z' ? iso+'Z' : iso);
      var parts = new Intl.DateTimeFormat('en-US', {{
        timeZone:'America/Denver', year:'numeric', month:'2-digit', day:'2-digit',
        hour:'2-digit', minute:'2-digit', hour12:false
      }}).formatToParts(d);
      var yr='',mo='',dy='',hh='',mm='';
      parts.forEach(function(p) {{
        if (p.type==='year') yr=p.value; if (p.type==='month')  mo=p.value;
        if (p.type==='day')  dy=p.value; if (p.type==='hour')   hh=p.value;
        if (p.type==='minute') mm=p.value;
      }});
      if (hh==='24') hh='00';
      return yr+'-'+mo+'-'+dy+'T'+hh+':'+mm;
    }}
    function lastValidIdx(seriesList) {{
      var last = 0;
      (seriesList||[]).forEach(function(s) {{
        for (var i=(s||[]).length-1;i>=0;i--) {{
          if (s[i]!=null) {{ if (i+1>last) last=i+1; break; }}
        }}
      }});
      return last;
    }}
    function cumsum(arr) {{
      var s = 0;
      return arr.map(function(v) {{ s += (v == null ? 0 : +v || 0); return s; }});
    }}
    function colQuantile(matrix, q) {{
      if (!matrix.length) return [];
      var n = matrix[0].length, out = new Array(n);
      for (var j=0;j<n;j++) {{
        var col = matrix.map(function(r){{return r[j];}}).filter(function(v){{return !isNaN(v)&&v!=null;}}).sort(function(a,b){{return a-b;}});
        if (!col.length) {{ out[j]=NaN; continue; }}
        var pos=q*(col.length-1), lo=Math.floor(pos), hi=Math.ceil(pos);
        out[j]=col[lo]+(col[hi]-col[lo])*(pos-lo);
      }}
      return out;
    }}

    function buildVarTraces(data, varKey) {{
      var members = data.members || {{}};
      var hourly  = data.hourly  || {{}};
      var meta    = data.meta    || {{}};
      var timeArr = members.time || hourly.time || [];
      var ensModels = meta.ensemble_models || [];
      var detModels = meta.models || [];
      var models  = detModels.length ? detModels : ensModels;
      var varInfo = VAR_META[varKey] || {{ label:varKey, unit:'', fmt:'.2f' }};
      var hover   = '<b>%{{fullData.name}}</b><br>'+varInfo.label+': %{{y:'+varInfo.fmt+'}} '+varInfo.unit+'<extra></extra>';
      var traces  = [];
      models.forEach(function(model, mIdx) {{
        var color  = MODEL_COLORS[model] || FALLBACKS[mIdx % FALLBACKS.length];
        var rgb    = hexToRgb(color);
        var mlabel = model === 'gfs_hrrr' ? 'GFS-HRRR' : model.split('_')[0].toUpperCase();
        var rgba   = 'rgba('+rgb+',0.18)';
        var series = (members[varKey] || {{}})[model] || [];
        if (!series.length) {{ var fb=(hourly[varKey]||{{}})[model]; if (fb) series=[fb]; }}
        if (!series.length) return;
        var vEnd = lastValidIdx(series) || timeArr.length;
        var tArr = vEnd < timeArr.length ? timeArr.slice(0, vEnd) : timeArr;
        var tMt  = tArr.map(toMtIso);
        var _latestT0 = availableRuns.length ? (((availableRuns[0].data.members||{{}}).time||(availableRuns[0].data.hourly||{{}}).time||[])[0]||null) : null;
        var _refMs = _latestT0 ? new Date(_latestT0.slice(-1)!=='Z'?_latestT0+'Z':_latestT0).getTime() : 0;
        var _refIdx = 0;
        if (_refMs) {{ for (var _ni = 0; _ni < tArr.length; _ni++) {{ var _t = tArr[_ni]; if (new Date(_t.slice(-1)!=='Z'?_t+'Z':_t).getTime() >= _refMs) {{ _refIdx = _ni; break; }} }} }}
        var A = series.map(function(s){{ var vals=s.slice(0,vEnd).map(function(v){{return v==null?NaN:+v;}}); var cs=varKey==='precipitation'?cumsum(vals):vals; if(varKey==='precipitation'&&_refIdx>0){{var b=cs[_refIdx]||0;cs=cs.map(function(v){{return v-b;}});}} return cs; }});
        if (A.length === 1) {{
          traces.push({{ type:'scatter', x:tMt, y:A[0], mode:'lines',
            line:{{color:color, width:1.8, dash: model === 'gfs_hrrr' ? 'solid' : 'dot'}}, name:mlabel, legendgroup:model,
            hovertemplate:hover }});
        }} else {{
          var qLo=colQuantile(A,0.5-iqrHalf/100), q50=colQuantile(A,0.50), qHi=colQuantile(A,0.5+iqrHalf/100);
          traces.push({{ type:'scatter', x:tMt, y:qHi, mode:'lines', line:{{width:0}}, hoverinfo:'skip', showlegend:false, legendgroup:model+'_iqr' }});
          traces.push({{ type:'scatter', x:tMt, y:qLo, mode:'lines', line:{{width:0}}, fill:'tonexty', fillcolor:rgba, hoverinfo:'skip', showlegend:false, legendgroup:model+'_iqr' }});
          traces.push({{ type:'scatter', x:tMt, y:q50, mode:'lines', line:{{color:color, width:2.5}},
            name:mlabel, legendgroup:model, hovertemplate:hover }});
        }}
      }});
      return traces;
    }}

    function buildNowShapes(data, rowRefs) {{
      var times = ((data.hourly || {{}}).time || []);
      if (!times.length) return [];
      var nowMt = toMtIso(new Date().toISOString());
      var t0Mt  = toMtIso(times[0]);
      var tNMt  = toMtIso(times[times.length - 1]);
      if (nowMt <= t0Mt || nowMt >= tNMt) return [];
      return rowRefs.map(function(yref) {{
        return {{ type:'line', xref:'x', yref:yref, x0:nowMt, x1:nowMt, y0:0, y1:1,
                 line:{{ color:'black', width:1.5, dash:'dash' }} }};
      }});
    }}
    function buildNowAnnotation(data) {{
      var times = ((data.hourly || {{}}).time || []);
      if (!times.length) return null;
      var nowMt = toMtIso(new Date().toISOString());
      var t0Mt  = toMtIso(times[0]);
      var tNMt  = toMtIso(times[times.length - 1]);
      if (nowMt <= t0Mt || nowMt >= tNMt) return null;
      return {{ x:nowMt, y:0.97, xref:'x', yref:'y domain', text:'<b>Now</b>',
               showarrow:false, font:{{ size:10, color:'black' }},
               bgcolor:'rgba(255,255,255,0.7)', yanchor:'top' }};
    }}

    function renderRun(run) {{
      var plotDiv = document.getElementById(DIV_ID);
      if (!plotDiv) return;
      var data    = run.data;
      var meta    = data.meta || {{}};
      var varInfo = VAR_META[currentVar] || {{ label:currentVar, unit:'', fmt:'.2f' }};
      var lat     = meta.lat || 0;
      var lon     = meta.lon || 0;
      var lonLabel = lon < 0 ? Math.abs(lon).toFixed(4)+'\u00b0W' : lon.toFixed(4)+'\u00b0E';
      var traces  = buildVarTraces(data, currentVar);
      var nowShapes     = buildNowShapes(data, ['y domain']);
      var nowAnnotation = buildNowAnnotation(data);
      var layout  = {{
        title: {{ text: varInfo.label+' \u2014 '+lat+'\u00b0N, '+lonLabel+
                       '<br><sub>Run: '+run.dateStr+'</sub>', font:{{size:15}} }},
        template:'plotly_white', height:520, hovermode:'x unified', dragmode:'pan',
        showlegend:true,
        legend:{{ orientation:'h', yanchor:'top', y:-0.12, xanchor:'center', x:0.5, font:{{size:11}} }},
        xaxis:{{ tickformat:'%a<br>%b %d', gridcolor:'rgba(200,200,200,0.4)',
                 autorange:false, range:latestXRange }},
        yaxis:{{ title:{{ text: varInfo.label+' ('+varInfo.unit+')' }},
                 gridcolor:'rgba(200,200,200,0.4)',
                 autorange: latestYRange ? false : true }},
        margin:{{t:80, b:80}},
        shapes: nowShapes,
        annotations: nowAnnotation ? [nowAnnotation] : [],
      }};
      if (latestYRange) layout.yaxis.range = latestYRange;
      Plotly.react(plotDiv, traces, layout, {{scrollZoom:false,displayModeBar:'hover'}});
      if (!latestYRange) {{
        var ly = plotDiv.layout;
        if (ly && ly.yaxis && ly.yaxis.range) latestYRange = ly.yaxis.range.slice();
      }}
    }}

    function updateRunLabel(val) {{
      var el = document.getElementById('var-run-label');
      if (!el || !availableRuns.length) return;
      var runIdx  = availableRuns.length - 1 - parseInt(val);
      var run     = availableRuns[runIdx];
      var daysAgo = Math.round((new Date(availableRuns[0].dateStr.slice(0,10)) -
                                new Date(run.dateStr.slice(0,10))) / 86400000);
      var suffix  = runIdx===0 ? ' (latest)' : daysAgo===0 ? ' (today)'
                  : ' ('+daysAgo+' day'+(daysAgo===1?'':'s')+' ago)';
      el.textContent = run.dateStr + suffix;
    }}

    document.getElementById('var-run-slider').addEventListener('input', function() {{
      if (!availableRuns.length) return;
      var runIdx = availableRuns.length - 1 - parseInt(this.value);
      updateRunLabel(parseInt(this.value));
      renderRun(availableRuns[runIdx]);
    }});

    document.getElementById('var-select').addEventListener('change', function() {{
      currentVar   = this.value;
      latestYRange = null;
      if (availableRuns.length) {{
        var sliderEl = document.getElementById('var-run-slider');
        var runIdx   = availableRuns.length - 1 - parseInt(sliderEl.value);
        renderRun(availableRuns[runIdx]);
      }}
    }});

    async function fetchAndRender(loc) {{
      latestYRange = null;
      var lat4  = loc.lat.toFixed(4);
      var lon4  = loc.lon.toFixed(4);
      var today = new Date();
      var found = [];
      document.getElementById('var-status').textContent = 'Loading '+loc.name+' \u2026';
      var base = (DATA_ORIGIN || ('https://'+S3_BUCKET+'.s3.amazonaws.com')) + '/forecasts/'+lat4+'_'+lon4+'/';
      for (var i = 0; i < 10; i++) {{
        var d = new Date(today); d.setDate(d.getDate() - i);
        var dateStr  = d.toISOString().slice(0, 10);
        var dayFound = false;
        var runKeys  = [dateStr+'T12', dateStr+'T00'];
        for (var ki = 0; ki < runKeys.length; ki++) {{
          try {{
            var r = await fetch(base + runKeys[ki] + '.json');
            if (r.ok) {{ found.push({{dateStr:runKeys[ki], data:await r.json()}}); dayFound=true; }}
          }} catch(e) {{}}
        }}
        if (!dayFound) {{
          try {{
            var r2 = await fetch(base + dateStr + '.json');
            if (r2.ok) found.push({{dateStr:dateStr, data:await r2.json()}});
          }} catch(e) {{}}
        }}
      }}
      if (!found.length) {{
        document.getElementById('var-status').textContent =
          'No S3 data for '+loc.name+'. Run Lambda first.';
        document.getElementById('var-run-bar').style.display = 'none';
        return;
      }}
      availableRuns = found;
      var latestTimes = availableRuns[0].data.hourly.time;
      latestXRange = [toMtIso(latestTimes[0]), toMtIso(latestTimes[latestTimes.length-1])];
      var sliderEl = document.getElementById('var-run-slider');
      var runBar   = document.getElementById('var-run-bar');
      sliderEl.min = 0; sliderEl.max = availableRuns.length - 1;
      sliderEl.value = availableRuns.length - 1;
      runBar.style.display = availableRuns.length > 1 ? 'flex' : 'none';
      document.getElementById('var-select-bar').style.display = 'flex';
      document.getElementById('var-status').textContent = '';
      updateRunLabel(availableRuns.length - 1);
      renderRun(availableRuns[0]);
    }}

    return {{ fetchAndRender: fetchAndRender, isLoaded: function() {{ return availableRuns.length > 0; }} }};
  }})();
  </script>
  <script type="text/javascript">
  (function() {{
    'use strict';
    var currentLoc      = null;
    var kdeNeedsRefresh = false;
    var varNeedsRefresh = false;

    document.querySelectorAll('.tab-btn').forEach(function(btn) {{
      btn.addEventListener('click', function() {{
        var tab = this.getAttribute('data-tab');
        document.querySelectorAll('.tab-btn').forEach(function(b) {{
          b.classList.toggle('active', b === btn);
        }});
        document.querySelectorAll('.tab-panel').forEach(function(p) {{
          p.classList.toggle('active', p.id === 'tab-' + tab);
        }});
        if (tab === 'kde') {{
          setTimeout(function() {{
            var kdeDiv = document.getElementById('kde-plot');
            if (kdeDiv && kdeDiv._fullLayout) Plotly.Plots.resize(kdeDiv);
          }}, 50);
          if (kdeNeedsRefresh && currentLoc) {{
            kdeNeedsRefresh = false;
            KdePlot.fetchAndRender(currentLoc);
          }}
        }} else if (tab === 'precip') {{
          setTimeout(function() {{
            var precipDiv = document.getElementById('forecast-plot');
            if (precipDiv && precipDiv._fullLayout) Plotly.Plots.resize(precipDiv);
          }}, 50);
        }} else if (tab === 'var') {{
          if (VarPlot.isLoaded()) {{
            setTimeout(function() {{
              var varDiv = document.getElementById('var-plot');
              if (varDiv && varDiv._fullLayout) Plotly.Plots.resize(varDiv);
            }}, 50);
          }} else if (currentLoc) {{
            varNeedsRefresh = false;
            VarPlot.fetchAndRender(currentLoc);
          }}
        }}
      }});
    }});

    var input    = document.getElementById('loc-input');
    var suggest  = document.getElementById('loc-suggestions');
    var statusEl = document.getElementById('loc-status');
    var s3note   = document.getElementById('s3-note');

    if (!LOCATIONS.length) return;
    if (!S3_BUCKET) {{
      s3note.textContent = 'Set ENSEMBLE_S3_BUCKET and re-run to enable switching';
    }}

    (function() {{
      var cur = LOCATIONS.find(function(l) {{
        return Math.abs(l.lat - CURRENT_LAT) < 0.02 && Math.abs(l.lon - CURRENT_LON) < 0.02;
      }});
      if (cur) input.value = cur.name + ', ' + cur.state;
    }})();

    var activeIdx = -1;
    function getMatches(q) {{
      q = q.trim().toLowerCase();
      if (!q) return [];
      return LOCATIONS.filter(function(l) {{
        return l.name.toLowerCase().indexOf(q) !== -1 || l.state.toLowerCase() === q;
      }}).slice(0, 10);
    }}
    function renderSuggestions(matches) {{
      suggest.innerHTML = '';
      activeIdx = -1;
      if (!matches.length) {{ suggest.style.display = 'none'; return; }}
      matches.forEach(function(loc) {{
        var li = document.createElement('li');
        li.innerHTML = loc.name + ' <span class="state-tag">' + loc.state + '</span>';
        li.addEventListener('mousedown', function(e) {{ e.preventDefault(); selectLoc(loc); }});
        suggest.appendChild(li);
      }});
      suggest.style.display = 'block';
    }}
    function selectLoc(loc) {{
      input.value = loc.state ? loc.name + ', ' + loc.state : loc.name;
      suggest.style.display = 'none';
      activeIdx = -1;
      if (!S3_BUCKET) {{
        statusEl.textContent = 'Run: python make_plots.py --location "' + loc.name + '"';
        return;
      }}
      currentLoc = loc;
      statusEl.textContent = 'Loading ' + loc.name + ' \u2026';
      PrecipPlot.fetchAndRender(loc);
      var kdePanel = document.getElementById('tab-kde');
      if (kdePanel && kdePanel.classList.contains('active')) {{
        KdePlot.fetchAndRender(loc);
      }} else {{
        kdeNeedsRefresh = true;
      }}
      var varPanel = document.getElementById('tab-var');
      if (varPanel && varPanel.classList.contains('active')) {{
        varNeedsRefresh = false;
        VarPlot.fetchAndRender(loc);
      }} else {{
        varNeedsRefresh = true;
      }}
    }}
    input.addEventListener('input', function() {{ renderSuggestions(getMatches(this.value)); }});
    input.addEventListener('keydown', function(e) {{
      var items = suggest.querySelectorAll('li');
      if (e.key === 'ArrowDown') {{
        e.preventDefault();
        activeIdx = Math.min(activeIdx + 1, items.length - 1);
        items.forEach(function(li, i) {{ li.classList.toggle('ac-active', i === activeIdx); }});
      }} else if (e.key === 'ArrowUp') {{
        e.preventDefault();
        activeIdx = Math.max(activeIdx - 1, 0);
        items.forEach(function(li, i) {{ li.classList.toggle('ac-active', i === activeIdx); }});
      }} else if (e.key === 'Enter') {{
        e.preventDefault();
        var matches = getMatches(input.value);
        var pick = activeIdx >= 0 ? matches[activeIdx] : matches[0];
        if (pick) selectLoc(pick);
      }} else if (e.key === 'Escape') {{ suggest.style.display = 'none'; }}
    }});
    document.addEventListener('click', function(e) {{
      if (!document.getElementById('loc-wrap').contains(e.target))
        suggest.style.display = 'none';
    }});

    if (S3_BUCKET) {{
      var initLoc = LOCATIONS.find(function(l) {{
        return Math.abs(l.lat - CURRENT_LAT) < 0.02 && Math.abs(l.lon - CURRENT_LON) < 0.02;
      }}) || {{lat:CURRENT_LAT, lon:CURRENT_LON, name:'Current', state:''}};
      currentLoc = initLoc;
      PrecipPlot.fetchAndRender(initLoc);
      kdeNeedsRefresh = true;
    }}
  }})();
  </script>
</body>
</html>"""


def _write_placeholder(out_file: Path) -> None:
    html = """<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Precipitation Interactive</title></head>
<body style="font-family:sans-serif;text-align:center;padding:80px;">
<h2>No ensemble data available</h2>
<p>Ensemble members are required for this plot.</p>
</body></html>"""
    out_file.write_text(html, encoding="utf-8")
    print(f"  saved (placeholder) → {out_file}")


_PLOTLY_CDN = "https://cdn.plot.ly/plotly-3.1.1.min.js"


def _build_lambda_html(
    title: str,
    current_lat: float,
    current_lon: float,
    s3_bucket: str,
    locations: list[dict],
    events: list[dict],
    cdn_domain: str = "",
) -> str:
    """Generate weather/index.html for Lambda: no server-side Plotly, fully client-side rendering.

    The page loads Plotly.js from CDN and calls PrecipPlot.fetchAndRender() on page load,
    which fetches forecast JSON from S3 and renders the chart in the browser.
    """
    # Pre-initialise the Plotly div with the correct 3-subplot layout so that
    # renderRun()'s Object.assign({}, plotDiv.layout, ...) finds all axes
    # already present and the if(newLayout[k]) guards pass.
    #
    # Domain values computed from make_subplots(rows=3, shared_xaxes=True,
    # row_heights=[0.44,0.10,0.44], vertical_spacing=0.04):
    #   available = 1 - 2*0.04 = 0.92; sum(heights)=0.98 (normalised below)
    #   row1 h=0.4131  domain=[0.5870, 1.0]
    #   row2 h=0.0939  domain=[0.4531, 0.5470]
    #   row3 h=0.4131  domain=[0.0,    0.4131]
    precip_placeholder = (
        f'<script src="{_PLOTLY_CDN}"></script>'
        f'<div id="{_PLOT_DIV_ID}" style="width:100%;height:950px;touch-action:pan-y;"></div>'
        '<script>(function(){'
        f'var el=document.getElementById("{_PLOT_DIV_ID}");'
        'Plotly.newPlot(el,[],{'
        '  height:950,template:"plotly_white",hovermode:"x unified",'
        '  legend:{orientation:"h",yanchor:"top",y:-0.08,xanchor:"center",x:0.5,font:{size:10},tracegroupgap:5},'
        '  margin:{t:80,b:100},dragmode:"pan",'
        '  xaxis: {anchor:"y",  domain:[0,1]},'
        '  xaxis2:{anchor:"y2", domain:[0,1],matches:"x"},'
        '  xaxis3:{anchor:"y3", domain:[0,1],matches:"x"},'
        '  yaxis: {anchor:"x",  domain:[0.5870,1.0],  title:{text:"Cumul. Precip (in)"},gridcolor:"rgba(200,200,200,0.4)"},'
        '  yaxis2:{anchor:"x2", domain:[0.4531,0.5470],range:[-0.5,0.5],showgrid:false,zeroline:false},'
        '  yaxis3:{anchor:"x3", domain:[0,0.4131],     title:{text:"Temperature (\u00b0F)"},gridcolor:"rgba(200,200,200,0.4)"},'
        '},{staticPlot:false,scrollZoom:false,displayModeBar:"hover"});'
        '})();</script>'
    )
    return _build_combined_html(
        precip_plot_html=precip_placeholder,
        kde_html_fragment=None,
        title=title,
        current_lat=current_lat,
        current_lon=current_lon,
        s3_bucket=s3_bucket,
        locations=locations,
        events=events,
        cdn_domain=cdn_domain,
    )
