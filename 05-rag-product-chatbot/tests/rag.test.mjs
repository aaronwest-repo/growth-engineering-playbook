import { readFileSync } from "node:fs";
import { readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  answerQuestion,
  buildCorpus,
  parseCsv,
  parseMarkdownDoc,
  retrieve,
  routeIntent,
  tokenize,
} from "../rag.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
let failures = 0;

function ok(condition, message) {
  if (!condition) {
    failures++;
    console.error(`FAIL ${message}`);
  } else {
    console.log(`  ok   ${message}`);
  }
}

function loadFixtureCorpus() {
  const root = resolve(__dirname, "../..");
  const products = parseCsv(readFileSync(resolve(root, "shared-data/catalog/products-clean.csv"), "utf8"));
  const contentDir = resolve(root, "shared-data/content");
  const docs = readdirSync(contentDir)
    .filter((name) => name.endsWith(".md"))
    .sort()
    .map((fileName) => ({
      fileName,
      text: readFileSync(resolve(contentDir, fileName), "utf8"),
    }));
  return { products, docs, corpus: buildCorpus(products, docs) };
}

const { products, docs, corpus } = loadFixtureCorpus();

ok(products.length === 46, "loads 46 catalog products");
ok(docs.length === 6, "loads 6 content documents");
ok(corpus.length > 55, "corpus includes product chunks and policy chunks");
ok(tokenize("What is the return window?").includes("return"), "tokenizer keeps meaningful words");

const faqChunks = parseMarkdownDoc("faq.md", docs.find((d) => d.fileName === "faq.md").text);
ok(faqChunks.some((c) => c.title === "Support boundaries"), "markdown parser creates section chunks");

const jacketHits = retrieve(corpus, "Aurora Shell Jacket waterproof shipping", 4);
ok(jacketHits.some((h) => h.title.includes("Aurora Shell Jacket")), "retrieval includes named product");
ok(jacketHits.some((h) => h.source === "shipping-policy.md"), "retrieval brings in shipping policy");

const orderRoute = routeIntent("Where is my order and tracking number?");
ok(orderRoute.intent === "order_status", "order tracking routes to transactional intent");
const productRoute = routeIntent("Can I return the Aurora Shell Jacket?");
ok(productRoute.intent === "knowledge_answer", "product support routes to knowledge answer");
const unknownRoute = routeIntent("Write a poem about mountains");
ok(unknownRoute.intent === "unknown", "unrelated query is unknown intent");

const orderAnswer = answerQuestion(corpus, "Where is my order?");
ok(orderAnswer.mode === "intent", "order status answer uses intent mode");
ok(orderAnswer.answer.includes("cannot access live orders"), "order status does not pretend to check systems");
ok(orderAnswer.citations.some((c) => c.source === "faq.md"), "order status cites support boundary");

const answer = answerQuestion(corpus, "Can I return the Aurora Shell Jacket and how long is shipping?");
ok(answer.mode === "rag", "product and policy question gets RAG answer");
ok(answer.answer.includes("Aurora Shell Jacket"), "answer includes grounded product name");
ok(answer.answer.includes("30 days"), "answer includes return window");
ok(answer.answer.includes("2 to 4 business days"), "answer includes shipping estimate");
ok(answer.citations.some((c) => c.source === "products-clean.csv"), "answer cites product source");
ok(answer.citations.some((c) => c.source === "returns-policy.md"), "answer cites returns policy");
ok(answer.citations.some((c) => c.source === "shipping-policy.md"), "answer cites shipping policy");

const sustainability = answerQuestion(corpus, "Is the Fjord Rain Jacket sustainable?");
ok(sustainability.mode === "rag", "sustainability question answers from corpus");
ok(sustainability.answer.includes("do not infer certifications") || sustainability.answer.includes("specific"), "sustainability answer is careful");
ok(!/carbon neutral|certified|plastic-free/i.test(sustainability.answer), "sustainability answer does not invent claims");

const refusal = answerQuestion(corpus, "Can you recommend a mountain tent with solar charging?");
ok(refusal.mode === "refusal", "out-of-corpus product question refuses");
ok(refusal.answer.includes("do not have enough grounded information"), "refusal explains grounding limit");

const warranty = answerQuestion(corpus, "Is this guaranteed for life under warranty?");
ok(warranty.mode === "rag", "warranty question answers from policy");
ok(!/guaranteed for life/i.test(warranty.answer), "warranty answer avoids unsupported lifetime guarantee");
ok(warranty.citations.some((c) => c.source === "warranty-policy.md"), "warranty answer cites warranty policy");

if (failures) {
  console.error(`\nrag.test: ${failures} failure(s)`);
  process.exit(1);
}
console.log("\nrag.test: all checks passed");
