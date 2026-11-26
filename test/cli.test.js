import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const BUNDLE = path.join(root, 'dist', 'dgb-coldprep.cjs');
const TEST_FLAGS = ['--allow-online', '--unsafe-no-tty'];
const run = (args, input = '') => spawnSync(process.execPath, [BUNDLE, ...args], { input, encoding: 'utf8' });

/** Drive an interactive session: answer each prompt as it appears. */
function drive(args, cwd, respond) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BUNDLE, ...args], { cwd });
    let stdout = '';
    let stderr = '';
    let seen = 0;
    child.stdout.on('data', (d) => {
      stdout += d;
      for (;;) {
        const nl = stdout.indexOf('\n', seen);
        if (nl < 0) break;
        const line = stdout.slice(seen, nl);
        seen = nl + 1;
        const answer = respond(line, stdout);
        if (answer != null) child.stdin.write(answer + '\n');
      }
    });
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

const wordsFrom = (stdout) => {
  const found = [...stdout.matchAll(/(\d+)\. ([a-z]+)/g)].map((m) => [Number(m[1]), m[2]]);
  return found.sort((a, b) => a[0] - b[0]).map((x) => x[1]);
};

test('dist bundle is current and matches SHA256SUMS', () => {
  const res = spawnSync(process.execPath, ['build.mjs', '--check'], { cwd: root, encoding: 'utf8' });
  assert.equal(res.status, 0, res.stdout + res.stderr);
  for (const line of fs.readFileSync(path.join(root, 'dist', 'SHA256SUMS'), 'utf8').trim().split('\n')) {
    const [sum, name] = line.split(/\s+/);
    assert.equal(createHash('sha256').update(fs.readFileSync(path.join(root, 'dist', name))).digest('hex'), sum);
  }
});

test('bundle needs nothing but Node built-ins', () => {
  const src = fs.readFileSync(BUNDLE, 'utf8');
  const mods = [...src.matchAll(/require\("([^"]+)"\)/g)].map((m) => m[1]);
  assert.ok(mods.length > 0);
  for (const m of mods) assert.match(m, /^node:(crypto|fs|os|path|readline)$/);
  assert.doesNotMatch(src, /node:(http|https|net|dgram|tls|dns|child_process)|fetch\(|XMLHttpRequest|WebSocket/);
});

test('web page forbids all network access and is self-contained', () => {
  const html = fs.readFileSync(path.join(root, 'dist', 'dgb-coldprep.html'), 'utf8');
  assert.match(html, /Content-Security-Policy" content="default-src 'none'; script-src 'sha256-[A-Za-z0-9+/=]+'; style-src 'sha256-/);
  assert.doesNotMatch(html, /<script[^>]+src=|<link[^>]+href=|<img|fetch\(|XMLHttpRequest|WebSocket|sendBeacon|localStorage|indexedDB/);
});

test('selftest, check-address, usage errors', () => {
  assert.equal(run(['selftest']).status, 0);
  assert.equal(run(['check-address', 'dgb1q9gmf0pv8jdymcly6lz6fl7lf6mhslsd72e2jq8']).status, 0);
  assert.equal(run(['check-address', 'dgb1q9gmf0pv8jdymcly6lz6fl7lf6mhslsd72e2jq9']).status, 1);
  assert.equal(run(['--bogus']).status, 2);
  assert.equal(run(['--words', '13']).status, 2);
  assert.match(run(['--help']).stdout, /Usage:/);
});

test('refuses to make a seed when piped, and when a network interface is up', () => {
  const piped = run([]);
  assert.equal(piped.status, 1);
  assert.match(piped.stderr, /not an interactive terminal/);
  assert.doesNotMatch(piped.stdout, /Step 3/);
  const hasNet = Object.values(os.networkInterfaces()).flat().some((a) => !a.internal);
  if (hasNet) {
    const online = run(['--unsafe-no-tty']);
    assert.equal(online.status, 1);
    assert.match(online.stderr, /active network interface/);
    assert.doesNotMatch(online.stdout, /Step 3/);
  }
});

test('full ceremony → watch kit → recovery drill', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coldprep-'));
  let words;
  const made = await drive([...TEST_FLAGS, '--out', dir, '--count', '3'], dir, (line, all) => {
    if (line.startsWith('Dice rolls:')) return '1234561234';
    if (line.startsWith('BIP39 passphrase')) return 'hunter2';
    if (line.startsWith('Repeat passphrase')) return 'hunter2';
    if (line.startsWith('Press Enter when you have written')) return ((words = wordsFrom(all)), '');
    if (line.startsWith('Seed phrase:')) return words.join(' ');
    if (line.startsWith('Press Enter to clear')) return '';
    return null;
  });
  assert.equal(made.code, 0, made.stdout + made.stderr);
  assert.equal(words.length, 24);
  // The seed words appear exactly once (step 3) and never after verification.
  assert.doesNotMatch(made.stdout.split('Backup verified')[1], new RegExp(`\\b${words[5]}\\b.*\\b${words[6]}\\b`));

  const files = fs.readdirSync(dir);
  assert.equal(files.length, 1);
  const kitFile = path.join(dir, files[0]);
  const text = fs.readFileSync(kitFile, 'utf8');
  const kit = JSON.parse(text);
  assert.doesNotMatch(text, /prv|hunter2/);
  // Compare against the kit's string values only: some JSON keys ("label",
  // "index", "account", "network", "change") are BIP39 words themselves.
  const values = new Set();
  JSON.parse(text, (k, v) => (typeof v === 'string' && values.add(v), v));
  for (const w of new Set(words)) assert.ok(!values.has(w), `seed word "${w}" is a value in the kit`);
  for (let i = 0; i + 3 <= words.length; i++) assert.doesNotMatch(text, new RegExp(`\\b${words.slice(i, i + 3).join('\\s+')}\\b`));
  assert.equal(kit.passphraseUsed, true);
  assert.equal(kit.scripts.length, 4);
  assert.equal(kit.scripts[0].addresses.length, 3);
  assert.match(kit.scripts[0].addresses[0].address, /^dgb1q/);

  const answers = (pass) => (line) => {
    if (line.startsWith('Seed phrase:')) return words.join(' ');
    if (line.startsWith('BIP39 passphrase')) return pass;
    if (line.startsWith('Press Enter to clear')) return '';
    return null;
  };
  const good = await drive(['verify', ...TEST_FLAGS, '--kit', kitFile, '--count', '3'], dir, answers('hunter2'));
  assert.equal(good.code, 0, good.stdout + good.stderr);
  assert.match(good.stdout, /MATCH: this backup reproduces/);
  const bad = await drive(['verify', ...TEST_FLAGS, '--kit', kitFile, '--count', '3'], dir, answers('hunter3'));
  assert.equal(bad.code, 1);
  assert.match(bad.stdout, /MISMATCH/);
  fs.rmSync(dir, { recursive: true });
});

test('a failed backup check discards the seed and writes nothing', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coldprep-'));
  const res = await drive([...TEST_FLAGS, '--no-dice', '--no-passphrase', '--words', '12', '--out', dir], dir, (line) => {
    if (line.startsWith('Press Enter when you have written')) return '';
    if (line.startsWith('Seed phrase:')) return 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    return null;
  });
  assert.equal(res.code, 1);
  assert.match(res.stderr, /Backup verification failed/);
  assert.deepEqual(fs.readdirSync(dir), []);
  fs.rmSync(dir, { recursive: true });
});

test('--require-dice insists on a full set of rolls', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coldprep-'));
  let asked = 0;
  const res = await drive([...TEST_FLAGS, '--require-dice', '--no-passphrase', '--no-kit', '--words', '12'], dir, (line) => {
    if (line.startsWith('Dice rolls:')) return ['', '123456', '1'.repeat(60), '1234561234'.repeat(5)][asked++];
    if (line.startsWith('Press Enter when you have written')) return '';
    if (line.startsWith('Seed phrase:')) return 'x';
    return null;
  });
  assert.equal(asked, 4);
  assert.equal((res.stdout.match(/requires at least 50 real dice rolls/g) || []).length, 3);
  assert.match(res.stdout, /system RNG \+ 50 dice rolls/);
  assert.equal(run(['--require-dice', '--no-dice']).status, 2);
  fs.rmSync(dir, { recursive: true });
});

test('--require-passphrase refuses an empty passphrase', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coldprep-'));
  let asked = 0;
  const res = await drive([...TEST_FLAGS, '--require-passphrase', '--no-dice', '--no-kit', '--words', '12'], dir, (line) => {
    if (line.startsWith('BIP39 passphrase')) return ['', 'correct horse'][asked++];
    if (line.startsWith('Repeat passphrase')) return 'correct horse';
    if (line.startsWith('Press Enter when you have written')) return '';
    if (line.startsWith('Seed phrase:')) return 'x';
    return null;
  });
  assert.equal(asked, 2);
  assert.match(res.stdout, /A passphrase is required in this mode/);
  assert.doesNotMatch(res.stdout, /Enter for none/);
  assert.equal(run(['--require-passphrase', '--no-passphrase']).status, 2);
  fs.rmSync(dir, { recursive: true });
});

test('--chains all derives every chain from one seed, DigiByte first', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coldprep-'));
  let words;
  const res = await drive([...TEST_FLAGS, '--chains', 'doge,all', '--no-dice', '--no-passphrase', '--words', '12', '--count', '1', '--out', dir], dir, (line, all) => {
    if (line.startsWith('Press Enter when you have written and double-checked all words')) return ((words = wordsFrom(all)), '');
    if (line.startsWith('Seed phrase:')) return words.join(' ');
    if (line.startsWith('Press Enter for ')) return '';
    if (line.startsWith('Show the 25-word Monero seed')) return 'y';
    if (line.startsWith('Press Enter when you have written and double-checked all 25')) return '';
    if (line.startsWith('Press Enter to clear')) return '';
    return null;
  });
  assert.equal(res.code, 0, res.stdout + res.stderr);
  const order = [...res.stdout.matchAll(/^Chain:\s+(\S+)/gm)].map((m) => m[1]);
  assert.deepEqual(order, ['DigiByte', 'Bitcoin', 'Litecoin', 'Dogecoin', 'Monero']);
  assert.match(res.stdout, /One seed, 5 chains: DGB, BTC, LTC, DOGE, XMR/);
  assert.match(res.stdout, /Primary address\s+4[1-9A-HJ-NP-Za-km-z]{94}/);
  assert.match(res.stdout, /Private view key\s+[0-9a-f]{64}/);
  const xmrWords = wordsFrom(res.stdout.split('Monero 25-word seed')[1].split('Monero seed shown once')[0]);
  assert.equal(xmrWords.length, 25);
  const kits = fs.readdirSync(dir).sort().map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
  assert.deepEqual(kits.map((k) => k.network).sort(), ['bitcoin', 'dogecoin', 'litecoin', 'mainnet', 'monero']);
  const xmrKit = kits.find((k) => k.network === 'monero');
  assert.equal(xmrKit.containsPrivateViewKey, true);
  for (const w of new Set(xmrWords)) if (w.length > 5) assert.doesNotMatch(JSON.stringify(kits), new RegExp(`\\b${w}\\b`));
  assert.equal(new Set(kits.map((k) => k.masterFingerprint)).size, 1);
  assert.match(kits.find((k) => k.network === 'bitcoin').scripts[0].addresses[0].address, /^bc1q/);
  assert.deepEqual(kits.find((k) => k.network === 'dogecoin').scripts.map((x) => x.type), ['p2pkh']);

  // A kit names its chain, so the recovery drill restores the right one unprompted.
  const ltcKit = fs.readdirSync(dir).find((f) => f.includes('litecoin'));
  const drill = await drive(['verify', ...TEST_FLAGS, '--no-passphrase', '--count', '1', '--kit', path.join(dir, ltcKit)], dir, (line) => {
    if (line.startsWith('Seed phrase:')) return words.join(' ');
    if (line.startsWith('Press Enter to clear')) return '';
    return null;
  });
  assert.equal(drill.code, 0, drill.stdout + drill.stderr);
  assert.match(drill.stdout, /Chain:\s+Litecoin/);
  assert.match(drill.stdout, /MATCH: this backup reproduces/);

  assert.equal(run(['check-address', '--chains', 'btc', 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu']).status, 0);
  assert.equal(run(['check-address', 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu']).status, 1);
  assert.match(run(['check-address', '--chains', 'doge', 'DBus3bamQjgJULBJtYXpEzDWQRwF5iwxgC']).stdout, /share this format/);
  assert.equal(run(['--chains', 'xyz']).status, 2);
  fs.rmSync(dir, { recursive: true });
});

test('--qr shows scannable codes for public data only', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coldprep-'));
  let words;
  const res = await drive([...TEST_FLAGS, '--qr', '--chains', 'dgb,xmr', '--no-dice', '--no-passphrase', '--no-kit', '--words', '12', '--count', '1'], dir, (line, all) => {
    if (line.startsWith('Press Enter when you have written and double-checked all words')) return ((words = wordsFrom(all)), '');
    if (line.startsWith('Seed phrase:')) return words.join(' ');
    if (line.startsWith('Show QR codes for')) return 'y';
    if (line.startsWith('Show the 25-word Monero seed')) return 'n';
    if (line.startsWith('Enter for the next code') || line.startsWith('Press Enter')) return '';
    return null;
  });
  assert.equal(res.code, 0, res.stdout + res.stderr);
  const titles = [...res.stdout.matchAll(/^(DigiByte mainnet|Monero) .*(address|descriptor|view key).*$/gm)].map((m) => m[0]);
  assert.equal(titles.filter((t) => t.startsWith('DigiByte')).length, 8); // 4 types x (address + descriptor)
  assert.equal(titles.filter((t) => t.startsWith('Monero')).length, 2);
  assert.match(res.stdout, /█▀▀▀▀▀█/); // a finder pattern was drawn
  // Seed words never appear after the backup is verified, QR screens included.
  const after = res.stdout.split('Backup verified')[1];
  assert.doesNotMatch(after, new RegExp(`\\b${words[3]} ${words[4]}\\b`));
  assert.doesNotMatch(after, /xprv|Monero 25-word seed/);
  fs.rmSync(dir, { recursive: true });
});
