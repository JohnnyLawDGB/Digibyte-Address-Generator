// Reproducible build: bundles the pinned, audited dependencies into
//   dist/dgb-coldprep.cjs   single-file CLI (needs only a Node.js binary)
//   dist/dgb-coldprep.html  single-file offline web page
//   dist/SHA256SUMS
// `node build.mjs --check` rebuilds in memory and fails if dist/ differs.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, chmodSync, existsSync } from 'node:fs';
import { build } from 'esbuild';

const check = process.argv.includes('--check');
const sha256 = (data, enc = 'hex') => createHash('sha256').update(data).digest(enc);

const common = {
  bundle: true,
  write: false,
  minify: false, // keep the shipped code readable and auditable
  legalComments: 'inline',
  charset: 'utf8',
  logLevel: 'warning',
};

const cli = await build({
  ...common,
  entryPoints: ['src/main.js'],
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  banner: { js: '#!/usr/bin/env node' },
});

const web = await build({
  ...common,
  entryPoints: ['src/web/app.js'],
  platform: 'browser',
  format: 'iife',
  target: 'es2020',
});

const script = web.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const style = readFileSync('src/web/style.css', 'utf8');
const html = readFileSync('src/web/index.html', 'utf8')
  .replace('__SCRIPT_HASH__', () => `sha256-${sha256(script, 'base64')}`)
  .replace('__STYLE_HASH__', () => `sha256-${sha256(style, 'base64')}`)
  .replace('__STYLE__', () => style)
  .replace('__SCRIPT__', () => script);

const files = {
  'dgb-coldprep.cjs': cli.outputFiles[0].text,
  'dgb-coldprep.html': html,
};
files.SHA256SUMS = Object.entries(files)
  .map(([name, data]) => `${sha256(data)}  ${name}\n`)
  .join('');

let stale = false;
for (const [name, data] of Object.entries(files)) {
  const file = `dist/${name}`;
  if (check) {
    const same = existsSync(file) && readFileSync(file, 'utf8') === data;
    console.log(`${same ? 'ok      ' : 'MISMATCH'} ${file}`);
    if (!same) stale = true;
  } else {
    mkdirSync('dist', { recursive: true });
    writeFileSync(file, data);
    if (name.endsWith('.cjs')) chmodSync(file, 0o755);
    console.log(`wrote ${file} (${Buffer.byteLength(data)} bytes)`);
  }
}
if (!check) process.stdout.write('\n' + files.SHA256SUMS);
if (stale) {
  console.error('\ndist/ does not match a fresh build of src/. Run `npm run build` and commit the result.');
  process.exit(1);
}
