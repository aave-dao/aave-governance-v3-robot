// Tiny ULID generator (Crockford base32, time-ordered).
// 26 chars: 10 timestamp + 16 random. Good enough for execution row ids.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

const encode = (n: bigint, len: number): string => {
  let out = '';
  let value = n;
  for (let i = 0; i < len; i++) {
    const ch = ALPHABET[Number(value & 31n)];
    if (!ch) throw new Error('ulid: alphabet index out of range');
    out = ch + out;
    value >>= 5n;
  }
  return out;
};

export const ulid = (now: number = Date.now()): string => {
  const time = encode(BigInt(now), 10);
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  let randNum = 0n;
  for (const b of bytes) randNum = (randNum << 8n) | BigInt(b);
  const rand = encode(randNum, 16);
  return time + rand;
};
