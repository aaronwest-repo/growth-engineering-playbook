// Smoke test for the UTM audit core. Pure Node, no dependencies.
// Reads the shared messy campaign data and asserts the audit findings.
// Run: node tests/audit.test.mjs   (exits non-zero on any failure)

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  parseCsv,
  auditCampaigns,
  canonicalSource,
  canonicalMedium,
  canonicalCampaign,
} from "../audit.js";

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.error(`  FAIL ${name} ${extra}`); }
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// --- Canonicalization ------------------------------------------------------
check("facebook/fb/meta all canonicalize to Meta",
  canonicalSource("fb") === "Meta" && canonicalSource("Facebook") === "Meta" && canonicalSource("meta") === "Meta");
check("IG canonicalizes to Instagram", canonicalSource("IG") === "Instagram");
check("ppc/CPC canonicalize to cpc",
  canonicalMedium("ppc") === "cpc" && canonicalMedium("CPC") === "cpc");
check("campaign spelling variants collapse",
  canonicalCampaign(" PROSPECTING-LOOKALIKE") === "prospecting-lookalike" &&
  canonicalCampaign("prospecting lookalike") === "prospecting-lookalike" &&
  canonicalCampaign("Prospecting-Lookalike ") === "prospecting-lookalike");

// --- CSV parsing edge case -------------------------------------------------
const mini = parseCsv('a,b\n"x,y",z\n');
check("CSV parser handles quoted comma", mini.length === 1 && mini[0].a === "x,y" && mini[0].b === "z",
  JSON.stringify(mini));

// --- Audit the real shared data --------------------------------------------
const csvPath = fileURLToPath(new URL("../../shared-data/marketing/campaigns-messy.csv", import.meta.url));
const rows = parseCsv(readFileSync(csvPath, "utf8"));
const audit = auditCampaigns(rows);

check("232 campaign rows parsed", audit.totals.rowCount === 232, `got ${audit.totals.rowCount}`);

const meta = audit.channels.find((c) => c.name === "Meta");
check("Meta channel exists", !!meta);
check("Meta spend split across 4 raw labels", meta && meta.rawLabelCount === 4,
  meta && `got ${meta.rawLabelCount}: ${meta.labels}`);
check("Meta ROAS >= 1.8 (looks healthy)", meta && meta.roas >= 1.8, meta && `roas=${meta.roas}`);
check("Meta POAS < 1 (below breakeven on margin)", meta && meta.poas < 1, meta && `poas=${meta.poas}`);

const affiliate = audit.channels.find((c) => c.name === "Affiliate");
check("Affiliate is genuinely profitable (POAS > 3)", affiliate && affiliate.poas > 3,
  affiliate && `poas=${affiliate.poas}`);

check("blended ROAS ~6.4x", near(audit.totals.roas, 6.41, 0.2), `got ${audit.totals.roas}`);
check("blended POAS ~2.76x", near(audit.totals.poas, 2.76, 0.2), `got ${audit.totals.poas}`);
check("blended ROAS far exceeds POAS (vanity gap)", audit.totals.roas > audit.totals.poas * 2);

const mc = audit.issues.missingCampaign;
check("39 rows missing a campaign tag", mc.rows === 39, `got ${mc.rows}`);
check("missing-campaign spend ~€4,806", near(mc.spend, 4806, 60), `got ${mc.spend}`);
check("missing-campaign spend ~18-19% of total", near(mc.pctSpend, 0.186, 0.02), `got ${mc.pctSpend}`);

check("source inconsistencies detected", audit.issues.sourceInconsistencies.length >= 4);
check("medium inconsistencies detected", audit.issues.mediumInconsistencies.length >= 2);

const collide = audit.issues.namingCollisions.find((c) => c.normalized === "prospecting-lookalike");
check("prospecting-lookalike flagged as a naming collision", !!collide);
check("prospecting-lookalike has >= 3 spellings", collide && collide.variants.length >= 3,
  collide && `got ${collide.variants.length}`);
check("prospecting-lookalike collides across >= 2 sources", collide && collide.sources.length >= 2,
  collide && `got ${collide.sources}`);

// --- Verdicts --------------------------------------------------------------
check("produces at least 4 plain-English verdicts", audit.verdicts.length >= 4, `got ${audit.verdicts.length}`);
check("a verdict names the Meta split",
  audit.verdicts.some((v) => /Meta/.test(v.text) && /source labels/.test(v.text)));
check("a verdict contrasts ROAS vs POAS",
  audit.verdicts.some((v) => /ROAS/.test(v.text) && /POAS/.test(v.text)));

console.log("");
if (failures > 0) {
  console.error(`audit.test: ${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("audit.test: all checks passed");
