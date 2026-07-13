# Growth Engineering Playbook

Live, runnable e-commerce growth engineering demos: experimentation, tracking, AI workflows, automation, RAG, affiliate attribution, customer data, lifecycle growth, and static web infrastructure.

**Live portfolio:** [aaronwest.de/portfolio.html](https://aaronwest.de/portfolio.html)

This repo is a portfolio of small, inspectable tools that connect commercial growth problems with technical implementation. Each use case includes sample data, a screenshot or GIF, one-command setup, and links to the articles explaining the thinking behind it.

Role signal: senior e-commerce / marketing technology work, focused on turning messy growth problems into maintainable systems.

## What This Proves

- **Measurement judgment:** knowing when a metric, A/B test, or attribution report is not trustworthy enough to act on.
- **Operational data craft:** turning messy product, campaign, and customer data into usable inputs.
- **Practical AI use:** using LLMs, RAG, guardrails, and local models where they reduce workflow friction.
- **Automation discipline:** designing for retries, failure paths, and human approval instead of happy-path demos.
- **Web stack literacy:** explaining simple, low-cost infrastructure in a way non-engineers can still reason about.

## Use Cases

Wave 1 (experimentation, tracking, AI, automation, infrastructure) and Wave 2 (customer data & lifecycle growth) are complete. Wave 3 is underway with content and SEO for the AI era. Every tool ships with source code, a screenshot, a smoke test, and a GitHub Pages demo.

| # | Demo | Status | What it demonstrates |
|---|------|--------|----------------------|
| 1 | [`ab-test-analyzer`](01-ab-test-analyzer) | [Live demo](https://aaronwest-repo.github.io/growth-engineering-playbook/01-ab-test-analyzer/) | Why many A/B tests are inconclusive, and how to reason about power, confidence, and sample size |
| 2 | [`utm-audit-dashboard`](02-utm-audit-dashboard) | [Live demo](https://aaronwest-repo.github.io/growth-engineering-playbook/02-utm-audit-dashboard/) | UTM hygiene, campaign-data cleanup, and profit-based marketing metrics |
| 3 | [`product-data-cleaner`](03-product-data-cleaner) | [Live demo](https://aaronwest-repo.github.io/growth-engineering-playbook/03-product-data-cleaner/) | Catalog normalization, AI-assisted enrichment, confidence flags, and feed exports |
| 4 | [`product-description-generator`](04-product-description-generator) | [Live demo](https://aaronwest-repo.github.io/growth-engineering-playbook/04-product-description-generator/) | AI product copy with brand voice, banned claims, length limits, and hallucination checks |
| 5 | [`rag-product-chatbot`](05-rag-product-chatbot) | [Live demo](https://aaronwest-repo.github.io/growth-engineering-playbook/05-rag-product-chatbot/) | RAG chatbot architecture with citations, refusal behavior, and intent routing |
| 6 | [`affiliate-tracking-simulator`](06-affiliate-tracking-simulator) | [Live demo](https://aaronwest-repo.github.io/growth-engineering-playbook/06-affiliate-tracking-simulator/) (flagship) | Click tracking, cookies, attribution, deduplication, validation, and fraud patterns |
| 7 | [`cart-recovery-automation`](07-cart-recovery-automation) | [Live demo](https://aaronwest-repo.github.io/growth-engineering-playbook/07-cart-recovery-automation/) | Event-driven automation with queueing, retries, email templates, and human approval gates |
| 8 | [`static-commerce-stack`](08-static-commerce-stack) | [Live demo](https://aaronwest-repo.github.io/growth-engineering-playbook/08-static-commerce-stack/) | Static-site deployment with S3-style storage, CDN invalidation, and cache trade-offs |
| 9 | [`mini-cdp-identity-resolution`](09-mini-cdp-identity-resolution) | [Live demo](https://aaronwest-repo.github.io/growth-engineering-playbook/09-mini-cdp-identity-resolution/) | Customer identity resolution: confidence scoring, consent boundaries, false-merge risk, and segment-ready profiles |
| 10 | [`rfm-segmentation-dashboard`](10-rfm-segmentation-dashboard) | [Live demo](https://aaronwest-repo.github.io/growth-engineering-playbook/10-rfm-segmentation-dashboard/) | RFM scoring as a decision layer: return-adjusted value, consent/suppression eligibility, segment explanations, and campaign recommendations |
| 11 | [`lifecycle-campaign-planner`](11-lifecycle-campaign-planner) | [Live demo](https://aaronwest-repo.github.io/growth-engineering-playbook/11-lifecycle-campaign-planner/) | Segment-to-campaign planning: eligibility, suppression, holdouts, margin-aware incentives, timing, measurement, and risk controls |
| 12 | [`customer-support-insight-miner`](12-customer-support-insight-miner) | [Live demo](https://aaronwest-repo.github.io/growth-engineering-playbook/12-customer-support-insight-miner/) | Support tickets as customer intelligence: theme clusters, category friction, content gaps, support-risk customers, automation candidates, and an action queue |
| 13 | [`recommendation-rules-engine`](13-recommendation-rules-engine) | [Live demo](https://aaronwest-repo.github.io/growth-engineering-playbook/13-recommendation-rules-engine/) | Governed product recommendations: blended strategies, business guardrails (in-stock, margin floor, return-risk suppression, diversity), and per-slot explainability |
| 14 | [`free-shipping-threshold-calculator`](14-free-shipping-threshold-calculator) | [Live demo](https://aaronwest-repo.github.io/growth-engineering-playbook/14-free-shipping-threshold-calculator/) | Margin-aware free-shipping threshold: models subsidy, basket nudging, and conversion lift; break-even analysis and revenue-vs-contribution truth-telling |
| 15 | [`geo-content-checker`](15-geo-content-checker) | [Live demo](https://aaronwest-repo.github.io/growth-engineering-playbook/15-geo-content-checker/) | Answer-engine (AEO) content audit: answer-first structure, extractable definitions, quotable sentences, schema hints, and the sentences an AI would quote |
| 16 | [`schema-markup-generator`](16-schema-markup-generator) | [Live demo](https://aaronwest-repo.github.io/growth-engineering-playbook/16-schema-markup-generator/) | JSON-LD generator + validator (Product/Article/FAQ/Breadcrumb/Organization): required vs recommended fields, format/enum linting, and rich-result eligibility from clean or messy data |
| 17 | [`seo-tech-auditor`](17-seo-tech-auditor) | [Live demo](https://aaronwest-repo.github.io/growth-engineering-playbook/17-seo-tech-auditor/) | Technical-SEO crawl audit: broken links, redirect chains, canonical/title/meta issues, noindex on key pages, orphan pages, and missing schema — scored and prioritised by severity |
| 18 | [`internal-linking-optimizer`](18-internal-linking-optimizer) | Demo-ready | Topical-authority link graph: topic clustering, pillar/orphan detection, and specific from→to internal-link recommendations with a reason and keyword-overlap strength |

## Run Philosophy

Every demo should run from a fresh clone with one command and no paid service requirement. AI demos default to local models via Ollama, with optional OpenAI-compatible configuration where useful. Where a local model would slow down review, demos include cached/mock output so the workflow remains inspectable.

Every shipped use case includes a Mermaid diagram, a business-impact note, a screenshot/GIF, a smoke test, and a concrete trade-offs section explaining what would change at production scale.

## Writing

The articles behind these demos live at [aaronwest.de/blog](https://aaronwest.de/blog). Each shipped use case links to the relevant article cluster, and each article links back to the runnable demo.
