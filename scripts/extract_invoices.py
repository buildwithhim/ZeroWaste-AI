import pdfplumber
import pandas as pd
import re
from pathlib import Path

rows = []

for pdf in Path("../data/invoices").glob("*.pdf"):
    text = ""

    with pdfplumber.open(pdf) as doc:
        for page in doc.pages:
            if page.extract_text():
                text += page.extract_text() + "\n"

    vendor = re.search(r"VENDOR NAME\s*:\s*(.*)", text)
    date = re.search(r"Order Date:\s*(.*)", text)
    time = re.search(r"Order Time:\s*(.*)", text)

    item = qty = amount = ""

    for line in text.splitlines():
        if "(" in line:
            m = re.search(r"(.+?)\s+\((\d+)\)\s+(\d+)\s+([\d.]+)", line)
            if m:
                item = m.group(1).strip()
                qty = m.group(3)
                amount = m.group(4)

    rows.append({
        "date": date.group(1),
        "time": time.group(1),
        "vendor": vendor.group(1),
        "item": item,
        "quantity": qty,
        "amount": amount
    })

pd.DataFrame(rows).to_csv("../data/orders_dataset.csv", index=False)

print("Dataset Created")