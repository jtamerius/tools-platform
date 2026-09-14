"""
Lambda handler for parsing investment seller statement emails.

Triggered by S3 ObjectCreated events on the email bucket.

S3 key conventions:
  {userId}/inbound/{timestamp}-{filename}     -> uploaded via API
  ses-inbound/{messageId}                     -> forwarded via SES

For SES objects the recipient address is used to look up the userId via
the UserEmails table (partition key = localPart).

For each parsed statement:
  * Upsert into InvestmentAccounts (userId, accountNumber)
  * Put into Payments (acctKey=userId#accountNumber, interestPaidTo or dateReceived as sort key)
"""
from __future__ import annotations

import json
import logging
import os
import stat
import tempfile
from decimal import Decimal
from email import policy
from email.parser import BytesParser
from pathlib import Path
from urllib.parse import unquote_plus

import boto3

from eml_to_json import parse_input_path

log = logging.getLogger()
log.setLevel(logging.INFO)

s3 = boto3.client("s3")
ddb = boto3.resource("dynamodb")

ACCOUNTS_TABLE = os.environ["ACCOUNTS_TABLE"]
PAYMENTS_TABLE = os.environ["PAYMENTS_TABLE"]
USER_EMAILS_TABLE = os.environ["USER_EMAILS_TABLE"]

accounts_tbl = ddb.Table(ACCOUNTS_TABLE)
payments_tbl = ddb.Table(PAYMENTS_TABLE)
user_emails_tbl = ddb.Table(USER_EMAILS_TABLE)


def _to_decimal(value):
    """DynamoDB does not accept floats; convert to Decimal preserving 4-digit precision."""
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, Decimal)):
        return value
    if isinstance(value, float):
        return Decimal(str(value))
    if isinstance(value, list):
        return [_to_decimal(v) for v in value]
    if isinstance(value, dict):
        return {k: _to_decimal(v) for k, v in value.items()}
    return value


def _extract_user_id_from_key(key: str) -> str | None:
    """Return user id if the key is in the `{userId}/inbound/...` form."""
    parts = key.split("/", 2)
    if len(parts) >= 2 and parts[1] == "inbound":
        return parts[0]
    return None


def _lookup_user_id_from_email(local_part: str) -> str | None:
    r = user_emails_tbl.get_item(Key={"localPart": local_part})
    item = r.get("Item")
    return item["userId"] if item else None


def _recipient_local_part(body: bytes) -> str | None:
    """Parse a raw RFC822 message and return the local part of the first To: address."""
    try:
        msg = BytesParser(policy=policy.default).parsebytes(body)
    except Exception:
        return None
    to = msg.get("To")
    if not to:
        return None
    # Simple local-part extraction — grab first token before '@'
    addr = str(to).strip()
    # handle "Name <user@domain>" form
    if "<" in addr and ">" in addr:
        addr = addr.split("<")[-1].split(">")[0]
    if "@" not in addr:
        return None
    return addr.split("@")[0].strip().lower()


def _resolve_user_id(key: str, body: bytes) -> str | None:
    # Preferred: explicit userId in S3 key (API uploads)
    uid = _extract_user_id_from_key(key)
    if uid:
        return uid
    # Fallback: parse recipient from raw message (SES inbound)
    if key.startswith("ses-inbound/"):
        local_part = _recipient_local_part(body)
        if not local_part:
            log.warning("SES object %s: no recipient local part found", key)
            return None
        return _lookup_user_id_from_email(local_part)
    return None


def _write_statement(user_id: str, statement: dict, source_key: str) -> None:
    stmt = statement.get("statement") or {}
    acct = stmt.get("account_number")
    if not acct:
        log.warning("Statement missing account_number — skipping")
        return

    account_item = {
        "userId": user_id,
        "accountNumber": acct,
        "payor": stmt.get("payor") or "",
        "recipient": stmt.get("recipient") or "",
        "company": stmt.get("company") or "",
        "property_address": stmt.get("property_address"),
    }
    accounts_tbl.put_item(Item=_to_decimal(account_item))

    status = statement.get("current_account_status") or {}
    ipt = status.get("interest_paid_to")
    dr = stmt.get("date_received")
    sort_key = ipt or dr or statement.get("metadata", {}).get("parsed_at_utc", "unknown")

    payment_item = {
        "acctKey": f"{user_id}#{acct}",
        "interestPaidTo": sort_key,
        "date_received": dr,
        "payment": stmt.get("payment"),
        "details": statement.get("current_payment_details") or {},
        "status": status,
        "disbursements": statement.get("disbursements") or [],
        "metadata": {
            **(statement.get("metadata") or {}),
            "source_s3_key": source_key,
        },
    }
    payments_tbl.put_item(Item=_to_decimal(payment_item))
    masked_acct = f"{acct[:3]}***" if len(acct) > 3 else "***"
    log.info("Wrote payment for account %s user=%s", masked_acct, user_id)


def handler(event, _context):
    records = event.get("Records", [])
    log.info("Received %d S3 records", len(records))

    for rec in records:
        bucket = rec["s3"]["bucket"]["name"]
        key = unquote_plus(rec["s3"]["object"]["key"])
        log.info("Processing s3://%s/%s", bucket, key)

        try:
            obj = s3.get_object(Bucket=bucket, Key=key)
            body = obj["Body"].read()
        except Exception as exc:
            log.exception("Failed to read s3://%s/%s: %s", bucket, key, exc)
            continue

        user_id = _resolve_user_id(key, body)
        if not user_id:
            log.warning("Could not resolve userId for %s — skipping", key)
            continue

        # Write body to /tmp so the existing parser can mmap / iterate mbox
        with tempfile.NamedTemporaryFile(
            delete=False, suffix=Path(key).suffix or ".eml", dir="/tmp"
        ) as tmp:
            tmp.write(body)
            tmp_path = Path(tmp.name)
        os.chmod(tmp_path, stat.S_IRUSR | stat.S_IWUSR)

        try:
            results = parse_input_path(tmp_path)
        except Exception as exc:
            log.exception("parse_input_path failed for %s: %s", key, exc)
            continue
        finally:
            try:
                tmp_path.unlink()
            except Exception:
                pass

        log.info("Parsed %d statements from %s", len(results), key)
        for r in results:
            try:
                _write_statement(user_id, r.data, key)
            except Exception as exc:
                log.exception("Failed to write statement: %s", exc)

    return {"ok": True, "records": len(records)}
