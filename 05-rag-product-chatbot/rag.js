// Deterministic RAG core for the product/support chatbot demo.
//
// This intentionally does not call a model. It demonstrates the production
// architecture pieces that matter for a portfolio review: corpus construction,
// retrieval, citations, intent routing, refusal behavior, and grounded answers.

// --- CSV / corpus parsing --------------------------------------------------
export function parseCsv(text) {
  const rows = [];
  let field = "";
  let record = [];
  let inQuotes = false;
  const pushField = () => { record.push(field); field = ""; };
  const pushRecord = () => { rows.push(record); record = []; };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      pushField();
    } else if (c === "\n") {
      pushField(); pushRecord();
    } else if (c !== "\r") {
      field += c;
    }
  }
  if (field.length > 0 || record.length > 0) { pushField(); pushRecord(); }

  const rawRows = rows.filter((r) => r.length > 1 || (r.length === 1 && r[0] !== ""));
  if (!rawRows.length) return [];
  const header = rawRows[0].map((h) => h.trim());
  return rawRows.slice(1).map((cells) => {
    const obj = {};
    header.forEach((h, i) => { obj[h] = cells[i] !== undefined ? cells[i] : ""; });
    return obj;
  });
}

export function parseMarkdownDoc(fileName, text) {
  const lines = String(text || "").split(/\r?\n/);
  const title = lines.find((line) => line.startsWith("# "))?.replace(/^#\s+/, "").trim() || fileName;
  const chunks = [];
  let heading = title;
  let buffer = [];

  const flush = () => {
    const body = buffer.join(" ").replace(/\s+/g, " ").trim();
    if (body) {
      chunks.push({
        id: `${fileName}#${slugify(heading)}`,
        type: "policy",
        source: fileName,
        title: heading,
        text: body,
      });
    }
    buffer = [];
  };

  for (const line of lines) {
    if (line.startsWith("## ")) {
      flush();
      heading = line.replace(/^##\s+/, "").trim();
    } else if (!line.startsWith("# ")) {
      buffer.push(line.trim());
    }
  }
  flush();
  return chunks;
}

export function buildCorpus(products, docs) {
  const productChunks = products.map((p) => ({
    id: `product:${p.sku}`,
    type: "product",
    source: "products-clean.csv",
    title: `${p.title_en} (${p.sku})`,
    product: p,
    text: [
      p.title_en,
      p.title_de,
      p.brand,
      p.category,
      p.size,
      p.color,
      p.material,
      `${p.price} ${p.currency}`,
      p.description_en,
      p.description_de,
      `availability ${p.availability}`,
      `stock ${p.stock}`,
      `sku ${p.sku}`,
      `gtin ${p.gtin}`,
    ].join(" "),
  }));

  const docChunks = docs.flatMap((doc) => parseMarkdownDoc(doc.fileName, doc.text));
  return [...productChunks, ...docChunks].map((chunk) => ({
    ...chunk,
    tokens: tokenize(`${chunk.title} ${chunk.text}`),
  }));
}

// --- Retrieval -------------------------------------------------------------
const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "can", "do", "for", "from",
  "how", "i", "in", "is", "it", "me", "my", "of", "on", "or", "the", "to",
  "what", "when", "where", "which", "with", "you", "your",
]);

const SYNONYMS = {
  delivery: ["shipping", "dispatch", "tracking"],
  ship: ["shipping", "delivery", "dispatch"],
  return: ["returns", "refund", "exchange"],
  refund: ["returns", "return"],
  waterproof: ["rain", "shell", "jacket"],
  size: ["fit", "sizes"],
  sustainable: ["sustainability", "recycled", "material"],
  eco: ["sustainability", "recycled", "material"],
  warranty: ["defect", "claim"],
  hiking: ["trail", "hiker"],
};

export function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

function expandTokens(tokens) {
  const expanded = new Set(tokens);
  for (const token of tokens) {
    for (const synonym of SYNONYMS[token] || []) expanded.add(synonym);
  }
  return [...expanded];
}

export function retrieve(corpus, query, limit = 4) {
  const queryTokens = expandTokens(tokenize(query));
  const querySet = new Set(queryTokens);
  const q = String(query || "").toLowerCase();
  const scored = corpus.map((chunk) => {
    const tokenSet = new Set(chunk.tokens);
    let score = 0;
    for (const token of querySet) {
      if (tokenSet.has(token)) score += token.length > 5 ? 2 : 1;
      if (chunk.title.toLowerCase().includes(token)) score += 2;
    }
    if (chunk.type === "product" && queryTokens.some((t) => chunk.product.sku.toLowerCase().includes(t))) score += 8;
    if (chunk.source === "shipping-policy.md" && /\b(shipping|delivery|ship|tracking)\b/.test(q)) score += 18;
    if (chunk.source === "returns-policy.md" && /\b(return|refund|exchange)\b/.test(q)) score += 18;
    if (chunk.source === "warranty-policy.md" && /\b(warranty|guarantee|defect)\b/.test(q)) score += 18;
    if (chunk.source === "size-guide.md" && /\b(size|fit|shoe|jacket)\b/.test(q)) score += 12;
    if (chunk.source === "sustainability-policy.md" && /\b(sustainable|sustainability|eco|recycled|material)\b/.test(q)) score += 18;
    return { ...chunk, score };
  }).filter((chunk) => chunk.score > 0);

  return scored.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, limit);
}

// --- Intent routing --------------------------------------------------------
export function routeIntent(query) {
  const q = String(query || "").toLowerCase();
  if (/\b(order|tracking|track|package|parcel|where is|delivery status|invoice|payment)\b/.test(q)) {
    return {
      intent: "order_status",
      confidence: 0.92,
      reason: "Order, payment, and tracking questions need transactional data, not generative answering.",
    };
  }
  if (/\b(return|refund|exchange|warranty|shipping|delivery|size|fit|sustainab|material|product|jacket|shoe|backpack|bottle)\b/.test(q)) {
    return {
      intent: "knowledge_answer",
      confidence: 0.78,
      reason: "Question can be answered from product and policy knowledge.",
    };
  }
  return {
    intent: "unknown",
    confidence: 0.34,
    reason: "No strong product, support, or transactional intent detected.",
  };
}

// --- Answering -------------------------------------------------------------
export function answerQuestion(corpus, query) {
  const route = routeIntent(query);
  if (route.intent === "order_status") {
    return {
      mode: "intent",
      intent: route,
      answer: "I cannot access live orders or tracking from this demo. In a production bot, this would route to an authenticated order-status workflow. Here, use the official order lookup flow with the order number and email address.",
      citations: [{ title: "Support boundaries", source: "faq.md", id: "faq.md#support-boundaries" }],
      retrieval: [],
      confidence: route.confidence,
    };
  }

  const retrieval = augmentWithRequiredPolicies(corpus, query, retrieve(corpus, query, 5));
  if (route.intent === "unknown" || !retrieval.length || retrieval[0].score < 3) {
    return {
      mode: "refusal",
      intent: route,
      answer: "I do not have enough grounded information in the catalog or policy corpus to answer that safely. Ask about a Northstar product, shipping, returns, warranty, sizing, or sustainability policy.",
      citations: [],
      retrieval,
      confidence: 0.24,
    };
  }

  const answer = synthesizeAnswer(query, retrieval);
  return {
    mode: "rag",
    intent: route,
    answer: answer.text,
    citations: answer.citations,
    retrieval,
    confidence: Math.min(0.94, 0.45 + retrieval[0].score / 20),
  };
}

function augmentWithRequiredPolicies(corpus, query, retrieval) {
  const q = String(query || "").toLowerCase();
  const needed = [];
  if (/\b(shipping|delivery|ship|tracking)\b/.test(q)) needed.push("shipping-policy.md");
  if (/\b(return|refund|exchange)\b/.test(q)) needed.push("returns-policy.md");
  if (/\b(warranty|guarantee|defect)\b/.test(q)) needed.push("warranty-policy.md");
  if (/\b(size|fit|shoe|jacket|larger|smaller)\b/.test(q)) needed.push("size-guide.md");
  if (/\b(sustainable|sustainability|eco|recycled|material)\b/.test(q)) needed.push("sustainability-policy.md");

  const merged = [...retrieval];
  for (const source of needed) {
    const preferredTitle = preferredPolicyTitle(source, q);
    if (!merged.some((chunk) => chunk.source === source && preferredTitle.test(chunk.title))) {
      const candidates = corpus.filter((chunk) => chunk.source === source);
      const candidate = candidates.find((chunk) => preferredTitle.test(chunk.title))
        || candidates.sort((a, b) => b.tokens.length - a.tokens.length)[0];
      if (candidate) merged.push({ ...candidate, score: Math.max(candidate.score || 0, 3) });
    }
  }
  return merged.slice(0, 8);
}

function preferredPolicyTitle(source, q) {
  if (source === "shipping-policy.md" && /\b(cost|free|fee)\b/.test(q)) return /shipping cost/i;
  if (source === "shipping-policy.md") return /delivery times/i;
  if (source === "returns-policy.md" && /\b(refund)\b/.test(q)) return /refund timing/i;
  if (source === "returns-policy.md") return /return window/i;
  if (source === "warranty-policy.md") return /coverage/i;
  if (source === "size-guide.md" && /\b(shoe|hiker|runner)\b/.test(q)) return /shoes/i;
  if (source === "size-guide.md") return /apparel/i;
  if (source === "sustainability-policy.md") return /claim limits/i;
  return /.*/;
}

function synthesizeAnswer(query, chunks) {
  const q = query.toLowerCase();
  const product = chunks.find((chunk) => chunk.type === "product")?.product;
  const policy = chunks.filter((chunk) => chunk.type === "policy");
  const citations = [];
  const lines = [];

  if (product) {
    citations.push(citationFor(chunks.find((chunk) => chunk.type === "product")));
    lines.push(`${product.title_en} is ${articleFor(product.brand)} ${product.brand} ${singularCategory(product.category)} in ${product.color}, size ${product.size}, made with ${product.material}. It is listed at ${product.price} ${product.currency} and is currently ${product.availability}.`);
  }

  if (/\b(shipping|delivery|ship|tracking)\b/.test(q)) {
    const shipping = pickPolicy(chunks, "shipping-policy.md", q);
    if (shipping) {
      citations.push(citationFor(shipping));
      lines.push("For shipping, Germany is usually 2 to 4 business days after dispatch; Austria, the Netherlands, Belgium, and Luxembourg are usually 3 to 6 business days. These are estimates, not guarantees.");
    }
  }

  if (/\b(return|refund|exchange)\b/.test(q)) {
    const returns = pickPolicy(chunks, "returns-policy.md", q);
    if (returns) {
      citations.push(citationFor(returns));
      lines.push("Unused products can be returned within 30 days of delivery. Refunds are processed after inspection, usually 5 to 8 business days after warehouse receipt.");
    }
  }

  if (/\b(warranty|guarantee|defect)\b/.test(q)) {
    const warranty = pickPolicy(chunks, "warranty-policy.md", q);
    if (warranty) {
      citations.push(citationFor(warranty));
      lines.push("The sample warranty covers manufacturing defects for 2 years, but the assistant should not promise approval or make lifetime-guarantee claims.");
    }
  }

  if (/\b(size|fit|shoe|jacket|larger|smaller)\b/.test(q)) {
    const sizeGuide = pickPolicy(chunks, "size-guide.md", q);
    if (sizeGuide) {
      citations.push(citationFor(sizeGuide));
      lines.push("For apparel, customers between sizes should choose larger for layering and smaller for a closer fit. Shoes in this sample use EU 41, EU 43, and EU 45.");
    }
  }

  if (/\b(sustainable|sustainability|eco|recycled|material)\b/.test(q)) {
    const sustainability = pickPolicy(chunks, "sustainability-policy.md", q);
    if (sustainability) {
      citations.push(citationFor(sustainability));
      lines.push("Sustainability wording should stay specific: only mention listed materials such as recycled polyester or recycled nylon, and do not infer certifications or broad environmental claims.");
    }
  }

  if (!lines.length && chunks[0]) {
    citations.push(citationFor(chunks[0]));
    lines.push(summaryFromChunk(chunks[0]));
  }

  return { text: dedupe(lines).join(" "), citations: dedupeCitations(citations).slice(0, 4) };
}

function pickPolicy(chunks, source, q) {
  const preferredTitle = preferredPolicyTitle(source, q);
  return chunks.find((chunk) => chunk.source === source && preferredTitle.test(chunk.title))
    || chunks.find((chunk) => chunk.source === source);
}

function summaryFromChunk(chunk) {
  if (chunk.type === "product") {
    const p = chunk.product;
    return `${p.title_en} is listed as ${p.availability}, priced at ${p.price} ${p.currency}, and made with ${p.material}.`;
  }
  return chunk.text.split(". ").slice(0, 2).join(". ") + ".";
}

function citationFor(chunk) {
  return {
    id: chunk.id,
    title: chunk.title,
    source: chunk.source,
  };
}

function dedupe(items) {
  return [...new Set(items.filter(Boolean))];
}

function dedupeCitations(citations) {
  const seen = new Set();
  return citations.filter((c) => {
    const key = `${c.source}:${c.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function articleFor(value) {
  return /^[aeiou]/i.test(String(value || "")) ? "an" : "a";
}

function singularCategory(value) {
  const category = String(value || "").toLowerCase();
  if (category === "shoes") return "shoe";
  if (category === "jackets") return "jacket";
  if (category === "backpacks") return "backpack";
  if (category === "base layers") return "base layer";
  if (category === "reusable bottles") return "bottle";
  if (category === "outdoor accessories") return "outdoor accessory";
  if (category === "travel gear") return "travel item";
  return category || "product";
}
