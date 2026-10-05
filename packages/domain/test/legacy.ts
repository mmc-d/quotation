import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const INDEX = path.resolve(here, '../../../index.html');

/** Extract `function name(...) { ... }` from the legacy single-page tool by brace matching. */
export function legacyFunctionSource(name: string): string {
  const src = readFileSync(INDEX, 'utf8');
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`legacy function ${name} not found in index.html`);
  let i = src.indexOf('{', start);
  let depth = 0;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced braces in legacy ${name}`);
}

/** Load a legacy function as a callable. */
export function legacy<T extends (...args: never[]) => unknown>(name: string): T {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function(`${legacyFunctionSource(name)}; return ${name};`)() as T;
}
