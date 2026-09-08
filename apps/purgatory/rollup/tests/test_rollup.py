"""Offline tests for the rollup cell layer — no AWS required."""
import os
import sys
from datetime import datetime, timedelta, timezone

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("INGEST_TABLE", "t-ingest")
os.environ.setdefault("ROLLUP_TABLE", "t-rollup")
os.environ.setdefault("CAM_CONFIG_TABLE", "t-cam")

from src.mt import hours_in_mt_day, mt_parts, to_mt  # noqa: E402
from src.season import season_key  # noqa: E402


class TestMountainTime:
    def test_mdt_offset_in_summer(self):
        d = to_mt(datetime(2026, 9, 8, 16, 15, tzinfo=timezone.utc))
        assert d.utcoffset() == timedelta(hours=-6)
        assert (d.hour, d.strftime("%Y-%m-%d")) == (10, "2026-09-08")

    def test_mst_offset_in_winter(self):
        d = to_mt(datetime(2026, 1, 15, 16, 15, tzinfo=timezone.utc))
        assert d.utcoffset() == timedelta(hours=-7)
        assert d.hour == 9

    def test_spring_forward_skips_two_am(self):
        before = to_mt(datetime(2026, 3, 8, 8, 59, tzinfo=timezone.utc))
        after = to_mt(datetime(2026, 3, 8, 9, 1, tzinfo=timezone.utc))
        assert before.hour == 1 and after.hour == 3

    def test_fall_back_repeats_one_am(self):
        before = to_mt(datetime(2026, 11, 1, 7, 59, tzinfo=timezone.utc))
        after = to_mt(datetime(2026, 11, 1, 8, 1, tzinfo=timezone.utc))
        assert before.hour == 1 and after.hour == 1

    @pytest.mark.parametrize("date,expected", [
        ("2026-03-08", 23),   # spring forward — 92 ticks, not 96
        ("2026-11-01", 25),   # fall back — 100 ticks
        ("2026-09-08", 24),
    ])
    def test_dst_days_are_not_24_hours(self, date, expected):
        assert hours_in_mt_day(date) == expected

    def test_mt_parts_returns_date_hour_weekday(self):
        assert mt_parts("2026-09-08T16:15:00Z") == ("2026-09-08", 10, 1)


class TestSeasonKey:
    @pytest.mark.parametrize("date,key", [
        ("2026-05-16", "closed"), ("2026-09-08", "closed"),
        ("2026-11-10", "preseason"), ("2026-11-28", "open"),
        ("2026-12-25", "peak"), ("2027-01-15", "peak"),
        ("2027-04-15", "spring"),
    ])
    def test_operations_calendar(self, date, key):
        assert season_key(date) == key


class TestCellStatistics:
    """Cells must merge by addition at any depth, so they store sufficient
    statistics rather than pre-averaged values."""

    def _cell(self, counts, **kw):
        from src.handler import Cell
        c = Cell()
        for y in counts:
            c.add({"vehicle_count": y, "model_s3_key": kw.get("model", "m/v5"),
                   "roi_version": 1, "yolo_confidence_mean": 0.7,
                   "vehicle_counts_by_zone": {"Inbound": 1, "Outbound": y}})
        return c

    def test_sufficient_statistics(self):
        c = self._cell([0, 1, 2, 3])
        item = c.item(4)
        assert item["n"] == 4
        assert float(item["sum_y"]) == 6.0
        assert float(item["sum_y2"]) == 14.0
        assert item["n_zero"] == 1
        assert float(item["mean"]) == 1.5

    def test_merge_equals_direct_aggregation(self):
        from src.handler import Cell
        a, b = self._cell([0, 1, 2, 3]), self._cell([4, 5])
        merged = Cell()
        merged.merge(a)
        merged.merge(b)
        direct = self._cell([0, 1, 2, 3, 4, 5])
        for field in ("n", "sum_y", "sum_y2", "n_zero", "sum_outbound"):
            assert str(merged.item(4)[field]) == str(direct.item(4)[field]), field

    def test_roundtrip_through_stored_item(self):
        """A day row rebuilt from stored hour cells must equal a direct rebuild."""
        from src.handler import Cell
        a, b = self._cell([0, 1, 2, 3]), self._cell([4, 5])
        restored = Cell()
        restored.merge(Cell.from_item(a.item(4)))
        restored.merge(Cell.from_item(b.item(4)))
        direct = self._cell([0, 1, 2, 3, 4, 5])
        for field in ("n", "sum_y", "sum_y2", "n_zero", "sum_conf", "n_conf"):
            assert str(restored.item(4)[field]) == str(direct.item(4)[field]), field

    def test_unusable_frames_excluded_from_traffic_stats(self):
        """A snow-covered lens is not a quiet road — but it still counts
        against coverage."""
        from src.handler import Cell
        c = Cell()
        c.add({"vehicle_count": 5, "unusable": False})
        c.add({"vehicle_count": 0, "unusable": True})
        item = c.item(4)
        assert item["n"] == 1
        assert float(item["sum_y"]) == 5.0
        assert item["n_unusable"] == 1

    def test_mixed_detector_epoch_is_flagged(self):
        from src.handler import Cell
        c = Cell()
        c.add({"vehicle_count": 1, "model_s3_key": "m/v4", "roi_version": 1})
        c.add({"vehicle_count": 1, "model_s3_key": "m/v5", "roi_version": 1})
        assert c.item(4)["epoch_mixed"] is True

    def test_single_epoch_not_flagged(self):
        c = self._cell([1, 2])
        assert c.item(4)["epoch_mixed"] is False
