// Offline web front end. Same core as the CLI; no network, no storage.

import {
  NETWORKS,
  VERSION,
  buildWatchKit,
  compareToKit,
  deriveWallet,
  diceBits,
  diceOnlyEntropy,
  mixEntropy,
  mnemonicFromEntropy,
  mnemonicProblem,
  normalizeDice,
  normalizeMnemonic,
  selfTest,
  wordsToBits,
} from '../core.js';

const $ = (id) => document.getElementById(id);
const el = (tag, text, cls) => {
  const n = document.createElement(tag);
  if (text != null) n.textContent = text;
  if (cls) n.className = cls;
  return n;
};
const show = (id, on = true) => ($(id).hidden = !on);

let state = null; // { mnemonic, passphrase, wallet } — lives only in this tab's memory
let safe = true;

function addCheck(ok, text) {
  $('checks').append(el('li', text, ok ? 'ok' : 'bad'));
  if (!ok) safe = false;
}

function environmentChecks() {
  $('version').textContent = `v${VERSION}`;
  let tests;
  try {
    tests = selfTest();
  } catch (e) {
    tests = { ok: false, results: [{ ok: false, name: String(e) }] };
  }
  if (tests.ok) addCheck(true, `Self-test passed (${tests.results.length} known-answer checks)`);
  else {
    const failed = tests.results.filter((r) => !r.ok).map((r) => r.name).join('; ');
    addCheck(false, `SELF-TEST FAILED (${failed}). Do not use this copy.`);
    $('generate').disabled = true;
    $('verify').disabled = true;
    return false;
  }
  const hasRng = typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function';
  addCheck(hasRng, hasRng ? 'Cryptographic random generator available' : 'No cryptographic random generator in this browser');
  const local = location.protocol === 'file:';
  addCheck(local, local ? 'Opened from a local file' : `Loaded from ${location.protocol}//${location.host} — a cold seed must never be made on a served page. Save this file and open it offline.`);
  addCheck(!navigator.onLine, navigator.onLine ? 'This machine has a network connection. Disconnect it (or use an air-gapped machine) first.' : 'No network connection detected');
  if (!safe) show('practiceRow');
  return true;
}

const allowed = () => safe || $('practice').checked;

function gatherEntropy(bits) {
  const dice = normalizeDice($('dice').value);
  if ($('diceOnly').checked) {
    if (new Set(dice).size < 4 && dice.length) throw new Error('Those rolls do not look random. Roll a real die.');
    return { entropy: diceOnlyEntropy(dice, bits), source: `${dice.length} dice rolls only` };
  }
  const os = crypto.getRandomValues(new Uint8Array(64));
  if (!dice) return { entropy: mixEntropy(os, null, bits), source: 'browser random generator' };
  return {
    entropy: mixEntropy(os, dice, bits),
    source: `browser random generator + ${dice.length} dice rolls (~${Math.min(bits, diceBits(dice.length))} bits)`,
  };
}

function generate() {
  $('setupError').textContent = '';
  try {
    if (!allowed()) throw new Error('Fix the failed checks above, or tick practice mode.');
    const p1 = $('pass1').value;
    if (p1 !== $('pass2').value) throw new Error('Passphrases do not match.');
    const words = Number($('words').value);
    const count = Number($('count').value);
    const { entropy, source } = gatherEntropy(wordsToBits(words));
    const mnemonic = mnemonicFromEntropy(entropy);
    entropy.fill(0);
    const wallet = deriveWallet(mnemonic, p1, { network: NETWORKS[$('network').value], count });
    state = { mnemonic, passphrase: p1, wallet, count };
    for (const id of ['dice', 'pass1', 'pass2']) $(id).value = '';
    $('mnemonic').replaceChildren(...mnemonic.split(' ').map((w) => el('li', w)));
    $('fpWrite').textContent = wallet.masterFingerprint;
    $('entropySource').textContent = `Entropy source: ${source}`;
    show('stepSetup', false);
    show('stepWrite');
    $('written').focus();
  } catch (e) {
    $('setupError').textContent = e.message;
  }
}

function written() {
  $('mnemonic').replaceChildren(); // words leave the screen before the quiz
  show('stepWrite', false);
  show('stepProve');
  $('retype').focus();
}

function prove() {
  const typed = normalizeMnemonic($('retype').value);
  if (typed !== state.mnemonic) {
    const problem = mnemonicProblem(typed);
    const want = state.mnemonic.split(' ');
    const got = typed.split(' ');
    const wrong = want.map((w, i) => (got[i] === w ? null : i + 1)).filter(Boolean);
    $('proveError').textContent = problem || `Valid phrase, but not this one. Check word(s) #${wrong.slice(0, 6).join(', #')}.`;
    return;
  }
  // Independent second derivation from what the user typed.
  const again = deriveWallet(typed, state.passphrase, { network: NETWORKS[state.wallet.network], count: state.count });
  if (JSON.stringify(again) !== JSON.stringify(state.wallet)) {
    $('proveError').textContent = 'Internal error: derivation is not deterministic. Do not use this seed.';
    return;
  }
  $('retype').value = '';
  $('proveError').textContent = '';
  show('stepProve', false);
  renderResult(state.wallet, { title: '4 · Your cold-storage addresses', kit: true });
}

function renderResult(wallet, { title, kit, match }) {
  $('resultTitle').textContent = title;
  $('rNetwork').textContent = NETWORKS[wallet.network].label;
  $('rFp').textContent = wallet.masterFingerprint;
  $('rPass').textContent = wallet.passphraseUsed ? 'YES — required for recovery; back it up separately' : 'none';
  const blocks = wallet.scripts.map((s) => {
    const box = el('div', null, 'script');
    const h = el('h3', `${s.label} `);
    h.append(el('span', `· ${s.bip} · ${s.accountPath}/0/i`, 'muted'));
    const list = el('ul', null, 'addr');
    for (const a of s.addresses) {
      const li = el('li');
      li.append(el('span', String(a.index)), document.createTextNode(a.address));
      list.append(li);
    }
    const det = el('details');
    det.append(el('summary', 'xpub and descriptors'), el('pre', `xpub     ${s.xpub}\nreceive  ${s.descriptors.receive}\nchange   ${s.descriptors.change}`));
    box.append(h, el('p', s.note, 'muted small'), list, det);
    return box;
  });
  $('scripts').replaceChildren(...blocks);
  show('kitBox', Boolean(kit));
  $('kit').value = kit ? JSON.stringify(buildWatchKit(wallet), null, 2) : '';
  const m = $('match');
  m.hidden = !match;
  if (match) {
    m.textContent = match.text;
    m.className = `match ${match.ok ? 'ok' : 'bad'}`;
  }
  show('stepResult');
  $('stepResult').scrollIntoView();
}

function download() {
  const fp = state.wallet.masterFingerprint;
  const net = state.wallet.network === 'mainnet' ? '' : `-${state.wallet.network}`;
  const url = URL.createObjectURL(new Blob([$('kit').value + '\n'], { type: 'application/json' }));
  const a = el('a');
  a.href = url;
  a.download = `dgb-watch-kit-${fp}${net}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function verify() {
  $('verifyError').textContent = '';
  try {
    if (!allowed()) throw new Error('Fix the failed checks above, or tick practice mode.');
    const phrase = normalizeMnemonic($('vMnemonic').value);
    const problem = mnemonicProblem(phrase);
    if (problem) throw new Error(problem);
    const kitText = $('vKit').value.trim();
    let kit = null;
    if (kitText) {
      try {
        kit = JSON.parse(kitText);
      } catch {
        throw new Error('The kit is not valid JSON.');
      }
    }
    const count = kit?.scripts?.[0]?.addresses?.length || 5;
    const wallet = deriveWallet(phrase, $('vPass').value, { network: NETWORKS[$('vNetwork').value], count });
    $('vMnemonic').value = '';
    $('vPass').value = '';
    let match = null;
    if (kit) {
      const diffs = compareToKit(wallet, kit);
      match = diffs.length
        ? { ok: false, text: `✘ MISMATCH — ${diffs.join('; ')}. Wrong words, wrong passphrase or wrong kit. Do not fund until this matches.` }
        : { ok: true, text: '✔ MATCH — this backup reproduces every key and address in the kit.' };
    }
    renderResult(wallet, { title: 'Restored wallet', kit: false, match });
  } catch (e) {
    $('verifyError').textContent = e.message;
  }
}

function wipe() {
  state = null;
  for (const n of document.querySelectorAll('input, textarea')) n.value = '';
  $('mnemonic').replaceChildren();
  $('scripts').replaceChildren();
  location.reload();
}

function tab(which) {
  if (state && !confirm('Discard the seed in progress?')) return;
  state = null;
  $('mnemonic').replaceChildren();
  $('tabNew').classList.toggle('active', which === 'new');
  $('tabVerify').classList.toggle('active', which === 'verify');
  for (const id of ['stepWrite', 'stepProve', 'stepResult']) show(id, false);
  show('stepSetup', which === 'new');
  show('stepVerify', which === 'verify');
}

if (environmentChecks()) {
  $('generate').addEventListener('click', generate);
  $('written').addEventListener('click', written);
  $('prove').addEventListener('click', prove);
  $('download').addEventListener('click', download);
  $('verify').addEventListener('click', verify);
  $('wipe').addEventListener('click', wipe);
  $('tabNew').addEventListener('click', () => tab('new'));
  $('tabVerify').addEventListener('click', () => tab('verify'));
  // Seed words must not reach the clipboard or a printer by accident.
  $('mnemonic').addEventListener('copy', (e) => e.preventDefault());
}
