"""Agent decision layer — Tier 1 metadata, Tier 2 image, Tier 3 propagation."""
from __future__ import annotations
import base64
import json
import logging
import os
from datetime import datetime, timezone
from decimal import Decimal
from typing import Optional

import boto3

from . import config

logger = logging.getLogger(__name__)
_ddb = boto3.resource("dynamodb")
_ssm = boto3.client("ssm")
_s3 = boto3.client("s3")

_anthropic_client = None


def _get_anthropic_client():
    global _anthropic_client
    if _anthropic_client is None:
        api_key = os.environ.get("ANTHROPIC_API_KEY")
        if not api_key and config.ANTHROPIC_API_KEY_SSM:
            r = _ssm.get_parameter(Name=config.ANTHROPIC_API_KEY_SSM, WithDecryption=True)
            api_key = r["Parameter"]["Value"]
        if not api_key:
            return None
        import anthropic
        _anthropic_client = anthropic.Anthropic(api_key=api_key)
    return _anthropic_client


SYSTEM_PROMPT = """You are a quality control agent for a traffic camera monitoring system on US-550 in Colorado, supporting a Purgatory Resort crowding prediction model.

Your job is to evaluate flagged camera records and decide whether they should be marked "unusable" (excluded from training data) or "keep" (retained).

You will receive structured data about a flagged record. Reason carefully and return a JSON decision object.

Rules:
- Mark "unusable" when inference failure is likely due to external conditions (fog, snow, night, lens obscuration) rather than a real traffic change
- Mark "keep" when the count anomaly appears to reflect real traffic conditions
- When neighboring cams show normal counts but the flagged cam shows 0 or near-0, this strongly suggests cam-specific failure
- When all cams show simultaneous drops, this may reflect a real traffic event (road closure, early morning, storm)
- RWIS visibility below 0.3 miles is a strong indicator of inference failure
- Solar altitude below 0 degrees means nighttime — low counts at night are expected and should be kept, not marked unusable
- Solar altitude 0-10 degrees is civil twilight — treat low counts with caution
- Low image edge density combined with low vehicle count strongly suggests fog or lens obscuration
- Always return valid JSON and nothing else"""


def _decimal_safe(obj):
    if isinstance(obj, Decimal):
        i = int(obj)
        f = float(obj)
        return i if i == f else f
    if isinstance(obj, dict):
        return {k: _decimal_safe(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_decimal_safe(v) for v in obj]
    return obj


def _month_key() -> str:
    return datetime.now(tz=timezone.utc).strftime("%Y-%m")


def check_and_increment_counter() -> bool:
    """Returns True if under cap (and increments). False if cap is hit."""
    table = _ddb.Table(config.AGENT_COUNTER_TABLE)
    month = _month_key()
    try:
        r = table.update_item(
            Key={"pk": "AGENT_COUNTER", "sk": month},
            UpdateExpression="SET invocations = if_not_exists(invocations, :zero) + :one, cap = if_not_exists(cap, :cap), reset_date = if_not_exists(reset_date, :rd)",
            ExpressionAttributeValues={
                ":zero": 0, ":one": 1,
                ":cap": config.AGENT_MONTHLY_CAP,
                ":rd": f"{month}-01",
            },
            ReturnValues="ALL_NEW",
        )
        invocations = int(r["Attributes"].get("invocations", 0))
        cap = int(r["Attributes"].get("cap", config.AGENT_MONTHLY_CAP))
        if invocations > cap:
            # Roll back the over-cap increment
            table.update_item(
                Key={"pk": "AGENT_COUNTER", "sk": month},
                UpdateExpression="SET invocations = invocations - :one",
                ExpressionAttributeValues={":one": 1},
            )
            return False
        return True
    except Exception as e:
        logger.warning("agent counter update failed: %s", e)
        return False


def _check_propagation(record: dict, last_n: list[dict]) -> Optional[dict]:
    """If the last 3 records for this cam all have the same high-confidence decision,
    propagate without an API call."""
    if len(last_n) < 3:
        return None
    decisions = [r.get("agent_decision") for r in last_n]
    confidences = [float(r.get("agent_confidence") or 0) for r in last_n]
    if all(d == decisions[0] and d in ("keep", "unusable") for d in decisions) \
            and all(c >= 0.85 for c in confidences):
        return {
            "agent_decision": decisions[0],
            "agent_confidence": min(confidences),
            "agent_reasoning": f"Propagated from {len(last_n)} prior same-decision records.",
            "agent_decision_source": "propagated",
        }
    return None


def _call_llm(record: dict, last_n: list[dict], neighbors: list[dict], image_b64: Optional[str] = None) -> Optional[dict]:
    client = _get_anthropic_client()
    if client is None:
        logger.warning("anthropic client unavailable")
        return None

    try:
        sk = record["sk"]
        dt = datetime.fromisoformat(sk.rstrip("Z"))
    except Exception:
        dt = datetime.now(tz=timezone.utc)

    payload = {
        "flagged_record": _decimal_safe(record),
        "same_cam_last_3": _decimal_safe(last_n),
        "neighboring_cams_same_timestamp": _decimal_safe(neighbors),
        "day_of_week": dt.strftime("%A"),
        "time_utc": dt.strftime("%H:%M"),
        "season": _season_for(dt),
    }

    user_text = (
        "Evaluate this flagged camera record and decide: \"unusable\" or \"keep\".\n\n"
        + json.dumps(payload, default=str)
        + "\n\nRespond with JSON only: {\"decision\": ..., \"confidence\": 0.0-1.0, \"reasoning\": \"...\"}"
    )

    content: list = [{"type": "text", "text": user_text}]
    if image_b64:
        content.insert(0, {
            "type": "image",
            "source": {"type": "base64", "media_type": "image/jpeg", "data": image_b64},
        })

    try:
        resp = client.messages.create(
            model=config.ANTHROPIC_MODEL,
            max_tokens=300,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": content}],
        )
        text = resp.content[0].text.strip()
        if text.startswith("```"):
            text = text.strip("`").lstrip("json").strip()
        parsed = json.loads(text)
        return {
            "agent_decision": parsed.get("decision"),
            "agent_confidence": float(parsed.get("confidence", 0.0)),
            "agent_reasoning": str(parsed.get("reasoning", ""))[:1000],
        }
    except Exception as e:
        logger.warning("agent call failed: %s", e)
        return None


def _season_for(dt: datetime) -> str:
    m = dt.month
    if m in (12, 1, 2): return "winter"
    if m in (3, 4, 5):  return "spring"
    if m in (6, 7, 8):  return "summer"
    return "fall"


def decide(record: dict, last_n: list[dict], neighbors: list[dict], s3_key: Optional[str]) -> dict:
    """Run the agent decision tiers. Returns agent_* fields to merge into the record."""
    out = {
        "agent_decision": None,
        "agent_confidence": None,
        "agent_reasoning": None,
        "agent_decision_source": None,
        "agent_review_required": True,
        "agent_prompt_version": config.AGENT_PROMPT_VERSION,
    }

    # Tier 3: propagation (free)
    prop = _check_propagation(record, last_n)
    if prop is not None:
        out.update(prop)
        out["agent_review_required"] = False
        return out

    if not check_and_increment_counter():
        out["agent_reasoning"] = "Monthly cap reached — queued for manual review."
        return out

    # Tier 1: metadata only
    t1 = _call_llm(record, last_n, neighbors, image_b64=None)
    if t1 is None:
        return out
    out.update(t1)
    out["agent_decision_source"] = "tier_1"

    if (out["agent_confidence"] or 0) >= config.AGENT_TIER1_CONFIDENCE_THRESHOLD:
        out["agent_review_required"] = False
        return out

    # Tier 2: image-assisted
    image_b64 = None
    if s3_key:
        try:
            obj = _s3.get_object(Bucket=config.S3_BUCKET, Key=s3_key)
            image_b64 = base64.b64encode(obj["Body"].read()).decode("ascii")
        except Exception as e:
            logger.warning("S3 image fetch failed for tier 2: %s", e)

    if not check_and_increment_counter():
        return out

    t2 = _call_llm(record, last_n, neighbors, image_b64=image_b64)
    if t2 is not None:
        out.update(t2)
        out["agent_decision_source"] = "tier_2"
        if (out["agent_confidence"] or 0) >= config.AGENT_TIER1_CONFIDENCE_THRESHOLD:
            out["agent_review_required"] = False

    return out
