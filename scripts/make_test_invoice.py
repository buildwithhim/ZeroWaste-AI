"""
Builds SmartQ-shaped invoice PDFs for testing the ingestion pipeline.

The eight bundled samples are all single-item invoices from one café, which
leaves the interesting paths untested: multi-item orders, corrected invoices
that collide with a stored order number, image-only scans, and malformed
fields. This writes minimal but genuinely valid PDFs so those cases can be
exercised end to end rather than by stubbing the parser.

    python scripts/make_test_invoice.py <outdir>
"""

import sys
from pathlib import Path


def build_pdf(lines, with_text=True):
    """Assembles a one-page PDF. Offsets are computed as objects are appended."""
    if with_text:
        content = ["BT", "/F1 11 Tf", "50 780 Td", "13 TL"]
        for line in lines:
            escaped = line.replace("\\", r"\\").replace("(", r"\(").replace(")", r"\)")
            content.append(f"({escaped}) Tj T*")
        content.append("ET")
        stream = "\n".join(content).encode("latin-1")
    else:
        # A page with no text operators at all: stands in for a scanned invoice.
        stream = b"0.9 0.9 0.9 rg\n50 600 500 200 re\nf\n"

    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] "
        b"/Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
        b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]

    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for index, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{index} 0 obj\n".encode() + body + b"\nendobj\n"

    xref_at = len(out)
    out += f"xref\n0 {len(objects) + 1}\n".encode()
    out += b"0000000000 65535 f \n"
    for offset in offsets:
        out += f"{offset:010d} 00000 n \n".encode()
    out += f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref_at}\n%%EOF\n".encode()
    return bytes(out)


def invoice_lines(order_id, date, time, items, cafe="Microsoft Pune - CMZ", vendor="Compass India Food Services Pvt. Ltd."):
    lines = [
        "KOT",
        f"VENDOR NAME : {vendor}",
        "GSTIN: 27AADCC9070A2ZW",
        "FSSAI Licence No: N/A",
        f"Cafe: {cafe}",
        "Site Code: 149I",
        f"Order ID: #{order_id}",
        f"Order Date: {date}",
        f"Order Time: {time}",
        "Item Name with HSN Code Quantity Amount",
    ]
    for name, qty, amount in items:
        lines.append(f"{name} (996333) {qty} {amount} (points)")
    lines.append(f"Order ID #{order_id}Z268199325205")
    return lines


FIXTURES = {
    # Same order number as the bundled invoice_G1004987.pdf but a different
    # amount: the corrected-invoice case that must never overwrite silently.
    "conflict_G1004987.pdf": lambda: build_pdf(
        invoice_lines("G1004987", "19-Aug 2026", "09:32 AM", [("Mix Fruit Platter", 2, "102.00")])
    ),
    # A third version of the same order. Used to check that resolving one
    # conflict does not let a second, older conflict silently revert it.
    "conflict2_G1004987.pdf": lambda: build_pdf(
        invoice_lines("G1004987", "19-Aug 2026", "09:32 AM", [("Mix Fruit Platter", 5, "255.00")])
    ),
    # Several priced lines on one order.
    "multi_item_N2001987.pdf": lambda: build_pdf(
        invoice_lines(
            "N2001987",
            "21-Aug 2026",
            "12:45 PM",
            [("Veg Biryani", 3, "270.00"), ("Masala Dosa (Large)", 2, "120.00"), ("Mix Fruit Juice", 1, "42.00")],
        )
    ),
    # A different café, so the per-cafeteria analytics have something to split.
    "other_cafe_P3001987.pdf": lambda: build_pdf(
        invoice_lines("P3001987", "21-Aug 2026", "01:15 PM", [("Make Your Own Salad - Veg", 4, "240.00")], cafe="Microsoft Bengaluru - BLR")
    ),
    # Valid PDF, but no text layer at all.
    "scanned_no_text.pdf": lambda: build_pdf([], with_text=False),
    # Reads as a PDF and has an order number, but the date is unusable.
    "bad_date_Q4001987.pdf": lambda: build_pdf(
        invoice_lines("Q4001987", "sometime last Tuesday", "11:00 AM", [("Watermelon Cut", 1, "31.00")])
    ),
    # A PDF that is not a SmartQ invoice.
    "not_an_invoice.pdf": lambda: build_pdf(["Quarterly Facilities Report", "Prepared for the operations team", "Page 1 of 4"]),
}


def main():
    outdir = Path(sys.argv[1] if len(sys.argv) > 1 else "data/test_invoices")
    outdir.mkdir(parents=True, exist_ok=True)
    for name, make in FIXTURES.items():
        (outdir / name).write_bytes(make())
        print(f"wrote {name}")
    print(f"{len(FIXTURES)} fixtures in {outdir}")


if __name__ == "__main__":
    main()
