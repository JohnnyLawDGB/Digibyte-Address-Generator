# Roadmap

## Now: HoldFast Vault OS (see [os/README.md](os/README.md))

1. Skeleton image that boots to the ceremony on a Raspberry Pi 4. *(in progress)*
2. First boot on real hardware, working through the checklist in `os/README.md`.
3. Watch-only kit export from the device: USB stick, and QR codes on screen.
4. Verified reproducible image builds and signed releases.

## Next

- Cross-restore test between a Vault seed and HoldFast Wallet.
- On-screen warning before seed words are shown: use a plain monitor, not a
  network-connected smart TV, and a wired keyboard.
- Move this work to its own HoldFast Vault repository.

## Multi-chain release

Planned together, so the device that adds more chains is also the one that
no longer needs a monitor and keyboard.

- **More chains**, DigiByte first: Bitcoin, Litecoin, Dogecoin (same seed
  scheme, different parameters), then Monero as its own piece of work
  (different seed format, curve and key structure).
- **Pick-the-word backup check.** Choose each word from a short list with
  arrow keys instead of typing all 24, so a few buttons are enough for the
  whole ceremony. A prerequisite for the unit below.
- **Self-contained unit.** A small screen and buttons mounted on the Pi, with
  no external monitor or keyboard. Removes the smart TV and wireless keyboard
  risks, and gives a chain picker a natural home. Needs a button-driven
  interface and a chosen add-on board.

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
