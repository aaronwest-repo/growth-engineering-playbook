#!/usr/bin/env python3
"""Validate the shared-data catalog and marketing files.

Two levels of strictness:
  * CLEAN files are the canonical answer key -> strict value + consistency checks.
  * MESSY files intentionally contain defects -> structural checks only
    (correct columns, non-empty, and every ID reconciles back to the clean set).

Exit code is non-zero if any check fails, so CI can gate on it.
Stdlib only; no third-party dependencies.
"""

from __future__ import annotations

import csv
import json
import sys
from datetime import date, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CATALOG = ROOT / "shared-data" / "catalog"
MARKETING = ROOT / "shared-data" / "marketing"
CONTENT = ROOT / "shared-data" / "content"
EVENTS = ROOT / "shared-data" / "events"

PRODUCT_COLUMNS = [
    "product_id", "parent_id", "sku", "title_en", "title_de", "brand",
    "category", "price", "currency", "margin_rate", "stock", "size", "color",
    "material", "weight_grams", "description_en", "description_de",
    "image_url", "gtin", "availability", "condition", "google_product_category",
]
CAMPAIGN_COLUMNS = [
    "date", "campaign_id", "source", "medium", "campaign", "term", "content",
    "spend", "clicks", "sessions", "orders", "revenue", "gross_margin",
    "new_customers",
]

CATEGORIES = {
    "Jackets", "Shoes", "Backpacks", "Outdoor accessories", "Base layers",
    "Reusable bottles", "Travel gear",
}
CURRENCIES = {"EUR"}
AVAILABILITY = {"in stock", "out of stock", "preorder"}
DATE_MIN = date(2024, 1, 1)
DATE_MAX = date(2027, 12, 31)
CONTENT_DOCS = {
    "faq.md",
    "shipping-policy.md",
    "returns-policy.md",
    "warranty-policy.md",
    "size-guide.md",
    "sustainability-policy.md",
}

errors: list[str] = []


def fail(msg: str) -> None:
    errors.append(msg)


def read_rows(path: Path) -> tuple[list[str], list[dict]]:
    with path.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        header = reader.fieldnames or []
        return header, list(reader)


def check_header(path: Path, header: list[str], expected: list[str]) -> bool:
    if header != expected:
        fail(f"{path.name}: header mismatch\n    expected: {expected}\n    found:    {header}")
        return False
    return True


def as_float(value: str):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def validate_products_clean(path: Path) -> set[str]:
    header, rows = read_rows(path)
    if not check_header(path, header, PRODUCT_COLUMNS):
        return set()
    if not rows:
        fail(f"{path.name}: no data rows")
        return set()

    ids: set[str] = set()
    for i, r in enumerate(rows, start=2):  # row 1 is the header
        pid = r["product_id"]
        loc = f"{path.name} row {i} ({pid})"
        if not pid:
            fail(f"{loc}: empty product_id")
        elif pid in ids:
            fail(f"{loc}: duplicate product_id")
        ids.add(pid)

        price = as_float(r["price"])
        if price is None or price <= 0:
            fail(f"{loc}: price not a positive number: {r['price']!r}")
        margin = as_float(r["margin_rate"])
        if margin is None or not (0.0 <= margin <= 1.0):
            fail(f"{loc}: margin_rate not in [0,1]: {r['margin_rate']!r}")
        if not r["stock"].isdigit():
            fail(f"{loc}: stock not a non-negative integer: {r['stock']!r}")
        if not r["weight_grams"].isdigit() or int(r["weight_grams"]) <= 0:
            fail(f"{loc}: weight_grams not a positive integer: {r['weight_grams']!r}")
        if r["currency"] not in CURRENCIES:
            fail(f"{loc}: currency not allowed: {r['currency']!r}")
        if r["category"] not in CATEGORIES:
            fail(f"{loc}: category not allowed: {r['category']!r}")
        if r["availability"] not in AVAILABILITY:
            fail(f"{loc}: availability not allowed: {r['availability']!r}")
        if r["condition"] != "new":
            fail(f"{loc}: condition not 'new': {r['condition']!r}")
        if not (r["gtin"].isdigit() and len(r["gtin"]) == 13):
            fail(f"{loc}: gtin not 13 digits: {r['gtin']!r}")
        for required in ("sku", "title_en", "title_de", "brand", "material", "color"):
            if not r[required].strip():
                fail(f"{loc}: empty {required}")

    # Referential integrity: parent_id must be empty or point to a real product.
    for i, r in enumerate(rows, start=2):
        parent = r["parent_id"]
        if parent and parent not in ids:
            fail(f"{path.name} row {i}: parent_id {parent!r} has no matching product_id")

    return ids


def validate_campaigns_clean(path: Path) -> set[str]:
    header, rows = read_rows(path)
    if not check_header(path, header, CAMPAIGN_COLUMNS):
        return set()
    if not rows:
        fail(f"{path.name}: no data rows")
        return set()

    campaign_ids: set[str] = set()
    numeric = ["spend", "clicks", "sessions", "orders", "revenue",
               "gross_margin", "new_customers"]
    for i, r in enumerate(rows, start=2):
        loc = f"{path.name} row {i} ({r['campaign_id']})"
        if not r["campaign_id"]:
            fail(f"{loc}: empty campaign_id")
        campaign_ids.add(r["campaign_id"])

        try:
            d = date.fromisoformat(r["date"])
            if not (DATE_MIN <= d <= DATE_MAX):
                fail(f"{loc}: date out of range: {r['date']}")
        except ValueError:
            fail(f"{loc}: unparseable date: {r['date']!r}")

        vals = {}
        ok = True
        for col in numeric:
            v = as_float(r[col])
            if v is None or v < 0:
                fail(f"{loc}: {col} not a non-negative number: {r[col]!r}")
                ok = False
            vals[col] = v
        if not ok:
            continue

        if vals["sessions"] > vals["clicks"]:
            fail(f"{loc}: sessions ({vals['sessions']}) > clicks ({vals['clicks']})")
        if vals["orders"] > vals["sessions"]:
            fail(f"{loc}: orders ({vals['orders']}) > sessions ({vals['sessions']})")
        if vals["new_customers"] > vals["orders"]:
            fail(f"{loc}: new_customers ({vals['new_customers']}) > orders ({vals['orders']})")
        if vals["gross_margin"] > vals["revenue"]:
            fail(f"{loc}: gross_margin ({vals['gross_margin']}) > revenue ({vals['revenue']})")
        if not r["source"].islower() or not r["source"].strip():
            fail(f"{loc}: source not canonical lowercase: {r['source']!r}")

    return campaign_ids


def validate_messy_structure(path: Path, expected_cols: list[str],
                             id_col: str, valid_ids: set[str]) -> None:
    """Messy files may violate value rules, but must be structurally sound and
    every ID must reconcile with the clean answer key."""
    header, rows = read_rows(path)
    if not check_header(path, header, expected_cols):
        return
    if not rows:
        fail(f"{path.name}: no data rows")
        return
    unknown = {r[id_col] for r in rows if r[id_col] and r[id_col] not in valid_ids}
    if unknown:
        fail(f"{path.name}: {id_col}(s) not found in clean set: {sorted(unknown)}")


EVENT_FILES = {
    "affiliate-clicks.jsonl": ["click_id", "visitor_id", "session_id", "publisher_id",
                               "publisher_name", "campaign_id", "clicked_at", "landing_url",
                               "product_id", "cookie_set", "cookie_lost", "suspicious_flag"],
    "web-events.jsonl": ["event_id", "visitor_id", "session_id", "event_type",
                         "occurred_at", "product_id", "source", "medium", "campaign_id"],
    "conversions.jsonl": ["order_id", "visitor_id", "session_id", "converted_at", "product_id",
                          "order_value", "gross_margin", "claimed_click_id", "competing_channel",
                          "returned", "validation_status", "validation_reason"],
    "cart-events.jsonl": ["cart_id", "visitor_id", "customer_ref", "checkout_started_at", "items",
                          "product_ids", "cart_value", "currency", "consent_status",
                          "purchased_before_send", "recovers_if_emailed", "provider_error",
                          "succeeds_on_attempt"],
}
CONSENT_STATUSES = {"subscribed", "unknown", "unsubscribed"}


def _parse_ts(value) -> bool:
    try:
        datetime.strptime(str(value), "%Y-%m-%dT%H:%M:%SZ")
        return True
    except (TypeError, ValueError):
        return False


def read_jsonl(path: Path) -> list[dict]:
    rows = []
    for i, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip():
            continue
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError as e:
            fail(f"{path.name} line {i}: invalid JSON ({e})")
    return rows


def validate_events(product_ids: set[str], campaign_ids: set[str]) -> dict:
    counts = {}
    data = {}
    for name, columns in EVENT_FILES.items():
        path = EVENTS / name
        if not path.exists():
            fail(f"events/{name}: missing required event file")
            data[name] = []
            continue
        rows = read_jsonl(path)
        data[name] = rows
        counts[name] = len(rows)
        if not rows:
            fail(f"events/{name}: no event rows")
            continue
        for i, r in enumerate(rows, start=1):
            missing = [c for c in columns if c not in r]
            if missing:
                fail(f"events/{name} row {i}: missing keys {missing}")

    clicks, web, convs = data["affiliate-clicks.jsonl"], data["web-events.jsonl"], data["conversions.jsonl"]
    carts = data["cart-events.jsonl"]

    # Uniqueness of primary IDs.
    def check_unique(rows, key, label):
        seen, dupes = set(), set()
        for r in rows:
            v = r.get(key)
            if v in seen:
                dupes.add(v)
            seen.add(v)
        if dupes:
            fail(f"{label}: duplicate {key}(s): {sorted(dupes)[:5]}")
        return seen

    click_ids = check_unique(clicks, "click_id", "affiliate-clicks.jsonl")
    check_unique(web, "event_id", "web-events.jsonl")
    check_unique(convs, "order_id", "conversions.jsonl")

    known_visitors = {r.get("visitor_id") for r in clicks} | {r.get("visitor_id") for r in web}

    # Product IDs must exist in the catalog; timestamps must parse.
    for r in clicks:
        if r.get("product_id") and r["product_id"] not in product_ids:
            fail(f"affiliate-clicks.jsonl: unknown product_id {r['product_id']}")
        if r.get("campaign_id") and r["campaign_id"] not in campaign_ids:
            fail(f"affiliate-clicks.jsonl: unknown campaign_id {r['campaign_id']}")
        if not _parse_ts(r.get("clicked_at")):
            fail(f"affiliate-clicks.jsonl: unparseable clicked_at {r.get('clicked_at')!r}")

    for r in web:
        if r.get("product_id") and r["product_id"] not in product_ids:
            fail(f"web-events.jsonl: unknown product_id {r['product_id']}")
        if r.get("campaign_id") and r["campaign_id"] not in campaign_ids:
            fail(f"web-events.jsonl: unknown campaign_id {r['campaign_id']}")
        if not _parse_ts(r.get("occurred_at")):
            fail(f"web-events.jsonl: unparseable occurred_at {r.get('occurred_at')!r}")

    for r in convs:
        if r.get("product_id") and r["product_id"] not in product_ids:
            fail(f"conversions.jsonl: unknown product_id {r['product_id']}")
        if not _parse_ts(r.get("converted_at")):
            fail(f"conversions.jsonl: unparseable converted_at {r.get('converted_at')!r}")
        claimed = r.get("claimed_click_id")
        if claimed and claimed not in click_ids:
            fail(f"conversions.jsonl: claimed_click_id {claimed} not found in affiliate clicks")
        if r.get("visitor_id") and r["visitor_id"] not in known_visitors:
            fail(f"conversions.jsonl: visitor_id {r['visitor_id']} has no click/web history")

    # Cart events: abandoned-cart inputs for the recovery workflow.
    check_unique(carts, "cart_id", "cart-events.jsonl")
    for r in carts:
        pids = r.get("product_ids")
        if not isinstance(pids, list) or not pids:
            fail(f"cart-events.jsonl: product_ids not a non-empty list for {r.get('cart_id')}")
        else:
            for pid in pids:
                if pid not in product_ids:
                    fail(f"cart-events.jsonl: unknown product_id {pid} in {r.get('cart_id')}")
        if not isinstance(r.get("cart_value"), (int, float)) or r.get("cart_value", 0) <= 0:
            fail(f"cart-events.jsonl: cart_value not positive for {r.get('cart_id')}")
        if r.get("consent_status") not in CONSENT_STATUSES:
            fail(f"cart-events.jsonl: bad consent_status {r.get('consent_status')!r}")
        if not _parse_ts(r.get("checkout_started_at")):
            fail(f"cart-events.jsonl: unparseable checkout_started_at for {r.get('cart_id')}")
        if "@" in str(r.get("customer_ref", "")):
            fail(f"cart-events.jsonl: customer_ref looks like an email for {r.get('cart_id')}")

    return counts


def validate_content_docs() -> None:
    for name in sorted(CONTENT_DOCS):
        path = CONTENT / name
        if not path.exists():
            fail(f"content/{name}: missing required RAG corpus document")
            continue
        text = path.read_text(encoding="utf-8")
        if not text.startswith("# "):
            fail(f"content/{name}: missing top-level markdown heading")
        if len(text.split()) < 45:
            fail(f"content/{name}: too short for useful retrieval")


def main() -> int:
    product_ids = validate_products_clean(CATALOG / "products-clean.csv")
    campaign_ids = validate_campaigns_clean(MARKETING / "campaigns-clean.csv")

    validate_messy_structure(CATALOG / "products-messy.csv",
                             PRODUCT_COLUMNS, "product_id", product_ids)
    validate_messy_structure(MARKETING / "campaigns-messy.csv",
                             CAMPAIGN_COLUMNS, "campaign_id", campaign_ids)
    validate_content_docs()
    event_counts = validate_events(product_ids, campaign_ids)

    print("Shared-data validation")
    print(f"  products-clean:   {len(product_ids)} products")
    print(f"  campaigns-clean:  {len(campaign_ids)} distinct campaign_ids")
    print(f"  content docs:     {len(CONTENT_DOCS)} documents")
    for name, count in event_counts.items():
        print(f"  events/{name}: {count} rows")

    if errors:
        print(f"\nFAILED with {len(errors)} error(s):")
        for e in errors:
            print(f"  - {e}")
        return 1

    print("\nAll shared-data checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
