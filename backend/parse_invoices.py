"""
Stage 2: extraction.

Reads SmartQ KOT invoices and returns structured fields as JSON. This is the
only part of the pipeline that needs pdfplumber, so it is kept deliberately
small: it extracts what is printed and does not interpret it. Turning
"19-Aug 2026" into a date, or deciding whether an invoice is a duplicate, is
the job of later stages in Node.

Usage:
    python parse_invoices.py < paths.json > results.json

stdin  : {"files": [{"id": "...", "path": "..."}]}
stdout : {"results": [{"id": "...", "ok": true, "fields": {...}} | {...error}]}

A malformed file never raises: it comes back as ok=false with an error code
from backend/lib/invoices/invoiceModel.js so the UI can explain the failure.
"""

import json
import re
import sys

try:
    import pdfplumber
except ImportError:  # pragma: no cover - surfaced to the operator as a batch error
    json.dump({"error": "pdfplumber is not installed in the Python environment"}, sys.stdout)
    sys.exit(1)


# "VENDOR NAME : Compass India Food Services Pvt. Ltd."
VENDOR_RE = re.compile(r"VENDOR\s*NAME\s*[:\-]\s*(.+)", re.IGNORECASE)
# "Café: Microsoft Pune - CMZ" — the accent is unreliable across PDF producers,
# so match the stem and tolerate anything (or nothing) before the colon.
CAFE_RE = re.compile(r"^Caf.{0,2}\s*[:\-]\s*(.+)", re.IGNORECASE | re.MULTILINE)
SITE_RE = re.compile(r"Site\s*Code\s*[:\-]\s*(\S+)", re.IGNORECASE)
ORDER_ID_RE = re.compile(r"Order\s*ID\s*[:\-]\s*#?\s*([A-Z0-9\-]+)", re.IGNORECASE)
DATE_RE = re.compile(r"Order\s*Date\s*[:\-]\s*(.+)", re.IGNORECASE)
TIME_RE = re.compile(r"Order\s*Time\s*[:\-]\s*(.+)", re.IGNORECASE)
GSTIN_RE = re.compile(r"GSTIN\s*[:\-]\s*(\S+)", re.IGNORECASE)

# "Mix Fruit Platter (996333) 1 51.00 (points)"
#
# The item name is matched non-greedily and the HSN group requires 4-8 digits,
# which is what separates the HSN from parentheses inside the name itself:
# "Papaya Cut(200 Gms) (996333) 1 47.00" must yield the full name, not "Papaya
# Cut". Anchoring on a bare "(...)" would truncate it.
ITEM_RE = re.compile(
    r"^(?P<name>.+?)\s*\((?P<hsn>\d{4,8})\)\s+(?P<quantity>\d+)\s+(?P<amount>[\d,]+(?:\.\d+)?)",
)

# The HSN group is what makes a line an item, and it is also what makes header
# and footer lines safe to leave in: "Item Name with HSN Code Quantity Amount",
# "Order ID #G1004987Z268199325205" and "Cafe: Microsoft Pune - CMZ" have no
# "(<4-8 digits>) <qty> <amount>" tail, so ITEM_RE simply does not match them.
#
# Filtering headers by their leading word instead would be actively harmful: a
# cafeteria sells "Cafe Latte" and "Total Meal Combo", and dropping those would
# silently under-count the invoice with no error shown to the operator.


def first(pattern, text):
    match = pattern.search(text)
    return match.group(1).strip() if match else ""


def read_text(path):
    """Returns (text, page_count). Raises on an unreadable or encrypted file."""
    with pdfplumber.open(path) as document:
        pages = [page.extract_text() or "" for page in document.pages]
        return "\n".join(pages).strip(), len(pages)


def parse_items(text):
    """Every line that looks like '<name> (<hsn>) <qty> <amount>'."""
    items = []
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        match = ITEM_RE.match(line)
        if not match:
            continue
        items.append(
            {
                "foodItem": match.group("name").strip(),
                "hsnCode": match.group("hsn"),
                "quantity": match.group("quantity"),
                "amount": match.group("amount").replace(",", ""),
            }
        )
    return items


def extract(path):
    try:
        text, page_count = read_text(path)
    except Exception as error:  # pdfplumber raises a variety of types
        message = str(error).lower()
        if "password" in message or "encrypt" in message:
            return {"ok": False, "code": "ENCRYPTED_PDF", "message": "PDF is password protected"}
        return {"ok": False, "code": "UNREADABLE_PDF", "message": f"PDF could not be parsed: {error}"}

    if not text:
        return {"ok": False, "code": "NO_TEXT_LAYER", "message": "PDF has no extractable text layer"}

    order_id = first(ORDER_ID_RE, text)
    order_date = first(DATE_RE, text)
    items = parse_items(text)

    # A SmartQ KOT always carries an order number and at least one priced line.
    # Without both there is nothing to ingest, so say so specifically instead of
    # storing a half-empty record.
    if not order_id and not items:
        return {"ok": False, "code": "NOT_SMARTQ_INVOICE", "message": "No SmartQ order number or line items found"}
    if not order_id:
        return {"ok": False, "code": "MISSING_ORDER_ID", "message": "No order number found"}
    if not order_date:
        return {"ok": False, "code": "MISSING_ORDER_DATE", "message": "No order date found"}
    if not items:
        return {"ok": False, "code": "NO_LINE_ITEMS", "message": "No food line items could be read"}

    return {
        "ok": True,
        "fields": {
            "orderId": order_id,
            "orderDate": order_date,
            "orderTime": first(TIME_RE, text),
            "cafeteria": first(CAFE_RE, text),
            "vendor": first(VENDOR_RE, text),
            "siteCode": first(SITE_RE, text),
            "gstin": first(GSTIN_RE, text),
            # "(points)" marks SmartQ's loyalty currency rather than rupees.
            "currencyHint": "points" if "(points)" in text.lower() else "INR",
            "items": items,
            "pageCount": page_count,
        },
    }


def main():
    try:
        request = json.load(sys.stdin)
    except json.JSONDecodeError as error:
        json.dump({"error": f"Invalid request payload: {error}"}, sys.stdout)
        return 1

    results = []
    for entry in request.get("files", []):
        outcome = extract(entry.get("path", ""))
        outcome["id"] = entry.get("id")
        results.append(outcome)

    json.dump({"results": results}, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
