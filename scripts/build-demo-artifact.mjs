/**
 * ブラウザ内だけで動くデモ版（モックデータ）を 1 つの HTML にまとめる。
 * 使い方: node scripts/build-demo-artifact.mjs <出力パス>
 * 先に `npx vite build --mode demo --outDir dist/demo` を実行しておくこと。
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const out = process.argv[2] ?? join(root, 'dist/demo-artifact.html');
const assets = join(root, 'dist/demo/assets');
const files = readdirSync(assets);
const css = files.filter((f) => f.endsWith('.css')).map((f) => readFileSync(join(assets, f), 'utf8')).join('\n');
const jsFiles = files.filter((f) => f.endsWith('.js'));
if (jsFiles.length !== 1) throw new Error(`JS は 1 ファイルを想定: ${jsFiles.join(', ')}`);
const js = readFileSync(join(assets, jsFiles[0]), 'utf8').replace(/<\/script/gi, '<\\/script');

writeFileSync(
  out,
  `<title>実質最安値 Watch</title>
<meta name="robots" content="noindex, nofollow">
<style>
${css}
</style>
<div id="root"></div>
<script type="module">
${js}
</script>
`,
);
console.log(`wrote ${out} (${Math.round((css.length + js.length) / 1024)} KB)`);
