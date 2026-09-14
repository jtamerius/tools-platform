"""Tests for the seller-statement parser.

Written against SYNTHETIC statements. The prototype this code grew out of had
two tests, but both loaded the owner's real mailbox as a fixture, so they could
not survive that data being removed from the repo — and they were the parser's
only coverage. These use invented accounts, names and amounts instead, so they
run anywhere and expose nothing.
"""
from pathlib import Path

import pytest

from eml_to_json import (
    _extract_account_no,
    _html_to_text,
    _parse_money,
    _parse_statement_text,
    _split_statements_from_text,
    parse_statement_eml,
)

STATEMENT = """
Pioneer Example Agency, Inc.
Seller Email Statement
Account No 99990001234567
Property Address 100 Example Rd, Springfield, ZZ 00000
Payor EXAMPLE HOLDINGS, LLC
Recipient JANE DOE & JOHN DOE
Date Received 04/15/2026
Payment $1,234.56
Principal $234.56
Interest $1,000.00
Reserves $0.00
Payor Fees $0.00
Late Paid $0.00
Late Owed $0.00
Interest Paid To 05/01/2026
Next Due Date 05/15/2026
Lates Added to Balance $0.00
Current Balance $123,456.78
Principal (YTD) $1,234.00
Previous Balance $123,691.34
"""


class TestMoneyParsing:
    @pytest.mark.parametrize("raw,expected", [
        ("$1,234.56", 1234.56),
        ("1234.56", 1234.56),
        ("$0.00", 0.0),
        ("", None),
        (None, None),
    ])
    def test_parses_currency_shapes(self, raw, expected):
        got = _parse_money(raw)
        if expected is None:
            assert got is None
        else:
            assert got == pytest.approx(expected)


class TestAccountNumber:
    @pytest.mark.parametrize("label", [
        "Account No 99990001234567",
        "Account Number 99990001234567",
        "Account #99990001234567",
        "Acct. No. 99990001234567",
        "ACCOUNT NO 99990001234567",
    ])
    def test_accepts_every_label_variant(self, label):
        """Statements arrive from several senders with different label styles."""
        assert _extract_account_no(label) == "99990001234567"

    def test_parenthesised_negatives_are_read_as_positive(self):
        """Known limitation, pinned deliberately: the money regex has no
        accounting-notation branch, so "($500.00)" reads as 500.0 rather than
        -500.0. No observed statement uses that notation, but if one ever does
        the failure would be silent, so this records the behaviour."""
        assert _parse_money("($500.00)") == pytest.approx(500.0)

    def test_absent_account_number_is_none(self):
        assert _extract_account_no("no account here") is None


class TestStatementSplitting:
    def test_single_statement_is_one_chunk(self):
        assert len(_split_statements_from_text(STATEMENT)) == 1

    def test_splits_on_each_account_boundary(self):
        combined = STATEMENT + "\n" + STATEMENT.replace("99990001234567", "99990007654321")
        chunks = _split_statements_from_text(combined)
        assert len(chunks) == 2

    def test_preamble_is_prepended_to_every_chunk(self):
        """Company name appears once, above the first statement — without
        carrying the preamble forward, only statement one would be attributed."""
        combined = STATEMENT + "\n" + STATEMENT.replace("99990001234567", "99990007654321")
        for chunk in _split_statements_from_text(combined):
            assert "Pioneer Example Agency" in chunk


class TestFullParse:
    def _parsed(self):
        return _parse_statement_text(STATEMENT, "synthetic").data

    def test_extracts_identity_fields(self):
        s = self._parsed()
        assert s["statement"]["account_number"] == "99990001234567"
        assert "EXAMPLE HOLDINGS" in s["statement"]["payor"]

    def test_extracts_money_fields_as_numbers(self):
        s = self._parsed()
        assert s["current_payment_details"]["principal"] == pytest.approx(234.56)
        assert s["current_payment_details"]["interest"] == pytest.approx(1000.00)
        assert s["current_account_status"]["current_balance"] == pytest.approx(123456.78)

    def test_principal_plus_interest_reconciles_to_payment(self):
        """The invariant that makes a parse trustworthy: the components of a
        payment must add up to it."""
        s = self._parsed()
        d = s["current_payment_details"]
        total = d["principal"] + d["interest"] + (d.get("reserves") or 0) + (d.get("payor_fees") or 0)
        assert total == pytest.approx(1234.56, abs=0.01)

    def test_metadata_records_provenance(self):
        s = self._parsed()
        assert s["metadata"]["source_file"] == "synthetic"
        assert s["metadata"]["parsed_at_utc"]


class TestHtmlHandling:
    def test_strips_tags_and_unescapes_entities(self):
        html = "<table><tr><td>Payment</td><td>$1,234.56&nbsp;</td></tr></table>"
        text = _html_to_text(html)
        assert "<td>" not in text
        assert "1,234.56" in text

    def test_missing_file_raises_rather_than_returning_empty(self, tmp_path: Path):
        with pytest.raises(Exception):
            parse_statement_eml(tmp_path / "nope.eml")
