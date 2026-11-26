import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DGB_VECTORS,
  NETWORKS,
  buildWatchKit,
  checkAddress,
  compareToKit,
  deriveWallet,
  descriptorChecksum,
  diceOnlyEntropy,
  mixEntropy,
  mnemonicFromEntropy,
  mnemonicProblem,
  normalizeDice,
  selfTest,
} from '../src/core.js';

const ABANDON = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const LEGAL = 'legal winner thank year wave sausage worth useful legal winner thank year wave sausage worth useful legal winner thank year wave sausage worth title';
const addr = (w, type, i = 0) => w.scripts.find((s) => s.type === type).addresses[i].address;

test('self-test passes', () => {
  const res = selfTest();
  assert.deepEqual(res.results.filter((r) => !r.ok), []);
  assert.ok(res.results.length >= 20);
});

test('DigiByte mainnet vectors (cross-checked against bitcoinjs-lib v6)', () => {
  const w = deriveWallet(ABANDON, '', { count: 4 });
  assert.equal(w.masterFingerprint, '73c5da0a');
  for (const [type, want] of Object.entries(DGB_VECTORS)) assert.equal(addr(w, type), want);
  assert.equal(addr(w, 'p2tr', 3), 'dgb1pvl3h4yx9ya9vusnpjqcrdxv4xplr9lf2lsk2yc6c9j6vyj2elhfqnwy70m');
  assert.equal(
    w.scripts.find((s) => s.type === 'p2wpkh').xpub,
    'xpub6BmjNc3e3DmWgKc5xswF9m4pCrJ8qSw9LcHmLsdymvkuYm9BCRqYvkVbkC8JijGLZDwgG62hysxgAf32EdHVVQjiabWVfJ6xMRe425ph1B2'
  );
});

test('passphrase (unicode, NFKD) changes the wallet and matches reference', () => {
  const w = deriveWallet(LEGAL, 'cold ❄ storage');
  assert.equal(w.masterFingerprint, '64f27d92');
  assert.equal(w.passphraseUsed, true);
  assert.equal(addr(w, 'p2pkh'), 'DP4799HjVf7FMqCBPSd1eQAoeTQnGCeupA');
  assert.equal(addr(w, 'p2sh-p2wpkh'), 'ScPTd93YuCWbY22Ao8F7RunptuBBvYM2Kt');
  assert.equal(addr(w, 'p2wpkh'), 'dgb1qm6fu3pd43tj8ltjpvt6kpqnsdvas05g7nv4s02');
  assert.equal(addr(w, 'p2tr'), 'dgb1pu2vc3ky0mlnglwwu9gqv7knw04gt9svcel7xfhgr7jkqk2n9ev9svcejxd');
  assert.notEqual(deriveWallet(LEGAL, '').masterFingerprint, w.masterFingerprint);
});

test('mnemonic input is normalised (case, spacing)', () => {
  const messy = '  ' + ABANDON.toUpperCase().replace(/ /g, '   ') + '\n';
  assert.equal(deriveWallet(messy).masterFingerprint, '73c5da0a');
});

test('address prefixes per network', () => {
  const main = deriveWallet(ABANDON);
  assert.match(addr(main, 'p2pkh'), /^D/);
  assert.match(addr(main, 'p2sh-p2wpkh'), /^S/);
  assert.match(addr(main, 'p2wpkh'), /^dgb1q/);
  assert.match(addr(main, 'p2tr'), /^dgb1p/);
  const t = deriveWallet(ABANDON, '', { network: NETWORKS.testnet });
  assert.match(addr(t, 'p2wpkh'), /^dgbt1q/);
  assert.match(t.scripts[0].xpub, /^tpub/);
  assert.match(t.scripts[0].accountPath, /^m\/84'\/1'\/0'$/);
});

test('descriptors carry origin, wildcard and a valid BIP380 checksum', () => {
  assert.equal(descriptorChecksum('raw(deadbeef)'), '89f8spxm');
  const w = deriveWallet(ABANDON);
  const d = w.scripts.find((s) => s.type === 'p2wpkh').descriptors;
  assert.equal(
    d.receive,
    'wpkh([73c5da0a/84h/20h/0h]xpub6BmjNc3e3DmWgKc5xswF9m4pCrJ8qSw9LcHmLsdymvkuYm9BCRqYvkVbkC8JijGLZDwgG62hysxgAf32EdHVVQjiabWVfJ6xMRe425ph1B2/0/*)#xw9vv378'
  );
  assert.match(d.change, /\/1\/\*\)#[a-z0-9]{8}$/);
  assert.match(w.scripts.find((s) => s.type === 'p2tr').descriptors.receive, /^tr\(\[73c5da0a\/86h\/20h\/0h\]xpub/);
  assert.match(w.scripts.find((s) => s.type === 'p2sh-p2wpkh').descriptors.receive, /^sh\(wpkh\(/);
});

test('nothing private ever leaves deriveWallet / the watch kit', () => {
  const w = deriveWallet(ABANDON, 'secret-pass');
  const kit = buildWatchKit(w);
  const text = JSON.stringify([w, kit]);
  assert.doesNotMatch(text, /xprv|tprv|abandon|secret-pass/);
  assert.equal(kit.containsPrivateKeys, false);
  assert.equal(kit.importdescriptors.length, 8);
  assert.deepEqual(compareToKit(w, JSON.parse(JSON.stringify(kit))), []);
});

test('kit comparison detects a wrong seed or passphrase', () => {
  const kit = buildWatchKit(deriveWallet(ABANDON));
  assert.ok(compareToKit(deriveWallet(ABANDON, 'x'), kit).length > 0);
  assert.ok(compareToKit(deriveWallet(LEGAL), kit).length > 0);
  assert.deepEqual(compareToKit(deriveWallet(ABANDON), { format: 'other' }), ['Not a dgb-coldprep watch kit file']);
});

test('mnemonic problems are explained', () => {
  assert.equal(mnemonicProblem(ABANDON), null);
  assert.match(mnemonicProblem('abandon abandon'), /Expected 12 or 24 words, got 2/);
  assert.match(mnemonicProblem(ABANDON.replace('about', 'abuot')), /#12 "abuot"/);
  assert.match(mnemonicProblem(ABANDON.replace('about', 'abandon')), /Checksum failed/);
  assert.throws(() => deriveWallet(ABANDON.replace('about', 'abandon')), /Checksum failed/);
});

test('address checker', () => {
  for (const a of Object.values(DGB_VECTORS)) assert.equal(checkAddress(a).valid, true);
  assert.equal(checkAddress(DGB_VECTORS.p2tr).type, 'p2tr');
  assert.equal(checkAddress(DGB_VECTORS.p2wpkh.toUpperCase()).valid, true);
  assert.equal(checkAddress('dgb1q9gmf0pv8jdymcly6lz6fl7lf6mhslsd72e2jq9').valid, false);
  assert.equal(checkAddress('DG1KhhBKpsyWXTakHNezaDQ34focsXjN1j').valid, false);
  assert.equal(checkAddress('bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu').valid, false); // Bitcoin
  assert.equal(checkAddress('1LqBGSKuX5yYUonjxT5qGfpUsXKYYWeabA').valid, false); // Bitcoin
  assert.equal(checkAddress(DGB_VECTORS.p2wpkh, NETWORKS.testnet).valid, false);
});

test('entropy mixing', () => {
  const os1 = new Uint8Array(64).map((_, i) => i);
  const os2 = new Uint8Array(64).map((_, i) => i + 1);
  const hex = (b) => Buffer.from(b).toString('hex');
  assert.equal(mixEntropy(os1, null, 256).length, 32);
  assert.equal(mixEntropy(os1, null, 128).length, 16);
  assert.notEqual(hex(mixEntropy(os1, null)), hex(mixEntropy(os2, null)));
  assert.notEqual(hex(mixEntropy(os1, '123456')), hex(mixEntropy(os1, null)));
  assert.notEqual(hex(mixEntropy(os1, '123456')), hex(mixEntropy(os1, '123455')));
  assert.equal(hex(mixEntropy(os1, '123456')), hex(mixEntropy(os1, '123456')));
  assert.throws(() => mixEntropy(new Uint8Array(64)), /constant output/);
  assert.throws(() => mixEntropy(new Uint8Array(8)), /at least 32 bytes/);
  assert.equal(mnemonicFromEntropy(mixEntropy(os1, null, 256)).split(' ').length, 24);
  assert.equal(mnemonicFromEntropy(mixEntropy(os1, null, 128)).split(' ').length, 12);
});

test('dice handling', () => {
  assert.equal(normalizeDice('1 2,3\n4-5 6'), '123456');
  assert.throws(() => normalizeDice('1237'), /digits 1-6/);
  assert.throws(() => diceOnlyEntropy('123456'.repeat(16)), /at least 100 rolls/);
  // SHA-256("123456" x 17), reproducible with any sha256 tool
  const e = diceOnlyEntropy('123456'.repeat(17));
  assert.equal(e.length, 32);
  assert.equal(Buffer.from(e).toString('hex'), Buffer.from(diceOnlyEntropy(' 123456'.repeat(17))).toString('hex'));
});

test('input bounds', () => {
  assert.throws(() => deriveWallet(ABANDON, '', { count: 0 }), /count/);
  assert.throws(() => deriveWallet(ABANDON, '', { account: -1 }), /account/);
  const a1 = deriveWallet(ABANDON, '', { account: 1 });
  assert.match(a1.scripts[0].accountPath, /\/1'$/);
  assert.notEqual(addr(a1, 'p2wpkh'), DGB_VECTORS.p2wpkh);
});
