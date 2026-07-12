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

## Content Corpus

`content/*.md` is a compact support/product knowledge base for RAG and chatbot
demos. It includes:

- FAQ
- Shipping policy
- Returns policy
- Warranty policy
- Size guide
- Sustainability claims policy

The documents intentionally include boundaries a chatbot must respect:

| Boundary | What the assistant should do |
|----------|------------------------------|
| Live order tracking | Route to an order-status intent; do not pretend to access real orders |
| Delivery estimates | Answer from policy, but do not guarantee delivery dates |
| Warranty approval | Explain evidence needed; do not promise approval |
| Sustainability claims | Mention only listed materials; do not invent certifications |
| Missing product facts | Say the corpus does not confirm the fact |
| Out-of-corpus questions | Refuse or ask for a different product/support question |

## Event corpus (`events/`)

Deterministic affiliate event universe for the affiliate-tracking simulator
(use case #6), generated from the same seed and tied to the catalog:

- `affiliate-clicks.jsonl` — clicks from 5 invented publishers, incl. a
  deliberately suspicious one (`ClickFarmX`) with click bursts and cookie
  stuffing. Fields include `cookie_set`, `cookie_lost`, and `suspicious_flag`.
- `web-events.jsonl` — on-site touchpoints (affiliate click, product view, add
  to cart, checkout, purchase, competing campaign touches) across channels.
- `conversions.jsonl` — orders with `claimed_click_id`, `competing_channel`,
  `returned`, and a ground-truth `validation_status` + `validation_reason`.

Scenarios deliberately baked in (so the simulator has something to decide):

| Scenario | What it exercises |
|----------|-------------------|
| Varied click→conversion gaps (0–1 / 3–6 / 12–25 days) | Attribution-window control |
| Cookie-loss journeys | Undercounted (untracked) affiliate revenue |
| Conversions 34–55 days out | Outside-window rejection |
| Affiliate + later paid-search touch | Cross-channel dedup under different rules |
| Two publishers claiming one order | Duplicate-claim rejection |
| Returned orders | Commission clawback |
| ClickFarmX bursts + 40-second conversions | Fraud pattern flagging |
| Organic/paid/direct conversions | Non-affiliate baseline |

All IDs (visitor, session, click, order, publisher) are invented; timestamps
are synthetic; there is no personal data. The demo's simulator recomputes
attribution and validation from these raw facts — the stored
`validation_status` is a ground-truth label, not the final rule-dependent verdict.

`cart-events.jsonl` — 120 invented abandoned checkouts for the cart-recovery
workflow (use case #7). Each cart carries `cart_value`, `product_ids` (catalog
IDs), a `consent_status` (subscribed / unknown / unsubscribed), and workflow
seeds: `purchased_before_send`, `recovers_if_emailed`, `provider_error`, and
`succeeds_on_attempt`. `customer_ref` is a hashed-style token (e.g.
`cust_647555ef`), never an email. The recovery engine computes eligibility,
suppression, waits, sends, retries, and recovery live from these inputs — the
email sends and automation runs are outputs, not stored data.

## Customer layer (`customers/`)

Deterministic customer/order/email/support data for the mini-CDP identity
demo (use case #9). All identifiers are synthetic: `email_hash` is a token like
`eh_96d543f764` (never a real address), names are fictional first names, and
there is no personal data.

Intentional identity messiness baked in (so resolution has something to decide):

| Scenario | What it exercises |
|----------|-------------------|
| Same `email_hash` under two `customer_id`s (12 pairs) | Deterministic exact-match auto-merge |
| Duplicate rows with conflicting `newsletter_opt_in` / consent | Consent & opt-in conflict handling |
| Near-duplicate decoys (same first name + country, different hash) | False-merge risk — must hold for review, not auto-merge |
| Orders spread across a person's primary + duplicate IDs | Activity reattachment after merge |
| Email events / tickets with only `email_hash` (no `customer_id`) | Linking records with weak keys |
| Country / language inconsistencies across a person's rows | Attribute reconciliation |

`orders.csv` links to `customers.csv` by `customer_id`; `support-tickets.csv`
`product_id` references the catalog. The mini-CDP recomputes profiles,
confidence, merges, and consent boundaries live — merge outcomes are
rule-dependent, not stored.

## Guarantees for downstream use cases

- Clean files pass strict validation (`scripts/validate-shared-data.py`).
- Content documents exist and contain enough text for retrieval demos.
- Event files parse as JSONL with unique primary IDs, catalog-valid product IDs,
  known campaign IDs, parseable timestamps, and conversions that reference real
  click/visitor history.
- Every messy `product_id` / `campaign_id` exists in the corresponding clean
  file, so messy → clean is always joinable.
- No real personal data, secrets, or production identifiers anywhere.
