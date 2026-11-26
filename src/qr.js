// QR codes drawn with terminal block characters, for carrying public data
// (addresses, descriptors) off an air-gapped screen with a phone camera.

import encodeQR from 'qr';

const QUIET = 4; // light modules required around a QR code

/**
 * Encode text and return terminal lines. Two QR rows share one text row via
 * half-block characters, so modules are square on a typical 8x16 console font.
 * Always drawn dark-on-light regardless of the terminal's own colours.
 */
export function qrLines(text, { color = true } = {}) {
  const inner = encodeQR(text, 'raw', { ecc: 'medium', border: 1 });
  const pad = QUIET - 1;
  const width = inner[0].length + pad * 2;
  const blank = new Array(width).fill(false);
  const grid = [
    ...Array.from({ length: pad }, () => blank),
    ...inner.map((row) => [...new Array(pad).fill(false), ...row, ...new Array(pad).fill(false)]),
    ...Array.from({ length: pad }, () => blank),
  ];
  if (grid.length % 2) grid.push(blank);
  const on = color ? '\x1b[30;47m' : '';
  const off = color ? '\x1b[0m' : '';
  const lines = [];
  for (let y = 0; y < grid.length; y += 2) {
    let line = '';
    for (let x = 0; x < width; x++) {
      const top = grid[y][x];
      const bottom = grid[y + 1][x];
      line += top && bottom ? '█' : top ? '▀' : bottom ? '▄' : ' ';
    }
    lines.push(on + line + off);
  }
  return { lines, columns: width, rows: lines.length, modules: inner.length - 2 };
}

/** The raw module matrix (true = dark), without any border. For tests. */
export function qrMatrix(text) {
  return encodeQR(text, 'raw', { ecc: 'medium', border: 1 }).slice(1, -1).map((row) => row.slice(1, -1));
}
