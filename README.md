# Growth Engineering Playbook

Runnable e-commerce growth engineering demos: experimentation, tracking, AI workflows, automation, RAG, affiliate attribution, and static web infrastructure.

This repo is a portfolio of small, inspectable tools that connect commercial growth problems with technical implementation. Each use case includes sample data, a screenshot or GIF, one-command setup, and links to the articles explaining the thinking behind it.

Role signal: senior e-commerce / marketing technology work, focused on turning messy growth problems into maintainable systems.

## What This Proves

- **Measurement judgment:** knowing when a metric, A/B test, or attribution report is not trustworthy enough to act on.
- **Operational data craft:** turning messy product, campaign, and customer data into usable inputs.
- **Practical AI use:** using LLMs, RAG, guardrails, and local models where they reduce workflow friction.
- **Automation discipline:** designing for retries, failure paths, and human approval instead of happy-path demos.
- **Web stack literacy:** explaining simple, low-cost infrastructure in a way non-engineers can still reason about.

## Use Cases

| # | Demo | Status | What it demonstrates |
|---|------|--------|----------------------|
| 1 | [`ab-test-analyzer`](01-ab-test-analyzer) | [Live demo](https://aaronwest-repo.github.io/growth-engineering-playbook/01-ab-test-analyzer/) | Why many A/B tests are inconclusive, and how to reason about power, confidence, and sample size |
| 2 | [`utm-audit-dashboard`](02-utm-audit-dashboard) | [Live demo](https://aaronwest-repo.github.io/growth-engineering-playbook/02-utm-audit-dashboard/) | UTM hygiene, campaign-data cleanup, and profit-based marketing metrics |
| 3 | [`product-data-cleaner`](03-product-data-cleaner) | [Live demo](https://aaronwest-repo.github.io/growth-engineering-playbook/03-product-data-cleaner/) | Catalog normalization, AI-assisted enrichment, confidence flags, and feed exports |
| 4 | [`product-description-generator`](04-product-description-generator) | [Live demo](https://aaronwest-repo.github.io/growth-engineering-playbook/04-product-description-generator/) | AI product copy with brand voice, banned claims, length limits, and hallucination checks |
| 5 | [`rag-product-chatbot`](05-rag-product-chatbot) | [Live demo](https://aaronwest-repo.github.io/growth-engineering-playbook/05-rag-product-chatbot/) | RAG chatbot architecture with citations, refusal behavior, and intent routing |
| 6 | `affiliate-tracking-simulator` | Planned flagship | Click tracking, cookies, attribution, deduplication, validation, and fraud patterns |
| 7 | `cart-recovery-automation` | Planned | Event-driven automation with queueing, retries, email templates, and human approval gates |
| 8 | `static-commerce-stack` | Planned | Static-site deployment with S3-style storage, CDN invalidation, and cache trade-offs |

## Run Philosophy

Every demo should run from a fresh clone with one command and no paid service requirement. AI demos default to local models via Ollama, with optional OpenAI-compatible configuration where useful. Where a local model would slow down review, demos include cached/mock output so the workflow remains inspectable.

Every shipped use case includes a Mermaid diagram, a business-impact note, a screenshot/GIF, a smoke test, and a concrete trade-offs section explaining what would change at production scale.

## Writing

The articles behind these demos live at [aaronwest.de/blog](https://aaronwest.de/blog). Each shipped use case links to the relevant article cluster, and each article links back to the runnable demo.
