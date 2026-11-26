# Roadmap

HoldFast Vault is a DigiByte-first product. DigiByte is always listed first
and is the default; Bitcoin, Litecoin, Dogecoin and Monero ride on the same
seed as fellow proof-of-work chains.

## First release

**Chains from one 24-word seed**

- [x] DigiByte: Native SegWit, Taproot, Wrapped SegWit, Legacy
- [x] Bitcoin: same four address types
- [x] Litecoin: same four address types
- [x] Dogecoin: Legacy only (the chain has no SegWit or Taproot)
- [ ] Monero: keys derived from the same seed the way Ledger does it
      (`m/44'/128'/0'/0/0`), showing the primary address, the private view
      key for a watch-only wallet, and optionally the 25-word Monero seed so
      it also restores in any Monero wallet. Needs its own tested code path.

**HoldFast Vault OS** (see [os/README.md](os/README.md))

- [x] Image boots to the ceremony in an emulator: no shell, no network,
      mandatory dice, 24 or 24+1, one chain per screen.
- [ ] First boot on a real Raspberry Pi 4, working through the checklist in
      `os/README.md`.
- [ ] On-screen warning before seed words are shown: use a plain monitor, not
      a network-connected smart TV, and a wired keyboard.
- [ ] Watch-only kit export from the device: USB stick, and QR codes on screen.
- [ ] Verified reproducible image builds and signed releases.
- [ ] Cross-restore test between a Vault seed and HoldFast Wallet.

## After the first release

- **Pick-the-word backup check.** Choose each word from a short list with
  arrow keys instead of typing all 24, so a few buttons are enough for the
  whole ceremony. A prerequisite for the unit below.
- **Self-contained unit.** A small screen and buttons mounted on the Pi, with
  no external monitor or keyboard. Removes the smart TV and wireless keyboard
  risks. Needs a button-driven interface and a chosen add-on board.
- Move this work to its own HoldFast Vault repository.

## Pinned for later

- **Watch-only companion on Fire TV Stick.** A watch-only mode in HoldFast
  Wallet (Android, so it runs on Fire OS) that imports the Vault's kit and
  shows balances and receive addresses on a TV. It holds no keys, so an
  always-online, locked-down device is acceptable there. Depends on the
  kit export above. Work belongs in the `digibytewallet-android` repository.
  A Fire Stick was considered and rejected as the key-generating device:
  locked boot chain, radios that cannot be removed, soldered storage and
  closed firmware.
- A build for a board with no radio chip (Raspberry Pi 2B).
- A kernel with loadable-module support removed entirely.
- Node.js compiled from source instead of the pinned official binary.
