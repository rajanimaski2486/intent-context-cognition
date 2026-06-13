// One-off: re-author journey_g (Music Editor) step 3 so the Intent layer embeds
// a self-contained query that keeps the "live music" entity, instead of the
// context-stripped "make it electric but not a spectacle" (which embeds toward
// electric *devices*). Re-embeds step-3 `embedding` + recomputes the step-3
// `session_accumulated_embedding` (decay-weighted avg of steps 1-3), matching
// the formula in add_reveal_scenarios.mjs / 07_embed_journeys.py.
//
// Targeted text edits only — every other array stays byte-for-byte identical.
//
// Run: node data-pipeline/fix_journey_g_step3.mjs
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
const OLD_TEXT = "make it electric but not a spectacle";
const NEW_TEXT = "a close-up live-music moment, electric but not a stadium spectacle";

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
// session-accumulated vector for the LAST of `embs` (decay weights, oldest gets least).
const sessionAccum = (embs) => {
  const n = embs.length;
  const ws = embs.map((_, i) => DECAY ** (n - 1 - i));
  return weightedAvg(embs, ws);
};
const embed = async (text, dims) => {
  const r = await client.embeddings.create({ model: "text-embedding-3-small", input: text, dimensions: dims });
  return r.data[0].embedding;
};

// Replace the FIRST `"<key>": [ ... ]` array found at/after `from`, reusing the
// existing per-element + closing-bracket indentation so the diff stays minimal.
function replaceArray(text, key, from, values) {
  const keyIdx = text.indexOf(`"${key}": [`, from);
  if (keyIdx === -1) throw new Error(`key not found: ${key}`);
  const open = text.indexOf("[", keyIdx);
  const close = text.indexOf("]", open);
  const body = text.slice(open + 1, close);
  const elemIndent = (body.match(/\n([ \t]+)/) || [, "          "])[1];
  const closeIndent = (text.slice(open, close + 1).match(/\n([ \t]*)\]$/) || [, "        "])[1];
  const arr = "[\n" + values.map((v) => elemIndent + JSON.stringify(v)).join(",\n") + "\n" + closeIndent + "]";
  return text.slice(0, open) + arr + text.slice(close + 1);
}

for (const { file, dims } of FILES) {
  let text = fs.readFileSync(file, "utf8");

  // Scope every edit to journey_g's step-3 object.
  const jgIdx = text.indexOf('"id": "journey_g"');
  if (jgIdx === -1) throw new Error(`journey_g not found in ${file}`);
  const jgEnd = (() => {
    const next = text.indexOf('"id": "journey_', jgIdx + 1);
    return next === -1 ? text.length : next;
  })();
  const dtIdx = text.indexOf(`"display_text": "${OLD_TEXT}"`, jgIdx);
  if (dtIdx === -1 || dtIdx >= jgEnd) throw new Error(`step-3 display_text not found in journey_g (${file})`);

  // Read steps 1-2 embeddings (unchanged) from the parsed copy.
  const data = JSON.parse(text);
  const jg = data.journeys.find((j) => j.id === "journey_g");
  const e1 = jg.steps.find((s) => s.step === 1).embedding;
  const e2 = jg.steps.find((s) => s.step === 2).embedding;

  const e3 = await embed(NEW_TEXT, dims);
  const accum = sessionAccum([e1, e2, e3]);

  // 1) display_text
  text = text.slice(0, dtIdx) + `"display_text": "${NEW_TEXT}"` + text.slice(dtIdx + `"display_text": "${OLD_TEXT}"`.length);
  // 2) step-3 embedding + session_accumulated_embedding (search from the edited display_text)
  text = replaceArray(text, "embedding", dtIdx, e3);
  text = replaceArray(text, "session_accumulated_embedding", dtIdx, accum);

  fs.writeFileSync(file, text);
  console.log(`${path.basename(file)}: step-3 re-embedded (${dims}d), session vector recomputed`);
}
