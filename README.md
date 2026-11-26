# DigiByte Cold Prep

One-step, air-gapped cold-storage preparation for DigiByte: create a seed,
prove the backup, and walk away with receive addresses and a watch-only kit
for your online wallet. Private keys never touch a disk or a network.

DigiByte is the default. The same seed can also produce Bitcoin, Litecoin,
Dogecoin and Monero wallets (`--chains all`), so one written backup covers
all five.

This is version 2 of the original `generator.js` script, rebuilt around
current standards and a much smaller, audited dependency set.

## What you get

| | |
|---|---|
| **Seed** | BIP39, 24 words (256-bit) or 12 words, optional passphrase ("25th word") |
| **Entropy** | System CSPRNG, optionally hashed together with your own dice rolls, or dice only (seed = SHA-256 of the rolls, checkable by hand) |
| **Addresses** | Native SegWit `dgb1q…` (BIP84, recommended), Taproot `dgb1p…` (BIP86), Wrapped SegWit `S…` (BIP49), Legacy `D…` (BIP44), coin type 20 |
| **Other chains** | Bitcoin and Litecoin (the same four address types), Dogecoin (Legacy only; it has no SegWit or Taproot). Each uses its own coin type, so keys never overlap between chains |
| **Monero** | Keys derived from the same seed at `m/44'/128'/0'/0/0`, the way Ledger's Monero app does it. Shows the primary address and private view key, and can show the standard 25-word Monero seed for restoring in any Monero wallet |
| **Watch-only kit** | Master fingerprint, account xpubs and BIP380 output descriptors with checksums, ready for DigiByte Core `importdescriptors` |
| **Recovery drill** | Re-enter the words and confirm they reproduce every key in the kit, before any coins are sent |

## Safety built in

- **Zero runtime dependencies.** `dist/dgb-coldprep.cjs` and
  `dist/dgb-coldprep.html` are single files. Nothing to `npm install` on the
  offline machine.
- **Refuses to run online.** The CLI stops if any network interface is up; the
  web page stops if the browser reports a connection or it was loaded from a
  server.
- **Cannot phone home.** The CLI bundle imports no networking module. The web
  page ships a Content-Security-Policy of `default-src 'none'` with the script
  pinned by hash, so even injected code cannot make a request.
- **Self-test before every run.** 21 known-answer checks (BIP39, BIP32,
  BIP44/49/84/86, BIP380, DigiByte vectors) must pass before a key is made.
- **Refuses pipes and redirects**, so a seed cannot land in a file or log.
- **Backup must be proven.** You retype the phrase before any address is
  shown; fail and the seed is discarded with nothing saved.
- **Secrets stay off disk.** Only the public watch-only kit can be written,
  and it is read back and re-verified. Passphrase input is hidden, there is
  no line history, and the screen and scrollback are wiped at each stage.
- **Audited crypto only:** `@noble/curves`, `@noble/hashes`, `@scure/bip32`,
  `@scure/bip39`, `@scure/base`, plus `qr` from the same author for QR codes, pinned to exact versions with lockfile
  integrity hashes.
- **Reproducible build.** CI rebuilds `dist/` from `src/` and fails on any
  byte difference.

## Use it

### 1. On an online machine: fetch and check

```sh
git clone https://github.com/JohnnyLawDGB/Digibyte-Address-Generator.git
cd Digibyte-Address-Generator/dist && sha256sum -c SHA256SUMS
```

The checksum file only detects corruption. To defend against a tampered
download, compare the hashes with a second source, or rebuild them yourself:
`npm ci --ignore-scripts && npm run verify-dist`.

Copy the folder (or just the one file you need) to a USB stick.

### 2. On the air-gapped machine: one step

A machine that has never been online and never will be is best; a live OS
such as Tails with networking disabled is a good second choice.

**With Node.js 18+:**

```sh
./coldprep.sh            # verifies checksums, then starts the ceremony
```

**Without Node.js:** double-click `dist/dgb-coldprep.html`. It runs the same
code in any modern browser.

The ceremony: environment checks → optional dice rolls → optional passphrase →
write down the words → retype them → addresses and watch-only kit.

### 3. Recovery drill (do this before funding)

```sh
./coldprep.sh verify --kit dgb-watch-kit-xxxxxxxx.json
```

`MATCH` means your paper backup regenerates every key in the kit.

### 4. On the online machine: watch-only wallet

```sh
digibyte-cli createwallet "cold-watch" true true "" false true
digibyte-cli -rpcwallet=cold-watch importdescriptors "$(jq -c .importdescriptors dgb-watch-kit-xxxxxxxx.json)"
```

Send a small test amount first.

## Commands

```
dgb-coldprep [options]            full ceremony (default)
dgb-coldprep verify [--kit FILE]  recovery drill
dgb-coldprep check-address ADDR   validate an address checksum
dgb-coldprep selftest             run the known-answer tests
```

Options: `--chains dgb,btc,ltc,doge,xmr|all`, `--words 12|24`, `--count N`,
`--account N`, `--testnet`, `--require-passphrase`,
`--no-dice`, `--dice-only`, `--require-dice`, `--no-passphrase`, `--quick-verify`, `--out DIR`,
`--no-kit`, `--show-descriptors`, `--qr`. Run `--help` for details.

`--allow-online` and `--unsafe-no-tty` exist for practice and automated tests
only. Never fund a seed made with them.

## What changed from v1

- v1 printed one legacy address from `bitcoinjs-lib` 4 and needed
  `npm install` on the target machine. It also carried the wrong P2SH version
  byte (`0x32`; DigiByte uses `0x3f`). No v1 address was affected, because v1
  only produced `D…` addresses, which were and remain correct.
- A v1 seed restores here: run `verify` and look under **Legacy**
  (`m/44'/20'/0'/0/0`).

## Limits to know about

- **DigiByte and Dogecoin legacy addresses look identical.** Both start with
  `D` and use the same version byte, so no checksum can tell them apart.
  Label them carefully. A coin sent to the other chain's address is
  recoverable only by someone who knows how to derive that key on the wrong
  chain.
- **Monero is different.** Ordinary Monero wallets cannot restore from the
  24 words; only this tool or a Ledger can. Write down the optional 25-word
  Monero seed if you want to restore elsewhere, and treat it as a second
  secret. The Monero kit contains the private view key, which cannot spend
  but reveals every incoming payment. Only the primary address is produced,
  not subaddresses. Compatibility has been checked against two independent
  libraries, not yet against the official Monero wallet or a Ledger device.
- The watch-only kit import commands are written for DigiByte Core. Bitcoin
  Core and Litecoin Core accept the same descriptors; Dogecoin Core has no
  descriptor wallets, so use the listed addresses or the account `dgub`.
- Software cannot reliably erase memory. Power the machine off afterwards.
- A browser adds extensions and a larger attack surface; prefer the CLI, or
  use a clean profile with no extensions.
- The watch-only kit cannot spend, but it reveals every address you will use.
- Taproot is active on DigiByte mainnet since block 21,168,000, but not every
  wallet or exchange can send to `dgb1p…` yet. Native SegWit is the default.
- This tool prepares storage. Spending later means restoring the seed in an
  offline signing wallet.

## Develop

```sh
npm ci --ignore-scripts
npm test            # unit tests + end-to-end ceremony against dist/
npm run build       # regenerate dist/ and SHA256SUMS
```

Network parameters come from DigiByte Core `src/kernel/chainparams.cpp`.
DigiByte, Bitcoin, Litecoin and Dogecoin test vectors were cross-checked
against `bitcoinjs-lib` 6; Monero vectors against `bip_utils` and
`monero-python`. The Monero word list is from the Monero source (BSD-3).

## HoldFast Vault OS

[`os/`](os/README.md) builds a bootable Raspberry Pi 4 image that runs this
tool and nothing else: no network stack, no login, no storage writes. It is an
early skeleton and not yet proven on hardware.

## License

MIT
