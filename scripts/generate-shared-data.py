#!/usr/bin/env python3
"""Deterministic generator for the Northstar Outfitters shared-data universe.

Fictional store. All brands, products, campaigns, GTINs, URLs, and metrics are
invented. No real customer, employer, client, or production-system data.

This first scope covers catalog + marketing only (enough for use cases #1 and
#2). Customers, orders, events, and the RAG corpus are added before #3/#5.

Design:
  * A single fixed SEED makes every run reproducible.
  * The "clean" files are the canonical universe.
  * The "messy" files are DERIVED from the clean rows by injecting realistic
    defects, keeping IDs intact so the two reconcile (validate-shared-data.py
    treats the clean files as the answer key).

Run:  python scripts/generate-shared-data.py
Stdlib only; no third-party dependencies.
"""

from __future__ import annotations

import csv
import json
import random
from datetime import date, datetime, timedelta
from pathlib import Path

SEED = 42
CURRENCY = "EUR"
ROOT = Path(__file__).resolve().parent.parent
CATALOG_DIR = ROOT / "shared-data" / "catalog"
MARKETING_DIR = ROOT / "shared-data" / "marketing"
CONTENT_DIR = ROOT / "shared-data" / "content"
EVENTS_DIR = ROOT / "shared-data" / "events"
CUSTOMERS_DIR = ROOT / "shared-data" / "customers"

CATEGORIES = [
    "Jackets",
    "Shoes",
    "Backpacks",
    "Outdoor accessories",
    "Base layers",
    "Reusable bottles",
    "Travel gear",
]

GOOGLE_CATEGORY = {
    "Jackets": "Apparel & Accessories > Clothing > Outerwear > Coats & Jackets",
    "Shoes": "Apparel & Accessories > Shoes",
    "Backpacks": "Luggage & Bags > Backpacks",
    "Outdoor accessories": "Sporting Goods > Outdoor Recreation",
    "Base layers": "Apparel & Accessories > Clothing > Shirts & Tops",
    "Reusable bottles": "Home & Garden > Kitchen & Dining > Tableware > Drinkware",
    "Travel gear": "Luggage & Bags > Travel Accessories",
}

# Invented brands only.
BRANDS = {
    "Jackets": ["Northstar", "Aurora Gear"],
    "Shoes": ["TrailForge", "Northstar"],
    "Backpacks": ["Voyager Co", "Northstar"],
    "Outdoor accessories": ["Summit Line", "Northstar"],
    "Base layers": ["Fjordkit", "Northstar"],
    "Reusable bottles": ["HydraSteel"],
    "Travel gear": ["Nomad Co", "Voyager Co"],
}

# (model title EN, model title DE, materials, colors, price, weight g)
MODELS = {
    "Jackets": [
        ("Aurora Shell Jacket", "Aurora Hardshell-Jacke", "recycled polyester", 179.0, 480),
        ("Ridgeline Insulated Jacket", "Ridgeline Isolierjacke", "nylon", 219.0, 620),
        ("Fjord Rain Jacket", "Fjord Regenjacke", "recycled polyester", 139.0, 390),
        ("Windbreaker Lite Jacket", "Windbreaker Lite Jacke", "ripstop nylon", 99.0, 210),
    ],
    "Shoes": [
        ("TrailForge Hiker", "TrailForge Wanderschuh", "suede and mesh", 149.0, 820),
        ("Cascade Trail Runner", "Cascade Trailrunner", "engineered mesh", 129.0, 540),
        ("Basecamp Approach Shoe", "Basecamp Zustiegsschuh", "leather", 119.0, 700),
    ],
    "Backpacks": [
        ("Voyager 30L Backpack", "Voyager 30L Rucksack", "recycled nylon", 129.0, 1100),
        ("Daybreak 18L Pack", "Daybreak 18L Rucksack", "ripstop nylon", 79.0, 640),
        ("Expedition 55L Pack", "Expedition 55L Rucksack", "cordura", 189.0, 1850),
    ],
    "Outdoor accessories": [
        ("Trailhead Cap", "Trailhead Kappe", "organic cotton", 29.0, 90),
        ("Summit Beanie", "Summit Muetze", "merino wool", 34.0, 110),
        ("Glacier Gloves", "Glacier Handschuhe", "softshell", 39.0, 130),
        ("Horizon Sunglasses", "Horizon Sonnenbrille", "polycarbonate", 59.0, 30),
        ("Ridge Trekking Poles", "Ridge Trekkingstoecke", "aluminium", 69.0, 480),
    ],
    "Base layers": [
        ("Merino Base Tee", "Merino Funktionsshirt", "merino wool", 59.0, 180),
        ("Thermal Base Legging", "Thermo Funktionshose", "merino blend", 69.0, 220),
        ("Alpine Long Sleeve", "Alpine Langarmshirt", "merino wool", 64.0, 200),
    ],
    "Reusable bottles": [
        ("HydraSteel 750ml Bottle", "HydraSteel 750ml Flasche", "stainless steel", 27.0, 320),
        ("HydraSteel 1L Bottle", "HydraSteel 1L Flasche", "stainless steel", 32.0, 410),
        ("Trail Sipper 500ml Bottle", "Trail Sipper 500ml Flasche", "tritan", 19.0, 150),
    ],
    "Travel gear": [
        ("Nomad Packing Cubes", "Nomad Packwuerfel", "recycled polyester", 39.0, 260),
        ("Voyager Toiletry Kit", "Voyager Kulturbeutel", "recycled polyester", 34.0, 180),
        ("Transit Neck Pillow", "Transit Nackenkissen", "memory foam", 29.0, 210),
        ("Globe Travel Adapter", "Globe Reiseadapter", "abs plastic", 24.0, 140),
        ("Compression Duffel 40L", "Kompressions-Reisetasche 40L", "ripstop nylon", 89.0, 720),
    ],
}

# Which categories carry per-size variants, and the size sets used.
APPAREL_SIZES = ["S", "M", "L"]
SHOE_SIZES = ["EU 41", "EU 43", "EU 45"]
VARIANT_SIZES = {
    "Jackets": APPAREL_SIZES,
    "Base layers": APPAREL_SIZES,
    "Shoes": SHOE_SIZES,
}

COLORS = ["Forest", "Slate", "Charcoal", "Sand", "Ink Blue", "Ember", "Moss"]

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


def slugify(text: str) -> str:
    keep = [c.lower() if c.isalnum() else "-" for c in text]
    slug = "".join(keep)
    while "--" in slug:
        slug = slug.replace("--", "-")
    return slug.strip("-")


def gtin13(rng: random.Random) -> str:
    """Invented 13-digit numeric GTIN (not a real barcode)."""
    return "40" + "".join(str(rng.randint(0, 9)) for _ in range(11))


def build_products(rng: random.Random) -> list[dict]:
    products: list[dict] = []
    counter = 1
    for category in CATEGORIES:
        brands = BRANDS[category]
        sizes = VARIANT_SIZES.get(category)
        for title_en, title_de, material, base_price, base_weight in MODELS[category]:
            brand = brands[(counter) % len(brands)]
            model_colors = [rng.choice(COLORS) for _ in range(2)]
            variant_sizes = sizes if sizes else [""]
            parent_of_model = ""  # first variant becomes the group representative
            for v_index, size in enumerate(variant_sizes):
                pid = f"NSP-{counter:04d}"
                color = model_colors[v_index % len(model_colors)]
                size_slug = slugify(size) if size else "os"
                sku = f"{brand[:3].upper()}-{slugify(title_en)}-{size_slug}"
                price = round(base_price + v_index * 5.0, 2)
                weight = base_weight + v_index * 15
                stock = rng.randint(0, 240)
                margin = round(rng.uniform(0.35, 0.58), 2)
                availability = "in stock" if stock > 0 else "out of stock"
                size_txt = size if size else "One Size"
                desc_en = (
                    f"{title_en} in {color.lower()}. Made with {material} for "
                    f"reliable performance on the trail and around town."
                )
                desc_de = (
                    f"{title_de} in {color.lower()}. Gefertigt aus {material} "
                    f"fuer zuverlaessige Leistung auf dem Trail und im Alltag."
                )
                products.append({
                    "product_id": pid,
                    "parent_id": parent_of_model,
                    "sku": sku,
                    "title_en": title_en,
                    "title_de": title_de,
                    "brand": brand,
                    "category": category,
                    "price": f"{price:.2f}",
                    "currency": CURRENCY,
                    "margin_rate": f"{margin:.2f}",
                    "stock": str(stock),
                    "size": size_txt,
                    "color": color,
                    "material": material,
                    "weight_grams": str(weight),
                    "description_en": desc_en,
                    "description_de": desc_de,
                    "image_url": f"https://cdn.northstar-outfitters.example/img/{sku}.jpg",
                    "gtin": gtin13(rng),
                    "availability": availability,
                    "condition": "new",
                    "google_product_category": GOOGLE_CATEGORY[category],
                })
                if v_index == 0:
                    parent_of_model = pid  # later variants reference the first
                counter += 1
    return products


def inject_product_mess(clean: list[dict], rng: random.Random) -> list[dict]:
    """Derive the messy catalog from clean rows by injecting realistic defects.

    IDs (product_id) are preserved so the messy set reconciles with the clean
    answer key. SKU duplication is created by copying a value, not a whole row.
    """
    messy = [dict(row) for row in clean]

    hype_lines = [
        "The best jacket in the world. 100% waterproof forever, guaranteed for life!",
        "Scientifically proven to keep you warm in any weather, no matter what.",
        "Unbreakable and lasts a lifetime - never buy gear again!",
        "Miracle fabric that repairs itself and never smells.",
    ]

    for i, row in enumerate(messy):
        # Mixed casing on brand / category.
        if i % 3 == 0:
            row["brand"] = row["brand"].upper()
        elif i % 3 == 1:
            row["brand"] = row["brand"].lower()
        if i % 4 == 0:
            row["category"] = row["category"].lower()
        elif i % 4 == 1:
            row["category"] = f" {row['category'].upper()} "  # padding + case

        # Missing GTINs.
        if i % 5 == 0:
            row["gtin"] = ""

        # HTML fragments in descriptions.
        if i % 6 == 0:
            row["description_en"] = f"<p><b>{row['title_en']}</b><br/>{row['description_en']}</p>"

        # German / English mixed into the DE field.
        if i % 7 == 0:
            row["description_de"] = row["description_en"]  # English left in DE column

        # Inconsistent size vocabulary.
        if row["size"] == "M" and i % 2 == 0:
            row["size"] = rng.choice(["Medium", "med", "m"])
        elif row["size"] == "L" and i % 2 == 1:
            row["size"] = rng.choice(["Large", "lg"])
        elif row["size"].startswith("EU ") and i % 2 == 0:
            row["size"] = row["size"].replace("EU ", "").strip()  # "43"

        # Missing material / color.
        if i % 8 == 0:
            row["material"] = ""
        if i % 9 == 0:
            row["color"] = ""

        # Over-claimed marketing copy for use case #4 to flag.
        if i % 10 == 0:
            row["description_en"] = hype_lines[(i // 10) % len(hype_lines)]

        # Price written as a localized string on a subset.
        if i % 11 == 0:
            row["price"] = "€" + row["price"].replace(".", ",")

        # Occasional blank stock.
        if i % 13 == 0:
            row["stock"] = ""

    # Near-duplicate SKUs: copy one row's SKU onto another existing product.
    if len(messy) >= 6:
        messy[5]["sku"] = messy[2]["sku"]

    return messy


# --- Marketing -------------------------------------------------------------

CAMPAIGN_DEFS = [
    # id, source, medium, campaign, term, content, daily_spend, cpc, conv, aov, new_rate, active
    ("C001", "google", "cpc", "brand-search", "northstar outfitters", "text-ad", 60.0, 0.55, 0.075, 96, 0.25, "daily"),
    ("C002", "google", "cpc", "generic-hiking-jackets", "hiking jacket", "text-ad", 140.0, 1.05, 0.028, 132, 0.62, "daily"),
    ("C003", "google", "cpc", "shopping-all", "", "pla", 180.0, 0.62, 0.032, 88, 0.55, "daily"),
    ("C004", "facebook", "paid-social", "retargeting-viewers", "", "carousel", 90.0, 0.48, 0.021, 79, 0.20, "daily"),
    ("C005", "facebook", "paid-social", "prospecting-lookalike", "", "video", 130.0, 0.42, 0.011, 74, 0.78, "daily"),
    ("C006", "instagram", "paid-social", "prospecting-lookalike", "", "story", 80.0, 0.51, 0.010, 71, 0.80, "daily"),
    ("C007", "newsletter", "email", "weekly-newsletter", "", "header-link", 0.0, 0.0, 0.045, 102, 0.10, "twice-weekly"),
    ("C008", "bing", "cpc", "generic-backpacks", "backpack", "text-ad", 45.0, 0.70, 0.024, 108, 0.58, "daily"),
    ("C009", "affiliate", "affiliate", "partner-outdoorblog", "", "banner", 0.0, 0.0, 0.030, 118, 0.60, "daily"),
]

START_DATE = date(2025, 1, 1)
NUM_DAYS = 28


def build_campaigns(rng: random.Random) -> list[dict]:
    rows: list[dict] = []
    for day_offset in range(NUM_DAYS):
        d = START_DATE + timedelta(days=day_offset)
        for (cid, source, medium, campaign, term, content,
             daily_spend, cpc, conv, aov, new_rate, active) in CAMPAIGN_DEFS:
            if active == "twice-weekly" and d.weekday() not in (1, 3):  # Tue/Thu
                continue

            jitter = rng.uniform(0.75, 1.25)
            if cpc > 0:
                spend = round(daily_spend * jitter, 2)
                clicks = max(1, round(spend / cpc))
            else:
                # Email / affiliate: no CPC. Model reach as "clicks", spend is
                # a small fixed tooling/commission proxy.
                clicks = max(1, round(rng.uniform(400, 1200)))
                spend = round(clicks * 0.02, 2) if medium != "email" else 12.0

            sessions = max(1, round(clicks * rng.uniform(0.78, 0.94)))
            orders = round(sessions * conv * rng.uniform(0.8, 1.2))
            orders = min(orders, sessions)
            revenue = round(orders * aov * rng.uniform(0.9, 1.15), 2)
            gross_margin = round(revenue * rng.uniform(0.36, 0.5), 2)
            new_customers = min(orders, round(orders * new_rate))

            # Affiliate spend is commission on revenue.
            if source == "affiliate":
                spend = round(revenue * 0.08, 2)

            rows.append({
                "date": d.isoformat(),
                "campaign_id": cid,
                "source": source,
                "medium": medium,
                "campaign": campaign,
                "term": term,
                "content": content,
                "spend": f"{spend:.2f}",
                "clicks": str(clicks),
                "sessions": str(sessions),
                "orders": str(orders),
                "revenue": f"{revenue:.2f}",
                "gross_margin": f"{gross_margin:.2f}",
                "new_customers": str(new_customers),
            })
    return rows


def inject_campaign_mess(clean: list[dict], rng: random.Random) -> list[dict]:
    """Dirty the UTM fields while keeping campaign_id intact for joins."""
    source_variants = {
        "google": ["google", "Google"],
        "facebook": ["facebook", "Facebook", "fb", "meta"],
        "instagram": ["instagram", "Instagram", "IG"],
        "newsletter": ["newsletter", "email", "Newsletter"],
        "bing": ["bing", "Bing"],
        "affiliate": ["affiliate", "Affiliate"],
    }
    medium_variants = {
        "cpc": ["cpc", "CPC", "ppc"],
        "paid-social": ["paid-social", "Paid Social", "paid social", "social"],
        "email": ["email", "Email", "newsletter"],
        "affiliate": ["affiliate", "Affiliate", "referral"],
    }

    messy = [dict(row) for row in clean]
    for i, row in enumerate(messy):
        row["source"] = rng.choice(source_variants[row["source"]])
        row["medium"] = rng.choice(medium_variants[row["medium"]])

        camp = row["campaign"]
        roll = i % 6
        if roll == 0:
            row["campaign"] = ""                       # missing campaign
        elif roll == 1:
            row["campaign"] = camp.replace("-", " ")    # spaces not hyphens
        elif roll == 2:
            row["campaign"] = camp.title() + " "        # Title Case + trailing space
        elif roll == 3:
            row["campaign"] = f" {camp.upper()}"        # leading space + upper
        # roll 4/5: leave canonical
    return messy


def write_csv(path: Path, columns: list[str], rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=columns)
        writer.writeheader()
        writer.writerows(rows)


CONTENT_DOCS = {
    "faq.md": """# Northstar Outfitters FAQ

## Product advice

Northstar Outfitters sells outdoor and travel gear for everyday hikes, city travel, and weekend trips. The catalog covers jackets, shoes, backpacks, outdoor accessories, base layers, reusable bottles, and travel gear.

For wet weather, customers usually compare the Aurora Shell Jacket, Fjord Rain Jacket, and Ridgeline Insulated Jacket. The Aurora Shell Jacket is the more protective shell option in the sample catalog. The Fjord Rain Jacket is lighter and lower priced. The Ridgeline Insulated Jacket is warmer but heavier.

For hiking footwear, the TrailForge Hiker is the sturdier option, the Cascade Trail Runner is lighter, and the Basecamp Approach Shoe sits between casual travel and light trail use.

## Product identifiers

Product answers should cite the SKU or product title when possible. If a GTIN or exact stock value is missing from the provided catalog, support agents should say they cannot confirm it from the available data.

## Support boundaries

The assistant can answer product, shipping, return, warranty, size, and sustainability questions from this corpus. It cannot check a real order, payment, account, or delivery status. Those questions should route to the order-status intent and ask for the official order lookup flow.
""",
    "shipping-policy.md": """# Shipping Policy

## Delivery regions

Northstar Outfitters ships to Germany, Austria, the Netherlands, Belgium, and Luxembourg in this sample store universe.

## Delivery times

Standard delivery to Germany is usually 2 to 4 business days after dispatch. Austria, the Netherlands, Belgium, and Luxembourg are usually 3 to 6 business days after dispatch. Delivery estimates are not guarantees.

## Shipping cost

Standard delivery is free for orders of 75 EUR or more. Orders below 75 EUR have a 4.90 EUR standard shipping fee. Express shipping is not part of this sample policy.

## Tracking

Tracking is sent by email after dispatch. The chatbot cannot retrieve live tracking data and should route order-status questions to the mocked order lookup intent.
""",
    "returns-policy.md": """# Returns Policy

## Return window

Customers can return unused products within 30 days of delivery. Products must be clean, complete, and in a resellable condition.

## Exclusions

Reusable bottles can only be returned unused. Worn shoes, washed base layers, and damaged packaging may require manual review.

## Refund timing

Refunds are processed after the returned product is inspected. The sample policy uses a normal processing time of 5 to 8 business days after warehouse receipt.

## Exchanges

Direct exchanges are not available in the sample policy. Customers should return the unwanted item and place a new order for the replacement size or color.
""",
    "warranty-policy.md": """# Warranty Policy

## Coverage

Northstar Outfitters products include a 2-year warranty for manufacturing defects in this sample store universe. Normal wear, accidental damage, misuse, and cosmetic wear are not covered.

## Claim evidence

Warranty questions should ask for the product, order reference, photos of the issue, and a short description. The chatbot should not promise approval.

## Claim language

The assistant must not say products are unbreakable, guaranteed for life, scientifically proven, or 100% waterproof forever. Those claims are not supported by this corpus.
""",
    "size-guide.md": """# Size Guide

## Apparel

Jackets and base layers use S, M, and L in the sample catalog. Customers between sizes should choose the larger size for layering and the smaller size for a closer fit.

## Shoes

Shoes use EU 41, EU 43, and EU 45 in the sample catalog. The TrailForge Hiker is the sturdiest hiking shoe. The Cascade Trail Runner is lighter. The Basecamp Approach Shoe is suited to travel and light trail use.

## One-size products

Backpacks, bottles, travel gear, and most accessories are listed as One Size. Fit questions for backpacks should consider volume in liters, intended use, and loaded weight.
""",
    "sustainability-policy.md": """# Sustainability Claims Policy

## Materials

Some products use recycled polyester, recycled nylon, organic cotton, merino wool, stainless steel, or tritan. The assistant can mention a material only when it appears in the product catalog.

## Claim limits

The assistant can say a product uses a listed material. It must not infer carbon neutrality, full circularity, plastic-free manufacturing, lifetime durability, or environmental certifications that are not present in the catalog or policy documents.

## Careful wording

Use qualified language such as "made with recycled polyester" rather than broad claims such as "eco-friendly" or "sustainable product" unless a specific certification is present in the source data.
""",
}


def write_content_docs() -> None:
    CONTENT_DIR.mkdir(parents=True, exist_ok=True)
    for name, text in CONTENT_DOCS.items():
        (CONTENT_DIR / name).write_text(text.strip() + "\n", encoding="utf-8")


# --- Events (affiliate tracking) -------------------------------------------

AFFILIATE_CAMPAIGN_ID = "C009"  # the affiliate campaign in campaigns-clean.csv
PUBLISHERS = [
    ("PUB-01", "TrailNotes Blog"),
    ("PUB-02", "GearDealFinder"),
    ("PUB-03", "OutdoorMailer"),
    ("PUB-04", "CashbackHub"),
    ("PUB-05", "ClickFarmX"),  # deliberately suspicious publisher
]
EVENT_BASE = datetime(2025, 2, 1, 9, 0, 0)


def _iso(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def build_events(products: list[dict], rng: random.Random):
    """Deterministic affiliate event universe over the Northstar catalog.

    Emits raw clicks, web events, and conversions with ground-truth labels. The
    demo's simulator applies attribution windows/rules, cookie-loss, and
    validation modes on top of these raw facts. All IDs are invented; no
    personal data.
    """
    price_by_id = {p["product_id"]: float(p["price"]) for p in products}
    margin_by_id = {p["product_id"]: float(p["margin_rate"]) for p in products}
    product_ids = list(price_by_id.keys())

    clicks: list[dict] = []
    web: list[dict] = []
    convs: list[dict] = []
    n = {"v": 0, "s": 0, "c": 0, "o": 0, "e": 0}

    def nid(key: str, prefix: str, width: int) -> str:
        n[key] += 1
        return f"{prefix}{n[key]:0{width}d}"

    def add_web(visitor, session, etype, dt, product, source, medium, campaign):
        web.append({
            "event_id": nid("e", "EVT-", 6), "visitor_id": visitor,
            "session_id": session, "event_type": etype, "occurred_at": _iso(dt),
            "product_id": product or "", "source": source, "medium": medium,
            "campaign_id": campaign or "",
        })

    def add_click(visitor, session, publisher, dt, product, cookie_set, cookie_lost, suspicious):
        cid = nid("c", "CLK-", 5)
        clicks.append({
            "click_id": cid, "visitor_id": visitor, "session_id": session,
            "publisher_id": publisher[0], "publisher_name": publisher[1],
            "campaign_id": AFFILIATE_CAMPAIGN_ID, "clicked_at": _iso(dt),
            "landing_url": f"https://northstar-outfitters.example/p/{product}?aff={publisher[0]}&clk={cid}",
            "product_id": product, "cookie_set": cookie_set, "cookie_lost": cookie_lost,
            "suspicious_flag": suspicious,
        })
        return cid

    def add_conv(visitor, session, dt, product, claimed_click_id, competing, returned, status, reason, qty=None):
        value = round(price_by_id[product] * (qty if qty else rng.choice([1, 1, 1, 2])), 2)
        gm = round(value * margin_by_id[product], 2)
        convs.append({
            "order_id": nid("o", "ORD-", 5), "visitor_id": visitor, "session_id": session,
            "converted_at": _iso(dt), "product_id": product, "order_value": value,
            "gross_margin": gm, "claimed_click_id": claimed_click_id,
            "competing_channel": competing, "returned": returned,
            "validation_status": status, "validation_reason": reason,
        })

    def dt_at(day, hour=None, minute=None):
        return EVENT_BASE + timedelta(
            days=day,
            hours=rng.randint(0, 11) if hour is None else hour,
            minutes=rng.randint(0, 59) if minute is None else minute,
        )

    good_pubs = PUBLISHERS[:4]

    def affiliate_journey(gap_days, *, cookie_lost=False, competing="", returned=False,
                          status="clean", reason="", pub=None, suspicious=False):
        v = nid("v", "V-", 5)
        s = nid("s", "S-", 6)
        prod = rng.choice(product_ids)
        publisher = pub or rng.choice(good_pubs)
        ct = dt_at(rng.randint(0, 18))
        cid = add_click(v, s, publisher, ct, prod, True, cookie_lost, suspicious)
        add_web(v, s, "affiliate_click", ct, prod, "affiliate", "referral", AFFILIATE_CAMPAIGN_ID)
        add_web(v, s, "product_view", ct + timedelta(minutes=1), prod, "affiliate", "referral", AFFILIATE_CAMPAIGN_ID)
        add_web(v, s, "add_to_cart", ct + timedelta(minutes=6), prod, "affiliate", "referral", AFFILIATE_CAMPAIGN_ID)
        convt = ct + timedelta(days=gap_days, hours=rng.randint(1, 8))
        if competing:
            # a later paid touch competes for the same order
            add_web(v, nid("s", "S-", 6), "campaign_touch", convt - timedelta(hours=2),
                    prod, competing, "cpc" if competing == "paid_search" else competing, "")
        s2 = nid("s", "S-", 6)
        add_web(v, s2, "checkout_start", convt - timedelta(minutes=8), prod, "affiliate", "referral", AFFILIATE_CAMPAIGN_ID)
        add_web(v, s2, "purchase", convt, prod, "affiliate", "referral", AFFILIATE_CAMPAIGN_ID)
        claimed = "" if cookie_lost else cid
        add_conv(v, s2, convt, prod, claimed, competing, returned, status, reason)
        return v, cid, prod, ct

    # A. Valid affiliate conversions with varied click-to-conversion gaps
    #    (drives the attribution-window control).
    for lo, hi, count in ((0, 1, 22), (3, 6, 26), (12, 25, 16)):
        for _ in range(count):
            affiliate_journey(rng.randint(lo, hi), status="clean",
                              reason="Single affiliate click within window.")

    # B. Cookie-loss journeys: affiliate-influenced but tracking dropped.
    for _ in range(30):
        affiliate_journey(rng.randint(1, 8), cookie_lost=True, status="cookie_lost",
                          reason="Affiliate cookie lost before conversion; sale not tracked to publisher.")

    # C. Conversions outside a 30-day window.
    for _ in range(15):
        affiliate_journey(rng.randint(34, 55), status="outside_window",
                          reason="Conversion fell outside the attribution window.")

    # D. Cross-channel: a later paid-search touch also claims the order.
    for _ in range(24):
        affiliate_journey(rng.randint(1, 9), competing="paid_search", status="cross_channel",
                          reason="Paid search also claims this order; winner depends on the rule.")

    # E. Returned affiliate orders.
    for _ in range(18):
        affiliate_journey(rng.randint(1, 6), returned=True, status="returned",
                          reason="Order was returned; commission must be clawed back.")

    # F. Duplicate claims: two affiliate publishers claim the same order.
    for _ in range(12):
        v = nid("v", "V-", 5)
        s = nid("s", "S-", 6)
        prod = rng.choice(product_ids)
        p1, p2 = rng.sample(good_pubs, 2)
        c1t = dt_at(rng.randint(0, 10))
        cid1 = add_click(v, s, p1, c1t, prod, True, False, False)
        c2t = c1t + timedelta(hours=rng.randint(2, 20))
        cid2 = add_click(v, nid("s", "S-", 6), p2, c2t, prod, True, False, False)
        add_web(v, s, "affiliate_click", c1t, prod, "affiliate", "referral", AFFILIATE_CAMPAIGN_ID)
        add_web(v, s, "affiliate_click", c2t, prod, "affiliate", "referral", AFFILIATE_CAMPAIGN_ID)
        convt = c2t + timedelta(days=rng.randint(0, 3), hours=rng.randint(1, 6))
        s2 = nid("s", "S-", 6)
        add_web(v, s2, "purchase", convt, prod, "affiliate", "referral", AFFILIATE_CAMPAIGN_ID)
        add_conv(v, s2, convt, prod, cid2, "", False, "duplicate",
                 f"Two publishers ({p1[1]} and {p2[1]}) claim this order; one claim is a duplicate.")

    # G. Suspicious publisher (ClickFarmX): click bursts, poor session quality,
    #    a few conversions with impossibly short click-to-convert timing.
    clickfarm = PUBLISHERS[4]
    for burst in range(8):
        v = nid("v", "V-", 5)
        base_day = rng.randint(0, 18)
        for k in range(5):  # tight burst of clicks, cookie-stuffing style
            s = nid("s", "S-", 6)
            ct = dt_at(base_day, hour=3, minute=(k * 2) % 60)
            add_click(v, s, clickfarm, ct, rng.choice(product_ids), True, False, True)
        if burst % 3 == 0:  # a few odd conversions moments after a click
            prod = rng.choice(product_ids)
            s = nid("s", "S-", 6)
            ct = dt_at(base_day, hour=3, minute=11)
            cid = add_click(v, s, clickfarm, ct, prod, True, False, True)
            convt = ct + timedelta(seconds=40)
            add_web(v, s, "purchase", convt, prod, "affiliate", "referral", AFFILIATE_CAMPAIGN_ID)
            add_conv(v, s, convt, prod, cid, "", False, "suspicious",
                     "Conversion 40s after click from a flagged publisher; hold for review.")

    # H. Affiliate clicks that never convert (normal browsing tail).
    for _ in range(45):
        v = nid("v", "V-", 5)
        s = nid("s", "S-", 6)
        prod = rng.choice(product_ids)
        ct = dt_at(rng.randint(0, 25))
        add_click(v, s, rng.choice(good_pubs), ct, prod, True, rng.random() < 0.15, False)
        add_web(v, s, "product_view", ct + timedelta(minutes=1), prod, "affiliate", "referral", AFFILIATE_CAMPAIGN_ID)

    # I. Non-affiliate conversions (organic / paid / direct, no affiliate click).
    for _ in range(40):
        v = nid("v", "V-", 5)
        s = nid("s", "S-", 6)
        prod = rng.choice(product_ids)
        channel = rng.choice(["organic", "paid_search", "direct", "email"])
        vt = dt_at(rng.randint(0, 25))
        add_web(v, s, "product_view", vt, prod, channel, "cpc" if channel == "paid_search" else channel, "")
        add_web(v, s, "purchase", vt + timedelta(minutes=rng.randint(3, 40)), prod, channel,
                "cpc" if channel == "paid_search" else channel, "")
        add_conv(v, s, vt + timedelta(minutes=45), prod, "", channel, False, "non_affiliate",
                 "No affiliate click in the journey; not an affiliate sale.")

    return clicks, web, convs


def build_cart_events(products: list[dict], rng: random.Random) -> list[dict]:
    """Deterministic abandoned-cart universe for the cart-recovery workflow.

    Each row is an abandoned checkout with the signals the automation engine
    needs: consent, whether the shopper already bought, recover propensity, and
    a provider-error seed for retry logic. Customer refs are hashed-style tokens,
    never emails. The engine computes sends/retries/recovery live.
    """
    price_by_id = {p["product_id"]: float(p["price"]) for p in products}
    ids = list(price_by_id.keys())
    base = datetime(2025, 2, 10, 10, 0, 0)
    carts = []
    for i in range(120):
        cart_id = f"CART-{i + 1:05d}"
        item_ids = rng.sample(ids, rng.choice([1, 1, 2, 3]))
        value = round(sum(price_by_id[p] for p in item_ids), 2)
        started = base + timedelta(days=rng.randint(0, 20), hours=rng.randint(0, 12), minutes=rng.randint(0, 59))
        r = rng.random()
        consent = "subscribed" if r < 0.68 else ("unknown" if r < 0.88 else "unsubscribed")
        provider_error = rng.random() < 0.16
        carts.append({
            "cart_id": cart_id,
            "visitor_id": f"CV-{i + 1:05d}",
            "customer_ref": "cust_" + format(rng.getrandbits(32), "08x"),
            "checkout_started_at": _iso(started),
            "items": len(item_ids),
            "product_ids": item_ids,
            "cart_value": value,
            "currency": CURRENCY,
            "consent_status": consent,
            "purchased_before_send": rng.random() < 0.14,
            "recovers_if_emailed": rng.random() < 0.40,
            "provider_error": provider_error,
            "succeeds_on_attempt": rng.choice([2, 2, 3, 4]) if provider_error else 1,
        })
    return carts


# --- Customer / order / email / support layer (Wave 2) ---------------------

CUSTOMER_COLUMNS = ["customer_id", "email_hash", "first_name", "country", "language",
                    "created_at", "newsletter_opt_in", "loyalty_tier",
                    "consent_marketing", "consent_personalization"]
ORDER_COLUMNS = ["order_id", "customer_id", "order_date", "channel", "campaign_id",
                 "gross_revenue", "discount", "shipping_revenue", "product_cost",
                 "shipping_cost", "returned_amount", "currency"]
EMAIL_EVENT_COLUMNS = ["event_id", "email_hash", "customer_id", "event_type",
                       "occurred_at", "campaign_type", "message_id"]
TICKET_COLUMNS = ["ticket_id", "customer_id", "email_hash", "created_at", "theme",
                  "sentiment", "product_id", "status"]

FIRST_NAMES = ["Mara", "Jonas", "Lena", "Tomas", "Sofia", "Nils", "Ida", "Kai",
               "Petra", "Lukas", "Anouk", "Bram", "Elin", "Ravi", "Yuki", "Mateo",
               "Freya", "Oskar", "Nadia", "Timo", "Alma", "Boris", "Cleo", "Dario"]
COUNTRIES = ["DE", "AT", "NL", "BE", "LU"]
COUNTRY_LANG = {"DE": "de", "AT": "de", "NL": "nl", "BE": "nl", "LU": "de"}
LOYALTY = ["none", "none", "silver", "gold"]
TICKET_THEMES = ["delivery", "returns", "sizing", "compatibility", "warranty", "payment", "sustainability"]
SENTIMENTS = ["positive", "neutral", "negative"]
ORDER_CHANNELS = ["organic", "paid_search", "email", "affiliate", "direct", "social"]
EMAIL_TYPES = ["sent", "opened", "clicked", "unsubscribed"]
CAMPAIGN_TYPES = ["welcome", "newsletter", "win-back", "post-purchase", "promo"]

CUST_BASE = date(2024, 1, 1)


def _email_hash(rng: random.Random) -> str:
    return "eh_" + "".join(rng.choice("0123456789abcdef") for _ in range(10))


def build_customer_data(products: list[dict], rng: random.Random):
    """Deterministic customer/order/email/support layer with intentional identity
    messiness for the mini-CDP demo. All identifiers are synthetic; email_hash is
    a token (never a real address); names are fictional. No personal data."""
    price_by_id = {p["product_id"]: float(p["price"]) for p in products}
    margin_by_id = {p["product_id"]: float(p["margin_rate"]) for p in products}
    product_ids = list(price_by_id.keys())

    customers, orders, emails, tickets = [], [], [], []
    cust_n = order_n = evt_n = tkt_n = 0

    def new_customer_id():
        nonlocal cust_n; cust_n += 1; return f"C-{cust_n:05d}"

    # --- true people -------------------------------------------------------
    people = []
    for i in range(60):
        country = rng.choice(COUNTRIES)
        created = CUST_BASE + timedelta(days=rng.randint(0, 560))
        people.append({
            "name": rng.choice(FIRST_NAMES),
            "country": country,
            "language": COUNTRY_LANG[country],
            "created": created,
            "email_hash": _email_hash(rng),
            "newsletter": rng.random() < 0.6,
            "loyalty": rng.choice(LOYALTY),
            "consent_marketing": rng.random() < 0.7,
            "consent_personalization": rng.random() < 0.55,
            "orders": rng.randint(0, 6),
            "last_gap_days": rng.randint(2, 400),  # recency of last order
        })

    def emit_customer(p, *, email_hash=None, newsletter=None, country=None,
                      language=None, consent_marketing=None, consent_personalization=None):
        cid = new_customer_id()
        customers.append({
            "customer_id": cid,
            "email_hash": p["email_hash"] if email_hash is None else email_hash,
            "first_name": p["name"],
            "country": p["country"] if country is None else country,
            "language": p["language"] if language is None else language,
            "created_at": p["created"].isoformat(),
            "newsletter_opt_in": str(p["newsletter"] if newsletter is None else newsletter).lower(),
            "loyalty_tier": p["loyalty"],
            "consent_marketing": str(p["consent_marketing"] if consent_marketing is None else consent_marketing).lower(),
            "consent_personalization": str(p["consent_personalization"] if consent_personalization is None else consent_personalization).lower(),
        })
        return cid

    def add_orders(p, cid, count):
        for _ in range(count):
            gross = round(rng.uniform(45, 380), 2)
            prod = rng.choice(product_ids)
            margin = margin_by_id[prod]
            od = p["created"] + timedelta(days=rng.randint(0, 500))
            orders.append({
                "order_id": f"O-{(len(orders) + 1):05d}",
                "customer_id": cid,
                "order_date": od.isoformat(),
                "channel": rng.choice(ORDER_CHANNELS),
                "campaign_id": rng.choice(["", "", "C001", "C007", "C009"]),
                "gross_revenue": f"{gross:.2f}",
                "discount": f"{round(gross * rng.choice([0, 0, 0.05, 0.1]), 2):.2f}",
                "shipping_revenue": f"{rng.choice([0.0, 0.0, 4.90]):.2f}",
                "product_cost": f"{round(gross * (1 - margin), 2):.2f}",
                "shipping_cost": f"{round(rng.uniform(3, 6), 2):.2f}",
                "returned_amount": f"{(round(gross, 2) if rng.random() < 0.09 else 0.0):.2f}",
                "currency": CURRENCY,
            })

    def add_emails(p, cid, count, *, hash_only=False, id_only=False):
        for _ in range(count):
            evt = dict(zip(EMAIL_EVENT_COLUMNS, [""] * len(EMAIL_EVENT_COLUMNS)))
            nonlocal evt_n; evt_n += 1
            evt["event_id"] = f"E-{evt_n:06d}"
            evt["email_hash"] = "" if id_only else p["email_hash"]
            evt["customer_id"] = "" if hash_only else cid
            evt["event_type"] = rng.choice(EMAIL_TYPES)
            evt["occurred_at"] = _iso(EVENT_BASE + timedelta(days=rng.randint(-30, 40), hours=rng.randint(0, 20)))
            evt["campaign_type"] = rng.choice(CAMPAIGN_TYPES)
            evt["message_id"] = f"M-{rng.randint(1000, 9999)}"
            emails.append(evt)

    def add_ticket(p, cid, *, hash_only=False):
        nonlocal tkt_n; tkt_n += 1
        tickets.append({
            "ticket_id": f"T-{tkt_n:05d}",
            "customer_id": "" if hash_only else cid,
            "email_hash": p["email_hash"],
            "created_at": (p["created"] + timedelta(days=rng.randint(5, 480))).isoformat(),
            "theme": rng.choice(TICKET_THEMES),
            "sentiment": rng.choice(SENTIMENTS),
            "product_id": rng.choice(product_ids),
            "status": rng.choice(["open", "resolved", "resolved", "closed"]),
        })

    # --- emit each person's primary record + activity ----------------------
    for i, p in enumerate(people):
        cid = emit_customer(p)
        p["primary_id"] = cid
        add_orders(p, cid, p["orders"])
        add_emails(p, cid, rng.randint(0, 5))
        if rng.random() < 0.35:
            add_ticket(p, cid, hash_only=(rng.random() < 0.4))  # some tickets have no customer_id

        # Duplicate record: same email_hash, new customer_id, with a conflict.
        if i % 5 == 0:
            dup_id = emit_customer(
                p,
                newsletter=not p["newsletter"],                 # newsletter opt-in conflict
                country=rng.choice(COUNTRIES) if i % 10 == 0 else None,  # country inconsistency
                consent_marketing=not p["consent_marketing"] if i % 15 == 0 else None,  # consent conflict
            )
            p["duplicate_id"] = dup_id
            add_orders(p, dup_id, rng.randint(0, 2))            # orders spread across duplicate IDs
            add_emails(p, dup_id, rng.randint(0, 2))

    # --- near-duplicate decoys: DIFFERENT real people, same name+country ---
    # These must NOT auto-merge (weak evidence). Aggressive matching would merge
    # them (a false merge); balanced holds them for review.
    for i in range(8):
        base = people[i * 6]
        decoy = {
            "name": base["name"], "country": base["country"],
            "language": base["language"],
            "created": base["created"] + timedelta(days=rng.randint(1, 9)),
            "email_hash": _email_hash(rng),  # DIFFERENT hash — a different person
            "newsletter": rng.random() < 0.6, "loyalty": rng.choice(LOYALTY),
            "consent_marketing": rng.random() < 0.7,
            "consent_personalization": rng.random() < 0.55, "orders": rng.randint(1, 4),
            "last_gap_days": rng.randint(2, 300),
        }
        cid = emit_customer(decoy)
        decoy["primary_id"] = cid
        add_orders(decoy, cid, decoy["orders"])
        add_emails(decoy, cid, rng.randint(1, 3))

    return customers, orders, emails, tickets


def write_jsonl(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")


def main() -> None:
    # Independent RNG streams keep each dataset stable if others change size.
    products = build_products(random.Random(SEED))
    products_messy = inject_product_mess(products, random.Random(SEED + 1))
    campaigns = build_campaigns(random.Random(SEED + 2))
    campaigns_messy = inject_campaign_mess(campaigns, random.Random(SEED + 3))
    aff_clicks, web_events, conversions = build_events(products, random.Random(SEED + 4))
    cart_events = build_cart_events(products, random.Random(SEED + 5))
    customers, orders, email_events, tickets = build_customer_data(products, random.Random(SEED + 6))

    write_csv(CATALOG_DIR / "products-clean.csv", PRODUCT_COLUMNS, products)
    write_csv(CATALOG_DIR / "products-messy.csv", PRODUCT_COLUMNS, products_messy)
    write_csv(MARKETING_DIR / "campaigns-clean.csv", CAMPAIGN_COLUMNS, campaigns)
    write_csv(MARKETING_DIR / "campaigns-messy.csv", CAMPAIGN_COLUMNS, campaigns_messy)
    write_content_docs()
    write_jsonl(EVENTS_DIR / "affiliate-clicks.jsonl", aff_clicks)
    write_jsonl(EVENTS_DIR / "web-events.jsonl", web_events)
    write_jsonl(EVENTS_DIR / "conversions.jsonl", conversions)
    write_jsonl(EVENTS_DIR / "cart-events.jsonl", cart_events)
    write_csv(CUSTOMERS_DIR / "customers.csv", CUSTOMER_COLUMNS, customers)
    write_csv(CUSTOMERS_DIR / "orders.csv", ORDER_COLUMNS, orders)
    write_csv(CUSTOMERS_DIR / "email-events.csv", EMAIL_EVENT_COLUMNS, email_events)
    write_csv(CUSTOMERS_DIR / "support-tickets.csv", TICKET_COLUMNS, tickets)

    print(f"products-clean.csv       {len(products):>4} rows")
    print(f"products-messy.csv       {len(products_messy):>4} rows")
    print(f"campaigns-clean.csv      {len(campaigns):>4} rows")
    print(f"campaigns-messy.csv      {len(campaigns_messy):>4} rows")
    print(f"content docs             {len(CONTENT_DOCS):>4} files")
    print(f"affiliate-clicks.jsonl   {len(aff_clicks):>4} rows")
    print(f"web-events.jsonl         {len(web_events):>4} rows")
    print(f"conversions.jsonl        {len(conversions):>4} rows")
    print(f"cart-events.jsonl        {len(cart_events):>4} rows")
    print(f"customers.csv            {len(customers):>4} rows")
    print(f"orders.csv               {len(orders):>4} rows")
    print(f"email-events.csv         {len(email_events):>4} rows")
    print(f"support-tickets.csv      {len(tickets):>4} rows")


if __name__ == "__main__":
    main()
