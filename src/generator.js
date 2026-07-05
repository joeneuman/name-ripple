// Candidate generators for the daily scan.

const LETTERS = 'abcdefghijklmnopqrstuvwxyz';

/** All 17,576 three-letter .com names. */
export function allThreeLetter() {
  const out = [];
  for (const a of LETTERS) for (const b of LETTERS) for (const c of LETTERS) out.push(a + b + c + '.com');
  return out;
}

export const FOUR_LETTER_TOTAL = 26 ** 4; // 456,976

/** A slice of the 4-letter space starting at cursor (base-26 enumeration), wrapping. */
export function fourLetterSlice(cursor, count) {
  const out = [];
  for (let i = 0; i < count; i++) {
    let n = (cursor + i) % FOUR_LETTER_TOTAL;
    let s = '';
    for (let p = 0; p < 4; p++) {
      s = LETTERS[n % 26] + s;
      n = Math.floor(n / 26);
    }
    out.push(s + '.com');
  }
  return { domains: out, nextCursor: (cursor + count) % FOUR_LETTER_TOTAL };
}

// Pronounceable 5-letter generator: weighted consonant-vowel patterns that
// produce brandable-sounding names (bipzi/bunrue territory).
const ONSETS = 'b c d f g h j k l m n p r s t v w z br cr dr fr gr pr tr bl cl fl gl pl sl sk sm sn sp st sw'.split(' ');
const VOWELS = 'a e i o u'.split(' ');
const MIDS = 'b d g k l m n p r s t v z mb nd ng nk st'.split(' ');
const ENDS = 'b d k l m n p r s t x z'.split(' ');

const BAD = /(.)\1\1|[aeiou]{3}|q[^u]/;

function pick(arr, rng) {
  return arr[Math.floor(rng() * arr.length)];
}

/**
 * Generate `count` unique pronounceable 5-letter names as .com domains.
 * Patterns: onset+V+mid+V? / onset+V+V+end etc., filtered to exactly 5 letters.
 */
export function pronounceableFive(count, rng = Math.random) {
  const out = new Set();
  let guard = 0;
  while (out.size < count && guard < count * 200) {
    guard++;
    const shape = Math.floor(rng() * 3);
    let name;
    if (shape === 0) name = pick(ONSETS, rng) + pick(VOWELS, rng) + pick(MIDS, rng) + pick(VOWELS, rng);           // ba-nd-a
    else if (shape === 1) name = pick(ONSETS, rng) + pick(VOWELS, rng) + pick(VOWELS, rng) + pick(ENDS, rng);      // bu-ai-t
    else name = pick(ONSETS, rng) + pick(VOWELS, rng) + pick(MIDS, rng) + pick(VOWELS, rng) + pick(ENDS, rng);     // b-a-n-a-x
    if (name.length !== 5) continue; // onsets/mids vary 1-2 chars; keep exactly 5
    if (BAD.test(name)) continue;
    out.add(name + '.com');
  }
  return [...out];
}
