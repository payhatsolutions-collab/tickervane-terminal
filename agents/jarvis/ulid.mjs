// ULID: a 26-character identifier whose leading 10 characters encode the
// millisecond timestamp, so lexical sort == chronological sort. That property is
// what lets the signal log be read in order without parsing every line.
import { randomFillSync } from 'node:crypto';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32, no I L O U
const TIME_LEN = 10;
const RAND_LEN = 16;

let lastTime = -1;
let lastRand = null;

function encodeTime(ms) {
  let out = '';
  for (let i = TIME_LEN - 1; i >= 0; i--) {
    out = ALPHABET[ms % 32] + out;
    ms = Math.floor(ms / 32);
  }
  return out;
}

function randomChars() {
  const bytes = randomFillSync(new Uint8Array(RAND_LEN));
  // One byte per character, reduced mod 32. The 8→5 bit reduction costs a little
  // entropy per character but 16 chars still leaves ~80 bits, which is plenty for
  // a single-machine daemon and keeps this readable.
  return Array.from(bytes, b => ALPHABET[b % 32]);
}

/** Increment the random suffix in place so ids stay ordered within one millisecond. */
function bumpRand(chars) {
  for (let i = chars.length - 1; i >= 0; i--) {
    const next = ALPHABET.indexOf(chars[i]) + 1;
    if (next < 32) { chars[i] = ALPHABET[next]; return chars; }
    chars[i] = ALPHABET[0]; // carry
  }
  return chars; // overflowed a full 16 chars in one ms; practically unreachable
}

/**
 * Generate a ULID. Monotonic: two calls in the same millisecond still sort in
 * call order, so signals emitted in a tight loop keep their sequence.
 */
export function ulid(now = Date.now()) {
  if (now === lastTime && lastRand) {
    lastRand = bumpRand(lastRand);
  } else {
    lastTime = now;
    lastRand = randomChars();
  }
  return encodeTime(now) + lastRand.join('');
}

/** Prefixed id, e.g. `sig_01JB8...`. */
export const id = prefix => `${prefix}_${ulid()}`;

/** Recover the emission time from a ULID (with or without a `xxx_` prefix). */
export function timeOf(value) {
  const raw = String(value).includes('_') ? String(value).split('_').pop() : String(value);
  if (raw.length !== TIME_LEN + RAND_LEN) return null;
  let ms = 0;
  for (const ch of raw.slice(0, TIME_LEN)) {
    const digit = ALPHABET.indexOf(ch);
    if (digit < 0) return null;
    ms = ms * 32 + digit;
  }
  return new Date(ms);
}
