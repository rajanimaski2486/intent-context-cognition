// Offline Context-layer synthesis. For each journey, the 3 conversational turns
// are fused by ONE LLM call into a single self-contained search query that
// resolves the thread and rewrites negations as positive descriptors ("not a
// stadium" -> "small intimate venue"). That query is embedded and stored on
// step 3 as `session_synthesized_text` + `session_synthesized_embedding`.
//
// This is the precompute that makes the Context layer free at demo time: the LLM
// runs here (6 journeys x 1 call), never per request. The route reads the stored
// vector and falls back to the averaged session vector when it's absent.
//
// Idempotent: replaces the fields if already present, inserts them (right after
// session_accumulated_embedding) otherwise. Every other array stays byte-stable.
//
// Run: node data-pipeline/synthesize_context_queries.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import OpenAI from "openai";

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const FILES = [
  { file: path.join(REPO, "src/data/queries_standard.json"), dims: 1536 },
  { file: path.join(REPO, "src/data/queries_extended.json"), dims: 256 },
];
const SYNTH_MODEL = process.env.SYNTH_MODEL ?? "gpt-4o";

const env = fs.readFileSync(path.join(REPO, ".env.local"), "utf8");
const apiKey = (env.match(/^OPENAI_API_KEY=(.+)$/m) || [])[1]?.trim();
if (!apiKey) throw new Error("OPENAI_API_KEY not found in .env.local");
const client = new OpenAI({ apiKey });

const SYNTH_SYSTEM = [
  "You reformulate a short multi-turn image-search conversation into ONE standalone search query.",
  "Rules:",
  "- Fuse every turn into a single intent; later turns refine earlier ones.",
  "- Keep the core subject/entity explicit.",
  "- State ONLY what IS wanted. Rewrite every exclusion as a positive descriptor of the desired alternative (e.g. 'not a stadium' -> 'in a small, intimate venue'; 'not staged' -> 'candid and unposed'; 'not a gym' -> 'at home or outdoors'; 'not clinical' -> 'warm and natural').",
  "- BANNED words — never appear in the output: not, no, without, avoid, avoiding, instead of, rather than, except, nor, never, isn't, aren't.",
  "- One natural-language phrase, no preamble, no quotes, under 30 words.",
].join("\n");

// Guard: the whole point is to remove negation (it adds the excluded concept to
// the embedding). Reject any synthesized query that still carries a negation.
const NEGATION_RE = /\b(not|no|without|avoid(?:ing)?|instead of|rather than|except|nor|never|isn't|aren't|n't)\b/i;

const synthesizeOnce = async (turns, extra) => {
  const r = await client.chat.completions.create({
    model: SYNTH_MODEL,
    temperature: 0.2,
    messages: [
      { role: "system", content: SYNTH_SYSTEM },
      { role: "user", content: `Conversation turns:\n${turns.map((t, i) => `${i + 1}. ${t}`).join("\n")}${extra ? `\n\n${extra}` : ""}\n\nResolved query:` },
    ],
  });
  return r.choices[0].message.content.trim().replace(/^["']|["']$/g, "");
};

// Synthesize, retrying with an explicit correction if a negation slips through.
const synthesize = async (turns) => {
  let out = await synthesizeOnce(turns);
  if (!NEGATION_RE.test(out)) return out;
  out = await synthesizeOnce(turns, `Your previous attempt "${out}" used a banned negation word. Rewrite it stating ONLY positive descriptors — no negation words at all.`);
  if (NEGATION_RE.test(out)) console.warn(`  ! negation still present after retry: "${out}"`);
  return out;
};

const embed = async (text, dims) => {
  const r = await client.embeddings.create({ model: "text-embedding-3-small", input: text, dimensions: dims });
  return r.data[0].embedding;
};

// Format a vector array to match the file's pretty-printed style at a given indent.
const fmtArray = (values, elemIndent, closeIndent) =>
  "[\n" + values.map((v) => elemIndent + JSON.stringify(v)).join(",\n") + "\n" + closeIndent + "]";

// Locate journey j's step-3 object span in the raw text.
function step3Span(text, journeyId) {
  const jIdx = text.indexOf(`"id": "${journeyId}"`);
  if (jIdx === -1) throw new Error(`journey not found: ${journeyId}`);
  const next = text.indexOf('"id": "journey_', jIdx + 1);
  const jEnd = next === -1 ? text.length : next;
  // step 3 = last "step": 3 in the journey region
  let s = -1, k = jIdx;
  for (;;) {
    const i = text.indexOf('"step": 3', k);
    if (i === -1 || i >= jEnd) break;
    s = i; k = i + 1;
  }
  if (s === -1) throw new Error(`step 3 not found in ${journeyId}`);
  return { start: s, end: jEnd };
}

// Replace the FIRST `"<key>": [ ... ]` at/after `from`, reusing existing indent.
function replaceArray(text, key, from, values) {
  const keyIdx = text.indexOf(`"${key}": [`, from);
  const open = text.indexOf("[", keyIdx);
  const close = text.indexOf("]", open);
  const body = text.slice(open + 1, close);
  const elemIndent = (body.match(/\n([ \t]+)/) || [, "          "])[1];
  const closeIndent = (text.slice(open, close + 1).match(/\n([ \t]*)\]$/) || [, "        "])[1];
  return text.slice(0, open) + fmtArray(values, elemIndent, closeIndent) + text.slice(close + 1);
}

// Synthesize each journey's query once (corpus-independent text), cache by id.
const data0 = JSON.parse(fs.readFileSync(FILES[0].file, "utf8"));
const synthByJourney = {};
for (const j of data0.journeys) {
  const turns = j.steps.filter((s) => s.display_text).sort((a, b) => a.step - b.step).map((s) => s.display_text);
  synthByJourney[j.id] = await synthesize(turns);
  console.log(`  ${j.id}: "${synthByJourney[j.id]}"`);
}

for (const { file, dims } of FILES) {
  let text = fs.readFileSync(file, "utf8");
  const data = JSON.parse(text);
  for (const j of data.journeys) {
    const synthText = synthByJourney[j.id];
    const vec = await embed(synthText, dims);
    const step3 = j.steps.find((s) => s.step === 3);
    const { start } = step3Span(text, j.id);

    if (step3.session_synthesized_embedding && step3.session_synthesized_embedding.length) {
      // Replace existing text + vector.
      const tIdx = text.indexOf('"session_synthesized_text": "', start);
      const tEnd = text.indexOf('"', tIdx + '"session_synthesized_text": "'.length);
      text = text.slice(0, tIdx) + `"session_synthesized_text": ${JSON.stringify(synthText)}` + text.slice(tEnd + 1);
      text = replaceArray(text, "session_synthesized_embedding", tIdx, vec);
    } else {
      // Insert both fields right after step-3 session_accumulated_embedding.
      const { start: s2 } = step3Span(text, j.id);
      const accKey = text.indexOf('"session_accumulated_embedding": [', s2);
      const accClose = text.indexOf("]", text.indexOf("[", accKey));
      const fieldIndent = (text.slice(0, accKey).match(/\n([ \t]*)$/) || [, "          "])[1];
      const elemIndent = fieldIndent + "  ";
      const insertion =
        ",\n" +
        fieldIndent + `"session_synthesized_text": ${JSON.stringify(synthText)},\n` +
        fieldIndent + `"session_synthesized_embedding": ` + fmtArray(vec, elemIndent, fieldIndent);
      text = text.slice(0, accClose + 1) + insertion + text.slice(accClose + 1);
    }
    console.log(`${path.basename(file)} ${j.id}: stored (${dims}d)`);
  }
  fs.writeFileSync(file, text);
}
console.log("done");
