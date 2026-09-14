from __future__ import annotations

from typing import Optional, TypedDict


class ClusterSummary(TypedDict):
    cluster_id: int
    size: int                           # number of members in cluster
    medoid_index: int                   # index into the original member list
    total_precip_min: float             # min total-precip across members (in)
    total_precip_p25: float
    total_precip_median: float
    total_precip_p75: float
    total_precip_max: float
    window_0_72h: float                 # cluster-median total over hours 0–72
    window_72_168h: float               # cluster-median total over hours 72–168
    window_168_384h: float              # cluster-median total over hours 168–384


class ClusteringResult(TypedDict):
    metadata: ClusteringMetadata
    members: list[MemberInfo]
    clustering: ClusteringOutput


class ClusteringMetadata(TypedDict):
    model_id: str
    n_members: int                      # total members passed in (including mean at index 0)
    n_zero_members: int                 # members with zero total precip
    horizon_hours: int
    downsample_hours: int
    k: int
    linkage_method: str
    distance_metric: str


class MemberInfo(TypedDict):
    member_index: int                   # index in original input list
    total_precip: float                 # sum of all incremental values (in)
    cluster_id: int


class ClusteringOutput(TypedDict):
    cluster_assignments: dict[int, int]  # {member_index: cluster_id}
    clusters: list[ClusterSummary]
    linkage_matrix: list[list[float]]    # scipy linkage matrix as nested list


class StormEvent(TypedDict):
    event_index:     int    # 1-based label, sorted by start time
    start_hour:      int    # index into time axis (inclusive)
    end_hour:        int    # index into time axis (exclusive)
    start_time:      str    # ISO8601 UTC string from time_axis[start_hour]
    end_time:        str    # ISO8601 UTC string from time_axis[end_hour - 1]
    duration_hours:  int    # end_hour - start_hour
    peak_rate:       float  # max smoothed ensemble-mean precipitation rate (in/h) within this window
    member_totals:   dict   # {model_id: list[float]} — one float per member; index 0 = ensemble mean
    n_members_total: int    # total pooled members used for detection
