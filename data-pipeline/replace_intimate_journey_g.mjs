// Copy change: drop the word "intimate" from journey_g's query texts (step 1,
// step 3, synthesized) and re-embed everything that depends on them — step-1 and
// step-3 `embedding`, the decay-averaged `session_accumulated_embedding`, and the
// `session_synthesized_embedding`. Targeted text edits keep all other arrays
// byte-stable. Run: node data-pipeline/replace_intimate_journey_g.mjs
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

// old -> new query text (journey_g only)
const REPLACEMENTS = [
  ["music that feels intimate, not a stadium", "music that feels close, not a stadium"],
  ["an intimate live-music moment, electric but not a stadium spectacle", "a close-up live-music moment, electric but not a stadium spectacle"],
  ["An intimate live-music moment with a performer in a small, cozy venue, capturing an electric atmosphere.", "A close-up live-music moment with a performer in a small, cozy venue, capturing an electric atmosphere."],
];
const NEW_STEP1 = REPLACEMENTS[0][1];
const NEW_STEP3 = REPLACEMENTS[1][1];
const NEW_SYNTH = REPLACEMENTS[2][1];

const env = fs.readFileSync(path.join(REPO, ".env.local"), "utf8");
const apiKey = (env.match(/^OPENAI_API_KEY=(.+)$/m) || [])[1]?.trim();
if (!apiKey) throw new Error("OPENAI_API_KEY not found in .env.local");
const client = new OpenAI({ apiKey });

const normalize = (v) => { const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1; return v.map((x) => x / n); };
const weightedAvg = (embs, ws) => {
  const tot = ws.reduce((a, b) => a + b, 0), dims = embs[0].length, r = new Array(dims).fill(0);
  embs.forEach((vec, k) => { const w = ws[k] / tot; for (let i = 0; i < dims; i++) r[i] += vec[i] * w; });
  return normalize(r);
};
const sessionAccum = (embs) => { const n = embs.length; return weightedAvg(embs, embs.map((_, i) => DECAY ** (n - 1 - i))); };
const embed = async (text, dims) => (await client.embeddings.create({ model: "text-embedding-3-small", input: text, dimensions: dims })).data[0].embedding;

const fmtArray = (values, elemIndent, closeIndent) =>
  "[\n" + values.map((v) => elemIndent + JSON.stringify(v)).join(",\n") + "\n" + closeIndent + "]";

// Replace the first `"<key>": [ ... ]` at/after `from`, reusing existing indent.
function replaceArray(text, key, from, values) {
  const keyIdx = text.indexOf(`"${key}": [`, from);
  if (keyIdx === -1) throw new Error(`key not found: ${key}`);
  const open = text.indexOf("[", keyIdx), close = text.indexOf("]", open);
  const body = text.slice(open + 1, close);
  const elemIndent = (body.match(/\n([ \t]+)/) || [, "          "])[1];
  const closeIndent = (text.slice(open, close + 1).match(/\n([ \t]*)\]$/) || [, "        "])[1];
  return text.slice(0, open) + fmtArray(values, elemIndent, closeIndent) + text.slice(close + 1);
}

for (const { file, dims } of FILES) {
  let text = fs.readFileSync(file, "utf8");

  // Scope to journey_g.
  const jIdx = text.indexOf('"id": "journey_g"');
  if (jIdx === -1) throw new Error(`journey_g not found in ${file}`);
  const next = text.indexOf('"id": "journey_', jIdx + 1);
  const jEnd = next === -1 ? text.length : next;
  const slice = text.slice(jIdx, jEnd);

  // step-2 embedding (unchanged) for the session-accumulated recompute.
  const jg = JSON.parse(text).journeys.find((j) => j.id === "journey_g");
  const e2 = jg.steps.find((s) => s.step === 2).embedding;

  // 1) text replacements (scoped to journey_g region).
  let updated = slice;
  for (const [oldT, newT] of REPLACEMENTS) {
    if (!updated.includes(oldT)) throw new Error(`text not found in journey_g (${path.basename(file)}): ${oldT.slice(0, 40)}...`);
    updated = updated.replace(oldT, newT);
  }
  text = text.slice(0, jIdx) + updated + text.slice(jEnd);

  // 2) re-embed.
  const e1 = await embed(NEW_STEP1, dims);
  const e3 = await embed(NEW_STEP3, dims);
  const accum = sessionAccum([e1, e2, e3]);
  const synth = await embed(NEW_SYNTH, dims);

  // 3) write vectors, anchored on the new texts (all within journey_g).
  const at1 = text.indexOf(`"display_text": "${NEW_STEP1}"`);
  text = replaceArray(text, "embedding", at1, e1);
  const at3 = text.indexOf(`"display_text": "${NEW_STEP3}"`);
  text = replaceArray(text, "embedding", at3, e3);
  text = replaceArray(text, "session_accumulated_embedding", at3, accum);
  const atS = text.indexOf(`"session_synthesized_text": ${JSON.stringify(NEW_SYNTH)}`);
  text = replaceArray(text, "session_synthesized_embedding", atS, synth);

  fs.writeFileSync(file, text);
  console.log(`${path.basename(file)}: journey_g re-texted + re-embedded (${dims}d)`);
}
console.log("done");
