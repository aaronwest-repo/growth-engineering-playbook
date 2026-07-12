# Shared Data

One invented e-commerce data universe — **Northstar Outfitters**, a fictional
outdoor/lifestyle store — reused across the portfolio so every use case draws
from the same consistent, reproducible sample instead of inventing its own.

Everything here is fictional. No real customers, orders, brands, employers,
clients, or personal information. GTINs, URLs (`*.example`), and metrics are
all invented.

## What exists now

```text
shared-data/
├── README.md
├── DATA_NOTES.md              # what is intentionally messy, and why
├── catalog/
│   ├── products-clean.csv     # canonical product catalog (answer key)
│   └── products-messy.csv     # same products with realistic data-quality defects
└── marketing/
    ├── campaigns-clean.csv     # canonical daily campaign metrics
    └── campaigns-messy.csv     # same rows with inconsistent UTM tagging
└── content/
│   ├── faq.md
│   ├── returns-policy.md
│   ├── shipping-policy.md
│   ├── size-guide.md
│   ├── sustainability-policy.md
│   └── warranty-policy.md      # small RAG corpus for chatbot demos
└── events/
    ├── affiliate-clicks.jsonl  # invented affiliate click log
    ├── web-events.jsonl        # invented on-site touchpoints (view/cart/purchase)
    ├── conversions.jsonl       # invented orders with attribution/validation labels
    └── cart-events.jsonl       # invented abandoned carts for the recovery workflow
└── customers/
    ├── customers.csv           # invented customer profiles (with duplicate identities)
    ├── orders.csv              # invented orders linked to customers
    ├── email-events.csv        # invented email sends/opens/clicks/unsubscribes
    └── support-tickets.csv     # invented support tickets (themes, sentiment)
```

Customers and expanded feed samples are added by later use cases when they need
them.

## Regenerate

The CSVs are **generated, never hand-edited**. Everything comes from a fixed
seed, so output is byte-for-byte reproducible.

```bash
python scripts/generate-shared-data.py
```

## Validate

```bash
python scripts/validate-shared-data.py
```

Clean files are strictly checked (types, ranges, allowed values, referential
integrity, metric consistency). Messy files are checked structurally and must
still reconcile by ID against the clean files. CI runs both the regeneration
check and validation on every push and pull request.

## Current dataset

| File | Rows | Notes |
|------|------|-------|
| `catalog/products-clean.csv` | 46 products | 7 categories, size variants, EUR pricing |
| `catalog/products-messy.csv` | 46 products | injected catalog defects (see `DATA_NOTES.md`) |
| `marketing/campaigns-clean.csv` | 232 rows | 9 campaigns × 28 days, canonical UTMs |
| `marketing/campaigns-messy.csv` | 232 rows | same data with inconsistent UTM tagging |
| `content/*.md` | 6 docs | FAQ, shipping, returns, warranty, size guide, sustainability policy |
| `events/affiliate-clicks.jsonl` | 263 rows | invented affiliate clicks (5 publishers, incl. a suspicious one) |
| `events/web-events.jsonl` | 943 rows | invented on-site touchpoints across channels |
| `events/conversions.jsonl` | 206 rows | invented orders with attribution + validation labels |
| `events/cart-events.jsonl` | 120 rows | invented abandoned carts (consent, recover propensity, provider-error seed) |
| `customers/customers.csv` | 80 rows | invented profiles incl. 12 duplicate-identity pairs (same email_hash, conflicting opt-in/consent) |
| `customers/orders.csv` | 195 rows | invented orders linked to customers |
| `customers/email-events.csv` | 176 rows | email sends/opens/clicks/unsubscribes (some hash-only or id-only) |
| `customers/support-tickets.csv` | 18 rows | support tickets (themes, sentiment; some without customer_id) |

See [DATA_NOTES.md](DATA_NOTES.md) for the intentional messiness catalogue.
