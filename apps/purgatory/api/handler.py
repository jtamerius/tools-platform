"""Review-UI API Lambda — read/write for the React review app.

Routes (all behind Cognito JWT authorizer; `admin` group required):
  GET  /api/queue                            → records needing review
  GET  /api/search?cam_id=&start=&end=&...   → filtered search
  GET  /api/image?pk=&sk=                    → presigned S3 URL
  GET  /api/neighbors?sk=                    → same-timestamp records for other cams
  GET  /api/history?cam_id=&hours=24         → last N hours for a cam
  POST /api/decisions                        → record a manual decision
"""
from __future__ import annotations
import json
import logging
import os
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import boto3
from boto3.dynamodb.conditions import Attr, Key

logger = logging.getLogger()
logger.setLevel(logging.INFO)

INGEST_TABLE = os.environ["INGEST_TABLE"]
RESORT_TABLE = os.environ.get("RESORT_TABLE")
CAM_CONFIG_TABLE = os.environ["CAM_CONFIG_TABLE"]
S3_BUCKET = os.environ["S3_BUCKET"]
ALLOWED_ORIGINS = os.environ.get("ALLOWED_ORIGINS", "*")
ADMIN_GROUPS = {"admin", "member"}

_ddb = boto3.resource("dynamodb")
_s3 = boto3.client("s3")


def _cors(origin: str) -> dict:
    allowed = [o.strip() for o in ALLOWED_ORIGINS.split(",")]
    allow = origin if (origin in allowed or "*" in allowed) else allowed[0]
    return {
        "Access-Control-Allow-Origin": allow,
        "Access-Control-Allow-Headers": "Content-Type,Authorization",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Content-Type": "application/json",
    }


def _decimal(obj):
    if isinstance(obj, Decimal):
        i = int(obj)
        f = float(obj)
        return i if i == f else f
    if isinstance(obj, dict):
        return {k: _decimal(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_decimal(v) for v in obj]
    return obj


def _resp(status: int, body, origin: str = "*"):
    return {"statusCode": status, "headers": _cors(origin), "body": json.dumps(_decimal(body))}


def _check_group(event) -> bool:
    ctx = event.get("requestContext") or {}
    claims = ((ctx.get("authorizer") or {}).get("jwt") or {}).get("claims") or {}
    groups = claims.get("cognito:groups") or ""
    if isinstance(groups, str):
        groups = [g.strip() for g in groups.replace("[", "").replace("]", "").split(",") if g.strip()]
    return bool(ADMIN_GROUPS.intersection(groups))


def _queue(params):
    table = _ddb.Table(INGEST_TABLE)
    limit = int(params.get("limit", "100"))
    r = table.scan(
        FilterExpression=Attr("needs_review").eq(True) & Attr("agent_review_required").eq(True),
        Limit=limit,
    )
    items = sorted(r.get("Items", []), key=lambda x: x.get("sk", ""), reverse=True)
    return {"records": items[:limit]}


def _search(params):
    table = _ddb.Table(INGEST_TABLE)
    cam_id = params.get("cam_id")
    start = params.get("start")
    end = params.get("end")

    items = []
    if cam_id:
        cond = Key("pk").eq(f"CAM#{cam_id}")
        if start and end:
            cond = cond & Key("sk").between(start, end)
        elif start:
            cond = cond & Key("sk").gte(start)
        elif end:
            cond = cond & Key("sk").lte(end)
        r = table.query(KeyConditionExpression=cond, Limit=500, ScanIndexForward=False)
        items = r.get("Items", [])
    else:
        # Multi-cam scan with filter — Phase 1 volume only.
        filt = None
        if start: filt = (filt & Attr("sk").gte(start)) if filt else Attr("sk").gte(start)
        if end:   filt = (filt & Attr("sk").lte(end)) if filt else Attr("sk").lte(end)
        kw = {"Limit": 500}
        if filt is not None:
            kw["FilterExpression"] = filt
        r = table.scan(**kw)
        items = r.get("Items", [])

    def keep(rec):
        d = params.get("decision")
        if d and rec.get("agent_decision") != d: return False
        s = params.get("source")
        if s and rec.get("agent_decision_source") != s: return False
        c = params.get("confidence_lte")
        if c and (rec.get("agent_confidence") or 1) > float(c): return False
        v = params.get("visibility_lte")
        if v and (rec.get("rwis_visibility_mi") or 99) > float(v): return False
        nr = params.get("needs_review")
        if nr == "true" and not rec.get("needs_review"): return False
        if nr == "false" and rec.get("needs_review"): return False
        return True

    items = [i for i in items if keep(i)]
    items.sort(key=lambda x: x.get("sk", ""), reverse=True)
    return {"records": items[:200]}


def _image(params):
    pk = params.get("pk"); sk = params.get("sk")
    if not pk or not sk:
        return {"error": "pk and sk required"}, 400
    table = _ddb.Table(INGEST_TABLE)
    r = table.get_item(Key={"pk": pk, "sk": sk})
    item = r.get("Item")
    if not item or not item.get("s3_key"):
        return {"error": "not found"}, 404
    url = _s3.generate_presigned_url(
        "get_object",
        Params={"Bucket": S3_BUCKET, "Key": item["s3_key"]},
        ExpiresIn=600,
    )
    return {"url": url}


def _neighbors(params):
    sk = params.get("sk")
    if not sk:
        return {"error": "sk required"}, 400
    cam_table = _ddb.Table(CAM_CONFIG_TABLE)
    cams = cam_table.scan(
        FilterExpression=Attr("active").eq(True) & Attr("cam_type").eq("traffic"),
        ProjectionExpression="cam_id",
    ).get("Items", [])

    table = _ddb.Table(INGEST_TABLE)
    out = []
    for c in cams:
        r = table.get_item(Key={"pk": f"CAM#{c['cam_id']}", "sk": sk})
        if "Item" in r:
            out.append(r["Item"])
    return {"records": out}


def _history(params):
    cam_id = params.get("cam_id")
    if not cam_id:
        return {"error": "cam_id required"}, 400
    hours = int(params.get("hours", "24"))
    end = datetime.now(tz=timezone.utc)
    start = end - timedelta(hours=hours)
    table = _ddb.Table(INGEST_TABLE)
    r = table.query(
        KeyConditionExpression=Key("pk").eq(f"CAM#{cam_id}") & Key("sk").between(
            start.isoformat().replace("+00:00", "Z"),
            end.isoformat().replace("+00:00", "Z"),
        ),
    )
    return {"records": r.get("Items", [])}


def _decision(body):
    pk = body.get("pk"); sk = body.get("sk"); decision = body.get("decision")
    if not (pk and sk and decision in {"keep", "unusable", "needs_follow_up"}):
        return {"error": "invalid"}, 400
    table = _ddb.Table(INGEST_TABLE)
    table.update_item(
        Key={"pk": pk, "sk": sk},
        UpdateExpression=(
            "SET agent_decision = :d, agent_decision_source = :src, "
            "needs_review = :nr, agent_review_required = :nr, "
            "unusable = :u, agent_reasoning = :reason"
        ),
        ExpressionAttributeValues={
            ":d": decision,
            ":src": "manual",
            ":nr": False,
            ":u": decision == "unusable",
            ":reason": "Manual review",
        },
    )
    return {"ok": True}


def handler(event, context):
    ctx_http = (event.get("requestContext") or {}).get("http") or {}
    method = ctx_http.get("method", "GET")
    path = ctx_http.get("path", "") or event.get("rawPath", "")
    headers = event.get("headers") or {}
    origin = headers.get("origin", "*")
    params = event.get("queryStringParameters") or {}

    if method == "OPTIONS":
        return {"statusCode": 200, "headers": _cors(origin), "body": ""}

    if path != "/health" and not _check_group(event):
        return _resp(403, {"error": "forbidden"}, origin)

    try:
        if path == "/api/queue":
            return _resp(200, _queue(params), origin)
        if path == "/api/search":
            return _resp(200, _search(params), origin)
        if path == "/api/image":
            r = _image(params)
            return _resp(r[1] if isinstance(r, tuple) else 200, r[0] if isinstance(r, tuple) else r, origin)
        if path == "/api/neighbors":
            r = _neighbors(params)
            return _resp(r[1] if isinstance(r, tuple) else 200, r[0] if isinstance(r, tuple) else r, origin)
        if path == "/api/history":
            r = _history(params)
            return _resp(r[1] if isinstance(r, tuple) else 200, r[0] if isinstance(r, tuple) else r, origin)
        if path == "/api/decisions" and method == "POST":
            body = json.loads(event.get("body") or "{}")
            r = _decision(body)
            return _resp(r[1] if isinstance(r, tuple) else 200, r[0] if isinstance(r, tuple) else r, origin)
        if path == "/health":
            return _resp(200, {"ok": True}, origin)
        return _resp(404, {"error": "not found"}, origin)
    except Exception as e:
        logger.exception("api error")
        return _resp(500, {"error": str(e)}, origin)
