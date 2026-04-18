from __future__ import annotations

import argparse
import json
import mailbox
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from email.message import EmailMessage
from email import policy
from email.parser import BytesParser
from html import unescape
from pathlib import Path
from typing import Any


FIELD_ORDER = [
    "Account No",
    "Property Address",
    "Payor",
    "Date Received",
    "Recipient",
    "Payment",
    "Principal",
    "Late Paid",
    "Interest Paid To",
    "Interest",
    "Late Owed",
    "Next Due Date",
    "Payor Fees",
    "Lates Added to Balance",
    "Current Balance",
    "Reserves",
    "Principal (YTD)",
    "Previous Balance",
    "Others",
    "Interest (YTD)",
    "Accrued Interest",
    "Reserve Balance",
]


@dataclass(frozen=True)
class StatementParseResult:
    data: dict[str, Any]
    raw_text: str


def _read_message_html(msg: EmailMessage, source_label: str) -> str:
    html_part = msg.get_body(preferencelist=("html",))
    if html_part is not None:
        return html_part.get_content()

    # Fallback for non-standard MIME structures.
    for part in msg.walk():
        content_type = part.get_content_type()
        if content_type == "text/html":
            payload = part.get_payload(decode=True)
            if payload is None:
                continue
            charset = part.get_content_charset() or "utf-8"
            return payload.decode(charset, errors="replace")

    raise ValueError(f"No HTML body found in email: {source_label}")


def _read_eml_html(eml_path: Path) -> str:
    with eml_path.open("rb") as f:
        msg = BytesParser(policy=policy.default).parse(f)
    return _read_message_html(msg, source_label=str(eml_path))


def _html_to_text(html: str) -> str:
    # Preserve rough line boundaries before stripping tags.
    block_tags = ["</tr>", "</p>", "<br>", "<br/>", "<br />", "</div>", "</table>"]
    normalized = html
    for marker in block_tags:
        normalized = normalized.replace(marker, marker + "\n")

    # Remove scripts/styles and all tags.
    normalized = re.sub(r"<script\b.*?</script>", " ", normalized, flags=re.IGNORECASE | re.DOTALL)
    normalized = re.sub(r"<style\b.*?</style>", " ", normalized, flags=re.IGNORECASE | re.DOTALL)
    text = re.sub(r"<[^>]+>", " ", normalized)

    # Decode entities and normalize whitespace.
    text = unescape(text)
    text = text.replace("\xa0", " ")
    text = re.sub(r"[^\x20-\x7E\n]", " ", text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n+", "\n", text)
    return text.strip()


def _extract_value_by_label(text: str, label: str) -> str | None:
    idx = text.lower().find(label.lower())
    if idx == -1:
        return None

    next_labels = [l for l in FIELD_ORDER if l.lower() != label.lower()]
    tail = text[idx + len(label) :]
    tail = re.sub(r"^\s*:??\s*", "", tail)

    # Stop when next known label appears.
    stop_positions: list[int] = []
    lower_tail = tail.lower()
    for next_label in next_labels:
        pos = lower_tail.find(next_label.lower())
        if pos != -1:
            stop_positions.append(pos)
    if stop_positions:
        value = tail[: min(stop_positions)]
    else:
        value = tail

    value = re.sub(r"\s+", " ", value).strip(" :\n\t")
    return value or None


def _extract_money_for_label(text: str, label: str) -> float | None:
    pattern = rf"{re.escape(label)}\s*:??\s*\$\s*([0-9][0-9,]*\.[0-9]{{2}})"
    match = re.search(pattern, text, flags=re.IGNORECASE)
    if not match:
        return None
    return float(match.group(1).replace(",", ""))


def _extract_date_for_label(text: str, label: str) -> str | None:
    pattern = rf"{re.escape(label)}\s*:??\s*([0-9]{{1,2}}/[0-9]{{1,2}}/[0-9]{{2,4}})"
    match = re.search(pattern, text, flags=re.IGNORECASE)
    return match.group(1) if match else None


def _extract_between(text: str, start_label: str, end_label: str) -> str | None:
    pattern = rf"{re.escape(start_label)}\s*:??\s*(.*?)\s*{re.escape(end_label)}\s*:??"
    match = re.search(pattern, text, flags=re.IGNORECASE | re.DOTALL)
    if not match:
        return None
    value = re.sub(r"\s+", " ", match.group(1)).strip(" :\t\n")
    return value or None


def _parse_money(value: str | None) -> float | None:
    if not value:
        return None
    m = re.search(r"-?\$?\s*([0-9][0-9,]*\.?[0-9]*)", value)
    if not m:
        return None
    return float(m.group(1).replace(",", ""))


def _extract_disbursements(html: str) -> list[dict[str, Any]]:
    section_match = re.search(
        r"Disbursements(.*?)Contact Information",
        html,
        flags=re.IGNORECASE | re.DOTALL,
    )
    if not section_match:
        return []

    section = section_match.group(1)
    raw_lines = re.findall(r"<p[^>]*>\s*<span[^>]*>(.*?)</span>\s*</p>", section, flags=re.IGNORECASE | re.DOTALL)

    items: list[dict[str, Any]] = []
    for raw_line in raw_lines:
        line = unescape(raw_line)
        line = line.replace("\xa0", " ")
        line = re.sub(r"\s+", " ", line).strip()
        if "$" not in line:
            continue

        amount_match = re.search(r"\$([0-9][0-9,]*\.\d{2})", line)
        if not amount_match:
            continue

        amount = float(amount_match.group(1).replace(",", ""))
        desc = line[: amount_match.start()].strip(" -:\t.")
        desc = re.sub(r"[•·_]+", " ", desc)
        desc = re.sub(r"[^A-Za-z0-9()\-./ ]", "", desc)
        desc = re.sub(r"\s+", " ", desc).strip()
        if not desc:
            desc = "Unlabeled disbursement"

        items.append(
            {
                "description": desc,
                "amount": amount,
            }
        )
    return items


def _looks_like_mbox(file_path: Path) -> bool:
    try:
        with file_path.open("r", encoding="utf-8", errors="replace") as f:
            sample = f.read(200_000)
    except Exception:
        return False

    if not sample.startswith("From "):
        return False

    return "\nFrom " in sample


def _collect_input_files(raw_inputs: list[str]) -> list[Path]:
    supported_suffixes = {".eml", ".emlx"}
    discovered: list[Path] = []

    for raw in raw_inputs:
        p = Path(raw).expanduser().resolve()
        if not p.exists():
            raise FileNotFoundError(f"Input path not found: {p}")

        if p.is_dir():
            for child in sorted(c for c in p.rglob("*") if c.is_file()):
                if child.suffix.lower() in supported_suffixes or _looks_like_mbox(child):
                    discovered.append(child)
            continue

        discovered.append(p)

    # De-duplicate while preserving order.
    unique: list[Path] = []
    seen: set[Path] = set()
    for p in discovered:
        if p in seen:
            continue
        unique.append(p)
        seen.add(p)
    return unique


def _iter_messages_for_input(input_path: Path) -> list[tuple[int, EmailMessage, str]]:
    if _looks_like_mbox(input_path):
        mbox_obj = mailbox.mbox(str(input_path))
        messages: list[tuple[int, EmailMessage, str]] = []
        try:
            for idx, msg in enumerate(mbox_obj, start=1):
                email_msg = BytesParser(policy=policy.default).parsebytes(msg.as_bytes())
                messages.append((idx, email_msg, f"{input_path}#message-{idx}"))
        finally:
            mbox_obj.close()
        return messages

    with input_path.open("rb") as f:
        parsed = BytesParser(policy=policy.default).parse(f)
    return [(1, parsed, str(input_path))]


def _output_path_for_message(
    input_path: Path,
    output_dir: Path | None,
    message_index: int,
    message_count: int,
) -> Path:
    if message_count == 1:
        if output_dir is None:
            return input_path.with_suffix(".json")
        return output_dir / f"{input_path.stem}.json"

    if output_dir is None:
        return input_path.with_name(f"{input_path.stem}_msg_{message_index:04d}.json")
    return output_dir / f"{input_path.stem}_msg_{message_index:04d}.json"


def parse_statement_eml(eml_path: Path) -> StatementParseResult:
    html = _read_eml_html(eml_path)
    text = _html_to_text(html)
    return _parse_statement_from_html(
        html=html,
        text=text,
        source_label=str(eml_path),
    )


def _parse_statement_from_html(html: str, text: str, source_label: str) -> StatementParseResult:
    text = _html_to_text(html)

    # Header title/company lines are near the top.
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    company = lines[0] if lines else None
    statement_title = "Seller Statement" if "Seller Statement" in text else None

    account_no = _extract_value_by_label(text, "Account No")
    recipient = _extract_between(text, "Recipient", "Payment")
    payor = _extract_between(text, "Payor", "Date Received")
    property_address = _extract_between(text, "Property Address", "Payor")
    date_received = _extract_date_for_label(text, "Date Received")
    payment = _extract_money_for_label(text, "Payment")

    payment_details = {
        "principal": _extract_money_for_label(text, "Principal"),
        "interest": _extract_money_for_label(text, "Interest"),
        "reserves": _extract_money_for_label(text, "Reserves"),
        "payor_fees": _extract_money_for_label(text, "Payor Fees"),
        "others": _extract_money_for_label(text, "Others"),
    }

    account_status = {
        "late_paid": _extract_money_for_label(text, "Late Paid"),
        "late_owed": _extract_money_for_label(text, "Late Owed"),
        "interest_paid_to": _extract_date_for_label(text, "Interest Paid To"),
        "next_due_date": _extract_date_for_label(text, "Next Due Date"),
        "lates_added_to_balance": _extract_money_for_label(text, "Lates Added to Balance"),
        "current_balance": _extract_money_for_label(text, "Current Balance"),
        "principal_ytd": _extract_money_for_label(text, "Principal (YTD)"),
        "interest_ytd": _extract_money_for_label(text, "Interest (YTD)"),
        "previous_balance": _extract_money_for_label(text, "Previous Balance"),
        "accrued_interest": _extract_money_for_label(text, "Accrued Interest"),
        "reserve_balance": _extract_money_for_label(text, "Reserve Balance"),
    }

    result = {
        "metadata": {
            "source_file": source_label,
            "parsed_at_utc": datetime.now(timezone.utc).isoformat(),
            "parser": "investment_app.eml_to_json.v1",
        },
        "statement": {
            "company": company,
            "title": statement_title,
            "account_number": account_no,
            "property_address": property_address,
            "payor": payor,
            "recipient": recipient,
            "date_received": date_received,
            "payment": payment,
        },
        "current_payment_details": payment_details,
        "current_account_status": account_status,
        "disbursements": _extract_disbursements(html),
    }

    return StatementParseResult(data=result, raw_text=text)


def parse_input_path(input_path: Path) -> list[StatementParseResult]:
    results: list[StatementParseResult] = []
    messages = _iter_messages_for_input(input_path)
    for _, msg, source_label in messages:
        html = _read_message_html(msg, source_label=source_label)
        text = _html_to_text(html)
        results.append(_parse_statement_from_html(html=html, text=text, source_label=source_label))
    return results


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Convert seller statement email files/folders into structured JSON."
    )
    parser.add_argument(
        "inputs",
        nargs="+",
        help="Input file(s) or folder(s). Supports .eml/.emlx and mbox-style files.",
    )
    parser.add_argument(
        "-o",
        "--output-dir",
        type=Path,
        help="Directory where JSON files will be written (default: next to each input).",
    )
    parser.add_argument(
        "--pretty",
        action="store_true",
        help="Pretty-print output JSON.",
    )
    args = parser.parse_args()

    output_dir: Path | None = args.output_dir
    if output_dir is not None:
        output_dir.mkdir(parents=True, exist_ok=True)

    input_files = _collect_input_files(args.inputs)
    if not input_files:
        raise ValueError("No supported email files were discovered in the provided inputs.")

    writes = 0
    for input_path in input_files:
        messages = _iter_messages_for_input(input_path)
        message_count = len(messages)
        for message_index, msg, source_label in messages:
            html = _read_message_html(msg, source_label=source_label)
            text = _html_to_text(html)
            parsed = _parse_statement_from_html(html=html, text=text, source_label=source_label)

            output_path = _output_path_for_message(
                input_path=input_path,
                output_dir=output_dir,
                message_index=message_index,
                message_count=message_count,
            )
            output_path.parent.mkdir(parents=True, exist_ok=True)
            with output_path.open("w", encoding="utf-8") as f:
                json.dump(parsed.data, f, indent=2 if args.pretty else None, ensure_ascii=False)
                f.write("\n")

            writes += 1
            print(f"Wrote {output_path}")

    print(f"Done: wrote {writes} JSON file(s) from {len(input_files)} input file(s).")


if __name__ == "__main__":
    main()
