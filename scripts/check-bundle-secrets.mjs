/**
 * 配信物・ソースの安全性チェック:
 *  1. フロントエンドのビルド成果物（dist/client）に API 認証情報やその変数名が含まれない
 *  2. .dev.vars に設定された実際の秘密値が dist / src に含まれない
 *  3. 運用コードが生成 AI API を呼び出さない
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const walk = (dir) =>
  existsSync(dir)
    ? readdirSync(dir).flatMap((f) => {
        const p = join(dir, f);
        return statSync(p).isDirectory() ? walk(p) : [p];
      })
    : [];

const problems = [];
const clientFiles = walk(join(root, 'dist/client'));
if (clientFiles.length === 0) problems.push('dist/client が空です。先に npm run build を実行してください');

const forbiddenInClient = [/RAKUTEN_ACCESS_KEY/, /RAKUTEN_APPLICATION_ID/, /RAKUTEN_AFFILIATE_ID/, /APP_ACCESS_TOKEN/, /accessKey/, /applicationId/, /\bpk_[A-Za-z0-9]{8,}/];
for (const f of clientFiles) {
  const text = readFileSync(f, 'utf8');
  for (const re of forbiddenInClient) if (re.test(text)) problems.push(`${f}: ${re} を含みます`);
}

// .dev.vars の実値（空でない秘密）が成果物・ソースに含まれないこと
const devVars = join(root, '.dev.vars');
if (existsSync(devVars)) {
  const secrets = readFileSync(devVars, 'utf8')
    .split('\n')
    .map((l) => l.match(/^(RAKUTEN_ACCESS_KEY|RAKUTEN_APPLICATION_ID|RAKUTEN_AFFILIATE_ID|APP_ACCESS_TOKEN)=(.+)$/))
    .filter(Boolean)
    .map((m) => m[2].trim())
    .filter((v) => v.length >= 6);
  for (const f of [...clientFiles, ...walk(join(root, 'src'))]) {
    const text = readFileSync(f, 'utf8');
    for (const s of secrets) if (text.includes(s)) problems.push(`${f}: .dev.vars の秘密値を含みます`);
  }
}

// 生成 AI API の呼び出しがないこと
const aiHosts = [/api\.openai\.com/, /api\.anthropic\.com/, /generativelanguage\.googleapis\.com/, /@anthropic-ai\/sdk/, /from ['"]openai['"]/, /bedrock-runtime/];
for (const f of [...walk(join(root, 'src')), ...clientFiles]) {
  const text = readFileSync(f, 'utf8');
  for (const re of aiHosts) if (re.test(text)) problems.push(`${f}: 生成AI API (${re}) を参照しています`);
}

if (problems.length > 0) {
  console.error('NG:\n' + problems.join('\n'));
  process.exit(1);
}
console.log(`OK: ${clientFiles.length} 件の配信ファイルに秘密情報・生成AI API 参照なし`);
