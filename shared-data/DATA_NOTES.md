# Data Notes

This file documents the shared-data universe and, crucially, the **intentional
messiness** in the `*-messy.csv` files. The mess is the point: several use cases
exist to detect and fix exactly these problems. The `*-clean.csv` files are the
canonical answer key the messy versions are derived from.

## Store universe

- **Store:** Northstar Outfitters (fictional outdoor/lifestyle retailer).
- **Currency:** EUR. English-first, with German title/description fields for
  multilingual and catalog demos.
- **Brands:** all invented (`Northstar`, `Aurora Gear`, `TrailForge`,
  `Voyager Co`, `Summit Line`, `Fjordkit`, `HydraSteel`, `Nomad Co`).
- **Categories:** Jackets, Shoes, Backpacks, Outdoor accessories, Base layers,
  Reusable bottles, Travel gear.

## Determinism

All files are produced by `scripts/generate-shared-data.py` from a fixed seed
(`SEED = 42`). Re-running the generator reproduces the exact same bytes. Do not
hand-edit the CSVs; change the generator and regenerate. CI enforces that the
committed files match the generator output.

## Catalog

`products-clean.csv` — 46 products across the 7 categories. Apparel and shoes
use `parent_id` to group size variants: the first variant of a model has an
empty `parent_id` and later variants reference it. Every clean row has valid
types, an allowed category/availability/condition, a 13-digit GTIN, and a
positive price/weight.

### Intentional defects in `products-messy.csv`

`product_id` values are preserved so the messy catalog reconciles with the clean
answer key. Injected issues:

| Defect | What to expect |
|--------|----------------|
| Mixed brand casing | `AURORA GEAR`, `aurora gear`, `Aurora Gear` |
| Mixed category casing + padding | `jackets`, `" JACKETS "` with surrounding spaces |
| Missing GTINs | empty `gtin` on a subset |
| HTML in descriptions | `<p>`, `<b>`, `<br/>` fragments in `description_en` |
| Language bleed | English text left in the `description_de` column |
| Inconsistent sizes | `M` → `Medium` / `med` / `m`; `EU 43` → `43` |
| Missing attributes | empty `material` and/or `color` |
| Over-claimed copy | "100% waterproof forever, guaranteed for life", etc. — for the description-generator use case (#4) to flag |
| Localized price strings | `"€179,00"` instead of `179.00` |
| Blank stock | empty `stock` on a subset |
| Near-duplicate SKU | one product reuses another product's `sku` |

## Marketing

`campaigns-clean.csv` — daily rows for 9 campaigns over 28 days (2025-01-01 to
2025-01-28). Sources span paid search (Google, Bing), paid social (Facebook,
Instagram), email (newsletter, twice weekly), and affiliate. Metrics are
internally consistent: `sessions ≤ clicks`, `orders ≤ sessions`,
`new_customers ≤ orders`, `gross_margin ≤ revenue`. Affiliate spend is modelled
as commission on revenue; email spend as a small fixed tooling cost. Campaigns
include branded vs non-branded search and a campaign name reused across two
sources — realistic situations a UTM audit must handle.

### Intentional defects in `campaigns-messy.csv`

`campaign_id` is kept intact so rows still join to the clean set (the answer
key), while the UTM tagging is dirtied the way real analytics exports are:

| Defect | What to expect |
|--------|----------------|
| Source aliasing | `facebook` / `Facebook` / `fb` / `meta`; `google` / `Google` |
| Medium inconsistency | `cpc` / `CPC` / `ppc`; `paid-social` / `Paid Social` / `paid social` / `social` |
| Missing campaign | empty `campaign` on a subset |
| Casing / whitespace | Title Case, leading/trailing spaces, `UPPERCASE` |
| Separator drift | spaces instead of hyphens (`generic hiking jackets`) |

The numeric columns are left untouched in the messy file, so a UTM-audit demo
(#2) can show that normalizing the tagging recovers spend/revenue that would
otherwise be split across inconsistent labels.

## Guarantees for downstream use cases

- Clean files pass strict validation (`scripts/validate-shared-data.py`).
- Every messy `product_id` / `campaign_id` exists in the corresponding clean
  file, so messy → clean is always joinable.
- No real personal data, secrets, or production identifiers anywhere.
