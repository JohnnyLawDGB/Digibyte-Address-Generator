#!/usr/bin/env python3
"""Boot the HoldFast Vault userland in QEMU and drive it over the serial console.

Usage: qemu-boot.py path/to/Image [path/to/buildroot/host]

With the Buildroot host directory (for mkfs.vfat and mtools), a blank FAT32
USB stick is attached and the watch-only kit export is checked end to end.

Checks that the system boots straight into the HoldFast menu with no login or
shell, that the tool's self-test passes on the target, that the kernel has no
network interface other than loopback, and that a full ceremony and recovery
drill complete.
"""
import os
import re
import select
import subprocess
import sys
import time

import tempfile

image = sys.argv[1]
host = sys.argv[2] if len(sys.argv) > 2 else None
usb_args, stick = [], None
if host:
    stick = os.path.join(tempfile.mkdtemp(prefix="holdfast-usb-"), "stick.img")
    with open(stick, "wb") as f:
        f.truncate(64 * 1024 * 1024)
    subprocess.run([os.path.join(host, "sbin", "mkfs.vfat"), "-F", "32", stick], check=True, stdout=subprocess.DEVNULL)
    usb_args = ["-device", "qemu-xhci", "-drive", "if=none,id=stick,format=raw,file=" + stick,
                "-device", "usb-storage,drive=stick"]
qemu = subprocess.Popen(
    ["qemu-system-aarch64", "-M", "virt", "-cpu", "cortex-a72", "-smp", "2", "-m", "1024",
     "-nographic", "-no-reboot", "-nic", "none", "-kernel", image,
     "-append", "console=ttyAMA0 quiet"] + usb_args,
    stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
os.set_blocking(qemu.stdout.fileno(), False)
buf = ""
ANSI = re.compile(r"\x1b\[[0-9;?]*[A-Za-z]")


def fail(msg):
    print("\n--- console tail ---\n" + ANSI.sub("", buf)[-3000:])
    qemu.kill()
    sys.exit("FAIL: " + msg)


def until(pattern, timeout=180, start=0):
    global buf
    end = time.time() + timeout
    while time.time() < end:
        m = re.search(pattern, ANSI.sub("", buf[start:]))
        if m:
            return m
        if select.select([qemu.stdout], [], [], 0.5)[0]:
            chunk = qemu.stdout.read()
            if chunk:
                buf += chunk.decode(errors="replace")
        if qemu.poll() is not None:
            fail("QEMU exited while waiting for %r" % pattern)
    fail("timed out waiting for %r" % pattern)


def send(text):
    qemu.stdin.write((text + "\r").encode())
    qemu.stdin.flush()


def page_through(start, qr_for=None):
    """Step through the one-chain-per-screen pages; return everything shown.

    Optional prompts (Monero seed, QR codes) are declined, except that QR
    codes are opened once for the chain named in qr_for.
    """
    seen = len(buf)
    for _ in range(24):
        m = until(r"Press Enter (for \w+ \(\d of \d\)|to clear the screen and exit)"
                  r"|Monero seed to write down as well\? \[y/N\] "
                  r"|Show QR codes for (\w+)[^?]*\? \[y/N\] "
                  r"|Enter for the next code \(\d+ of \d+\), or q to stop", start=seen)
        hit = m.group(0)
        seen = len(buf)
        if "clear the screen" in hit:
            return ANSI.sub("", buf[start:])
        if hit.startswith("Show QR codes") and qr_for and m.group(2) == qr_for:
            send("y")
        elif hit.startswith("Enter for the next code"):
            send("q")
        else:
            send("")  # next chain, or decline an optional prompt
    fail("too many pages")


def step(name):
    print("ok   " + name, flush=True)


until(r"Choose 1-6: ")
step("boots straight into the HoldFast menu")
if re.search(r"login:|[#$] $", ANSI.sub("", buf)):
    fail("a login prompt or shell appeared")
step("no login prompt or shell")

mark = len(buf)
send("5")
until(r"\d+ checks passed", start=mark)
step("tool self-test passes on the target")
send("")

mark = len(buf)
until(r"Choose 1-6: ", start=mark)
mark = len(buf)
send("1")
until(r"No active network interfaces", start=mark)
step("tool sees no network interface")
until(r"Dice rolls: ", start=mark)
send("")
until(r"requires at least 100 real dice rolls", start=mark)
step("dice rolls are mandatory")
mark2 = len(buf)
send("1234561234" * 10)
until(r"Press Enter when you have written", start=mark2)
text = ANSI.sub("", buf[mark2:])
words = [w for _, w in sorted((int(n), w) for n, w in re.findall(r"(\d+)\. ([a-z]+)", text))]
if len(words) != 24:
    fail("expected 24 seed words, saw %d" % len(words))
fp = re.search(r"Master fingerprint: ([0-9a-f]{8})", text).group(1)
send("")
until(r"Seed phrase: ", start=mark2)
send(" ".join(words))
m = until(r"  0  (dgb1q[a-z0-9]+)", start=mark2)
first = m.group(1)
shown = page_through(mark2, qr_for="DigiByte")
send("")
step("ceremony completes (fingerprint %s)" % fp)
if "DigiByte mainnet Native SegWit receive address #0" not in shown or "\u2588\u2580\u2580\u2580\u2580\u2580\u2588" not in shown:
    fail("QR code for the first DigiByte address was not drawn")
step("QR code drawn for a public address")
chains = re.findall(r"Chain:\s+(\w+)", shown)
if chains != ["DigiByte", "Bitcoin", "Litecoin", "Dogecoin", "Monero"]:
    fail("expected DigiByte, Bitcoin, Litecoin, Dogecoin, Monero in that order; saw %r" % chains)
for prefix in (r"  0  bc1q", r"  0  ltc1q", r"  0  D[1-9A-HJ-NP-Za-km-z]{33}", r"Primary address\s+4[1-9A-HJ-NP-Za-km-z]{94}", r"Private view key\s+[0-9a-f]{64}"):
    if not re.search(prefix, shown):
        fail("missing address matching %r" % prefix)
step("one seed shows DigiByte first, then Bitcoin, Litecoin, Dogecoin and Monero")

# Watch-only kit export to a USB stick.
mark3 = len(buf)
until(r"Include the Monero kit\? \[y/N\] ", start=mark3)
send("")
until(r"press Enter \(or type skip\): ", start=mark3)
if stick:
    send("")
    m = until(r"Saved and verified (\d+) kit file|Writing or verifying failed|No USB stick found|Could not open the stick", start=mark3)
    if not m.group(1):
        fail("USB export: " + m.group(0))
    if m.group(1) != "4":
        fail("expected 4 kit files without Monero, device reported %s" % m.group(1))
else:
    send("skip")
    until(r"Skipped\. Nothing was written", start=mark3)
until(r"Press Enter to return to the menu", start=mark3)
send("")
step("watch-only kit export " + ("writes and verifies 4 files on the USB stick" if stick else "can be skipped"))

mark = len(buf)
until(r"Choose 1-6: ", start=mark)
mark = len(buf)
send("3")
until(r"Seed phrase: ", start=mark)
send(" ".join(words))
until(r"BIP39 passphrase[^\n]*: ", start=mark)
send("")
until(r"Master fingerprint:\s+%s" % fp, start=mark)
until(re.escape(first), start=mark)
page_through(mark)
send("")
step("recovery drill reproduces the same fingerprint and address")

mark = len(buf)
until(r"Choose 1-6: ", start=mark)
mark = len(buf)
send("2")
until(r"Dice rolls: ", start=mark)
send("6543216543" * 10)
until(r"BIP39 passphrase: ", start=mark)
send("")
until(r"A passphrase is required in this mode", start=mark)
send("vault test")
until(r"Repeat passphrase: ", start=mark)
send("vault test")
until(r"Press Enter when you have written", start=mark)
text = ANSI.sub("", buf[mark:])
words2 = [w for _, w in sorted((int(n), w) for n, w in re.findall(r"(\d+)\. ([a-z]+)", text))]
send("")
until(r"Seed phrase: ", start=mark)
send(" ".join(words2))
until(r"BIP39 passphrase:\s+YES", start=mark)
page_through(mark)
send("")
mark4 = len(buf)
until(r"Include the Monero kit\? \[y/N\] ", start=mark4)
send("")
until(r"press Enter \(or type skip\): ", start=mark4)
send("skip")
until(r"Press Enter to return to the menu", start=mark4)
send("")
step("24+1 ceremony requires and uses a passphrase")

mark = len(buf)
until(r"Choose 1-6: ", start=mark)
send("6")
try:
    qemu.wait(timeout=60)
except subprocess.TimeoutExpired:
    fail("did not power off")
step("powers off from the menu")

if stick:
    # Read the stick back on the host, as the online machine would.
    import json
    mdir = subprocess.run([os.path.join(host, "bin", "mdir"), "-b", "-i", stick, "::/holdfast-vault"],
                          capture_output=True, text=True, check=True).stdout.split()
    names = sorted(os.path.basename(n) for n in mdir)
    if len(names) != 4 or any("monero" in n for n in names):
        fail("unexpected files on the stick: %r" % names)
    text = ""
    for n in names:
        raw = subprocess.run([os.path.join(host, "bin", "mtype"), "-i", stick, "::/holdfast-vault/" + n],
                             capture_output=True, text=True, check=True).stdout
        kit = json.loads(raw)
        if kit["masterFingerprint"] != fp or kit["containsPrivateKeys"] is not False:
            fail("kit %s does not belong to this seed" % n)
        text += raw
    if first not in text:
        fail("the first DigiByte address is not in the exported kit")
    for w in set(words):
        if len(w) > 4 and re.search(r"\b%s\b" % w, text):
            fail("seed word %r found on the stick" % w)
    if re.search(r"prv[A-Za-z0-9]{20}", text):
        fail("a private extended key is on the stick")
    step("stick holds 4 public kits for this seed and no secrets")
print("PASS")
