// Demo articles for the GEO/AEO content checker. Invented, generic e-commerce
// content — no real brands, clients, or personal data. Deliberately varied so the
// audit visibly discriminates: one answer-engine-ready, one poorly structured,
// one how-to, one thin product page.

export const SAMPLES = [
  {
    id: "aeo-strong",
    title: "What Is Answer Engine Optimization? (strong example)",
    text: `# What Is Answer Engine Optimization?

Answer engine optimization (AEO) is the practice of structuring content so AI systems like Google's AI Overviews, ChatGPT, and Perplexity can extract, quote, and cite it. It is the successor to classic SEO for a world where the answer, not the link, is the destination.

## How is AEO different from SEO?

SEO optimizes to rank a page; AEO optimizes to be the quoted answer. Traditional SEO rewards keywords, backlinks, and dwell time. AEO rewards extractability: a clear definition, an answer-first structure, and self-contained sentences a model can lift without the surrounding page.

## What makes content quotable?

A quotable sentence stands on its own. It is 8 to 30 words, states one fact, and avoids opening with "this" or "it". Concrete numbers help: pages with specific figures are cited roughly 30% more often than vague ones.

## How do you structure a page for answer engines?

Lead with a one-sentence answer under the heading. Use question-shaped subheadings that mirror how people ask. Keep paragraphs under 60 words. Add FAQ and HowTo structured data so the machine can map questions to answers.

## Which schema types matter for AEO?

Article schema exposes the headline and author. FAQPage maps questions to answers. HowTo exposes steps. DefinedTerm makes a definition citable.`,
  },
  {
    id: "aeo-weak",
    title: "Our Thoughts On Shipping (weak example)",
    text: `# Our Thoughts On Shipping

When it comes to the topic of shipping and the broader logistics landscape that surrounds the modern direct-to-consumer commerce experience, there are honestly so many different angles and perspectives and considerations that a brand really has to sit down and think very carefully about before making any sort of decision, and in this post we wanted to take some time to walk through some of the general vibes and feelings we have developed over the years as a team that cares deeply about the journey our customers go on from the moment they land on our homepage all the way through to the eventual unboxing moment which as everyone knows is really the emotional peak of the whole thing. It is something we think about a lot. We really do.

## Background

This is where it all started for us and it has been quite a ride if we are being honest about the whole situation and how it has evolved.

## More Details

They say that logistics is hard and honestly they are not wrong about that at all, and it continues to be something that occupies our thinking.`,
  },
  {
    id: "howto",
    title: "How to Set a Free-Shipping Threshold (how-to example)",
    text: `# How to Set a Free-Shipping Threshold

A free-shipping threshold is the basket value above which you offer free shipping. Set it from your basket distribution and margin, not a round number.

## Why does the threshold matter?

The threshold decides who you subsidize and who nudges their basket up. Set it too low and you give away shipping on orders you would have won anyway.

## How do you calculate it?

1. Find your average order value and median basket.
2. Measure your contribution margin per order.
3. Set the threshold slightly above the dense middle of your baskets.
4. Check the break-even conversion lift before you commit.

The recommended threshold is usually 10% to 25% above the median basket. For a store with a €185 median, a €150 to €200 threshold is a common starting range.`,
  },
  {
    id: "thin-product",
    title: "Aurora Shell Jacket (thin product page)",
    text: `# Aurora Shell Jacket

This is a great jacket. It is really nice and you will love it. It works well and it is very good for many situations. Buy it today.

Available now.`,
  },
];
