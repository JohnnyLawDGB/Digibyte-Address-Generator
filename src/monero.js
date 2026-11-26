// Monero keys from a BIP39 seed, the way Ledger's Monero app derives them:
//   k      = BIP32 (secp256k1) private key at m/44'/128'/account'/0/0
//   spend  = keccak256(k) mod l
//   view   = keccak256(spend) mod l
// Because view = H(spend), the spend key is also a standard Monero wallet
// seed: its 25-word encoding restores the same wallet in any Monero wallet.

import { ed25519 } from '@noble/curves/ed25519.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { bytesToHex, concatBytes } from '@noble/hashes/utils.js';
import { base58xmr } from '@scure/base';
import { MONERO_WORDS } from './monero-words.js';

const L = ed25519.Point.Fn.ORDER;
const PREFIX_STANDARD = 0x12; // mainnet primary address, "4..."
const PREFIX_INTEGRATED = 0x13;
const PREFIX_SUBADDRESS = 0x2a; // "8..."

const leToInt = (b) => BigInt('0x' + (bytesToHex(Uint8Array.from(b).reverse()) || '0'));
function intToLe32(n) {
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    out[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  return out;
}
/** Reduce a 32-byte little-endian value modulo the ed25519 group order. */
export const scReduce32 = (bytes) => intToLe32(leToInt(bytes) % L);

function publicKey(scalar) {
  const n = leToInt(scalar);
  if (n === 0n) throw new Error('Invalid Monero key (zero scalar)');
  return ed25519.Point.BASE.multiply(n).toBytes();
}

function encodeAddress(prefix, pubSpend, pubView) {
  const body = concatBytes(Uint8Array.of(prefix), pubSpend, pubView);
  return base58xmr.encode(concatBytes(body, keccak_256(body).slice(0, 4)));
}

/** Everything that follows from a 32-byte private spend key. */
export function moneroFromSpendKey(spend) {
  if (!(spend instanceof Uint8Array) || spend.length !== 32) throw new Error('Monero spend key must be 32 bytes');
  if (leToInt(spend) >= L) throw new Error('Monero spend key is not reduced');
  const view = scReduce32(keccak_256(spend));
  return {
    address: encodeAddress(PREFIX_STANDARD, publicKey(spend), publicKey(view)),
    privateViewKey: bytesToHex(view),
  };
}

/** The private spend key for an account. SECRET: never log or store this. */
export function moneroSpendKey(root, account = 0) {
  const node = root.derive(`m/44'/128'/${account}'/0/0`);
  const spend = scReduce32(keccak_256(node.privateKey));
  node.wipePrivateData();
  return spend;
}

function crc32(text) {
  let crc = 0xffffffff;
  for (let i = 0; i < text.length; i++) {
    crc ^= text.charCodeAt(i);
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const checksumWord = (words) => words[crc32(words.map((w) => w.slice(0, 3)).join('')) % words.length];

/** Standard 25-word Monero mnemonic for a private spend key. SECRET. */
export function moneroWordsFromSpendKey(spend) {
  const n = MONERO_WORDS.length;
  const words = [];
  for (let i = 0; i < 32; i += 4) {
    const x = (spend[i] | (spend[i + 1] << 8) | (spend[i + 2] << 16) | (spend[i + 3] << 24)) >>> 0;
    const w1 = x % n;
    const w2 = (Math.floor(x / n) + w1) % n;
    const w3 = (Math.floor(x / n / n) + w2) % n;
    words.push(MONERO_WORDS[w1], MONERO_WORDS[w2], MONERO_WORDS[w3]);
  }
  words.push(checksumWord(words));
  return words.join(' ');
}

/** Decode a 25-word Monero mnemonic back to its spend key (used to self-check). */
export function moneroSpendKeyFromWords(phrase) {
  const words = String(phrase).trim().toLowerCase().split(/\s+/);
  if (words.length !== 25) throw new Error('A Monero seed has 25 words');
  if (checksumWord(words.slice(0, 24)) !== words[24]) throw new Error('Monero seed checksum failed');
  const n = MONERO_WORDS.length;
  const out = new Uint8Array(32);
  for (let i = 0; i < 8; i++) {
    const [w1, w2, w3] = words.slice(i * 3, i * 3 + 3).map((w) => MONERO_WORDS.indexOf(w));
    if (w1 < 0 || w2 < 0 || w3 < 0) throw new Error('Word not in the Monero word list');
    const x = w1 + n * ((n - w1 + w2) % n) + n * n * ((n - w2 + w3) % n);
    if (x % n !== w1 || x > 0xffffffff) throw new Error('Invalid Monero seed');
    out.set([x & 0xff, (x >>> 8) & 0xff, (x >>> 16) & 0xff, (x >>> 24) & 0xff], i * 4);
  }
  return out;
}

/** Validate a Monero mainnet address: length, network prefix and checksum. */
export function checkMoneroAddress(address) {
  let raw;
  try {
    raw = base58xmr.decode(String(address).trim());
  } catch {
    return { valid: false, reason: 'Not valid Monero base58' };
  }
  const type = { [PREFIX_STANDARD]: 'primary', [PREFIX_SUBADDRESS]: 'subaddress', [PREFIX_INTEGRATED]: 'integrated' }[raw[0]];
  if (!type) return { valid: false, reason: `Prefix ${raw[0]} is not a Monero mainnet address` };
  if (raw.length !== (type === 'integrated' ? 77 : 69)) return { valid: false, reason: 'Wrong length' };
  const body = raw.slice(0, -4);
  if (bytesToHex(keccak_256(body).slice(0, 4)) !== bytesToHex(raw.slice(-4))) return { valid: false, reason: 'Bad checksum' };
  return { valid: true, type };
}

