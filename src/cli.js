// dgb-coldprep command line: the one-command air-gapped cold-storage ceremony.

import nodeCrypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import {
  CHAINS,
  NETWORKS,
  VERSION,
  buildWatchKit,
  checkAddress,
  compareToKit,
  deriveWallet,
  diceBits,
  diceOnlyEntropy,
  mixEntropy,
  mnemonicFromEntropy,
  mnemonicProblem,
  moneroSeedWords,
  normalizeDice,
  normalizeMnemonic,
  selfTest,
  wordsToBits,
} from './core.js';

const HELP = `dgb-coldprep ${VERSION} — air-gapped cold-storage prep for DigiByte (plus BTC, LTC, DOGE, XMR)

Usage:
  dgb-coldprep [options]            Run the full cold-storage ceremony (default)
  dgb-coldprep verify [options]     Recovery drill: re-enter a seed phrase and
                                    confirm it reproduces the same addresses
  dgb-coldprep check-address ADDR   Validate a DigiByte address checksum
  dgb-coldprep selftest             Run the built-in known-answer tests

Ceremony options:
  --words 12|24        Seed phrase length (default 24 = 256-bit)
  --count N            Receive addresses to show per type (default 5)
  --account N          BIP44 account index (default 0)
  --chains LIST        Chains to derive from the one seed, comma separated:
                       dgb (default), btc, ltc, doge, xmr, or "all"
  --testnet            Derive for DigiByte testnet
  --no-dice            Do not ask for dice rolls (system RNG only)
  --dice-only          Derive entropy only from dice (auditable by hand)
  --require-dice       Refuse to continue without a full set of dice rolls,
                       mixed with the system RNG (for freshly booted devices)
  --no-passphrase      Do not ask for a BIP39 passphrase
  --require-passphrase Insist on a BIP39 passphrase ("24+1")
  --quick-verify       Quiz 4 random words instead of retyping the whole phrase
  --out DIR            Write the public watch-only kit to DIR without asking
  --no-kit             Never write anything to disk
  --show-descriptors   Print xpubs and output descriptors on screen

Verify options:
  --kit FILE           Compare against a saved watch-only kit
  (also --count, --account, --chains, --testnet, --no-passphrase)

check-address options:
  --chains NAME        Chain the address belongs to (default dgb)

Safety overrides (for testing only — do not use with real funds):
  --allow-online       Continue even though a network interface is up
  --unsafe-no-tty      Allow input/output that is not an interactive terminal
`;

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = paint('1');
const red = paint('1;31');
const yellow = paint('33');
const green = paint('32');
const dim = paint('2');
const out = (s = '') => process.stdout.write(s + '\n');

class UserAbort extends Error {}

function parseArgs(argv) {
  const opts = { command: 'ceremony', words: 24, count: 5, account: 0, positional: [] };
  const flags = {
    '--testnet': 'testnet',
    '--no-dice': 'noDice',
    '--dice-only': 'diceOnly',
    '--require-dice': 'requireDice',
    '--no-passphrase': 'noPassphrase',
    '--require-passphrase': 'requirePassphrase',
    '--quick-verify': 'quickVerify',
    '--no-kit': 'noKit',
    '--show-descriptors': 'showDescriptors',
    '--allow-online': 'allowOnline',
    '--unsafe-no-tty': 'unsafeNoTty',
    '--help': 'help',
    '-h': 'help',
    '--version': 'version',
  };
  const values = { '--words': 'words', '--count': 'count', '--account': 'account', '--out': 'out', '--kit': 'kit', '--chains': 'chains', '--chain': 'chains' };
  const args = [...argv];
  while (args.length) {
    const a = args.shift();
    if (flags[a]) opts[flags[a]] = true;
    else if (values[a]) {
      if (!args.length) throw new Error(`${a} needs a value`);
      const v = args.shift();
      opts[values[a]] = ['words', 'count', 'account'].includes(values[a]) ? Number(v) : v;
    } else if (a.startsWith('-')) throw new Error(`Unknown option: ${a}`);
    else opts.positional.push(a);
  }
  const commands = ['verify', 'check-address', 'selftest', 'ceremony'];
  if (opts.positional.length && commands.includes(opts.positional[0])) opts.command = opts.positional.shift();
  else if (opts.positional.length) throw new Error(`Unknown command: ${opts.positional[0]}`);
  wordsToBits(opts.words);
  opts.networks = parseChains(opts);
  if (!Number.isInteger(opts.count) || opts.count < 1 || opts.count > 1000) throw new Error('--count must be 1-1000');
  if (!Number.isInteger(opts.account) || opts.account < 0) throw new Error('--account must be a non-negative integer');
  if (opts.diceOnly && opts.noDice) throw new Error('--dice-only and --no-dice are mutually exclusive');
  if (opts.requireDice && (opts.noDice || opts.diceOnly)) throw new Error('--require-dice cannot be combined with --no-dice or --dice-only');
  if (opts.requirePassphrase && opts.noPassphrase) throw new Error('--require-passphrase and --no-passphrase are mutually exclusive');
  if (opts.out && opts.noKit) throw new Error('--out and --no-kit are mutually exclusive');
  return opts;
}

function parseChains(opts) {
  if (opts.testnet) {
    if (opts.chains) throw new Error('--testnet cannot be combined with --chains');
    return [NETWORKS.testnet];
  }
  const names = String(opts.chains || 'dgb')
    .toLowerCase()
    .split(',')
    .flatMap((n) => (n.trim() === 'all' ? Object.keys(CHAINS) : [n]));
  const picked = [];
  for (const raw of names) {
    const name = raw.trim();
    if (!CHAINS[name]) throw new Error(`Unknown chain "${name}". Choose from: ${Object.keys(CHAINS).join(', ')}, all`);
    if (!picked.includes(CHAINS[name])) picked.push(CHAINS[name]);
  }
  // DigiByte always leads when it is included.
  return picked.sort((a, b) => Object.values(CHAINS).indexOf(a) - Object.values(CHAINS).indexOf(b));
}

// ------------------------------------------------------------- terminal I/O

class Terminal {
  constructor() {
    this.tty = Boolean(process.stdin.isTTY && process.stdout.isTTY);
    this.queue = [];
    this.waiter = null;
    this.closed = false;
    this.muted = false;
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: this.tty,
      historySize: 0, // never keep secrets in line history
    });
    // Suppress echo while a secret is being typed, but keep the prompt visible.
    this.rl._writeToOutput = (s) => {
      if (!this.muted) this.rl.output.write(s);
      else if (s.startsWith(this.rl.getPrompt())) this.rl.output.write(this.rl.getPrompt());
      else if (/[\r\n]/.test(s)) this.rl.output.write('\n');
    };
    this.rl.on('line', (line) => {
      if (this.waiter) {
        const w = this.waiter;
        this.waiter = null;
        w.resolve(line);
      } else this.queue.push(line);
    });
    this.rl.on('close', () => {
      this.closed = true;
      if (this.waiter) this.waiter.reject(new UserAbort('Input closed'));
    });
    this.rl.on('SIGINT', () => {
      if (this.waiter) this.waiter.reject(new UserAbort('Interrupted'));
      else this.rl.close();
    });
  }

  ask(prompt, { hidden = false } = {}) {
    return new Promise((resolve, reject) => {
      const finish = (fn) => (v) => {
        this.muted = false;
        fn(v);
      };
      if (this.queue.length) {
        if (!this.tty) process.stdout.write(prompt + '\n');
        return resolve(this.queue.shift());
      }
      if (this.closed) return reject(new UserAbort('Input closed'));
      this.waiter = { resolve: finish(resolve), reject: finish(reject) };
      if (this.tty) {
        this.rl.setPrompt(prompt);
        this.rl.prompt();
        this.muted = hidden;
      } else process.stdout.write(prompt + '\n');
    });
  }

  async confirm(prompt, def = false) {
    const a = (await this.ask(`${prompt} ${def ? '[Y/n]' : '[y/N]'} `)).trim().toLowerCase();
    if (!a) return def;
    return a === 'y' || a === 'yes';
  }

  /** Wipe the visible screen and the scrollback buffer. */
  clear() {
    if (this.tty) process.stdout.write('\x1b[2J\x1b[3J\x1b[H');
    else out('\n' + '-'.repeat(60));
  }

  close() {
    this.rl.close();
  }
}

// --------------------------------------------------------- environment checks

export function activeNetworkInterfaces() {
  const up = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) if (!a.internal) up.push(`${name} (${a.address})`);
  }
  return up;
}

function selfHash() {
  try {
    return nodeCrypto.createHash('sha256').update(fs.readFileSync(process.argv[1])).digest('hex');
  } catch {
    return null;
  }
}

function runSelfTest({ verbose = false } = {}) {
  const res = selfTest();
  if (verbose || !res.ok) {
    for (const r of res.results) {
      out(`  ${r.ok ? green('ok  ') : red('FAIL')} ${r.name}`);
      if (!r.ok) out(`         got  ${r.got}\n         want ${r.want}`);
    }
  }
  if (!res.ok) {
    throw new Error('Self-test FAILED. This copy of the tool or this machine is not trustworthy. Do not use it.');
  }
  return res.results.length;
}

function preflight(opts) {
  out(bold(`dgb-coldprep ${VERSION}`) + dim('  DigiByte cold-storage prep'));
  const hash = selfHash();
  if (hash) out(dim(`SHA-256 of this program: ${hash}`));
  out();

  const n = runSelfTest();
  out(`${green('✔')} Self-test passed (${n} known-answer checks: BIP39, BIP32, BIP44/49/84/86, BIP380, DGB, BTC, LTC, DOGE, XMR)`);

  if (!(process.stdin.isTTY && process.stdout.isTTY)) {
    if (!opts.unsafeNoTty) {
      throw new Error(
        'Input or output is not an interactive terminal. Secrets could end up in a file, pipe or log.\n' +
          'Run this directly in a terminal window (or pass --unsafe-no-tty for testing).'
      );
    }
    out(red('✘ UNSAFE: not an interactive terminal. Test mode — never use these keys for real funds.'));
  } else out(`${green('✔')} Interactive terminal; nothing is piped or redirected`);

  const ifaces = activeNetworkInterfaces();
  if (ifaces.length) {
    if (!opts.allowOnline) {
      throw new Error(
        `This machine has an active network interface: ${ifaces.join(', ')}\n` +
          'A cold-storage seed must be created on a machine that is offline and stays offline.\n' +
          'Unplug Ethernet, disable Wi-Fi/Bluetooth (ideally boot a live OS such as Tails with networking\n' +
          'off) and run again. To practise the ceremony online, pass --allow-online and do NOT fund the result.'
      );
    }
    out(red(`✘ UNSAFE: network interface up (${ifaces.join(', ')}). Practice run — never fund these addresses.`));
  } else out(`${green('✔')} No active network interfaces`);
  out();
}

// ------------------------------------------------------------------- output

function printMnemonic(mnemonic) {
  const words = mnemonic.split(' ');
  const rows = words.length / 4;
  for (let r = 0; r < rows; r++) {
    let line = '  ';
    for (let c = 0; c < 4; c++) {
      const i = r + c * rows;
      line += `${String(i + 1).padStart(2)}. ${bold(words[i].padEnd(10))}`;
    }
    out(line);
  }
}

function printWallet(wallet, { showDescriptors }) {
  out(`${bold('Chain:')}              ${bold(NETWORKS[wallet.network].label)} (${NETWORKS[wallet.network].ticker})`);
  out(`${bold('Master fingerprint:')} ${wallet.masterFingerprint}   ${dim('(write this on your backup; it identifies the seed without revealing it)')}`);
  out(`${bold('BIP39 passphrase:')}   ${wallet.passphraseUsed ? yellow('YES — required for recovery, back it up separately') : 'none'}`);
  if (wallet.monero) {
    out();
    out(`${bold('Monero wallet')} ${dim(`· ${wallet.monero.path} · same derivation as Ledger`)}`);
    out(`  ${bold('Primary address')}   ${wallet.monero.address}`);
    out(`  ${bold('Private view key')}  ${wallet.monero.privateViewKey}`);
    out(dim('  The view key cannot spend, but it reveals every incoming payment. Give it only to your own'));
    out(dim('  watch-only wallet. Create that wallet "from keys" with the address and view key above, and set'));
    out(dim('  the restore height to the current block so it does not scan years of history.'));
  }
  for (const s of wallet.scripts) {
    out();
    out(`${bold(s.label)} ${dim(`· ${s.bip} · ${s.accountPath}/0/i`)}`);
    out(dim(`  ${s.note}`));
    for (const a of s.addresses) out(`  ${String(a.index).padStart(3)}  ${a.address}`);
    if (showDescriptors) {
      out(dim(`  xpub     ${s.xpub}`));
      out(dim(`  receive  ${s.descriptors.receive}`));
      out(dim(`  change   ${s.descriptors.change}`));
    }
  }
  out();
}

function writeKit(wallet, dir) {
  const kit = buildWatchKit(wallet);
  const base = `dgb-watch-kit-${wallet.masterFingerprint}${wallet.network === 'mainnet' ? '' : '-' + wallet.network}`;
  fs.mkdirSync(dir, { recursive: true });
  let file;
  for (let i = 0; ; i++) {
    file = path.join(dir, `${base}${i ? `-${i}` : ''}.json`);
    try {
      fs.writeFileSync(file, JSON.stringify(kit, null, 2) + '\n', { flag: 'wx', mode: 0o644 });
      break;
    } catch (e) {
      if (e.code !== 'EEXIST' || i > 50) throw e;
    }
  }
  // Read it back: a kit that does not match the seed is worse than no kit.
  const diffs = compareToKit(wallet, JSON.parse(fs.readFileSync(file, 'utf8')));
  if (diffs.length) throw new Error(`Watch kit read-back mismatch: ${diffs.join('; ')}`);
  return file;
}

/**
 * Monero wallets cannot restore from BIP39 words (only a Ledger can). Offer
 * the native 25-word seed so the Monero is recoverable without this tool.
 */
async function offerMoneroSeed(term, wallet, { mnemonic, passphrase }) {
  out('Your written seed restores this Monero wallet here or on a Ledger. Ordinary Monero wallets need');
  out('their own 25-word seed instead. It is a second secret: anyone holding it can spend the Monero.');
  if (!(await term.confirm('Show the 25-word Monero seed to write down as well?', false))) {
    out();
    return;
  }
  const words = moneroSeedWords(mnemonic, passphrase, { account: wallet.account }).split(' ');
  term.clear();
  out(bold('Monero 25-word seed') + dim('  (spends Monero only; write it by hand and label it "Monero")'));
  out();
  for (let r = 0; r < 5; r++) {
    let line = '  ';
    for (let c = 0; c < 5; c++) line += `${String(r + c * 5 + 1).padStart(2)}. ${bold(words[r + c * 5].padEnd(11))}`;
    out(line);
  }
  out();
  await term.ask('Press Enter when you have written and double-checked all 25 words… ');
  term.clear();
  out(`${green('✔')} Monero seed shown once and cleared.`);
  out();
}

/** One chain per screen when there are several, so nothing scrolls away. */
async function printWallets(term, wallets, opts) {
  for (let i = 0; i < wallets.length; i++) {
    printWallet(wallets[i], opts);
    if (wallets[i].monero && opts.secrets) await offerMoneroSeed(term, wallets[i], opts.secrets);
    if (i < wallets.length - 1) {
      await term.ask(`Press Enter for ${NETWORKS[wallets[i + 1].network].label} (${i + 2} of ${wallets.length})… `);
      term.clear();
    }
  }
}

const deriveAll = (mnemonic, passphrase, opts) =>
  opts.networks.map((network) => deriveWallet(mnemonic, passphrase, { network, account: opts.account, count: opts.count }));

// ----------------------------------------------------------------- ceremony

async function askPassphrase(term, { confirm, required = false }) {
  for (;;) {
    const p1 = await term.ask(required ? 'BIP39 passphrase: ' : 'BIP39 passphrase (Enter for none): ', { hidden: true });
    if (!p1 && required) {
      out(red('A passphrase is required in this mode.'));
      continue;
    }
    if (!p1) return '';
    if (!confirm) return p1;
    const p2 = await term.ask('Repeat passphrase: ', { hidden: true });
    if (p1 === p2) {
      if (p1 !== p1.trim()) out(yellow('Note: the passphrase starts or ends with a space. Spaces count.'));
      return p1;
    }
    out(red('Passphrases do not match. Try again.'));
  }
}

async function gatherEntropy(term, opts) {
  const bits = wordsToBits(opts.words);
  const fullRolls = Math.ceil(bits / Math.log2(6));
  if (opts.noDice) return { entropy: mixEntropy(nodeCrypto.randomBytes(64), null, bits), source: 'system RNG' };

  out(bold('Step 1 — Entropy'));
  if (opts.diceOnly) {
    out(`Dice-only mode: the seed is SHA-256 of your rolls and nothing else, so it can be`);
    out(`re-computed by hand on any other tool. Roll a fair die at least ${fullRolls} times.`);
  } else {
    out('The seed comes from the system random number generator. To avoid trusting it alone,');
    out(`roll a die and type the results (digits 1-6; ${fullRolls} rolls = full ${bits}-bit strength).`);
    out(`Your rolls are hashed together with the system RNG.${opts.requireDice ? '' : ' Press Enter to skip.'}`);
  }
  for (;;) {
    let dice;
    try {
      dice = normalizeDice(await term.ask('Dice rolls: '));
    } catch (e) {
      out(red(e.message));
      continue;
    }
    if (opts.diceOnly) {
      try {
        const entropy = diceOnlyEntropy(dice, bits);
        if (new Set(dice).size < 4) {
          out(red('Those rolls do not look random (fewer than 4 distinct faces). Roll a real die.'));
          continue;
        }
        return { entropy, source: `${dice.length} dice rolls only` };
      } catch (e) {
        out(red(e.message));
        continue;
      }
    }
    if (opts.requireDice && (dice.length < fullRolls || new Set(dice).size < 4)) {
      out(red(`This device requires at least ${fullRolls} real dice rolls (got ${dice.length}${dice.length >= fullRolls ? ', and they do not look random' : ''}).`));
      continue;
    }
    if (!dice) return { entropy: mixEntropy(nodeCrypto.randomBytes(64), null, bits), source: 'system RNG' };
    if (dice.length < fullRolls) {
      out(yellow(`${dice.length} rolls add ~${diceBits(dice.length)} bits; the system RNG supplies the rest.`));
    }
    return {
      entropy: mixEntropy(nodeCrypto.randomBytes(64), dice, bits),
      source: `system RNG + ${dice.length} dice rolls`,
    };
  }
}

async function verifyBackup(term, mnemonic, opts) {
  const words = mnemonic.split(' ');
  if (opts.quickVerify) {
    const picks = new Set();
    while (picks.size < 4) picks.add(nodeCrypto.randomInt(words.length));
    for (const i of [...picks].sort((a, b) => a - b)) {
      for (let tries = 0; ; tries++) {
        const a = (await term.ask(`Word #${i + 1}: `)).trim().toLowerCase();
        if (a === words[i]) break;
        if (tries >= 2) return false;
        out(red('That is not the word. Check your written backup.'));
      }
    }
    return true;
  }
  out('Type the whole phrase back from your written copy, words separated by spaces.');
  for (let tries = 0; tries < 3; tries++) {
    const typed = normalizeMnemonic(await term.ask('Seed phrase: '));
    if (typed === mnemonic) return true;
    const problem = mnemonicProblem(typed);
    const got = typed.split(' ');
    const wrong = words.map((w, i) => (got[i] === w ? null : i + 1)).filter(Boolean);
    out(red(problem || `Valid phrase, but not this one. Check word(s) #${wrong.slice(0, 6).join(', #')}.`));
  }
  return false;
}

async function ceremony(opts) {
  preflight(opts);
  const term = new Terminal();
  let entropy;
  try {
    out('This creates a new cold-storage seed. You need: pen and paper (or a metal backup),');
    out('privacy (no cameras, no one watching the screen), and about ten minutes.');
    out();

    const gathered = await gatherEntropy(term, opts);
    entropy = gathered.entropy;
    const mnemonic = mnemonicFromEntropy(entropy);
    if (mnemonicProblem(mnemonic)) throw new Error('Internal error: generated phrase failed its own checksum');
    out(dim(`Entropy source: ${gathered.source}`));
    out();

    let passphrase = '';
    if (!opts.noPassphrase) {
      out(bold(`Step 2 — ${opts.requirePassphrase ? 'Passphrase' : 'Optional passphrase'} ("25th word")`));
      out('A passphrase means a thief who finds the written words still cannot spend.');
      out(yellow(`It is NOT recoverable: forget it and the coins are gone.${opts.requirePassphrase ? '' : ' Leave empty if unsure.'}`));
      out('Write it down exactly (capitals and spaces count) and store it apart from the words.');
      passphrase = await askPassphrase(term, { confirm: true, required: opts.requirePassphrase });
      out();
    }

    const wallets = deriveAll(mnemonic, passphrase, opts);
    const wallet = wallets[0];

    out(bold(`Step 3 — Write down these ${opts.words} words, in order`));
    out('By hand, on paper or metal. Never photograph, print, type into a phone or store in a file.');
    out();
    printMnemonic(mnemonic);
    out();
    out(`Master fingerprint: ${bold(wallet.masterFingerprint)}  ${dim('(safe to write next to the words)')}`);
    out();
    await term.ask('Press Enter when you have written and double-checked all words… ');
    term.clear();

    out(bold('Step 4 — Prove the backup'));
    if (!(await verifyBackup(term, mnemonic, opts))) {
      term.clear();
      throw new Error('Backup verification failed. Nothing was saved; this seed is discarded. Start again.');
    }
    // Independent second derivation from what the user holds on paper.
    if (JSON.stringify(deriveAll(mnemonic, passphrase, opts)) !== JSON.stringify(wallets)) throw new Error('Internal error: derivation is not deterministic');
    term.clear();
    out(`${green('✔')} Backup verified. The seed words will not be shown again.`);
    out();

    out(bold('Step 5 — Your cold-storage addresses'));
    if (wallets.length > 1) {
      out(`One seed, ${wallets.length} chains: ${wallets.map((w) => NETWORKS[w.network].ticker).join(', ')}. The same written words restore all of them.`);
      out();
    }
    let dir = opts.out;
    if (!opts.noKit && !dir) {
      out('A watch-only kit (addresses, xpubs, descriptors — no private keys) lets an online wallet');
      out('show your balance and make receive addresses. It cannot spend, but it does reveal all');
      out('your addresses to whoever holds it.');
      if (await term.confirm(`Write the watch-only kit to ${process.cwd()}?`, true)) dir = process.cwd();
      out();
    }
    await printWallets(term, wallets, { showDescriptors: opts.showDescriptors || !dir, secrets: { mnemonic, passphrase } });
    if (dir) {
      for (const w of wallets) {
        const file = writeKit(w, dir);
        out(`${green('✔')} ${NETWORKS[w.network].ticker} watch-only kit written and read back: ${bold(file)}`);
        if (w.network === 'mainnet') {
          out(dim('  Import on an online DigiByte Core (v8.22+) with:'));
          out(dim('    digibyte-cli createwallet "cold-watch" true true "" false true'));
          out(dim(`    digibyte-cli -rpcwallet=cold-watch importdescriptors "$(jq -c .importdescriptors ${path.basename(file)})"`));
        }
      }
      out();
    }

    out(bold('Before you fund it'));
    out('  1. Store the written words (and passphrase, separately) somewhere fire/water/theft safe.');
    out(`  2. Run the recovery drill on this offline machine:  dgb-coldprep verify${dir ? ' --kit <kit file>' : ''}`);
    out('  3. Send a small test amount first and confirm it appears in your watch-only wallet.');
    out('  4. Power this machine off when done (memory cannot be reliably wiped from software).');
    out();
    await term.ask('Press Enter to clear the screen and exit… ');
    term.clear();
  } finally {
    if (entropy) entropy.fill(0);
    term.close();
  }
}

async function verifyCommand(opts) {
  preflight(opts);
  const term = new Terminal();
  try {
    out(bold('Recovery drill'));
    out('Enter the seed phrase from your written backup to confirm it restores the same wallet.');
    let mnemonic;
    for (;;) {
      mnemonic = normalizeMnemonic(await term.ask('Seed phrase: '));
      const problem = mnemonicProblem(mnemonic);
      if (!problem) break;
      out(red(problem));
    }
    const passphrase = opts.noPassphrase ? '' : await askPassphrase(term, { confirm: false });
    term.clear();
    const kit = opts.kit ? JSON.parse(fs.readFileSync(opts.kit, 'utf8')) : null;
    // A kit names its own chain; restore that one unless chains were chosen.
    if (kit && !opts.chains && !opts.testnet && NETWORKS[kit.network]) opts.networks = [NETWORKS[kit.network]];
    const wallets = deriveAll(mnemonic, passphrase, opts);
    await printWallets(term, wallets, { showDescriptors: opts.showDescriptors, secrets: { mnemonic, passphrase } });

    let ok = true;
    if (opts.kit) {
      const wallet = wallets.find((w) => w.network === kit.network) || wallets[0];
      const diffs = compareToKit(wallet, kit);
      if (diffs.length) {
        ok = false;
        out(red(`✘ MISMATCH against ${opts.kit}:`));
        for (const d of diffs) out(red(`    ${d}`));
        out('  Wrong words, wrong passphrase, or wrong kit. Do not fund until this matches.');
      } else out(`${green('✔')} MATCH: this backup reproduces every key and address in ${opts.kit}`);
    } else {
      out('Compare the master fingerprint and addresses above with the ones you recorded.');
    }
    out();
    await term.ask('Press Enter to clear the screen and exit… ');
    term.clear();
    return ok ? 0 : 1;
  } finally {
    term.close();
  }
}

function checkAddressCommand(opts) {
  const addr = opts.positional[0];
  if (!addr) throw new Error('Usage: dgb-coldprep check-address ADDRESS');
  if (opts.networks.length !== 1) throw new Error('check-address takes one chain, e.g. --chains btc');
  const network = opts.networks[0];
  const res = checkAddress(addr, network);
  if (res.valid) out(`${green('✔')} Valid ${network.label} address (${res.type})`);
  else out(`${red('✘')} INVALID: ${res.reason}`);
  if (res.valid && res.type === 'p2pkh' && network.pubKeyHash === 0x1e) {
    out(yellow('  Note: DigiByte and Dogecoin legacy addresses share this format. The checksum cannot tell them apart.'));
  }
  return res.valid ? 0 : 1;
}

export async function main(argv = process.argv.slice(2)) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (e) {
    process.stderr.write(`${e.message}\n\nRun with --help for usage.\n`);
    return 2;
  }
  if (opts.help) return out(HELP), 0;
  if (opts.version) return out(VERSION), 0;
  try {
    switch (opts.command) {
      case 'selftest':
        out(`dgb-coldprep ${VERSION} self-test`);
        out(`${green('✔')} ${runSelfTest({ verbose: true })} checks passed`);
        return 0;
      case 'check-address':
        return checkAddressCommand(opts);
      case 'verify':
        return await verifyCommand(opts);
      default:
        await ceremony(opts);
        return 0;
    }
  } catch (e) {
    if (e instanceof UserAbort) {
      if (process.stdout.isTTY) process.stdout.write('\x1b[2J\x1b[3J\x1b[H');
      process.stderr.write(`Aborted (${e.message}). Nothing was saved.\n`);
      return 130;
    }
    process.stderr.write(`\n${red('ERROR:')} ${e.message}\n`);
    return 1;
  }
}
