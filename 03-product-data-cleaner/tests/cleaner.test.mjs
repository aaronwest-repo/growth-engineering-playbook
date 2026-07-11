import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AFFILIATE_FEED_EXPORT_COLUMNS,
  GOOGLE_FEED_EXPORT_COLUMNS,
  cleanCatalog,
  googleFeedXml,
  parseCsv,
  toCsv,
} from "../cleaner.js";

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

const messyPath = resolve(__dirname, "../../shared-data/catalog/products-messy.csv");
const messy = parseCsv(readFileSync(messyPath, "utf8"));
const clean = cleanCatalog(messy);
const { summary, products, googleFeed, affiliateFeed } = clean;

ok(messy.length === 46, "46 messy catalog rows parsed");
ok(summary.rowCount === 46, "summary tracks 46 rows");
ok(summary.changedProducts >= 30, "most products receive at least one normalization");
ok(summary.totalIssues >= 30, "issue queue is non-trivial");
ok(summary.issueCounts.missing_gtin === 10, "10 missing GTINs detected");
ok(summary.issueCounts.missing_color_inferred === 6, "6 missing colors detected");
ok(summary.issueCounts.missing_material_inferred === 6, "6 missing materials detected");
ok(summary.issueCounts.missing_stock === 4, "4 missing stock blockers detected");
ok(summary.issueCounts.localized_price === 5, "5 localized euro prices normalized");
ok(summary.issueCounts.duplicate_sku === 2, "duplicate SKU flags both affected rows");
ok(summary.issueCounts.banned_claim === 4, "4 unsupported claim descriptions flagged");
ok(summary.issueCounts.language_bleed >= 5, "language bleed is flagged for mixed descriptions");

const first = products.find((p) => p.clean.product_id === "NSP-0001");
ok(first.clean.brand === "Aurora Gear", "brand casing normalized");
ok(first.clean.category === "Jackets", "category casing normalized");
ok(first.clean.price === "179.00", "localized price converted to decimal");
ok(!first.clean.description_en.includes("<"), "HTML removed from English description");
ok(!/best|forever|guaranteed/i.test(first.clean.description_en), "unsupported overclaim replaced");
ok(first.issues.some((i) => i.code === "missing_gtin"), "missing GTIN is review issue");

const shoe = products.find((p) => p.clean.product_id === "NSP-0013");
ok(shoe.clean.size === "EU 41", "numeric shoe size normalized to EU size");

const duplicate = products.filter((p) => p.issues.some((i) => i.code === "duplicate_sku"));
ok(duplicate.length === 2, "duplicate SKU blocks both duplicate products");
ok(duplicate.every((p) => p.status === "blocked"), "duplicate SKU rows are blocked from export");

ok(summary.statusCounts.blocked >= 5, "blockers are counted");
ok(summary.exportableRows === googleFeed.length, "google feed contains only exportable rows");
ok(summary.exportableRows === affiliateFeed.length, "affiliate feed contains only exportable rows");
ok(googleFeed.length < products.length, "blocked rows are excluded from feeds");
ok(googleFeed[0].price.endsWith(" EUR"), "Google price includes currency");
ok(GOOGLE_FEED_EXPORT_COLUMNS.includes("google_product_category"), "Google feed columns include category taxonomy");
ok(AFFILIATE_FEED_EXPORT_COLUMNS.includes("deeplink"), "affiliate feed columns include deeplink");

const xml = googleFeedXml(googleFeed.slice(0, 2));
ok(xml.includes("<rss"), "Google XML export has RSS root");
ok(xml.includes("<g:id>"), "Google XML export includes namespaced id");
ok(!xml.includes("<script"), "XML export escapes unsafe markup");

const affiliateCsv = toCsv(affiliateFeed.slice(0, 3), AFFILIATE_FEED_EXPORT_COLUMNS);
ok(affiliateCsv.split("\n").length === 4, "affiliate CSV export writes header plus rows");

if (failures) {
  console.error(`\ncleaner.test: ${failures} failure(s)`);
  process.exit(1);
}
console.log("\ncleaner.test: all checks passed");
