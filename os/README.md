# HoldFast Vault OS

A bootable image that turns a Raspberry Pi 3 or Pi 4 into a single-purpose,
air-gapped cold-storage device. Flash a card, power on, and the cold-storage
ceremony from this repository starts. There is nothing else on the device.

**Status: first bootable skeleton.** The userland is boot-tested in an
emulator on every build. The Raspberry Pi image is built by CI but has not
yet been confirmed on real hardware. Do not use it for real funds yet.

## What the image is

- **Built from pinned sources** with [Buildroot](https://buildroot.org): the
  Buildroot release, kernel, Pi firmware, toolchain and Node.js binary are all
  fixed by SHA-256, and the tool bundle is checked against `dist/SHA256SUMS`.
- **No way onto a network.** The kernel is built without TCP/IP, without any
  network device driver (Ethernet, Wi-Fi, USB network adapters, USB gadget) and
  without Bluetooth. No kernel modules are shipped, and no radio firmware is
  on the card. Wi-Fi and Bluetooth are also disabled in the boot firmware.
- **Runs from memory.** The whole system is packed inside the kernel image.
  The card has one read-only-in-practice boot partition and no root
  filesystem; nothing is written back, and you can remove the card after boot.
- **No login, no shell, no services.** Init starts one menu on the HDMI
  console. There is no serial console, SSH, or getty.
- **Dice are mandatory.** A freshly booted device has had little time to
  gather randomness, so the ceremony requires a full set of dice rolls, mixed
  with the system generator.
- **DigiByte first, five chains.** One seed produces DigiByte, Bitcoin,
  Litecoin, Dogecoin and Monero wallets, shown one chain per screen with
  DigiByte leading.
- **24 words, or 24 + 1.** The menu offers a 24-word seed on its own, or a
  24-word seed with a passphrase (the "25th word"), which is then required.

## What you need

- **A Raspberry Pi 3 Model B or B+, a Pi 4 Model B (any memory size), or a
  Pi 400.** One image boots all of them; the system uses well under 1 GB.
  Other models (Pi 5, Zero 2 W, Compute Modules) will not boot this image.
- **A microSD card of 1 GB or more.** The image is 256 MB and is only read,
  once, at power-on, so speed class and endurance rating do not matter. Use a
  name-brand card from a seller you trust (counterfeit cards are common),
  and keep it for this purpose only.
- A screen and HDMI cable (full-size HDMI on a Pi 3, micro-HDMI on a Pi 4), a
  wired USB keyboard, and the Pi's power supply (micro-USB on a Pi 3, USB-C
  on a Pi 4). Avoid wireless keyboards: their dongle is a radio.
- A six-sided die.

## Build

Needs a Linux machine with the usual build tools (`build-essential bc cpio
rsync unzip file wget curl xz-utils libssl-dev`) and about 15 GB of disk.

```sh
os/build.sh rpi      # -> os/output/rpi/images/holdfast-vault-rpi.img
os/build.sh qemu     # -> os/output/qemu/images/Image (emulator test build)
python3 os/test/qemu-boot.py os/output/qemu/images/Image
```

CI (`.github/workflows/os-image.yml`) runs both builds, boot-tests the
emulator build, and uploads the Pi image as the `holdfast-vault-rpi`
artifact with its SHA-256.

## Flash and boot

1. Check the download: `sha256sum -c holdfast-vault-rpi.img.xz.sha256`
2. Write it to a microSD card with Raspberry Pi Imager ("Use custom"),
   balenaEtcher, or `xz -dc holdfast-vault-rpi.img.xz | sudo dd of=/dev/sdX bs=4M conv=fsync`.
3. Connect an HDMI screen (on a Pi 4, the port nearest the power socket) and
   a USB keyboard. Leave Ethernet unplugged. Power on.

## First-boot hardware checklist

These are the things an emulator cannot prove. Please record each result.

- [ ] The HoldFast menu appears on HDMI within about 30 seconds.
- [ ] The USB keyboard works in the menu (on a Pi 4, try both blue and black
      USB ports).
- [ ] Menu option 4 (self-test) reports all checks passed.
- [ ] Option 1 shows "No active network interfaces", with an Ethernet cable
      plugged into a live router.
- [ ] A phone's Wi-Fi and Bluetooth scans show no new device near the Pi.
- [ ] The ceremony completes, and option 2 reproduces the same fingerprint.
- [ ] Pull the card after the menu appears: the device keeps working.
- [ ] After power-off, the card's contents are unchanged (same SHA-256 when
      read back on another machine).

## Layout

```
os/build.sh                         pinned Buildroot fetch + build
os/configs/                         holdfast_rpi_defconfig, holdfast_qemu_defconfig
os/board/holdfast/                  kernel fragments, boot files, session menu
os/package/holdfast-node/           official Node.js binary, pinned by hash
os/package/holdfast-vault/          the tool bundle from dist/
os/test/qemu-boot.py                serial-console boot test
```

## Not done yet

- Exporting the watch-only kit (USB stick or on-screen QR). For now the
  ceremony shows addresses and descriptors on screen only.
- Byte-for-byte reproducibility of the image has not been verified.
- A kernel without loadable-module support at all, and a build for a board
  with no radio chip (Pi 2B), are planned hardening steps.
- Node.js is the official prebuilt binary, not compiled from source.
