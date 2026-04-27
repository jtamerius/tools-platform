"""
finance-tracker Lambda handler.

All data lives in S3 as four flat JSON arrays:
  investments.json, events.json, accounts.json, snapshots.json

Every GET endpoint derives current state from those raw records.
No precomputed balances are stored.

Auth: Cognito access token validated via cognito-idp:GetUser.
Pass Authorization: Bearer <access_token> on every request.
"""

import base64
import json
import os
import time
import uuid
from datetime import date, timedelta
from typing import Optional

import boto3
from botocore.exceptions import ClientError

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
S3_BUCKET = os.environ["DATA_BUCKET"]

s3      = boto3.client("s3")
cognito = boto3.client("cognito-idp", region_name="us-east-1")


# ---------------------------------------------------------------------------
# Auth — Cognito access token
# ---------------------------------------------------------------------------

def _get_bearer(event: dict) -> Optional[str]:
    auth = (event.get("headers") or {}).get("authorization", "")
    if auth.startswith("Bearer "):
        return auth[7:]
    return None


def _authed(event: dict) -> bool:
    token = _get_bearer(event)
    if not token:
        return False
    try:
        cognito.get_user(AccessToken=token)
        return True
    except Exception:
        return False


# ---------------------------------------------------------------------------
# S3 data access
# ---------------------------------------------------------------------------

def _read(key: str) -> list:
    try:
        obj = s3.get_object(Bucket=S3_BUCKET, Key=key)
        return json.loads(obj["Body"].read())
    except ClientError as e:
        if e.response["Error"]["Code"] in ("NoSuchKey", "404"):
            return []
        raise


def _write(key: str, data: list) -> None:
    s3.put_object(
        Bucket=S3_BUCKET,
        Key=key,
        Body=json.dumps(data, indent=2, default=str).encode(),
        ContentType="application/json",
    )


def _load_all():
    return (
        _read("investments.json"),
        _read("events.json"),
        _read("accounts.json"),
        _read("snapshots.json"),
    )


# ---------------------------------------------------------------------------
# Business logic — derived fields
# ---------------------------------------------------------------------------

def _principal(inv_id: str, events: list, as_of: Optional[str] = None) -> float:
    evts = [e for e in events if e["investment_id"] == inv_id]
    if as_of:
        evts = [e for e in evts if e["effective_date"] <= as_of]
    evts.sort(key=lambda e: (e["effective_date"], e["entered_at"]))

    principal = 0.0
    for e in evts:
        et = e["event_type"]
        amt = float(e.get("amount") or 0)
        if et == "initial_funding":
            principal = amt
        elif et == "additional_funding":
            principal += amt
        elif et in ("principal_reduction", "closure_payoff"):
            principal = max(0.0, principal - amt)
    return principal


def _rate(inv: dict, events: list, as_of: Optional[str] = None) -> float:
    rate_evts = [
        e for e in events
        if e["investment_id"] == inv["id"] and e["event_type"] == "rate_change"
        and (as_of is None or e["effective_date"] <= as_of)
    ]
    if rate_evts:
        rate_evts.sort(key=lambda e: e["effective_date"])
        return float(rate_evts[-1].get("rate") or inv.get("annual_rate", 0.11))
    return float(inv.get("annual_rate", 0.11))


def _enrich_investment(inv: dict, events: list, as_of: Optional[str] = None) -> dict:
    p = _principal(inv["id"], events, as_of)
    r = _rate(inv, events, as_of)
    inv_events = sorted(
        [e for e in events if e["investment_id"] == inv["id"]],
        key=lambda e: (e["effective_date"], e["entered_at"]),
    )
    return {
        **inv,
        "principal_outstanding": p,
        "current_rate": r,
        "projected_annual": round(p * r, 2),
        "projected_monthly": round(p * r / 12, 2),
        "events": inv_events,
    }


def _latest_balance(acc_id: str, snapshots: list, as_of: Optional[str] = None) -> Optional[dict]:
    snaps = [s for s in snapshots if s["account_id"] == acc_id]
    if as_of:
        snaps = [s for s in snaps if s["snapshot_date"] <= as_of]
    if not snaps:
        return None
    snaps.sort(key=lambda s: s["snapshot_date"])
    return snaps[-1]


# ---------------------------------------------------------------------------
# HTTP response helpers
# ---------------------------------------------------------------------------

_CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Authorization,Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
}


def _resp(status: int, body) -> dict:
    return {
        "statusCode": status,
        "headers": {"Content-Type": "application/json", **_CORS},
        "body": json.dumps(body, default=str),
    }


def _ok(body):         return _resp(200, body)
def _created(body):    return _resp(201, body)
def _bad(msg):         return _resp(400, {"error": msg})
def _unauth(msg="Unauthorized"): return _resp(401, {"error": msg})
def _notfound(msg="Not found"):  return _resp(404, {"error": msg})


def _body(event: dict) -> dict:
    raw = event.get("body") or "{}"
    if event.get("isBase64Encoded"):
        raw = base64.b64decode(raw).decode()
    try:
        return json.loads(raw)
    except Exception:
        return {}


def _qs(event: dict) -> dict:
    return event.get("queryStringParameters") or {}


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


# ---------------------------------------------------------------------------
# Route handlers
# ---------------------------------------------------------------------------

def _handle_investments_list(event: dict) -> dict:
    investments, events, _, _ = _load_all()
    qs = _qs(event)
    as_of = qs.get("as_of") or None
    status_filter = qs.get("status", "active")

    result = []
    for inv in investments:
        s = inv.get("status", "active")
        if status_filter == "active" and s != "active":
            continue
        if status_filter == "closed" and s != "closed":
            continue
        result.append(_enrich_investment(inv, events, as_of))

    result.sort(key=lambda x: x.get("start_date", ""), reverse=True)
    return _ok(result)


def _handle_investments_create(event: dict) -> dict:
    investments, events, _, _ = _load_all()
    b = _body(event)
    now = _now()
    inv_id = _new_id("inv")

    rate = float(b.get("annual_rate") or 0.11)
    amount = float(b.get("original_funded_amount") or 0)
    start = b.get("start_date", "")

    inv = {
        "id": inv_id,
        "project_name": b.get("project_name", ""),
        "address": b.get("address", ""),
        "original_funded_amount": amount,
        "start_date": start,
        "closed_date": None,
        "status": "active",
        "annual_rate": rate,
        "notes": b.get("notes", ""),
        "funding_account_id": b.get("funding_account_id") or None,
        "payoff_account_id": b.get("payoff_account_id") or None,
        "created_at": now,
        "updated_at": now,
    }
    investments.append(inv)
    _write("investments.json", investments)

    evt = {
        "id": _new_id("evt"),
        "investment_id": inv_id,
        "effective_date": start,
        "event_type": "initial_funding",
        "amount": amount,
        "rate": None,
        "from_account_id": b.get("funding_account_id") or None,
        "to_account_id": None,
        "notes": b.get("event_notes", "Initial funding"),
        "entered_at": now,
    }
    events.append(evt)
    _write("events.json", events)

    return _created({"investment": inv, "event": evt})


def _handle_investment_update(event: dict, inv_id: str) -> dict:
    investments = _read("investments.json")
    idx = next((i for i, x in enumerate(investments) if x["id"] == inv_id), None)
    if idx is None:
        return _notfound(f"Investment {inv_id}")

    b = _body(event)
    inv = investments[idx]
    for field in ("project_name", "address", "notes", "funding_account_id", "payoff_account_id", "annual_rate"):
        if field in b:
            inv[field] = b[field]
    inv["updated_at"] = _now()
    _write("investments.json", investments)
    return _ok(inv)


def _handle_events_list(event: dict) -> dict:
    events = _read("events.json")
    inv_id = _qs(event).get("investment_id")
    if inv_id:
        events = [e for e in events if e["investment_id"] == inv_id]
    events.sort(key=lambda e: (e["effective_date"], e["entered_at"]))
    return _ok(events)


def _handle_events_create(event: dict) -> dict:
    investments = _read("investments.json")
    events = _read("events.json")
    b = _body(event)
    inv_id = b.get("investment_id", "")

    idx = next((i for i, x in enumerate(investments) if x["id"] == inv_id), None)
    if idx is None:
        return _bad(f"Investment {inv_id} not found")

    now = _now()
    etype = b.get("event_type", "")
    amount = b.get("amount")
    rate_val = b.get("rate")

    evt = {
        "id": _new_id("evt"),
        "investment_id": inv_id,
        "effective_date": b.get("effective_date", ""),
        "event_type": etype,
        "amount": float(amount) if amount is not None else None,
        "rate": float(rate_val) if rate_val is not None else None,
        "from_account_id": b.get("from_account_id") or None,
        "to_account_id": b.get("to_account_id") or None,
        "notes": b.get("notes", ""),
        "entered_at": now,
    }
    events.append(evt)
    _write("events.json", events)

    inv = investments[idx]
    if etype == "rate_change" and rate_val is not None:
        inv["annual_rate"] = float(rate_val)
        inv["updated_at"] = now
    elif etype == "closure_payoff":
        inv["status"] = "closed"
        inv["closed_date"] = b.get("effective_date", "")
        if b.get("to_account_id"):
            inv["payoff_account_id"] = b["to_account_id"]
        inv["updated_at"] = now
    elif etype == "status_change" and b.get("status"):
        inv["status"] = b["status"]
        inv["updated_at"] = now

    _write("investments.json", investments)
    return _created(evt)


def _handle_accounts_list(event: dict) -> dict:
    accounts = _read("accounts.json")
    snapshots = _read("snapshots.json")
    result = []
    for acc in accounts:
        latest = _latest_balance(acc["id"], snapshots)
        result.append({
            **acc,
            "latest_balance": latest["balance"] if latest else None,
            "latest_snapshot_date": latest["snapshot_date"] if latest else None,
        })
    return _ok(result)


def _handle_accounts_create(event: dict) -> dict:
    accounts = _read("accounts.json")
    b = _body(event)
    now = _now()
    acc = {
        "id": _new_id("acc"),
        "name": b.get("name", ""),
        "type": b.get("type", "bank"),
        "notes": b.get("notes", ""),
        "created_at": now,
    }
    accounts.append(acc)
    _write("accounts.json", accounts)
    return _created(acc)


def _handle_account_update(event: dict, acc_id: str) -> dict:
    accounts = _read("accounts.json")
    idx = next((i for i, x in enumerate(accounts) if x["id"] == acc_id), None)
    if idx is None:
        return _notfound(f"Account {acc_id}")
    b = _body(event)
    acc = accounts[idx]
    for field in ("name", "type", "notes"):
        if field in b:
            acc[field] = b[field]
    _write("accounts.json", accounts)
    return _ok(acc)


def _handle_snapshots_list(event: dict) -> dict:
    snapshots = _read("snapshots.json")
    acc_id = _qs(event).get("account_id")
    if acc_id:
        snapshots = [s for s in snapshots if s["account_id"] == acc_id]
    snapshots.sort(key=lambda s: s["snapshot_date"])
    return _ok(snapshots)


def _handle_snapshots_create(event: dict) -> dict:
    snapshots = _read("snapshots.json")
    b = _body(event)
    now = _now()
    snap = {
        "id": _new_id("snap"),
        "account_id": b.get("account_id", ""),
        "snapshot_date": b.get("snapshot_date", ""),
        "balance": float(b.get("balance", 0)),
        "note": b.get("note", ""),
        "entered_at": now,
    }
    snapshots.append(snap)
    _write("snapshots.json", snapshots)
    return _created(snap)


def _handle_summary(event: dict) -> dict:
    investments, events, _, _ = _load_all()
    as_of = _qs(event).get("as_of") or None

    active = []
    for inv in investments:
        s = inv.get("status", "active")
        if as_of:
            started = inv.get("start_date", "") <= as_of
            not_yet_closed = not inv.get("closed_date") or inv["closed_date"] > as_of
            if started and not_yet_closed:
                active.append(inv)
        else:
            if s == "active":
                active.append(inv)

    total_principal = 0.0
    total_annual = 0.0
    for inv in active:
        p = _principal(inv["id"], events, as_of)
        r = _rate(inv, events, as_of)
        total_principal += p
        total_annual += p * r

    return _ok({
        "active_count": len(active),
        "total_principal": round(total_principal, 2),
        "projected_annual": round(total_annual, 2),
        "projected_monthly": round(total_annual / 12, 2),
    })


def _handle_timeseries(event: dict) -> dict:
    investments, events, _, _ = _load_all()
    if not events:
        return _ok([])

    all_dates = [e["effective_date"] for e in events if e.get("effective_date")]
    if not all_dates:
        return _ok([])

    start = date.fromisoformat(min(all_dates))
    end = date.today()

    series = []
    cur = start
    while cur <= end:
        ds = cur.isoformat()
        total = 0.0
        for inv in investments:
            inv_start = inv.get("start_date", "")
            inv_closed = inv.get("closed_date")
            if inv_start and inv_start > ds:
                cur += timedelta(days=1)
                continue
            if inv_closed and inv_closed < ds:
                cur += timedelta(days=1)
                continue
            total += _principal(inv["id"], events, ds)
        series.append({"date": ds, "principal": round(total, 2)})
        cur += timedelta(days=1)

    return _ok(series)


# ---------------------------------------------------------------------------
# Scenarios
# ---------------------------------------------------------------------------

def _handle_scenarios_list(event: dict) -> dict:
    scenarios = _read("scenarios.json")
    scenarios.sort(key=lambda s: s.get("created_at", ""), reverse=True)
    return _ok(scenarios)


def _handle_scenarios_create(event: dict) -> dict:
    scenarios = _read("scenarios.json")
    b = _body(event)
    now = _now()
    scen = {
        "id": _new_id("scen"),
        "name": b.get("name", "Untitled"),
        "starting_balance": float(b.get("starting_balance", 0)),
        "annual_return_pct": float(b.get("annual_return_pct", 7)),
        "monthly_contribution": float(b.get("monthly_contribution", 0)),
        "tax_rate_pct": float(b.get("tax_rate_pct", 0)),
        "years": int(b.get("years", 20)),
        "created_at": now,
    }
    scenarios.append(scen)
    _write("scenarios.json", scenarios)
    return _created(scen)


def _handle_scenario_delete(event: dict, scen_id: str) -> dict:
    scenarios = _read("scenarios.json")
    scenarios = [s for s in scenarios if s["id"] != scen_id]
    _write("scenarios.json", scenarios)
    return _ok({"deleted": scen_id})


# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------

def handler(event, context):
    ctx = event.get("requestContext") or {}
    method = (ctx.get("http") or {}).get("method", "GET").upper()
    raw_path = event.get("rawPath", "/")
    parts = [p for p in raw_path.strip("/").split("/") if p]

    if method == "OPTIONS":
        return _resp(200, {})

    if not _authed(event):
        return _unauth()

    resource = parts[0] if parts else ""

    if resource == "investments":
        if len(parts) == 1:
            if method == "GET":
                return _handle_investments_list(event)
            if method == "POST":
                return _handle_investments_create(event)
        elif len(parts) == 2:
            if method == "PUT":
                return _handle_investment_update(event, parts[1])

    elif resource == "events":
        if method == "GET":
            return _handle_events_list(event)
        if method == "POST":
            return _handle_events_create(event)

    elif resource == "accounts":
        if len(parts) == 1:
            if method == "GET":
                return _handle_accounts_list(event)
            if method == "POST":
                return _handle_accounts_create(event)
        elif len(parts) == 2:
            if method == "PUT":
                return _handle_account_update(event, parts[1])

    elif resource == "snapshots":
        if method == "GET":
            return _handle_snapshots_list(event)
        if method == "POST":
            return _handle_snapshots_create(event)

    elif resource == "summary":
        if method == "GET":
            return _handle_summary(event)

    elif resource == "timeseries":
        if method == "GET":
            return _handle_timeseries(event)

    elif resource == "scenarios":
        if len(parts) == 1:
            if method == "GET":
                return _handle_scenarios_list(event)
            if method == "POST":
                return _handle_scenarios_create(event)
        elif len(parts) == 2:
            if method == "DELETE":
                return _handle_scenario_delete(event, parts[1])

    return _notfound(f"No route: {method} /{'/'.join(parts)}")
