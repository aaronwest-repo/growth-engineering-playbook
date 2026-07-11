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
import random
from datetime import date, timedelta
from pathlib import Path

SEED = 42
CURRENCY = "EUR"
ROOT = Path(__file__).resolve().parent.parent
CATALOG_DIR = ROOT / "shared-data" / "catalog"
MARKETING_DIR = ROOT / "shared-data" / "marketing"

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


def main() -> None:
    # Independent RNG streams keep each dataset stable if others change size.
    products = build_products(random.Random(SEED))
    products_messy = inject_product_mess(products, random.Random(SEED + 1))
    campaigns = build_campaigns(random.Random(SEED + 2))
    campaigns_messy = inject_campaign_mess(campaigns, random.Random(SEED + 3))

    write_csv(CATALOG_DIR / "products-clean.csv", PRODUCT_COLUMNS, products)
    write_csv(CATALOG_DIR / "products-messy.csv", PRODUCT_COLUMNS, products_messy)
    write_csv(MARKETING_DIR / "campaigns-clean.csv", CAMPAIGN_COLUMNS, campaigns)
    write_csv(MARKETING_DIR / "campaigns-messy.csv", CAMPAIGN_COLUMNS, campaigns_messy)

    print(f"products-clean.csv    {len(products):>4} rows")
    print(f"products-messy.csv    {len(products_messy):>4} rows")
    print(f"campaigns-clean.csv   {len(campaigns):>4} rows")
    print(f"campaigns-messy.csv   {len(campaigns_messy):>4} rows")


if __name__ == "__main__":
    main()
