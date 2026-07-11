# Shared Data

One invented e-commerce data universe — **Northstar Outfitters**, a fictional
outdoor/lifestyle store — reused across the portfolio so every use case draws
from the same consistent, reproducible sample instead of inventing its own.

Everything here is fictional. No real customers, orders, brands, employers,
clients, or personal information. GTINs, URLs (`*.example`), and metrics are
all invented.

## What exists now (first scope: use cases #1 and #2)

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
```

Customers, orders, events, the RAG/chatbot corpus, and catalog feeds
(`products.json`, Google Shopping XML, affiliate feed) are added before use
cases #3 and #5.

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

See [DATA_NOTES.md](DATA_NOTES.md) for the intentional messiness catalogue.
