"""Review-UI API Lambda — read/write for the React review app.

Routes (all behind Cognito JWT authorizer; `admin` group required):
  GET    /api/queue                            → records needing review
  GET    /api/search?cam_id=&start=&end=&...   → filtered search
  GET    /api/image?pk=&sk=                    → presigned S3 URL
  GET    /api/neighbors?sk=                    → same-timestamp records for other cams
  GET    /api/history?cam_id=&hours=24         → last N hours for a cam
  POST   /api/decisions                        → record a manual decision
  GET    /api/cam-config?cam_id=               → fetch cam config (includes zones)
  PUT    /api/cam-config                       → update cam zones
  GET    /api/label?pk=&sk=                    → fetch labels for an image (S3 or YOLO detections)
  POST   /api/label                            → save labels for an image
  GET    /api/models?cam_id=                   → list model versions for a cam
  POST   /api/model-upload-url                 → presigned S3 PUT URL for a new model version
  PATCH  /api/model-meta                       → update model metadata (activate, params, metrics)
  GET    /api/export-labels                    → export YOLO training dataset zip
"""
from __future__ import annotations
import io
import json
import logging
import os
import zipfile
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


def _jpeg_dims(data: bytes) -> tuple[int, int]:
    """Extract (width, height) from raw JPEG bytes without PIL."""
    i = 2
    while i + 8 < len(data):
        if data[i] != 0xFF:
            break
        marker = data[i + 1]
        if marker in (0xC0, 0xC1, 0xC2):
            return (data[i + 7] << 8) | data[i + 8], (data[i + 5] << 8) | data[i + 6]
        i += 2 + ((data[i + 2] << 8) | data[i + 3])
    return 0, 0


def _cors(origin: str) -> dict:
    allowed = [o.strip() for o in ALLOWED_ORIGINS.split(",")]
    allow = origin if (origin in allowed or "*" in allowed) else allowed[0]
    return {
        "Access-Control-Allow-Origin": allow,
        "Access-Control-Allow-Headers": "Content-Type,Authorization",
        "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,OPTIONS",
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


def _get_cam_config(params):
    cam_id = params.get("cam_id")
    if not cam_id:
        return {"error": "cam_id required"}, 400
    table = _ddb.Table(CAM_CONFIG_TABLE)
    r = table.get_item(Key={"cam_id": cam_id})
    item = r.get("Item")
    if not item:
        return {"error": "not found"}, 404
    return {"cam_config": item}


def _put_cam_config(body):
    cam_id = body.get("cam_id")
    zones = body.get("zones")
    if not cam_id:
        return {"error": "cam_id required"}, 400
    table = _ddb.Table(CAM_CONFIG_TABLE)
    r = table.get_item(Key={"cam_id": cam_id})
    if not r.get("Item"):
        return {"error": "cam_id not found"}, 404
    table.update_item(
        Key={"cam_id": cam_id},
        UpdateExpression="SET #z = :z, roi_version = roi_version + :one",
        ExpressionAttributeNames={"#z": "zones"},
        ExpressionAttributeValues={":z": zones or [], ":one": Decimal("1")},
    )
    return {"ok": True}


# ── Labels ────────────────────────────────────────────────────────────────────

YOLO_CLASS_NAMES = {2: "car", 3: "motorcycle", 5: "bus", 7: "truck"}

def _get_label(params):
    pk = params.get("pk"); sk = params.get("sk")
    if not pk or not sk:
        return {"error": "pk and sk required"}, 400

    # Try to fetch manually saved label file from S3
    cam_id = pk.replace("CAM#", "")
    label_key = f"labels/{cam_id}/{sk}.txt"
    boxes = []
    source = "yolo"
    image_width = None
    image_height = None

    # Get image dimensions and YOLO detections from the ingest record
    table = _ddb.Table(INGEST_TABLE)
    r = table.get_item(Key={"pk": pk, "sk": sk})
    item = r.get("Item")
    if not item:
        return {"error": "record not found"}, 404

    image_width = int(item.get("image_width") or 0) or None
    image_height = int(item.get("image_height") or 0) or None

    # For records ingested before image dimensions were stored, read from JPEG header
    if (not image_width or not image_height) and item.get("s3_key"):
        try:
            head = _s3.get_object(Bucket=S3_BUCKET, Key=item["s3_key"], Range="bytes=0-65535")["Body"].read()
            image_width, image_height = _jpeg_dims(head)
            if not image_width:
                image_width = image_height = None
        except Exception:
            pass

    try:
        obj = _s3.get_object(Bucket=S3_BUCKET, Key=label_key)
        label_text = obj["Body"].read().decode("utf-8")
        if image_width and image_height:
            for line in label_text.strip().splitlines():
                parts = line.split()
                if len(parts) == 5:
                    cls_id, cx, cy, w, h = int(parts[0]), *[float(p) for p in parts[1:]]
                    x1 = (cx - w / 2) * image_width
                    y1 = (cy - h / 2) * image_height
                    x2 = (cx + w / 2) * image_width
                    y2 = (cy + h / 2) * image_height
                    boxes.append({"cls": cls_id, "x1": x1, "y1": y1, "x2": x2, "y2": y2, "source": "manual"})
        source = "manual"
    except _s3.exceptions.NoSuchKey:
        # Fall back to YOLO detections stored in the record
        pass

    return {
        "boxes": boxes,
        "source": source,
        "image_width": image_width,
        "image_height": image_height,
        "labeled": bool(item.get("labeled")),
        "label_count": int(item.get("label_count") or 0),
    }


def _post_label(body):
    pk = body.get("pk"); sk = body.get("sk")
    boxes = body.get("boxes", [])
    image_width = body.get("image_width")
    image_height = body.get("image_height")
    if not pk or not sk:
        return {"error": "pk and sk required"}, 400
    if not image_width or not image_height:
        # Try to auto-detect from the stored S3 image
        try:
            table = _ddb.Table(INGEST_TABLE)
            s3_key = table.get_item(Key={"pk": pk, "sk": sk}).get("Item", {}).get("s3_key")
            if s3_key:
                head = _s3.get_object(Bucket=S3_BUCKET, Key=s3_key, Range="bytes=0-65535")["Body"].read()
                image_width, image_height = _jpeg_dims(head)
        except Exception:
            pass
    if not image_width or not image_height:
        return {"error": "image_width and image_height required and could not be auto-detected"}, 400

    cam_id = pk.replace("CAM#", "")
    label_key = f"labels/{cam_id}/{sk}.txt"

    # Write YOLO format: class cx cy w h (normalized)
    lines = []
    for box in boxes:
        cls_id = int(box["cls"])
        x1, y1, x2, y2 = float(box["x1"]), float(box["y1"]), float(box["x2"]), float(box["y2"])
        cx = ((x1 + x2) / 2) / image_width
        cy = ((y1 + y2) / 2) / image_height
        w = (x2 - x1) / image_width
        h = (y2 - y1) / image_height
        lines.append(f"{cls_id} {cx:.6f} {cy:.6f} {w:.6f} {h:.6f}")

    _s3.put_object(
        Bucket=S3_BUCKET,
        Key=label_key,
        Body="\n".join(lines).encode("utf-8"),
        ContentType="text/plain",
    )

    # Update DDB record
    table = _ddb.Table(INGEST_TABLE)
    table.update_item(
        Key={"pk": pk, "sk": sk},
        UpdateExpression="SET labeled = :t, label_count = :n, labeled_at = :ts",
        ExpressionAttributeValues={
            ":t": True,
            ":n": Decimal(str(len(boxes))),
            ":ts": datetime.now(tz=timezone.utc).isoformat().replace("+00:00", "Z"),
        },
    )
    return {"ok": True, "label_count": len(boxes)}


# ── Model management ──────────────────────────────────────────────────────────

MODEL_S3_PREFIX = "models/"


def _list_models(params):
    cam_id = params.get("cam_id")
    if not cam_id:
        return {"error": "cam_id required"}, 400
    prefix = f"{MODEL_S3_PREFIX}{cam_id}/"
    paginator = _s3.get_paginator("list_objects_v2")
    versions = []
    for page in paginator.paginate(Bucket=S3_BUCKET, Prefix=prefix):
        for obj in page.get("Contents", []):
            key = obj["Key"]
            if not key.endswith("/metadata.json"):
                continue
            try:
                meta = json.loads(_s3.get_object(Bucket=S3_BUCKET, Key=key)["Body"].read())
                versions.append(meta)
            except Exception:
                pass
    versions.sort(key=lambda m: m.get("version", 0), reverse=True)
    return {"versions": versions}


def _model_upload_url(body):
    cam_id = body.get("cam_id")
    inference = body.get("inference", {})
    if not cam_id:
        return {"error": "cam_id required"}, 400

    prefix = f"{MODEL_S3_PREFIX}{cam_id}/"
    paginator = _s3.get_paginator("list_objects_v2")
    max_ver = 0
    for page in paginator.paginate(Bucket=S3_BUCKET, Prefix=prefix):
        for obj in page.get("Contents", []):
            for part in obj["Key"].split("/"):
                if part.startswith("v") and part[1:].isdigit():
                    max_ver = max(max_ver, int(part[1:]))
    version = max_ver + 1
    version_prefix = f"{prefix}v{version}/"
    meta_key = f"{version_prefix}metadata.json"
    model_key = f"{version_prefix}model.pt"

    default_inference = {"conf": 0.45, "iou": 0.50, "agnostic_nms": True, "max_det": 50}
    default_inference.update(inference)
    metadata = {
        "version": version,
        "cam_id": cam_id,
        "uploaded_at": datetime.now(tz=timezone.utc).isoformat().replace("+00:00", "Z"),
        "active": False,
        "inference": default_inference,
        "metrics": {},
    }
    _s3.put_object(Bucket=S3_BUCKET, Key=meta_key,
                   Body=json.dumps(metadata).encode("utf-8"), ContentType="application/json")
    upload_url = _s3.generate_presigned_url(
        "put_object",
        Params={"Bucket": S3_BUCKET, "Key": model_key, "ContentType": "application/octet-stream"},
        ExpiresIn=3600,
    )
    return {"version": version, "upload_url": upload_url, "model_key": model_key}


def _patch_model_meta(body):
    cam_id = body.get("cam_id")
    version = body.get("version")
    if not cam_id or not version:
        return {"error": "cam_id and version required"}, 400

    meta_key = f"{MODEL_S3_PREFIX}{cam_id}/v{version}/metadata.json"
    try:
        obj = _s3.get_object(Bucket=S3_BUCKET, Key=meta_key)
        meta = json.loads(obj["Body"].read())
    except _s3.exceptions.NoSuchKey:
        return {"error": "version not found"}, 404

    if "inference" in body:
        meta["inference"].update(body["inference"])
    if "metrics" in body:
        meta.setdefault("metrics", {}).update(body["metrics"])
    if body.get("active") is True:
        prefix = f"{MODEL_S3_PREFIX}{cam_id}/"
        paginator = _s3.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=S3_BUCKET, Prefix=prefix):
            for obj in page.get("Contents", []):
                key = obj["Key"]
                if not key.endswith("/metadata.json") or key == meta_key:
                    continue
                try:
                    other = json.loads(_s3.get_object(Bucket=S3_BUCKET, Key=key)["Body"].read())
                    if other.get("active"):
                        other["active"] = False
                        _s3.put_object(Bucket=S3_BUCKET, Key=key,
                                       Body=json.dumps(other).encode(), ContentType="application/json")
                except Exception:
                    pass
        meta["active"] = True
    elif body.get("active") is False:
        meta["active"] = False

    _s3.put_object(Bucket=S3_BUCKET, Key=meta_key,
                   Body=json.dumps(meta).encode("utf-8"), ContentType="application/json")
    return {"ok": True, "metadata": meta}


def _export_labels(params):
    cam_id = params.get("cam_id")
    if not cam_id:
        return {"error": "cam_id required"}, 400
    condition_filter = params.get("condition")
    start = params.get("start")
    end = params.get("end")
    split_str = params.get("split", "70/15/15")
    try:
        split_parts = [int(x) for x in split_str.split("/")]
        train_pct, val_pct, test_pct = split_parts[0], split_parts[1], split_parts[2]
    except Exception:
        return {"error": "split must be like 70/15/15"}, 400

    table = _ddb.Table(INGEST_TABLE)
    kw: dict = {"KeyConditionExpression": Key("pk").eq(f"CAM#{cam_id}")}
    if start and end:
        kw["KeyConditionExpression"] = kw["KeyConditionExpression"] & Key("sk").between(start, end)
    elif start:
        kw["KeyConditionExpression"] = kw["KeyConditionExpression"] & Key("sk").gte(start)
    elif end:
        kw["KeyConditionExpression"] = kw["KeyConditionExpression"] & Key("sk").lte(end)
    kw["FilterExpression"] = Attr("labeled").eq(True) & Attr("s3_key").exists()

    records = []
    while True:
        r = table.query(**kw)
        records.extend(r.get("Items", []))
        if "LastEvaluatedKey" not in r:
            break
        kw["ExclusiveStartKey"] = r["LastEvaluatedKey"]

    if condition_filter:
        def _cond(rec):
            solar = float(rec.get("solar_altitude_deg") or -90)
            pavement = str(rec.get("rwis_pavement_status") or "").lower()
            precip = str(rec.get("rwis_precip_situation") or "").lower()
            snowy = "snow" in pavement or "ice" in pavement or "snow" in precip
            is_day = solar >= 10
            if is_day and not snowy: return "day_clear"
            if is_day and snowy: return "day_snow"
            if not is_day and not snowy: return "night_clear"
            return "night_snow"
        records = [r for r in records if _cond(r) == condition_filter]

    records.sort(key=lambda r: r.get("sk", ""))
    n = len(records)
    if n == 0:
        return {"error": "no labeled records found for this cam/filter"}, 404

    n_train = int(n * train_pct / 100)
    n_val = int(n * val_pct / 100)
    train_recs = records[:n_train]
    val_recs = records[n_train:n_train + n_val]
    test_recs = records[n_train + n_val:]

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for split_name, split_recs in [("train", train_recs), ("val", val_recs), ("test", test_recs)]:
            for rec in split_recs:
                s3_key = rec.get("s3_key", "")
                sk = rec.get("sk", "")
                filename = s3_key.split("/")[-1] if s3_key else f"{sk}.jpg"
                stem = filename.rsplit(".", 1)[0]

                # Image
                try:
                    img_obj = _s3.get_object(Bucket=S3_BUCKET, Key=s3_key)
                    zf.writestr(f"images/{split_name}/{filename}", img_obj["Body"].read())
                except Exception:
                    continue

                # Label
                label_key = f"labels/{cam_id}/{sk}.txt"
                try:
                    lbl_obj = _s3.get_object(Bucket=S3_BUCKET, Key=label_key)
                    zf.writestr(f"labels/{split_name}/{stem}.txt", lbl_obj["Body"].read())
                except Exception:
                    zf.writestr(f"labels/{split_name}/{stem}.txt", b"")

        # data.yaml
        yaml = (
            f"path: .\n"
            f"train: images/train\nval: images/val\ntest: images/test\n"
            f"nc: 1\nnames: [vehicle]\n"
            f"# cam_id: {cam_id}\n# exported: {datetime.now(tz=timezone.utc).isoformat()}\n"
            f"# split: {train_pct}/{val_pct}/{test_pct}\n"
            f"# train={len(train_recs)} val={len(val_recs)} test={len(test_recs)}\n"
        )
        zf.writestr("data.yaml", yaml)

    buf.seek(0)
    export_key = f"exports/{cam_id}/{datetime.now(tz=timezone.utc).strftime('%Y%m%dT%H%M%S')}.zip"
    _s3.put_object(Bucket=S3_BUCKET, Key=export_key, Body=buf.read(), ContentType="application/zip")
    download_url = _s3.generate_presigned_url(
        "get_object",
        Params={"Bucket": S3_BUCKET, "Key": export_key},
        ExpiresIn=3600,
    )
    return {
        "download_url": download_url,
        "train": len(train_recs),
        "val": len(val_recs),
        "test": len(test_recs),
        "total": n,
    }


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
        if path == "/api/cam-config" and method == "GET":
            r = _get_cam_config(params)
            return _resp(r[1] if isinstance(r, tuple) else 200, r[0] if isinstance(r, tuple) else r, origin)
        if path == "/api/cam-config" and method == "PUT":
            body = json.loads(event.get("body") or "{}")
            r = _put_cam_config(body)
            return _resp(r[1] if isinstance(r, tuple) else 200, r[0] if isinstance(r, tuple) else r, origin)
        if path == "/api/label" and method == "GET":
            r = _get_label(params)
            return _resp(r[1] if isinstance(r, tuple) else 200, r[0] if isinstance(r, tuple) else r, origin)
        if path == "/api/label" and method == "POST":
            body = json.loads(event.get("body") or "{}")
            r = _post_label(body)
            return _resp(r[1] if isinstance(r, tuple) else 200, r[0] if isinstance(r, tuple) else r, origin)
        if path == "/api/models" and method == "GET":
            r = _list_models(params)
            return _resp(r[1] if isinstance(r, tuple) else 200, r[0] if isinstance(r, tuple) else r, origin)
        if path == "/api/model-upload-url" and method == "POST":
            body = json.loads(event.get("body") or "{}")
            r = _model_upload_url(body)
            return _resp(r[1] if isinstance(r, tuple) else 200, r[0] if isinstance(r, tuple) else r, origin)
        if path == "/api/model-meta" and method == "PATCH":
            body = json.loads(event.get("body") or "{}")
            r = _patch_model_meta(body)
            return _resp(r[1] if isinstance(r, tuple) else 200, r[0] if isinstance(r, tuple) else r, origin)
        if path == "/api/export-labels" and method == "GET":
            r = _export_labels(params)
            return _resp(r[1] if isinstance(r, tuple) else 200, r[0] if isinstance(r, tuple) else r, origin)
        if path == "/health":
            return _resp(200, {"ok": True}, origin)
        return _resp(404, {"error": "not found"}, origin)
    except Exception as e:
        logger.exception("api error")
        return _resp(500, {"error": str(e)}, origin)
