# engine requires numpy; skip in Lambda environments where numpy is absent
try:
    from .engine import cluster_arrays, cluster_precipitation
    _HAS_ENGINE = True
except ImportError:
    _HAS_ENGINE = False

from .events import detect_storm_events

__all__ = ["cluster_arrays", "cluster_precipitation", "detect_storm_events"]
