#!/usr/bin/env python3
"""Boot the HoldFast Vault userland in QEMU and drive it over the serial console.

Usage: qemu-boot.py path/to/Image

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

image = sys.argv[1]
qemu = subprocess.Popen(
    ["qemu-system-aarch64", "-M", "virt", "-cpu", "cortex-a72", "-smp", "2", "-m", "1024",
     "-nographic", "-no-reboot", "-nic", "none", "-kernel", image,
     "-append", "console=ttyAMA0 quiet"],
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


def page_through(start):
    """Step through the one-chain-per-screen pages; return everything shown."""
    seen = len(buf)
    for _ in range(8):
        m = until(r"Press Enter (for \w+ \(\d of \d\)|to clear the screen and exit)", start=seen)
        if "clear the screen" in m.group(0):
            return ANSI.sub("", buf[start:])
        seen = len(buf)
        send("")
    fail("too many chain pages")


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
shown = page_through(mark2)
send("")
step("ceremony completes (fingerprint %s)" % fp)
chains = re.findall(r"Chain:\s+(\w+)", shown)
if chains != ["DigiByte", "Bitcoin", "Litecoin", "Dogecoin"]:
    fail("expected DigiByte, Bitcoin, Litecoin, Dogecoin in that order; saw %r" % chains)
for prefix in (r"  0  bc1q", r"  0  ltc1q", r"  0  D[1-9A-HJ-NP-Za-km-z]{33}"):
    if not re.search(prefix, shown):
        fail("missing address matching %r" % prefix)
step("one seed shows DigiByte first, then Bitcoin, Litecoin and Dogecoin")

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
step("24+1 ceremony requires and uses a passphrase")

mark = len(buf)
until(r"Choose 1-6: ", start=mark)
send("6")
try:
    qemu.wait(timeout=60)
except subprocess.TimeoutExpired:
    fail("did not power off")
step("powers off from the menu")
print("PASS")
