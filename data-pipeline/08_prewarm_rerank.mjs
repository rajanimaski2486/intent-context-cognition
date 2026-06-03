#!/usr/bin/env node
// Pre-warm the LLM rerank cache so that on stage every query is an instant
// cache hit (no live model call). Hits the running app's /api/search for every
// registry query + journey step in both corpora, replicating the UI's session
// flow for context queries so the cache keys match exactly.
//
// The rerank cache lives in the shared Aiven index (icc_rerank_cache), so
// warming via a local dev server also warms production.
//
// Usage:  node data-pipeline/08_prewarm_rerank.mjs
//         BASE_URL=https://intent-context-cognition-brown.vercel.app node data-pipeline/08_prewarm_rerank.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "src", "data");

const CORPORA = [
  { corpus: "standard", file: "queries_standard.json" },
  { corpus: "extended", file: "queries_extended.json" },
];

async function post(url, body) {
  const res = await fetch(`${BASE_URL}${url}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { error: `non-JSON response (${res.status})` };
  }
}

async function warmQuery(corpus, q) {
  let sessionVector;
  if (q.pillar === "context" && q.session_chain) {
    const s = await post("/api/session", {
      session_id: q.session_chain.session_id,
      query_id: q.id,
      corpus,
      step: q.session_chain.step,
    });
    sessionVector = s.session_vector;
  }
  const body = { query_id: q.id, corpus, ...(sessionVector ? { session_vector: sessionVector } : {}) };
  const d = await post("/api/search", body);
  return d?.trace?.rerank?.cache ?? d?.error ?? "?";
}

async function warmJourneyStep(corpus, journeyId, step) {
  const d = await post("/api/search", {
    query_id: `${journeyId}_step_${step}`,
    corpus,
    journey_session: true,
  });
  return d?.trace?.rerank?.cache ?? d?.error ?? "?";
}

async function main() {
  console.log(`Pre-warming rerank cache via ${BASE_URL}\n`);
  let total = 0, hits = 0, stored = 0, other = 0;

  for (const { corpus, file } of CORPORA) {
    const reg = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), "utf8"));
    console.log(`=== ${corpus} ===`);
    for (const q of reg.queries ?? []) {
      if (!q.embedding?.length) continue;
      let status;
      try { status = await warmQuery(corpus, q); }
      catch (e) { status = `error: ${e.message}`; }
      total++; status === "hit" ? hits++ : status === "stored" ? stored++ : other++;
      console.log(`  ${q.id.padEnd(14)} ${status}`);
    }
    for (const j of reg.journeys ?? []) {
      for (const s of j.steps ?? []) {
        if (s.step >= 4 || !s.session_accumulated_embedding?.length) continue;
        let status;
        try { status = await warmJourneyStep(corpus, j.id, s.step); }
        catch (e) { status = `error: ${e.message}`; }
        total++; status === "hit" ? hits++ : status === "stored" ? stored++ : other++;
        console.log(`  ${`${j.id}_step_${s.step}`.padEnd(14)} ${status}`);
      }
    }
  }

  console.log(`\nDone. ${total} queries — stored=${stored} hit=${hits} other=${other}`);
  if (other > 0) console.log("  (non hit/stored entries fell back to hybrid order — re-run to retry)");
}

main().catch((e) => { console.error(e); process.exit(1); });
