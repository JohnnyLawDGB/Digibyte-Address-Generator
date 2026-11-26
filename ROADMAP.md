# Roadmap

## Now: HoldFast Vault OS (see [os/README.md](os/README.md))

1. Skeleton image that boots to the ceremony on a Raspberry Pi 4. *(in progress)*
2. First boot on real hardware, working through the checklist in `os/README.md`.
3. Watch-only kit export from the device: USB stick, and QR codes on screen.
4. Verified reproducible image builds and signed releases.

## Next

- More chains in the tool, DigiByte first: Bitcoin, Litecoin, Dogecoin
  (same seed scheme, different parameters), then Monero as its own
  milestone (different seed format, curve and key structure).
- Cross-restore test between a Vault seed and HoldFast Wallet.
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
