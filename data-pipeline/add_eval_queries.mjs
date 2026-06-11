// Adds self-contained cognition queries to the `queries` registry (the array the
// offline eval in eval/run_eval.py scores — journeys are NOT scored there). These
// mirror the three new Reveal scenarios (family / live music / slow travel) as
// standalone briefs so the new themes show up in the Eval-tab IR numbers.
//
// New query objects are TEXT-INSERTED into the "queries" array (before its closing
// "]") so existing embedding arrays stay byte-for-byte untouched.
//
// Run: node data-pipeline/add_eval_queries.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import OpenAI from "openai";

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const FILES = [
  { file: path.join(REPO, "src/data/queries_standard.json"), dims: 1536 },
  { file: path.join(REPO, "src/data/queries_extended.json"), dims: 256 },
];

const env = fs.readFileSync(path.join(REPO, ".env.local"), "utf8");
const apiKey = (env.match(/^OPENAI_API_KEY=(.+)$/m) || [])[1]?.trim();
if (!apiKey) throw new Error("OPENAI_API_KEY not found in .env.local");
const client = new OpenAI({ apiKey });

const embed = async (texts, dims) => {
  const r = await client.embeddings.create({ model: "text-embedding-3-small", input: texts, dimensions: dims });
  return r.data.map((d) => d.embedding);
};

// Self-contained cognition briefs: each carries the scenario's tension in one query
// so it evaluates standalone (unlike a journey's step-3 text, which needs the thread).
const QUERIES = [
  {
    id: "cognition_05",
    pillar: "cognition",
    label: "Family, candid not staged",
    display_text: "a candid family moment that feels joyful but never staged",
    bm25_keywords: "family together home",
    precision_score: null,
    signal_labels: ["conflicting registers", "agent decomposition", "negative filter applied"],
    speaker_note: "Joyful pulls toward posed studio shots; the agent keeps it candid.",
    session_chain: null,
    filters: [{ type: "exclude_tags", tags: ["studio", "posed", "party", "props", "backdrop"], label: "exclude staged-studio cluster" }],
    trace_template: { steps: [
      "Analysing query for ambiguous modifier combinations...",
      "Detected tension: [joyful] vs [never staged] — conflicting visual registers.",
      "Decomposing into sub-queries:",
      "  Sub-query 1: real family interactions, natural light, unposed",
      "  Sub-query 2: children and parents mid-moment, candid",
      "  Sub-query 3: NOT studio portraits, NOT party backdrops, NOT props",
      "Routing sub-query 1 to k-NN retrieval...",
      "Routing sub-query 2 to k-NN retrieval...",
      "Applying negative signal filter for sub-query 3...",
      "Merging ranked result lists with composite score...",
      "Re-ranking by candor over arrangement...",
      "Returning top 6 results. Confidence: high.",
    ] },
  },
  {
    id: "cognition_06",
    pillar: "cognition",
    label: "Live music, intimate not arena",
    display_text: "an intimate live-music moment, electric but not a stadium spectacle",
    bm25_keywords: "live music musician",
    precision_score: null,
    signal_labels: ["conflicting registers", "agent decomposition", "negative filter applied"],
    speaker_note: "Electric pulls toward arenas; the agent holds the room close.",
    session_chain: null,
    filters: [{ type: "exclude_tags", tags: ["arena", "crowd", "festival", "pyrotechnics", "laser"], label: "exclude stadium-spectacle cluster" }],
    trace_template: { steps: [
      "Analysing query for ambiguous modifier combinations...",
      "Detected tension: [electric] vs [not a spectacle] — conflicting visual registers.",
      "Decomposing into sub-queries:",
      "  Sub-query 1: a performer close up, low light, charged",
      "  Sub-query 2: a small room, audience near the stage",
      "  Sub-query 3: NOT arena scale, NOT crowd seas, NOT pyrotechnics",
      "Routing sub-query 1 to k-NN retrieval...",
      "Routing sub-query 2 to k-NN retrieval...",
      "Applying negative signal filter for sub-query 3...",
      "Merging ranked result lists with composite score...",
      "Re-ranking by intimacy over scale...",
      "Returning top 6 results. Confidence: high.",
    ] },
  },
  {
    id: "cognition_07",
    pillar: "cognition",
    label: "Slow travel, not touristy",
    display_text: "a slow, adventurous travel scene that never feels touristy",
    bm25_keywords: "travel journey destination",
    precision_score: null,
    signal_labels: ["conflicting registers", "agent decomposition", "negative filter applied"],
    speaker_note: "Adventurous pulls toward landmarks; the agent keeps it off the beaten path.",
    session_chain: null,
    filters: [{ type: "exclude_tags", tags: ["landmark", "resort", "tourist", "souvenir", "sightseeing"], label: "exclude crowded-tourist cluster" }],
    trace_template: { steps: [
      "Analysing query for ambiguous modifier combinations...",
      "Detected tension: [adventurous] vs [never touristy] — conflicting visual registers.",
      "Decomposing into sub-queries:",
      "  Sub-query 1: a lone traveler, unhurried, real place",
      "  Sub-query 2: open landscape, off the beaten path",
      "  Sub-query 3: NOT postcard landmarks, NOT resorts, NOT tour crowds",
      "Routing sub-query 1 to k-NN retrieval...",
      "Routing sub-query 2 to k-NN retrieval...",
      "Applying negative signal filter for sub-query 3...",
      "Merging ranked result lists with composite score...",
      "Re-ranking by quiet discovery over sightseeing...",
      "Returning top 6 results. Confidence: high.",
    ] },
  },
];

const indent = (str, n) => {
  const pad = " ".repeat(n);
  return str.split("\n").map((l) => pad + l).join("\n");
};

async function processFile(file, dims) {
  const text = fs.readFileSync(file, "utf8");
  const data = JSON.parse(text);
  const existing = new Set(data.queries.map((q) => q.id));

  const toAdd = [];
  const pending = QUERIES.filter((q) => !existing.has(q.id));
  if (pending.length === 0) { console.log("  nothing to add (all present)"); return; }
  const vecs = await embed(pending.map((q) => q.display_text), dims);
  pending.forEach((q, i) => {
    // Field order mirrors existing query objects: embedding sits after bm25_keywords.
    const { id, pillar, label, display_text, bm25_keywords, precision_score, signal_labels, speaker_note, session_chain, filters, trace_template } = q;
    toAdd.push({ id, pillar, label, display_text, bm25_keywords, embedding: vecs[i], precision_score, signal_labels, speaker_note, session_chain, trace_template, filters });
    console.log(`  embedded ${id} (${dims}d)`);
  });

  const serialized = toAdd.map((q) => indent(JSON.stringify(q, null, 2), 4)).join(",\n");
  const marker = '\n  ],\n  "journeys"';
  const idx = text.indexOf(marker); // closes the queries array
  if (idx === -1) throw new Error(`Could not find queries array close in ${file}`);
  const newText = text.slice(0, idx) + ",\n" + serialized + text.slice(idx);
  fs.writeFileSync(file, newText);
  console.log(`  wrote ${path.basename(file)} (+${toAdd.length} queries)`);
}

for (const { file, dims } of FILES) {
  console.log(`Processing ${path.basename(file)} ...`);
  await processFile(file, dims);
}
console.log("Done.");
