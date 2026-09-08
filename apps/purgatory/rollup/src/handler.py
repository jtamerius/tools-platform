"""Purgatory rollup Lambda — collapses 15-minute ingest records into mergeable cells.

The dashboard needs a baseline drawn from all history while the view shows a
window. Those are different data extents, so no amount of client-side memoising
can be correct: before this Lambda existed the page pulled the entire ~82 MB
ingest table into the browser (twice) to compute an "all time" average.

One row per (camera x MT date x MT hour) plus a day tier and a day-of-week
pointer tier. Every time scale downstream is then a summation depth over one
artifact rather than a different query shape.

Cells store sufficient statistics (n, sum, sum of squares), never pre-averaged
values, so they merge by addition at any depth.

Modes
-----
incremental  re-derive a trailing window (default 2h) — runs every 15 minutes
nightly      re-derive a trailing 30 days, catching late review corrections
backfill     re-derive an explicit [start, end] date range
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Iterable

import boto3
from boto3.dynamodb.conditions import Key

from .mt import hours_in_mt_day, mt_parts, parse_sk, to_mt
from .season import season_key

logging.basicConfig()
logger = logging.getLogger()
logger.setLevel(os.environ.get("LOG_LEVEL", "INFO"))

INGEST_TABLE = os.environ["INGEST_TABLE"]
ROLLUP_TABLE = os.environ["ROLLUP_TABLE"]
CAM_CONFIG_TABLE = os.environ["CAM_CONFIG_TABLE"]

TICKS_PER_HOUR = 4
DOW_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

_ddb = boto3.resource("dynamodb")

# Covariates averaged into every cell. None of these should move with traffic
# demand, which is what makes them usable as a camera-health check.
_COVARIATES = [
    ("yolo_confidence_mean", "conf"),
    ("img_mean_brightness", "brightness"),
    ("img_edge_density", "edge_density"),
    ("solar_altitude_deg", "solar_alt"),
]


def _num(v) -> float | None:
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _dec(v):
    """DynamoDB rejects float; round hard enough to keep Decimal exact."""
    if isinstance(v, float):
        return Decimal(str(round(v, 6)))
    return v


def active_traffic_cams() -> list[str]:
    table = _ddb.Table(CAM_CONFIG_TABLE)
    resp = table.scan(
        FilterExpression="active = :a AND cam_type = :t",
        ExpressionAttributeValues={":a": True, ":t": "traffic"},
        ProjectionExpression="cam_id",
    )
    return sorted(item["cam_id"] for item in resp.get("Items", []))


def _query_range(cam_id: str, start_iso: str, end_iso: str) -> Iterable[dict]:
    table = _ddb.Table(INGEST_TABLE)
    kwargs = {
        "KeyConditionExpression": Key("pk").eq(f"CAM#{cam_id}") & Key("sk").between(start_iso, end_iso),
        "ProjectionExpression": (
            "sk, vehicle_count, vehicle_counts_by_zone, unusable, needs_review, "
            "yolo_confidence_mean, img_mean_brightness, img_edge_density, "
            "solar_altitude_deg, model_s3_key, roi_version"
        ),
    }
    while True:
        resp = table.query(**kwargs)
        yield from resp.get("Items", [])
        lek = resp.get("LastEvaluatedKey")
        if not lek:
            return
        kwargs["ExclusiveStartKey"] = lek


class Cell:
    """Sufficient statistics for one (camera, MT date, MT hour) bucket."""

    __slots__ = ("n", "sum_y", "sum_y2", "n_zero", "n_unusable", "n_review",
                 "sum_in", "sum_out", "n_zones", "cov", "epochs")

    def __init__(self):
        self.n = 0
        self.sum_y = 0.0
        self.sum_y2 = 0.0
        self.n_zero = 0
        self.n_unusable = 0
        self.n_review = 0
        self.sum_in = 0.0
        self.sum_out = 0.0
        self.n_zones = 0
        self.cov = {name: [0.0, 0] for _, name in _COVARIATES}
        self.epochs = {}

    def add(self, rec: dict) -> None:
        # An unusable frame is counted for coverage but excluded from the
        # traffic statistics — a snow-covered lens is not a quiet road.
        unusable = bool(rec.get("unusable"))
        if unusable:
            self.n_unusable += 1
        if rec.get("needs_review"):
            self.n_review += 1

        epoch = f"{rec.get('model_s3_key') or 'baked-in'}|roi{int(rec.get('roi_version') or 0)}"
        self.epochs[epoch] = self.epochs.get(epoch, 0) + 1

        for field, name in _COVARIATES:
            val = _num(rec.get(field))
            if val is not None:
                self.cov[name][0] += val
                self.cov[name][1] += 1

        if unusable:
            return
        y = _num(rec.get("vehicle_count"))
        if y is None:
            return
        self.n += 1
        self.sum_y += y
        self.sum_y2 += y * y
        if y == 0:
            self.n_zero += 1
        zones = rec.get("vehicle_counts_by_zone") or {}
        if zones:
            self.n_zones += 1
            self.sum_in += _num(zones.get("Inbound")) or 0.0
            self.sum_out += _num(zones.get("Outbound")) or 0.0

    def merge(self, other: "Cell") -> None:
        self.n += other.n
        self.sum_y += other.sum_y
        self.sum_y2 += other.sum_y2
        self.n_zero += other.n_zero
        self.n_unusable += other.n_unusable
        self.n_review += other.n_review
        self.sum_in += other.sum_in
        self.sum_out += other.sum_out
        self.n_zones += other.n_zones
        for name, (s, c) in other.cov.items():
            self.cov[name][0] += s
            self.cov[name][1] += c
        for k, v in other.epochs.items():
            self.epochs[k] = self.epochs.get(k, 0) + v

    def item(self, n_expected: int) -> dict:
        """Serialise as sufficient statistics — never pre-averaged.

        Covariate sums and counts are stored rather than their means so that a
        day row merged from 24 hour cells is exactly equal to the same day
        rebuilt from raw records. `mean` is written as a convenience for the
        API and is always recomputable from sum_y / n.
        """
        out = {
            "n": self.n,
            "n_expected": n_expected,
            "sum_y": _dec(self.sum_y),
            "sum_y2": _dec(self.sum_y2),
            "n_zero": self.n_zero,
            "n_unusable": self.n_unusable,
            "n_review": self.n_review,
            "n_zones": self.n_zones,
            "sum_inbound": _dec(self.sum_in),
            "sum_outbound": _dec(self.sum_out),
        }
        if self.n:
            out["mean"] = _dec(self.sum_y / self.n)
        for name, (total, count) in self.cov.items():
            if count:
                out[f"sum_{name}"] = _dec(total)
                out[f"n_{name}"] = count
        if self.epochs:
            # Kept as a map so day rows merge exactly. A cell spanning a
            # detector change is flagged rather than silently averaged across.
            out["epochs"] = {k: v for k, v in self.epochs.items()}
            out["epoch"] = max(self.epochs.items(), key=lambda kv: kv[1])[0]
            out["epoch_mixed"] = len(self.epochs) > 1
        return out

    @classmethod
    def from_item(cls, item: dict) -> "Cell":
        """Reconstruct from a stored cell so tiers merge without re-reading raw."""
        c = cls()
        c.n = int(item.get("n") or 0)
        c.sum_y = float(item.get("sum_y") or 0)
        c.sum_y2 = float(item.get("sum_y2") or 0)
        c.n_zero = int(item.get("n_zero") or 0)
        c.n_unusable = int(item.get("n_unusable") or 0)
        c.n_review = int(item.get("n_review") or 0)
        c.n_zones = int(item.get("n_zones") or 0)
        c.sum_in = float(item.get("sum_inbound") or 0)
        c.sum_out = float(item.get("sum_outbound") or 0)
        for _, name in _COVARIATES:
            total = item.get(f"sum_{name}")
            count = item.get(f"n_{name}")
            if total is not None and count:
                c.cov[name] = [float(total), int(count)]
        for k, v in (item.get("epochs") or {}).items():
            c.epochs[k] = int(v)
        return c


def _build(cam_id: str, start_iso: str, end_iso: str) -> dict[tuple[str, int], Cell]:
    cells: dict[tuple[str, int], Cell] = {}
    for rec in _query_range(cam_id, start_iso, end_iso):
        date, hour, _ = mt_parts(rec["sk"])
        key = (date, hour)
        if key not in cells:
            cells[key] = Cell()
        cells[key].add(rec)
    return cells


def _write(items: list[dict]) -> int:
    table = _ddb.Table(ROLLUP_TABLE)
    with table.batch_writer(overwrite_by_pkeys=["pk", "sk"]) as batch:
        for item in items:
            batch.put_item(Item=item)
    return len(items)


def _read_day_hours(cam_id: str, date: str) -> list[dict]:
    """Every stored hour cell for one MT day."""
    table = _ddb.Table(ROLLUP_TABLE)
    resp = table.query(
        KeyConditionExpression=Key("pk").eq(f"AGG#HOUR#{cam_id}")
        & Key("sk").between(f"{date}T00", f"{date}T23"),
    )
    return resp.get("Items", [])


def rebuild(start_utc: datetime, end_utc: datetime, cams: list[str] | None = None) -> dict:
    """Re-derive every cell touched by [start_utc, end_utc]. Idempotent.

    The window is snapped outward to whole hours first. A cell is only correct
    if it sees every tick in its hour, so a raw 2-hour window would rewrite the
    hour at each edge from a partial view and quietly drop ticks from it. MT is
    a whole-hour offset from UTC, so snapping in UTC snaps MT hours too.
    """
    cams = cams or active_traffic_cams()
    start_utc = start_utc.replace(minute=0, second=0, microsecond=0)
    end_utc = (end_utc.replace(minute=0, second=0, microsecond=0)
               + timedelta(hours=1) - timedelta(microseconds=1))
    start_iso = start_utc.isoformat().replace("+00:00", "Z")
    end_iso = end_utc.isoformat().replace("+00:00", "Z")

    written = 0
    touched_days: set[tuple[str, str]] = set()

    for cam_id in cams:
        cells = _build(cam_id, start_iso, end_iso)
        items = []
        for (date, hour), cell in sorted(cells.items()):
            item = cell.item(TICKS_PER_HOUR)
            item.update({
                "pk": f"AGG#HOUR#{cam_id}",
                "sk": f"{date}T{hour:02d}",
                "cam_id": cam_id,
                "date": date,
                "hour": hour,
                "season": season_key(date),
            })
            items.append(item)
            touched_days.add((cam_id, date))
        written += _write(items)
        logger.info("cam %s: %d hour cells", cam_id, len(items))

    # Day tier + day-of-week pointer rows, rebuilt from every stored hour cell
    # of the affected day rather than from this run's window. A 2-hour
    # incremental pass touches two hours of a day but must still write a day
    # row describing the whole day, or it would overwrite a complete row with
    # a partial one on every tick.
    day_items = []
    for cam_id, date in sorted(touched_days):
        merged = Cell()
        for hour_item in _read_day_hours(cam_id, date):
            merged.merge(Cell.from_item(hour_item))
        expected = hours_in_mt_day(date) * TICKS_PER_HOUR
        base = merged.item(expected)
        dow = datetime.strptime(date, "%Y-%m-%d").weekday()
        base.update({
            "cam_id": cam_id, "date": date, "dow": dow,
            "dow_name": DOW_NAMES[dow], "season": season_key(date),
        })
        day_items.append({**base, "pk": f"AGG#DAY#{cam_id}", "sk": date})
        day_items.append({**base, "pk": f"DOW#{cam_id}#{dow}", "sk": date})
    written += _write(day_items)

    return {"cells_written": written, "cams": len(cams),
            "range": [start_iso, end_iso], "day_rows": len(day_items)}


def handler(event, context):
    event = event or {}
    mode = event.get("mode", "incremental")
    now = datetime.now(tz=timezone.utc)

    if mode == "incremental":
        hours = int(event.get("hours", 2))
        start, end = now - timedelta(hours=hours), now
    elif mode == "nightly":
        days = int(event.get("days", 30))
        start, end = now - timedelta(days=days), now
    elif mode == "backfill":
        start = parse_sk(event["start"])
        end = parse_sk(event["end"]) if event.get("end") else now
    else:
        return {"error": f"unknown mode {mode}"}

    result = rebuild(start, end, event.get("cams"))
    result["mode"] = mode
    logger.info("rollup %s: %s", mode, result)
    return result
