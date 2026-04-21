// ESM 소스 파일들의 문법을 node:vm.SourceTextModule로 파싱 시도.
// 외부 URL import 때문에 실제 실행은 불가하므로 static parse만 수행.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (f.endsWith('.js') || f.endsWith('.mjs')) out.push(p);
  }
  return out;
}

const files = walk('assets/js');
let ok = 0, bad = 0;
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  try {
    // SourceTextModule is behind flag in Node 22, so use SyntaxError catching via new Script on wrapped form.
    // ESM cannot be parsed by Script. Use vm.compileFunction which ignores import statements → strip them first.
    const stripped = src.replace(/^\s*import[\s\S]*?;?\s*$/gm, '').replace(/^\s*export\s+/gm, '');
    new vm.Script(stripped, { filename: f });
    ok++;
  } catch (e) {
    console.log('PARSE FAIL:', f, '-', e.message);
    bad++;
  }
}
console.log(`parsed ${files.length} files. ok=${ok} bad=${bad}`);
process.exit(bad ? 1 : 0);
