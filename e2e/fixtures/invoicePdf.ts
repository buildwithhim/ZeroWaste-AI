/**
 * Builds a SmartQ-shaped invoice PDF in memory.
 *
 * A port of scripts/make_test_invoice.py, so an end-to-end run can mint a
 * *unique* invoice each time. That matters: the ingestion pipeline is built
 * around duplicate detection, so re-importing a fixed fixture would be
 * recorded as a duplicate on the second run and the "imported" assertion would
 * start failing for the wrong reason.
 *
 * The bytes are a genuine PDF with a real text layer -- pdfplumber parses this
 * for real on the server side, so nothing about the parse step is stubbed.
 */

export type InvoiceItem = { name: string; quantity: number; amount: string };

export type InvoiceSpec = {
  orderId: string;
  date: string;
  time: string;
  items: InvoiceItem[];
  cafe?: string;
  vendor?: string;
};

function escapePdfText(line: string) {
  return line.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

/** Assembles a one-page PDF, computing the xref offsets as objects are appended. */
function buildPdf(lines: string[]): Buffer {
  const content = ["BT", "/F1 11 Tf", "50 780 Td", "13 TL"];
  for (const line of lines) content.push(`(${escapePdfText(line)}) Tj T*`);
  content.push("ET");
  const stream = Buffer.from(content.join("\n"), "latin1");

  const objects = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>", "latin1"),
    Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "latin1"),
    Buffer.from(
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
      "latin1"
    ),
    Buffer.concat([Buffer.from(`<< /Length ${stream.length} >>\nstream\n`, "latin1"), stream, Buffer.from("\nendstream", "latin1")]),
    Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", "latin1"),
  ];

  const chunks: Buffer[] = [Buffer.from("%PDF-1.4\n", "latin1")];
  let length = chunks[0].length;
  const offsets: number[] = [];

  objects.forEach((body, index) => {
    offsets.push(length);
    const wrapped = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`, "latin1"), body, Buffer.from("\nendobj\n", "latin1")]);
    chunks.push(wrapped);
    length += wrapped.length;
  });

  const xrefAt = length;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) xref += `${String(offset).padStart(10, "0")} 00000 n \n`;
  xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  chunks.push(Buffer.from(xref, "latin1"));

  return Buffer.concat(chunks);
}

export function invoicePdf(spec: InvoiceSpec): Buffer {
  const cafe = spec.cafe ?? "Microsoft Pune - CMZ";
  const vendor = spec.vendor ?? "Compass India Food Services Pvt. Ltd.";
  const lines = [
    "KOT",
    `VENDOR NAME : ${vendor}`,
    "GSTIN: 27AADCC9070A2ZW",
    "FSSAI Licence No: N/A",
    `Cafe: ${cafe}`,
    "Site Code: 149I",
    `Order ID: #${spec.orderId}`,
    `Order Date: ${spec.date}`,
    `Order Time: ${spec.time}`,
    "Item Name with HSN Code Quantity Amount",
    ...spec.items.map((item) => `${item.name} (996333) ${item.quantity} ${item.amount} (points)`),
    `Order ID #${spec.orderId}Z268199325205`,
  ];
  return buildPdf(lines);
}

/** An order number no earlier run can have used. */
export const uniqueOrderId = () => `E${Date.now().toString().slice(-7)}${Math.floor(Math.random() * 90 + 10)}`;

/** A PDF that is valid but is plainly not an invoice. Used for the reject path. */
export const notAnInvoicePdf = () =>
  buildPdf(["Quarterly Facilities Report", "Prepared for the operations team", "Page 1 of 4"]);
