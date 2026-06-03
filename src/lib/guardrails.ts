// Input guardrails for the free-form search box. Runs server-side before any
// embedding/LLM call so junk and disallowed input never reach OpenAI or
// OpenSearch. Returns a user-facing message on rejection.

export type GuardrailCode = "too_short" | "too_long" | "junk" | "adult";

export interface GuardrailResult {
  ok: boolean;
  code?: GuardrailCode;
  message?: string;
}

const MAX_LEN = 200;
const MIN_LEN = 2;

// Explicit adult/NSFW terms. Word-boundary matched. Kept deliberately narrow to
// obvious explicit terms — this is a public conference demo, not a moderation
// system; the goal is to keep the on-screen results safe-for-stage.
const ADULT_TERMS = [
  "porn", "porno", "pornography", "xxx", "nsfw", "nude", "nudes", "naked",
  "sex", "sexual", "sexy", "erotic", "erotica", "fetish", "bdsm", "hentai",
  "blowjob", "handjob", "boobs", "tits", "pussy", "cock", "dick", "penis",
  "vagina", "cum", "orgasm", "masturbat", "creampie", "milf", "escort",
  "onlyfans", "camgirl", "strip", "stripper", "lingerie",
];

function fail(code: GuardrailCode, message: string): GuardrailResult {
  return { ok: false, code, message };
}

function wordHit(haystack: string, term: string): boolean {
  // substring for stems ending in non-word truncation (e.g. "masturbat"),
  // word-boundary otherwise.
  if (/[a-z]$/.test(term) && term.length >= 7) {
    return haystack.includes(term);
  }
  return new RegExp(`(^|[^a-z])${term}([^a-z]|$)`).test(haystack);
}

export function validateQueryText(raw: string): GuardrailResult {
  const text = raw.trim();
  if (text.length < MIN_LEN) {
    return fail("too_short", "Type a few words describing what you're looking for.");
  }
  if (text.length > MAX_LEN) {
    return fail("too_long", `Keep it under ${MAX_LEN} characters — try a more concise phrase.`);
  }

  const lower = text.toLowerCase();

  for (const term of ADULT_TERMS) {
    if (wordHit(lower, term)) {
      return fail("adult", "That query isn't supported here. Try describing a scene, mood, or subject.");
    }
  }

  // Junk / meaningless: reject keyboard mashing and punctuation/number soup.
  // A real word has a vowel (incl. y) and a sane vowel ratio; pure consonant
  // runs ("qwrtp") or near-vowelless mash ("asdfgh") fail.
  const alphaTokens = lower
    .split(/\s+/)
    .map((t) => t.replace(/[^a-z]/g, ""))
    .filter((t) => t.length > 0);

  const hasRealWord = alphaTokens.some((t) => t.length >= 2 && /[aeiouy]/.test(t));
  // Any substantial token with no vowel at all is keyboard mash.
  const consonantMash = alphaTokens.some((t) => t.length >= 3 && !/[aeiouy]/.test(t));

  const letterCount = (lower.match(/[a-z]/g) ?? []).length;
  const vowelCount = (lower.match(/[aeiouy]/g) ?? []).length;
  const nonSpace = lower.replace(/\s/g, "").length;
  const letterRatio = nonSpace > 0 ? letterCount / nonSpace : 0;
  const vowelRatio = letterCount > 0 ? vowelCount / letterCount : 0;

  if (!hasRealWord || consonantMash || letterRatio < 0.5 || vowelRatio < 0.2) {
    return fail("junk", "That doesn't look like a searchable phrase. Try something like “calm morning light”.");
  }

  return { ok: true };
}
