// DigiByte cold-storage derivation core.
// Pure functions only: no I/O, no network, no filesystem. Shared by the CLI
// and the offline web page so both produce byte-identical results.

import { HDKey } from '@scure/bip32';
import {
  entropyToMnemonic,
  mnemonicToEntropy,
  mnemonicToSeedSync,
  validateMnemonic,
} from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { bech32, bech32m, createBase58check } from '@scure/base';
import { schnorr, secp256k1 } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { ripemd160 } from '@noble/hashes/legacy.js';
import { bytesToHex, concatBytes, utf8ToBytes } from '@noble/hashes/utils.js';

export const VERSION = '2.0.0';
export { wordlist };

// Chain parameters, each taken from that chain's reference node source
// (chainparams.cpp): address version bytes, bech32 prefix, extended-key
// version bytes, and the SLIP-44 coin type used in derivation paths.
// `scriptTypes` lists what the chain can actually spend; anything else is
// never offered.
const XPUB = Object.freeze({ public: 0x0488b21e, private: 0x0488ade4 });
const ALL_TYPES = Object.freeze(['p2wpkh', 'p2tr', 'p2sh-p2wpkh', 'p2pkh']);
const chain = (c) => Object.freeze({ scriptTypes: ALL_TYPES, notes: Object.freeze({}), ...c });

export const NETWORKS = Object.freeze({
  // DigiByte Core. Taproot is buried-active on mainnet since block 21,168,000.
  mainnet: chain({
    name: 'mainnet',
    ticker: 'DGB',
    label: 'DigiByte mainnet',
    pubKeyHash: 0x1e, // 30  -> "D..."
    scriptHash: 0x3f, // 63  -> "S..."
    bech32: 'dgb',
    bip32: XPUB,
    coinType: 20,
    notes: Object.freeze({
      p2tr: 'Active on DigiByte mainnet since block 21,168,000. Confirm your sending wallet/exchange supports dgb1p… (bech32m) before using.',
      p2pkh: 'Maximum compatibility, highest fees. DigiByte and Dogecoin legacy addresses both start with "D" and look alike: never send DOGE here.',
    }),
  }),
  testnet: chain({
    name: 'testnet',
    ticker: 'tDGB',
    label: 'DigiByte testnet',
    pubKeyHash: 0x7e, // 126
    scriptHash: 0x8c, // 140
    bech32: 'dgbt',
    bip32: Object.freeze({ public: 0x043587cf, private: 0x04358394 }), // tpub / tprv
    coinType: 1,
  }),
  // Bitcoin Core.
  bitcoin: chain({
    name: 'bitcoin',
    ticker: 'BTC',
    label: 'Bitcoin',
    pubKeyHash: 0x00, // "1..."
    scriptHash: 0x05, // "3..."
    bech32: 'bc',
    bip32: XPUB,
    coinType: 0,
  }),
  // Litecoin Core. P2SH uses the newer "M..." prefix (version 50).
  litecoin: chain({
    name: 'litecoin',
    ticker: 'LTC',
    label: 'Litecoin',
    pubKeyHash: 0x30, // 48 -> "L..."
    scriptHash: 0x32, // 50 -> "M..."
    bech32: 'ltc',
    bip32: XPUB,
    coinType: 2,
  }),
  // Dogecoin Core. No SegWit and no Taproot on Dogecoin: legacy addresses only.
  dogecoin: chain({
    name: 'dogecoin',
    ticker: 'DOGE',
    label: 'Dogecoin',
    pubKeyHash: 0x1e, // 30 -> "D..." (same version byte as DigiByte)
    scriptHash: 0x16, // 22
    bech32: null,
    bip32: Object.freeze({ public: 0x02facafd, private: 0x02fac398 }), // dgub / dgpv
    coinType: 3,
    scriptTypes: Object.freeze(['p2pkh']),
    notes: Object.freeze({
      p2pkh: 'The only address type Dogecoin supports. Dogecoin and DigiByte legacy addresses both start with "D" and look alike: never send DGB here.',
    }),
  }),
});

/** Short names accepted on the command line, DigiByte first. */
export const CHAINS = Object.freeze({
  dgb: NETWORKS.mainnet,
  btc: NETWORKS.bitcoin,
  ltc: NETWORKS.litecoin,
  doge: NETWORKS.dogecoin,
});

// Ordered newest-first: the first entry is the recommended default.
export const SCRIPT_TYPES = Object.freeze([
  Object.freeze({
    id: 'p2wpkh',
    purpose: 84,
    bip: 'BIP84',
    label: 'Native SegWit',
    note: 'Recommended. Lowest fees among widely supported types; bech32 checksum catches typos.',
    wrap: (key) => `wpkh(${key})`,
  }),
  Object.freeze({
    id: 'p2tr',
    purpose: 86,
    bip: 'BIP86',
    label: 'Taproot',
    note: 'Confirm your sending wallet/exchange supports bech32m (…1p…) addresses before using.',
    wrap: (key) => `tr(${key})`,
  }),
  Object.freeze({
    id: 'p2sh-p2wpkh',
    purpose: 49,
    bip: 'BIP49',
    label: 'Wrapped SegWit',
    note: 'For senders that cannot pay bech32 addresses.',
    wrap: (key) => `sh(wpkh(${key}))`,
  }),
  Object.freeze({
    id: 'p2pkh',
    purpose: 44,
    bip: 'BIP44',
    label: 'Legacy',
    note: 'Maximum compatibility, highest fees.',
    wrap: (key) => `pkh(${key})`,
  }),
]);

const base58check = createBase58check(sha256);
const hash160 = (bytes) => ripemd160(sha256(bytes));

// ---------------------------------------------------------------- entropy

export function wordsToBits(words) {
  if (words === 24) return 256;
  if (words === 12) return 128;
  throw new Error('Mnemonic length must be 12 or 24 words');
}

/** Keep only die faces 1-6; spaces, commas and newlines are ignored. */
export function normalizeDice(input) {
  const cleaned = String(input).replace(/[\s,.;:_-]/g, '');
  if (cleaned.length && !/^[1-6]+$/.test(cleaned)) {
    throw new Error('Dice rolls may only contain the digits 1-6');
  }
  return cleaned;
}

/** Bits of entropy carried by n fair six-sided die rolls. */
export const diceBits = (rolls) => Math.floor(rolls * Math.log2(6));

/**
 * Combine the operating system CSPRNG with optional user-supplied entropy.
 * The result is at least as unpredictable as the stronger of the two sources,
 * so neither the RNG nor the dice have to be trusted on their own.
 */
export function mixEntropy(osRandom, extra, bits = 256) {
  if (!(osRandom instanceof Uint8Array) || osRandom.length < 32) {
    throw new Error('Need at least 32 bytes from the system RNG');
  }
  if (osRandom.every((b) => b === osRandom[0])) {
    throw new Error('System RNG returned constant output; refusing to continue');
  }
  const extraBytes = typeof extra === 'string' ? utf8ToBytes(extra) : extra || new Uint8Array(0);
  const digest = extraBytes.length
    ? sha256(concatBytes(utf8ToBytes('dgb-coldprep/entropy/v1'), sha256(osRandom), sha256(extraBytes)))
    : sha256(concatBytes(utf8ToBytes('dgb-coldprep/entropy/v1'), sha256(osRandom)));
  return digest.slice(0, bits / 8);
}

/**
 * Dice-only entropy: SHA-256 of the ASCII roll digits. Reproducible by hand
 * with any SHA-256 tool, so the result can be audited without trusting this
 * program's RNG. Requires enough rolls to carry the requested strength.
 */
export function diceOnlyEntropy(dice, bits = 256) {
  const rolls = normalizeDice(dice);
  const need = Math.ceil(bits / Math.log2(6));
  if (rolls.length < need) {
    throw new Error(`Dice-only mode needs at least ${need} rolls for ${bits}-bit security (got ${rolls.length})`);
  }
  return sha256(utf8ToBytes(rolls)).slice(0, bits / 8);
}

// --------------------------------------------------------------- mnemonic

export const normalizeMnemonic = (m) => String(m).normalize('NFKD').trim().toLowerCase().split(/\s+/).join(' ');

export function mnemonicFromEntropy(entropy) {
  return entropyToMnemonic(entropy, wordlist);
}

export function isValidMnemonic(mnemonic) {
  return validateMnemonic(normalizeMnemonic(mnemonic), wordlist);
}

/** Explain exactly what is wrong with a mnemonic, or return null if valid. */
export function mnemonicProblem(mnemonic) {
  const words = normalizeMnemonic(mnemonic).split(' ').filter(Boolean);
  if (![12, 15, 18, 21, 24].includes(words.length)) {
    return `Expected 12 or 24 words, got ${words.length}`;
  }
  const unknown = words.map((w, i) => (wordlist.includes(w) ? null : `#${i + 1} "${w}"`)).filter(Boolean);
  if (unknown.length) return `Not in the BIP39 word list: ${unknown.join(', ')}`;
  if (!validateMnemonic(words.join(' '), wordlist)) {
    return 'Checksum failed: a word is wrong or the words are out of order';
  }
  return null;
}

// -------------------------------------------------------------- addresses

function segwitAddress(hrp, version, program) {
  const enc = version === 0 ? bech32 : bech32m;
  return enc.encode(hrp, [version, ...enc.toWords(program)]);
}

/** BIP341 key-path-only output key: P + H_TapTweak(P)·G, x-only. */
export function taprootOutputKey(pubkey33) {
  const xOnly = pubkey33.slice(1);
  const internal = schnorr.utils.lift_x(BigInt('0x' + bytesToHex(xOnly)));
  const tweak = BigInt('0x' + bytesToHex(schnorr.utils.taggedHash('TapTweak', xOnly)));
  if (tweak >= secp256k1.Point.Fn.ORDER) throw new Error('Invalid taproot tweak');
  const out = internal.add(secp256k1.Point.BASE.multiply(tweak));
  return schnorr.utils.pointToBytes(out);
}

export function encodeAddress(typeId, pubkey33, network) {
  if (!(pubkey33 instanceof Uint8Array) || pubkey33.length !== 33) {
    throw new Error('Expected a 33-byte compressed public key');
  }
  switch (typeId) {
    case 'p2pkh':
      return base58check.encode(concatBytes(Uint8Array.of(network.pubKeyHash), hash160(pubkey33)));
    case 'p2sh-p2wpkh': {
      const redeem = concatBytes(Uint8Array.of(0x00, 0x14), hash160(pubkey33));
      return base58check.encode(concatBytes(Uint8Array.of(network.scriptHash), hash160(redeem)));
    }
    case 'p2wpkh':
      return segwitAddress(network.bech32, 0, hash160(pubkey33));
    case 'p2tr':
      return segwitAddress(network.bech32, 1, taprootOutputKey(pubkey33));
    default:
      throw new Error(`Unknown script type: ${typeId}`);
  }
}

/**
 * Validate an address string (checksum, prefix, length) for a network.
 * Returns { valid, type?, reason? }.
 */
export function checkAddress(address, network = NETWORKS.mainnet) {
  const addr = String(address).trim();
  const lower = addr.toLowerCase();
  if (network.bech32 && lower.startsWith(network.bech32 + '1')) {
    if (addr !== lower && addr !== addr.toUpperCase()) return { valid: false, reason: 'Mixed-case bech32' };
    for (const [enc, name] of [[bech32, 'bech32'], [bech32m, 'bech32m']]) {
      try {
        const { prefix, words } = enc.decode(lower);
        if (prefix !== network.bech32) continue;
        const version = words[0];
        const program = enc.fromWords(words.slice(1));
        if (version === 0 && name === 'bech32' && program.length === 20) return { valid: true, type: 'p2wpkh' };
        if (version === 0 && name === 'bech32' && program.length === 32) return { valid: true, type: 'p2wsh' };
        if (version === 1 && name === 'bech32m' && program.length === 32) return { valid: true, type: 'p2tr' };
        return { valid: false, reason: `Unsupported witness v${version} program (${program.length} bytes, ${name})` };
      } catch {
        /* try the other encoding */
      }
    }
    return { valid: false, reason: 'Bad bech32 checksum' };
  }
  try {
    const raw = base58check.decode(addr);
    if (raw.length !== 21) return { valid: false, reason: 'Wrong payload length' };
    if (raw[0] === network.pubKeyHash) return { valid: true, type: 'p2pkh' };
    if (raw[0] === network.scriptHash) return { valid: true, type: 'p2sh' };
    return { valid: false, reason: `Version byte ${raw[0]} is not a ${network.label} address` };
  } catch {
    return { valid: false, reason: 'Bad base58 checksum' };
  }
}

// ------------------------------------------------------------ descriptors

const DESC_INPUT = '0123456789()[],\'/*abcdefgh@:$%{}IJKLMNOPQRSTUVWXYZ&+-.;<=>?!^_|~ijklmnopqrstuvwxyzABCDEFGH`#"\\ ';
const DESC_CHECK = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const DESC_GEN = [0xf5dee51989n, 0xa9fdca3312n, 0x1bab10e32dn, 0x3706b1677an, 0x644d626ffdn];

function descPolymod(c, val) {
  const c0 = c >> 35n;
  c = ((c & 0x7ffffffffn) << 5n) ^ BigInt(val);
  for (let i = 0; i < 5; i++) if ((c0 >> BigInt(i)) & 1n) c ^= DESC_GEN[i];
  return c;
}

/** BIP380 output descriptor checksum (8 characters). */
export function descriptorChecksum(desc) {
  let c = 1n;
  let cls = 0;
  let clsCount = 0;
  for (const ch of desc) {
    const pos = DESC_INPUT.indexOf(ch);
    if (pos < 0) throw new Error(`Invalid descriptor character: ${ch}`);
    c = descPolymod(c, pos & 31);
    cls = cls * 3 + (pos >> 5);
    if (++clsCount === 3) {
      c = descPolymod(c, cls);
      cls = 0;
      clsCount = 0;
    }
  }
  if (clsCount > 0) c = descPolymod(c, cls);
  for (let i = 0; i < 8; i++) c = descPolymod(c, 0);
  c ^= 1n;
  let out = '';
  for (let i = 0; i < 8; i++) out += DESC_CHECK[Number((c >> BigInt(5 * (7 - i))) & 31n)];
  return out;
}

export const withChecksum = (desc) => `${desc}#${descriptorChecksum(desc)}`;

// ------------------------------------------------------------- derivation

const fingerprintHex = (n) => (n >>> 0).toString(16).padStart(8, '0');

/**
 * Derive the public "watch-only kit" for a mnemonic: master fingerprint,
 * account xpubs, output descriptors and the first `count` receive addresses
 * for every script type. Nothing private is returned.
 */
export function deriveWallet(mnemonic, passphrase = '', opts = {}) {
  const network = opts.network || NETWORKS.mainnet;
  const account = opts.account ?? 0;
  const count = opts.count ?? 5;
  if (!Number.isInteger(account) || account < 0 || account >= 0x80000000) throw new Error('Invalid account index');
  if (!Number.isInteger(count) || count < 1 || count > 1000) throw new Error('Address count must be 1-1000');

  const phrase = normalizeMnemonic(mnemonic);
  const problem = mnemonicProblem(phrase);
  if (problem) throw new Error(problem);

  const seed = mnemonicToSeedSync(phrase, String(passphrase).normalize('NFKD'));
  const root = HDKey.fromMasterSeed(seed, network.bip32);
  seed.fill(0);
  const masterFingerprint = fingerprintHex(root.fingerprint);

  const scripts = SCRIPT_TYPES.filter((type) => network.scriptTypes.includes(type.id)).map((type) => {
    const origin = `${type.purpose}h/${network.coinType}h/${account}h`;
    const accountPath = `m/${type.purpose}'/${network.coinType}'/${account}'`;
    const acct = root.derive(accountPath);
    const xpub = acct.publicExtendedKey;
    const pubAcct = HDKey.fromExtendedKey(xpub, network.bip32); // public-only from here on
    acct.wipePrivateData();
    const receive = pubAcct.deriveChild(0);
    const addresses = [];
    for (let i = 0; i < count; i++) {
      addresses.push({
        index: i,
        path: `${accountPath}/0/${i}`,
        address: encodeAddress(type.id, receive.deriveChild(i).publicKey, network),
      });
    }
    const key = `[${masterFingerprint}/${origin}]${xpub}`;
    return {
      type: type.id,
      bip: type.bip,
      label: type.label,
      note: network.notes[type.id] || type.note,
      accountPath,
      xpub,
      descriptors: {
        receive: withChecksum(type.wrap(`${key}/0/*`)),
        change: withChecksum(type.wrap(`${key}/1/*`)),
      },
      addresses,
    };
  });
  root.wipePrivateData();

  return {
    network: network.name,
    masterFingerprint,
    account,
    passphraseUsed: String(passphrase).length > 0,
    scripts,
  };
}

/** The public kit written to disk / carried to the online machine. */
export function buildWatchKit(wallet, { range = 999 } = {}) {
  const importdescriptors = [];
  for (const s of wallet.scripts) {
    importdescriptors.push({ desc: s.descriptors.receive, active: true, internal: false, range: [0, range], timestamp: 'now' });
    importdescriptors.push({ desc: s.descriptors.change, active: true, internal: true, range: [0, range], timestamp: 'now' });
  }
  return {
    format: 'dgb-coldprep-watch-kit',
    formatVersion: 1,
    tool: `dgb-coldprep ${VERSION}`,
    containsPrivateKeys: false,
    network: wallet.network,
    masterFingerprint: wallet.masterFingerprint,
    account: wallet.account,
    passphraseUsed: wallet.passphraseUsed,
    scripts: wallet.scripts.map(({ note, ...rest }) => rest),
    importdescriptors,
  };
}

/**
 * Compare a freshly derived wallet against a saved watch kit.
 * Returns a list of human-readable mismatches (empty = identical).
 */
export function compareToKit(wallet, kit) {
  const diffs = [];
  if (kit?.format !== 'dgb-coldprep-watch-kit') return ['Not a dgb-coldprep watch kit file'];
  if (kit.network !== wallet.network) diffs.push(`network: kit=${kit.network} derived=${wallet.network}`);
  if (kit.masterFingerprint !== wallet.masterFingerprint) {
    diffs.push(`master fingerprint: kit=${kit.masterFingerprint} derived=${wallet.masterFingerprint}`);
  }
  for (const s of wallet.scripts) {
    const k = (kit.scripts || []).find((x) => x.type === s.type);
    if (!k) {
      diffs.push(`${s.type}: missing from kit`);
      continue;
    }
    if (k.xpub !== s.xpub) diffs.push(`${s.type}: account xpub differs`);
    if (k.descriptors?.receive !== s.descriptors.receive) diffs.push(`${s.type}: receive descriptor differs`);
    const n = Math.min(k.addresses?.length || 0, s.addresses.length);
    if (n === 0) diffs.push(`${s.type}: kit has no addresses to compare`);
    for (let i = 0; i < n; i++) {
      if (k.addresses[i].address !== s.addresses[i].address) diffs.push(`${s.type}: address #${i} differs`);
    }
  }
  return diffs;
}

// --------------------------------------------------------------- selftest

const ABANDON = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const BTC = NETWORKS.bitcoin;

/**
 * Known-answer tests run before any key is generated. A corrupted download,
 * a broken JS runtime or a tampered dependency fails here instead of
 * silently producing addresses nobody can spend from.
 */
export function selfTest() {
  const results = [];
  const check = (name, got, want) => results.push({ name, ok: got === want, got, want });

  // BIP39 reference vectors (trezor/python-mnemonic)
  check('BIP39 entropy→mnemonic (128-bit)', mnemonicFromEntropy(new Uint8Array(16)), ABANDON);
  check(
    'BIP39 entropy→mnemonic (256-bit)',
    mnemonicFromEntropy(new Uint8Array(32).fill(0x7f)),
    'legal winner thank year wave sausage worth useful legal winner thank year wave sausage worth useful legal winner thank year wave sausage worth title'
  );
  check(
    'BIP39 mnemonic→seed (PBKDF2-HMAC-SHA512)',
    bytesToHex(mnemonicToSeedSync(ABANDON, 'TREZOR')),
    'c55257c360c07c72029aebc1b53c05ed0362ada38ead3e3e9efa3708e53495531f09a6987599d18264c1e1c92f2cf141630c7a3c4ab7c81b2f001698e7463b04'
  );
  check('BIP39 checksum rejects a swapped word', String(isValidMnemonic(ABANDON.replace(/about$/, 'abandon'))), 'false');
  check('BIP39 round trip', bytesToHex(mnemonicToEntropy(ABANDON, wordlist)), '00'.repeat(16));

  // BIP32/44/49/84/86 reference vectors (Bitcoin parameters, from the BIPs)
  const btc = deriveWallet(ABANDON, '', { network: BTC, count: 1 });
  const btcAddr = (t) => btc.scripts.find((s) => s.type === t).addresses[0].address;
  check('BIP32 master fingerprint', btc.masterFingerprint, '73c5da0a');
  check('BIP44 P2PKH vector', btcAddr('p2pkh'), '1LqBGSKuX5yYUonjxT5qGfpUsXKYYWeabA');
  check('BIP49 P2SH-P2WPKH vector', btcAddr('p2sh-p2wpkh'), '37VucYSaXLCAsxYyAPfbSi9eh4iEcbShgf');
  check('BIP84 P2WPKH vector', btcAddr('p2wpkh'), 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu');
  check('BIP86 P2TR vector', btcAddr('p2tr'), 'bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr');
  check(
    'BIP86 account xpub',
    btc.scripts.find((s) => s.type === 'p2tr').xpub,
    'xpub6BgBgsespWvERF3LHQu6CnqdvfEvtMcQjYrcRzx53QJjSxarj2afYWcLteoGVky7D3UKDP9QyrLprQ3VCECoY49yfdDEHGCtMMj92pReUsQ'
  );

  // BIP380 descriptor checksum
  check('BIP380 descriptor checksum', descriptorChecksum('raw(deadbeef)'), '89f8spxm');

  // DigiByte vectors (cross-checked against bitcoinjs-lib with DigiByte parameters)
  const dgb = deriveWallet(ABANDON, '', { network: NETWORKS.mainnet, count: 1 });
  const dgbAddr = (t) => dgb.scripts.find((s) => s.type === t).addresses[0].address;
  for (const [type, want] of Object.entries(DGB_VECTORS)) check(`DigiByte ${type} m/…'/20'/0'/0/0`, dgbAddr(type), want);
  for (const s of dgb.scripts) {
    for (const a of s.addresses) {
      const res = checkAddress(a.address);
      check(`DigiByte ${s.type} address decodes`, String(res.valid), 'true');
    }
  }
  // Litecoin and Dogecoin vectors (cross-checked against bitcoinjs-lib)
  for (const [net, vectors] of Object.entries(CHAIN_VECTORS)) {
    const w = deriveWallet(ABANDON, '', { network: NETWORKS[net], count: 1 });
    check(`${NETWORKS[net].label} offers exactly its supported address types`, w.scripts.map((x) => x.type).sort().join(), Object.keys(vectors).sort().join());
    for (const [type, want] of Object.entries(vectors)) {
      const got = w.scripts.find((x) => x.type === type)?.addresses[0].address;
      check(`${NETWORKS[net].label} ${type}`, got, want);
      check(`${NETWORKS[net].label} ${type} address decodes`, String(checkAddress(want, NETWORKS[net]).valid), 'true');
    }
  }
  check('Address checker rejects a typo', String(checkAddress(dgbAddr('p2wpkh').replace(/.$/, (c) => (c === 'q' ? 'p' : 'q'))).valid), 'false');

  return { ok: results.every((r) => r.ok), results };
}

export const DGB_VECTORS = Object.freeze({
  p2pkh: 'DG1KhhBKpsyWXTakHNezaDQ34focsXjN1i',
  'p2sh-p2wpkh': 'SQ9EXABrHztGgefL9aH3FyeRjowdjtLfn4',
  p2wpkh: 'dgb1q9gmf0pv8jdymcly6lz6fl7lf6mhslsd72e2jq8',
  p2tr: 'dgb1pcevt23hht82rkdrjdpwzstmqyj4ngyy42r9cu73rl4n9h5vu6hgsx5tm5q',
});

export const CHAIN_VECTORS = Object.freeze({
  litecoin: Object.freeze({
    p2pkh: 'LUWPbpM43E2p7ZSh8cyTBEkvpHmr3cB8Ez',
    'p2sh-p2wpkh': 'M7wtsL7wSHDBJVMWWhtQfTMSYYkyooAAXM',
    p2wpkh: 'ltc1qjmxnz78nmc8nq77wuxh25n2es7rzm5c2rkk4wh',
    p2tr: 'ltc1puht8rk95c53q3u9w3pf9h3jfcutcrl9lxc7rqsdthjrse4k6sn7q9tuqm9',
  }),
  dogecoin: Object.freeze({ p2pkh: 'DBus3bamQjgJULBJtYXpEzDWQRwF5iwxgC' }),
});
