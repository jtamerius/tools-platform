"""Resort-operations season key.

Deliberately an operations calendar rather than astronomical seasons: what
changes corridor behaviour is whether the lifts are turning, not the solstice.
Boundaries are month/day pairs in Mountain time and are expected to be tuned
once a real opening date is known for a given year.
"""
from __future__ import annotations

# (start_month, start_day, key) — evaluated in order, wrapping at year end.
_BOUNDARIES = [
    (12, 21, "peak"),       # holidays through the core of the season
    (11, 25, "open"),       # lifts turning, pre-holiday
    (11, 1, "preseason"),   # snowmaking, early storms, no lifts
    (5, 1, "closed"),       # summer — the corridor is commuters only
    (4, 1, "spring"),       # spring skiing / closing weeks
    (1, 1, "peak"),         # Jan 1 through Mar 31
]


def season_key(mt_date: str) -> str:
    """Map an MT date string 'YYYY-MM-DD' to a season key."""
    _, m, d = (int(x) for x in mt_date.split("-"))
    for sm, sd, key in _BOUNDARIES:
        if (m, d) >= (sm, sd):
            return key
    return "peak"
