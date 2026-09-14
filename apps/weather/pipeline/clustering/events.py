"""clustering/events.py — Detect distinct storm events from a multi-model ensemble.

Public API
----------
detect_storm_events(result, *, active_rate, smoothing_hours,
                    min_gap_hours, min_duration_hours)
    → list[StormEvent]

Algorithm
---------
1. Pool all ensemble members from all models into one matrix (N_total × H timesteps).
2. At each timestep t, compute p[t] = ensemble-mean precipitation rate (in/h).
3. Smooth p with a rolling mean of width smoothing_hours (np.convolve, mode='same').
4. Find contiguous runs where smoothed_p > active_rate.
5. Merge runs whose inter-run gap is < min_gap_hours.
6. Drop runs shorter than min_duration_hours.
7. For each surviving window [start_h, end_h): sum incremental precip per (model, member).

numpy is used when available (local runs); a pure-Python fallback handles Lambda
environments where numpy is not installed.
"""
from __future__ import annotations

import logging
from typing import Optional

try:
    import numpy as np
    _HAS_NP = True
except ImportError:
    _HAS_NP = False

from .models import StormEvent

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Pure-Python helpers (used when numpy is unavailable)
# ---------------------------------------------------------------------------

def _rolling_mean(arr: list[float], k: int) -> list[float]:
    """Uniform rolling mean matching np.convolve(mode='same') zero-pad behaviour."""
    h = len(arr)
    half = k // 2
    out: list[float] = []
    for t in range(h):
        lo = max(0, t - half)
        hi = min(h, t + k - half)
        window = arr[lo:hi]
        # Window may be shorter than k near edges — divide by k (zero-pad equivalent)
        out.append(sum(window) / k)
    return out


def _col_mean_rate(rows: list[list[float]]) -> list[float]:
    """Column-wise mean across all rows (ensemble-mean precipitation rate in/h)."""
    if not rows:
        return []
    h = len(rows[0])
    n = len(rows)
    return [sum(row[t] for row in rows) / n for t in range(h)]


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def detect_storm_events(
    result: dict,
    *,
    active_rate:        float = 0.003,  # in/h — ensemble-mean rate threshold to activate a run
    smoothing_hours:    int   = 6,      # rolling-mean kernel width (hours)
    min_gap_hours:      int   = 12,     # merge runs with gap < this many hours
    min_duration_hours: int   = 12,     # drop runs shorter than this
) -> list[StormEvent]:
    """Detect distinct storm episodes from a multi-model ensemble forecast.

    Args:
        result:              A successful ``ForecastResult`` dict from ``fetch_forecast()``.
                             Must contain ``result["members"]`` with precipitation arrays.
        active_rate:         Ensemble-mean precipitation rate (in/h) above which a timestep
                             is considered active.  Combines both frequency and intensity:
                             p[t] = mean(member_rate[t]) across all pooled members.
        smoothing_hours:     Width of the rolling-mean smoothing kernel applied to the
                             ensemble-mean rate signal.
        min_gap_hours:       Runs separated by fewer than this many hours are merged.
        min_duration_hours:  Runs shorter than this are discarded.

    Returns:
        Sorted list of ``StormEvent`` dicts (by start_hour).  Empty list if no events
        are detected or if ensemble data is unavailable.  Max 5 events returned
        (largest by total precipitation).  Never raises.
    """
    if result.get("error"):
        return []

    members_data = result.get("members")
    if members_data is None:
        return []

    time_axis: list[str] = members_data.get("time", [])
    H = len(time_axis)
    if H == 0:
        return []

    # ── Step 1: Build pooled matrix and per-model arrays ────────────────────
    # pooled: all members from all models stacked row-by-row (N_total × H)
    # model_arrays: {model_id: list[list[float]]} for per-event totals
    pooled: list[list[float]] = []
    model_arrays: dict[str, list[list[float]]] = {}

    precip_data = members_data.get("precipitation", {})
    for model_id, series_list in precip_data.items():
        if not series_list:
            continue
        model_arrs: list[list[float]] = []
        for series in series_list:
            arr: list[float] = [max(0.0, 0.0 if v is None else float(v)) for v in series]
            # Pad or truncate to H if a model returned a different length
            if len(arr) != H:
                logger.warning(
                    "Model %s member array length %d ≠ time axis length %d; clipping/padding.",
                    model_id, len(arr), H,
                )
                if len(arr) < H:
                    arr = arr + [0.0] * (H - len(arr))
                else:
                    arr = arr[:H]
            pooled.append(arr)
            model_arrs.append(arr)
        model_arrays[model_id] = model_arrs

    if not pooled:
        return []

    N_total = len(pooled)

    # ── Step 2 & 3: Ensemble-mean rate + rolling-mean smoothing ─────────────
    if _HAS_NP:
        matrix = np.vstack([np.array(r, dtype=float) for r in pooled])  # (N_total, H)
        p = matrix.mean(axis=0)                                          # ensemble-mean rate (in/h)
        kernel = np.ones(smoothing_hours) / smoothing_hours
        smoothed_p_arr = np.convolve(p, kernel, mode="same")
        smoothed_p: list[float] = smoothed_p_arr.tolist()
    else:
        p = _col_mean_rate(pooled)
        smoothed_p = _rolling_mean(p, max(1, smoothing_hours))

    # ── Step 4: Find contiguous active runs ─────────────────────────────────
    runs: list[tuple[int, int]] = []
    in_run = False
    run_start = 0
    for t in range(H):
        if smoothed_p[t] > active_rate and not in_run:
            run_start = t
            in_run = True
        elif smoothed_p[t] <= active_rate and in_run:
            runs.append((run_start, t))
            in_run = False
    if in_run:
        runs.append((run_start, H))

    if not runs:
        return []

    # ── Step 5: Merge runs with small gaps ──────────────────────────────────
    merged: list[tuple[int, int]] = [runs[0]]
    for start, end in runs[1:]:
        prev_start, prev_end = merged[-1]
        if start - prev_end < min_gap_hours:
            merged[-1] = (prev_start, end)
        else:
            merged.append((start, end))
    runs = merged

    # ── Step 6: Filter short events ─────────────────────────────────────────
    runs = [(s, e) for s, e in runs if (e - s) >= min_duration_hours]

    if not runs:
        return []

    # ── Step 7: Compute per-event member totals and build StormEvent list ───
    events: list[StormEvent] = []
    for event_idx, (s, e) in enumerate(runs):
        member_totals: dict[str, list[float]] = {}
        for model_id, arrs in model_arrays.items():
            member_totals[model_id] = [float(sum(arr[s:e])) for arr in arrs]

        peak_rate = float(max(smoothed_p[s:e]))
        end_clipped = min(e - 1, H - 1)

        events.append({
            "event_index":     event_idx + 1,
            "start_hour":      s,
            "end_hour":        e,
            "start_time":      time_axis[s],
            "end_time":        time_axis[end_clipped],
            "duration_hours":  e - s,
            "peak_rate":       peak_rate,
            "member_totals":   member_totals,
            "n_members_total": N_total,
        })

    # ── Step 8: Keep at most 5 events, ranked by mean total precip ──────────
    MAX_EVENTS = 5
    if len(events) > MAX_EVENTS:
        def _mean_precip(ev: StormEvent) -> float:
            totals = [t for tots in ev["member_totals"].values() for t in tots]
            return sum(totals) / len(totals) if totals else 0.0

        events.sort(key=_mean_precip, reverse=True)
        events = events[:MAX_EVENTS]
        # Re-sort by start_hour and re-number
        events.sort(key=lambda ev: ev["start_hour"])
        for i, ev in enumerate(events):
            ev["event_index"] = i + 1

    return events
