// Adds new Reveal layer-view scenarios (journeys) to both registries, embedding
// their step texts live and computing session-accumulated vectors with the same
// formula as 07_embed_journeys.py (weights[i] = 0.7^(n-1-i), normalized).
//
// New journey objects are TEXT-INSERTED into the "journeys" array so the existing
// embedding arrays are left byte-for-byte untouched (no giant reformat diff).
//
// Run: node data-pipeline/add_reveal_scenarios.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import OpenAI from "openai";

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const FILES = [
  { file: path.join(REPO, "src/data/queries_standard.json"), dims: 1536 },
  { file: path.join(REPO, "src/data/queries_extended.json"), dims: 256 },
];
const DECAY = 0.7;

const env = fs.readFileSync(path.join(REPO, ".env.local"), "utf8");
const apiKey = (env.match(/^OPENAI_API_KEY=(.+)$/m) || [])[1]?.trim();
if (!apiKey) throw new Error("OPENAI_API_KEY not found in .env.local");
const client = new OpenAI({ apiKey });

const normalize = (v) => {
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / n);
};
const weightedAvg = (embs, ws) => {
  const tot = ws.reduce((a, b) => a + b, 0);
  const dims = embs[0].length;
  const r = new Array(dims).fill(0);
  embs.forEach((vec, k) => {
    const w = ws[k] / tot;
    for (let i = 0; i < dims; i++) r[i] += vec[i] * w;
  });
  return normalize(r);
};
const sessionAccum = (embs, idx) => {
  const rel = embs.slice(0, idx + 1);
  const n = rel.length;
  const ws = rel.map((_, i) => DECAY ** (n - 1 - i));
  return weightedAvg(rel, ws);
};
const embed = async (texts, dims) => {
  const r = await client.embeddings.create({ model: "text-embedding-3-small", input: texts, dimensions: dims });
  return r.data.map((d) => d.embedding);
};

// Each scenario: steps 1-2 set up a conversation; step 3 is the contradictory
// brief whose keyword+expansion drifts into a cluster the Cognition filter removes.
const step = (n, pillar, label, narrative, display_text, bm25_keywords, extra = {}) => ({
  step: n,
  pillar_demonstrated: pillar,
  label,
  narrative,
  display_text,
  bm25_keywords,
  embedding: [],
  session_accumulated_embedding: [],
  session_accumulates: true,
  show_trace: n === 3,
  trace_template: null,
  signal_labels: [],
  speaker_note: "",
  ...extra,
});

const JOURNEYS = [
  {
    id: "journey_c",
    label: "Brand Marketer",
    subtitle: "An outdoor brand finds calm",
    steps: [
      step(1, "intent", "Setting the register", "Adventure as a feeling, not an extreme sport.", "adventure that feels calm, not extreme", "adventure outdoors", { signal_labels: ["mood over action", "no extreme keyword"] }),
      step(2, "context", "Adding a person", "The session keeps the unhurried register and adds a human.", "add a person, but keep it unhurried", "person hiking outdoors", { signal_labels: ["session-conditioned", "unhurried preserved"] }),
      step(3, "cognition", "Resolving the brief", "Aspirational and grounded pull apart. The agent excludes the extreme-sports cluster the expansion drags in.", "make it aspirational but grounded in nature", "adventure lifestyle", {
        bm25_expansion: "extreme adrenaline action race speed skydiving",
        filters: [{ type: "exclude_tags", tags: ["extreme", "adrenaline", "race", "skydiving", "motocross"], label: "exclude extreme-sports cluster" }],
        signal_labels: ["conflicting modifiers", "agent decomposes", "grounded register", "intersection retrieval"],
        trace_template: { steps: [
          "Query received. Parsing modifier structure...",
          "Conflicting modifiers: [aspirational] vs [grounded in nature].",
          "Session context active: calm, unhurried, human-in-landscape register.",
          "Keyword expansion drifted toward: extreme, adrenaline, race, skydiving.",
          "Building exclusion for the extreme-sports cluster...",
          "Routing to k-NN with session vector weight applied...",
          "Filtering out high-adrenaline visual cluster...",
          "Re-ranking by intersection: aspirational AND attainable in nature...",
          "Returning top 6. Aspirational, but you could be there on Sunday.",
        ] },
      }),
    ],
  },
  {
    id: "journey_d",
    label: "Photo Editor",
    subtitle: "A wellness story takes shape",
    steps: [
      step(1, "intent", "Health without the gym", "Wellbeing as a mood, not a workout.", "health that isn't a gym", "health wellness", { signal_labels: ["wellbeing as atmosphere", "no gym keyword"] }),
      step(2, "context", "Bringing in food", "The session adds food while keeping it unstaged and real.", "add food, but nothing staged", "food healthy", { signal_labels: ["session-conditioned", "unstaged preserved"] }),
      step(3, "cognition", "Resolving the brief", "Vibrant but not clinical. The agent removes the gym/clinical cluster the expansion pulls in.", "make it vibrant but not clinical", "healthy lifestyle", {
        bm25_expansion: "diet fitness gym workout supplement medical clinical",
        filters: [{ type: "exclude_tags", tags: ["gym", "workout", "medical", "clinic", "supplement"], label: "exclude gym/clinical cluster" }],
        signal_labels: ["conflicting modifiers", "agent decomposes", "warm register", "intersection retrieval"],
        trace_template: { steps: [
          "Query received. Parsing modifier structure...",
          "Conflicting modifiers: [vibrant] vs [not clinical].",
          "Session context active: real, unstaged, food-and-wellbeing register.",
          "Keyword expansion drifted toward: gym, workout, medical, supplements.",
          "Building exclusion for the gym/clinical cluster...",
          "Routing to k-NN with session vector weight applied...",
          "Filtering out clinical and equipment-heavy imagery...",
          "Re-ranking by intersection: vibrant AND human, not sterile...",
          "Returning top 6. Health that looks like a life, not a regimen.",
        ] },
      }),
    ],
  },
  {
    id: "journey_e",
    label: "UX Researcher",
    subtitle: "A human-centered tech story",
    steps: [
      step(1, "intent", "Tech that feels human", "Technology as warmth, not hardware.", "technology that feels human", "technology people", { signal_labels: ["human over hardware", "no device keyword"] }),
      step(2, "context", "Adding hands", "The session keeps the warmth and adds human touch.", "add hands, keep it warm", "hands device warm", { signal_labels: ["session-conditioned", "warmth preserved"] }),
      step(3, "cognition", "Resolving the brief", "Innovative but not cold. The agent excludes the cold-tech cluster the expansion drags in.", "make it innovative but not cold", "technology innovation", {
        bm25_expansion: "robot circuit server data neon futuristic",
        filters: [{ type: "exclude_tags", tags: ["robot", "server", "circuit", "neon", "futuristic"], label: "exclude cold-tech cluster" }],
        signal_labels: ["conflicting modifiers", "agent decomposes", "warm register", "intersection retrieval"],
        trace_template: { steps: [
          "Query received. Parsing modifier structure...",
          "Conflicting modifiers: [innovative] vs [not cold].",
          "Session context active: human, warm, hands-on register.",
          "Keyword expansion drifted toward: robot, circuit, server, neon.",
          "Building exclusion for the cold-tech cluster...",
          "Routing to k-NN with session vector weight applied...",
          "Filtering out sterile, machine-only imagery...",
          "Re-ranking by intersection: forward-looking AND human-scale...",
          "Returning top 6. Innovation with a pulse.",
        ] },
      }),
    ],
  },
];

const indent = (str, n) => {
  const pad = " ".repeat(n);
  return str.split("\n").map((l) => pad + l).join("\n");
};

async function processFile(file, dims) {
  const text = fs.readFileSync(file, "utf8");
  const data = JSON.parse(text);
  const existing = new Set(data.journeys.map((j) => j.id));

  const toAdd = [];
  for (const jd of JOURNEYS) {
    if (existing.has(jd.id)) { console.log(`  skip ${jd.id} (already present)`); continue; }
    const steps = jd.steps.map((s) => ({ ...s }));
    const vecs = await embed(steps.map((s) => s.display_text), dims);
    steps.forEach((s, i) => { s.embedding = vecs[i]; });
    steps.forEach((s, i) => { s.session_accumulated_embedding = sessionAccum(vecs, i); });
    toAdd.push({ id: jd.id, pillar: "journey", label: jd.label, subtitle: jd.subtitle, visible_in: ["standard", "extended"], steps });
    console.log(`  embedded ${jd.id} (${dims}d)`);
  }
  if (toAdd.length === 0) return;

  const serialized = toAdd.map((j) => indent(JSON.stringify(j, null, 2), 4)).join(",\n");
  const idx = text.lastIndexOf("\n  ]"); // closes the journeys array (last top-level array)
  if (idx === -1) throw new Error(`Could not find journeys array close in ${file}`);
  const newText = text.slice(0, idx) + ",\n" + serialized + text.slice(idx);
  fs.writeFileSync(file, newText);
  console.log(`  wrote ${path.basename(file)} (+${toAdd.length} journeys)`);
}

for (const { file, dims } of FILES) {
  console.log(`Processing ${path.basename(file)} ...`);
  await processFile(file, dims);
}
console.log("Done.");
