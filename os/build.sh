#!/bin/sh
# Build a HoldFast Vault image from pinned sources.
#   os/build.sh rpi     -> os/output/rpi/images/holdfast-vault-rpi.img  (Pi 3 B/B+, 4 B, 400)
#   os/build.sh qemu    -> os/output/qemu/images/Image (for os/test/qemu-boot.py)
set -eu

BR_VERSION=2026.08.2
BR_SHA256=bc9497c8e3a734c277e541e2f7fcf9a6275dc92f75bd2f753b05981c54be8705

TARGET=${1:-rpi}
case "$TARGET" in rpi | qemu) ;; *) echo "usage: $0 rpi|qemu" >&2; exit 2 ;; esac

OS_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
WORK=${HOLDFAST_WORK:-$OS_DIR/.work}
BR_DIR=$WORK/buildroot-$BR_VERSION
OUT=${HOLDFAST_OUT:-$OS_DIR/output/$TARGET}
mkdir -p "$WORK" "$OUT"

if [ ! -d "$BR_DIR" ]; then
	tarball=$WORK/buildroot-$BR_VERSION.tar.xz
	[ -f "$tarball" ] || curl -fsSL -o "$tarball" "https://buildroot.org/downloads/buildroot-$BR_VERSION.tar.xz"
	echo "$BR_SHA256  $tarball" | sha256sum -c -
	tar -xJf "$tarball" -C "$WORK"
fi

# The tool bundle must match its committed checksums before it goes in an image.
(cd "$OS_DIR/../dist" && sha256sum -c SHA256SUMS)

export BR2_DL_DIR=${BR2_DL_DIR:-$WORK/dl}
make -C "$BR_DIR" O="$OUT" BR2_EXTERNAL="$OS_DIR" "holdfast_${TARGET}_defconfig"
make -C "$BR_DIR" O="$OUT"

echo
echo "Built: $OUT/images"
ls -l "$OUT/images"
