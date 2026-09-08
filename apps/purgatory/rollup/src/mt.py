"""America/Denver conversion without tzdata.

Lambda's Python image does not reliably ship the IANA database, and the whole
rollup is keyed on Mountain calendar hours, so the DST rules are implemented
directly. US rule since 2007: DST starts 02:00 local on the second Sunday in
March and ends 02:00 local on the first Sunday in November.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

MST = timezone(timedelta(hours=-7))
MDT = timezone(timedelta(hours=-6))


def _nth_weekday(year: int, month: int, weekday: int, n: int) -> datetime:
    """UTC-naive date of the nth given weekday (0=Mon) in a month."""
    d = datetime(year, month, 1)
    offset = (weekday - d.weekday()) % 7
    return d + timedelta(days=offset + 7 * (n - 1))


def _dst_bounds(year: int) -> tuple[datetime, datetime]:
    """DST start/end as UTC instants for a given year."""
    # 02:00 MST = 09:00 UTC on the second Sunday in March
    start = _nth_weekday(year, 3, 6, 2) + timedelta(hours=9)
    # 02:00 MDT = 08:00 UTC on the first Sunday in November
    end = _nth_weekday(year, 11, 6, 1) + timedelta(hours=8)
    return start, end


def to_mt(dt: datetime) -> datetime:
    """Convert an aware UTC datetime to Mountain wall-clock time."""
    naive_utc = dt.astimezone(timezone.utc).replace(tzinfo=None)
    start, end = _dst_bounds(naive_utc.year)
    tz = MDT if start <= naive_utc < end else MST
    return dt.astimezone(tz)


def parse_sk(sk: str) -> datetime:
    """Parse an ingest sort key (UTC ISO, trailing Z) into an aware datetime."""
    return datetime.fromisoformat(sk.replace("Z", "+00:00"))


def mt_parts(sk: str) -> tuple[str, int, int]:
    """(MT date 'YYYY-MM-DD', MT hour 0-23, MT weekday 0=Mon) for an sk."""
    d = to_mt(parse_sk(sk))
    return d.strftime("%Y-%m-%d"), d.hour, d.weekday()


def hours_in_mt_day(date_str: str) -> int:
    """23, 24 or 25 — DST transition days are not 24 hours long.

    Coverage gating is load-bearing, so a spring-forward day must expect 92
    ticks rather than 96 or every March renders as a data outage.
    """
    y, m, d = (int(x) for x in date_str.split("-"))
    start, end = _dst_bounds(y)
    day = datetime(y, m, d)
    nxt = day + timedelta(days=1)
    if day <= start < nxt:
        return 23
    if day <= end < nxt:
        return 25
    return 24
