#!/usr/bin/env node
// Pre-warm the LLM caches so that on stage every query is an instant cache hit
// (no live model call). Two stages are warmed against the running app:
//   1. Rerank  (/api/search) — for every registry query + journey step in both
//      corpora, replicating the UI's session flow for context queries so the
//      cache keys match exactly.
//   2. Trace   (/api/trace)  — for every query / journey step that has a
//      trace_template, so the first click streams the cached NVIDIA trace.
// Both default to the NVIDIA provider (the app's default), so this warms the
// NVIDIA-keyed cache entries (meta/llama-* models).
//
// Both caches live in shared Aiven indices (icc_rerank_cache / icc_trace_cache),
// so warming via a local dev server also warms production.
//
// Usage:  node data-pipeline/08_prewarm_rerank.mjs
//         BASE_URL=https://intent-context-cognition-brown.vercel.app node data-pipeline/08_prewarm_rerank.mjs
//         WARM_TRACES=false ... node ...   # rerank only (skip trace warming)

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

// --- trace warming ---

// Reconstruct the streamed trace text from the SSE body so we can tell a real
// (model/cache) trace apart from the scripted "no template" fallback.
function reconstructTrace(sseText) {
  let out = "";
  for (const line of sseText.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    const payload = line.slice(6).trim();
    if (payload === "[DONE]") continue;
    try {
      const c = JSON.parse(payload).char;
      if (typeof c === "string") out += c;
    } catch { /* ignore non-char frames */ }
  }
  return out;
}

// Drains /api/trace for one query id (regular or `${journey}_step_${n}`) so the
// NVIDIA trace gets generated and stored. Provider defaults to nvidia server-side.
async function warmTrace(corpus, queryId) {
  const res = await fetch(`${BASE_URL}/api/trace`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query_id: queryId, corpus }),
  });
  const text = reconstructTrace(await res.text());
  if (/Falling back to scripted trace|no trace_template/i.test(text)) return "scripted";
  if (/unavailable/i.test(text)) return "failed";
  return text.trim().length > 0 ? "ok" : "empty";
}

async function main() {
  const warmTraces = process.env.WARM_TRACES !== "false";
  const registries = CORPORA.map(({ corpus, file }) => ({
    corpus,
    reg: JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), "utf8")),
  }));

  // --- stage 1: rerank ---
  console.log(`Pre-warming RERANK cache via ${BASE_URL}\n`);
  let total = 0, hits = 0, stored = 0, other = 0;

  for (const { corpus, reg } of registries) {
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

  console.log(`\nRerank done. ${total} queries — stored=${stored} hit=${hits} other=${other}`);
  if (other > 0) console.log("  (non hit/stored entries fell back to hybrid order — re-run to retry)");

  if (!warmTraces) return;

  // --- stage 2: trace (only queries / steps with a trace_template) ---
  console.log(`\nPre-warming TRACE cache via ${BASE_URL}\n`);
  let tTotal = 0, tOk = 0, tOther = 0;

  for (const { corpus, reg } of registries) {
    console.log(`=== ${corpus} ===`);
    for (const q of reg.queries ?? []) {
      if (!q.trace_template) continue;
      let status;
      try { status = await warmTrace(corpus, q.id); }
      catch (e) { status = `error: ${e.message}`; }
      tTotal++; status === "ok" ? tOk++ : tOther++;
      console.log(`  ${q.id.padEnd(14)} ${status}`);
    }
    for (const j of reg.journeys ?? []) {
      for (const s of j.steps ?? []) {
        if (!s.trace_template) continue;
        const id = `${j.id}_step_${s.step}`;
        let status;
        try { status = await warmTrace(corpus, id); }
        catch (e) { status = `error: ${e.message}`; }
        tTotal++; status === "ok" ? tOk++ : tOther++;
        console.log(`  ${id.padEnd(14)} ${status}`);
      }
    }
  }

  console.log(`\nTrace done. ${tTotal} traces — ok=${tOk} other=${tOther}`);
  if (tOther > 0) console.log("  (non-ok entries were scripted/failed/empty — re-run to retry)");
}

main().catch((e) => { console.error(e); process.exit(1); });
