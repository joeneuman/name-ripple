// AI features, powered by the Claude API (Opus 4.8).
//  - generateWordList: "kitchen items" -> 20 words for the Ripple tool
//  - evaluateName: judges a shortlisted name as a business name — the automated
//    version of the GIDDY DIGS rubric (unique / positive response / memorable),
//    with special attention to the Realzy->Sleazy failure mode: what a name
//    SOUNDS like, not just what it spells.
//
// Requires ANTHROPIC_API_KEY in .env. Without it, calls fail with a clear
// message and the rest of the app works normally.

import Anthropic from '@anthropic-ai/sdk';

const MODEL = process.env.AI_MODEL || 'claude-opus-4-8';

let client = null;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) {
    const err = new Error('AI is not configured. Add ANTHROPIC_API_KEY to the .env file (get a key at console.anthropic.com), then restart the app.');
    err.status = 503;
    throw err;
  }
  client ??= new Anthropic();
  return client;
}

function parseJsonBlock(response) {
  const text = response.content.find((b) => b.type === 'text')?.text ?? '';
  return JSON.parse(text);
}

const WORDLIST_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'Short title-cased list name, e.g. "Kitchen Items"' },
    words: { type: 'array', items: { type: 'string' }, description: 'Exactly 20 single lowercase words' },
  },
  required: ['name', 'words'],
  additionalProperties: false,
};

export async function generateWordList(prompt) {
  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: 2048,
    output_config: { format: { type: 'json_schema', schema: WORDLIST_SCHEMA } },
    messages: [{
      role: 'user',
      content: `Generate a word list for a domain-name brainstorming tool. Topic: "${prompt}"

Rules:
- Exactly 20 words, each a single common English word, lowercase, letters only
- Short words strongly preferred (3-8 letters) since they combine into domain names
- Concrete and recognizable (for "kitchen items": spatula, pan, oven, whisk...)
- No hyphens, no phrases, no proper nouns`,
    }],
  });
  const data = parseJsonBlock(response);
  return {
    name: data.name,
    words: [...new Set(data.words.map((w) => String(w).toLowerCase().replace(/[^a-z]/g, '')).filter(Boolean))],
  };
}

const EVAL_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['strong', 'promising', 'caution', 'weak'] },
    summary: { type: 'string', description: '2-3 plain sentences: is this a good business name and why' },
    criteria: {
      type: 'object',
      properties: {
        unique: {
          type: 'object',
          properties: {
            rating: { type: 'string', enum: ['pass', 'caution', 'fail'] },
            reason: { type: 'string' },
          },
          required: ['rating', 'reason'],
          additionalProperties: false,
        },
        positive: {
          type: 'object',
          properties: {
            rating: { type: 'string', enum: ['pass', 'caution', 'fail'] },
            reason: { type: 'string' },
          },
          required: ['rating', 'reason'],
          additionalProperties: false,
        },
        memorable: {
          type: 'object',
          properties: {
            rating: { type: 'string', enum: ['pass', 'caution', 'fail'] },
            reason: { type: 'string' },
          },
          required: ['rating', 'reason'],
          additionalProperties: false,
        },
      },
      required: ['unique', 'positive', 'memorable'],
      additionalProperties: false,
    },
    soundsLike: {
      type: 'array',
      items: { type: 'string' },
      description: 'What the name could be misheard as when spoken aloud — especially anything unfortunate',
    },
    risks: { type: 'array', items: { type: 'string' } },
  },
  required: ['verdict', 'summary', 'criteria', 'soundsLike', 'risks'],
  additionalProperties: false,
};

export async function evaluateName(display, domain) {
  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: 'adaptive' },
    output_config: { format: { type: 'json_schema', schema: EVAL_SCHEMA } },
    messages: [{
      role: 'user',
      content: `Evaluate "${display}" (domain: ${domain}) as a potential business/brand name.

Judge it against three criteria:
1. UNIQUE — could it be confused with existing brands, products, or common phrases? Consider close spellings and sound-alikes in any industry.
2. POSITIVE RESPONSE — say it out loud every way a stranger might. Does it evoke anything negative? Check phonetic mishearings and rhymes (a real company named "Realzy" failed because people heard "Sleazy"), unfortunate substrings, and meanings in major languages (Spanish, French, German, Mandarin pinyin).
3. MEMORABLE — length, rhythm, pronounceability after one hearing, alliteration, palindrome-like qualities. Could someone who heard it at a barbecue find it Monday?

Be honest and specific. "soundsLike" should list actual plausible mishearings, not stretches. A name most people would happily put on a sign is "strong"; a Realzy-class phonetic landmine is "weak".`,
    }],
  });
  return { ...parseJsonBlock(response), model: MODEL, at: new Date().toISOString() };
}
