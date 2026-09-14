"""Authorization tests for the Purgatory API.

The app is deliberately public for reads. These pin the boundary so it cannot
drift open again the way it did in a1b0a7a, which removed the group check when
the app went public and left the write routes trusting mere pool membership.
"""
import os
import re
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("INGEST_TABLE", "t")
os.environ.setdefault("CAM_CONFIG_TABLE", "t")
os.environ.setdefault("S3_BUCKET", "t")

from handler import RESTRICTED, WRITE_GROUPS, _caller_groups, _may_write  # noqa: E402

REPO = Path(__file__).resolve().parents[4]
STACK = REPO / "infra/cdk/lib/stacks/purgatory-stack.ts"


def _event(groups=None):
    claims = {} if groups is None else {"cognito:groups": groups}
    return {"requestContext": {"authorizer": {"jwt": {"claims": claims}}}}


class TestCallerGroups:
    @pytest.mark.parametrize("raw,expected", [
        ("admin", {"admin"}),
        ("[admin member]", {"admin", "member"}),   # API Gateway's flattened form
        ("admin,member", {"admin", "member"}),
        (["admin", "member"], {"admin", "member"}),
        ("", set()),
        ("[]", set()),
    ])
    def test_parses_every_claim_shape(self, raw, expected):
        assert _caller_groups(_event(raw)) == expected

    def test_absent_authorizer_yields_no_groups(self):
        assert _caller_groups({}) == set()


class TestMayWrite:
    def test_admin_and_member_may_write(self):
        assert _may_write(_event("admin"))
        assert _may_write(_event("member"))

    def test_guest_may_not(self):
        assert not _may_write(_event("guest"))

    def test_unauthenticated_may_not(self):
        """A caller with a valid pool token but no group is still not a writer."""
        assert not _may_write(_event(""))
        assert not _may_write({})


class TestRestrictedSetMatchesInfrastructure:
    """The Lambda's RESTRICTED set and the CDK's RESTRICTED_ROUTES are two
    halves of one decision. If they drift, a route is either unreachable or
    silently public — so assert they are identical."""

    def _cdk_routes(self, const_name):
        src = STACK.read_text()
        block = re.search(rf"const {const_name} = \[(.*?)\];", src, re.S)
        assert block, f"{const_name} not found in {STACK}"
        return {tuple(r.split(" ", 1)) for r in re.findall(r"'([A-Z]+ /[^']+)'", block.group(1))}

    def test_restricted_matches_cdk(self):
        assert RESTRICTED == self._cdk_routes("RESTRICTED_ROUTES")

    def test_public_and_restricted_do_not_overlap(self):
        assert not (RESTRICTED & self._cdk_routes("PUBLIC_READ_ROUTES"))

    def test_the_dangerous_routes_are_restricted(self):
        """Model upload plus activation is arbitrary code execution in the
        ingest container — ultralytics unpickles whatever .pt is active."""
        assert ("POST", "/api/model-upload-url") in RESTRICTED
        assert ("PATCH", "/api/model-meta") in RESTRICTED

    def test_dashboard_reads_stay_public(self):
        public = self._cdk_routes("PUBLIC_READ_ROUTES")
        for route in [("GET", "/api/series"), ("GET", "/api/history"), ("GET", "/api/image")]:
            assert route in public, f"{route} must stay public — the dashboard needs it"


def test_write_groups_excludes_guest():
    assert "guest" not in WRITE_GROUPS
