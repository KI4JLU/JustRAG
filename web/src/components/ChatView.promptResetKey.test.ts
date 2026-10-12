import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

/* ---------------------------------------------------------------------------
 * `promptResetKey` — the separator must stay U+0000 (card KI-766).
 *
 * WHAT THE KEY IS
 * ChatView resets `systemPromptDraft` during render, using React's
 * "adjust state when a prop changes" pattern: it derives one string from
 * (KB id, KB system prompt) and compares it against the previous render's
 * copy. The string is never persisted, never sent anywhere, never used as a
 * React `key`, and never compared against a literal — the only two consumers
 * are the `useState` initialiser and the `!==` on the next line. It is an
 * opaque equality token, so the only property that matters is INJECTIVITY:
 * two different (id, prompt) pairs must never produce the same string.
 *
 * WHY THE SEPARATOR IS U+0000
 * `knowledge_bases.id` is a Postgres `uuid` (hex + hyphens) and
 * `knowledge_bases.system_prompt` is Postgres `text`, which cannot store
 * U+0000 at all. So NUL is the one delimiter that provably cannot occur as a
 * content character on either side — a `-` or `:` separator can, and the last
 * test below shows the collision it would cause.
 *
 * WHAT CHANGED ON THIS CARD, AND WHAT DID NOT
 * The source used to contain the raw 0x00 BYTE; it now contains the escape
 * `\0`. The runtime string is byte-identical — this test is the assertion of
 * that, and it is the reason the change is not a behaviour change.
 *
 * THE ORACLE
 * The expected value is built here from `String.fromCharCode(0)`, whose
 * meaning is fixed by the Unicode standard, and the actual value is produced
 * by handing the REAL template literal — read out of ChatView.tsx at test
 * time — to the JavaScript engine. Nothing is compared against a string this
 * repo's code produced. A text assertion like `toContain('\\0')` would pass
 * against `\\0`, `0` or a copied-in typo; evaluating the literal cannot.
 * ------------------------------------------------------------------------- */

// Not `new URL('./ChatView.tsx', import.meta.url)` — Vite statically rewrites
// exactly that pattern into a dev-server URL, and `fileURLToPath` then throws
// "The URL must be of scheme file". Same workaround as ChatView.composer.test.ts.
const here = path.dirname(fileURLToPath(import.meta.url));
// 'utf8', not 'latin1': since this card the file is valid UTF-8 text with no
// control bytes (src/test/controlBytes.test.ts is the standing guard for that).
const src = readFileSync(path.join(here, 'ChatView.tsx'), 'utf8');

/** The template literal as it is actually written in ChatView.tsx. */
function readPromptResetKeyLiteral(): string {
  const line = src.split('\n').find(l => l.includes('const promptResetKey ='));
  if (!line) throw new Error('promptResetKey is gone from ChatView.tsx — this test needs rewriting, not deleting');
  const start = line.indexOf('`');
  const end = line.lastIndexOf('`');
  if (start < 0 || end <= start) throw new Error(`promptResetKey is no longer a template literal: ${line}`);
  return line.slice(start, end + 1);
}

type Kb = { id: string; systemPrompt: string };

/** Evaluates ChatView's own literal against a stub KB. */
function buildKey(currentKb: Kb): string {
  const literal = readPromptResetKeyLiteral();
  return new Function('currentKb', `return ${literal};`)(currentKb) as string;
}

const NUL = String.fromCharCode(0);

describe('promptResetKey', () => {
  it('reads the real literal out of ChatView.tsx', () => {
    // Vacuum protection: if the read silently produced '' every assertion
    // below would still be satisfiable by an empty key.
    const literal = readPromptResetKeyLiteral();
    expect(literal).toContain('currentKb?.id');
    expect(literal).toContain('currentKb?.systemPrompt');
  });

  it('joins id and system prompt with U+0000', () => {
    const key = buildKey({ id: 'ac7e0d3a-0000-4000-8000-000000000001', systemPrompt: 'Du bist hilfreich.' });

    expect(key).toBe('ac7e0d3a-0000-4000-8000-000000000001' + NUL + 'Du bist hilfreich.');
    expect(key.codePointAt('ac7e0d3a-0000-4000-8000-000000000001'.length)).toBe(0);
  });

  it('survives an absent KB the way the `?? \'\'` fallbacks say it should', () => {
    // `currentKb` is `undefined` before a KB is selected; the key must still
    // be a string, or the first render throws.
    const key = new Function('currentKb', `return ${readPromptResetKeyLiteral()};`)(undefined) as string;
    expect(key).toBe(NUL);
  });

  it('cannot collide the way a printable separator could', () => {
    // The point of the delimiter. With '-' these two pairs would both produce
    // 'kb-1-a-b'; with NUL they are distinguishable, and the draft therefore
    // resets exactly when it should.
    const a = buildKey({ id: 'kb-1-a', systemPrompt: 'b' });
    const b = buildKey({ id: 'kb-1', systemPrompt: 'a-b' });
    expect(a).not.toBe(b);
    expect(a.replace(NUL, '-')).toBe(b.replace(NUL, '-')); // identical without it
  });
});
