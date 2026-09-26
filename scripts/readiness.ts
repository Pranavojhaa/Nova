/**
 * The prod gate: refuses while docs/prod-readiness.md has any unchecked box.
 * Usage: pnpm readiness [path]
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// A GitHub task-list item: `-`/`*`/`+` bullets or numbered lists (`1.` / `1)`), each followed by `[ ]` or `[x]`.
const BULLET = String.raw`(?:[-*+]|\d+[.)])`;
const UNCHECKED_ITEM = new RegExp(`^${BULLET} \\[ \\]`);
const ANY_CHECKED_ITEM = new RegExp(`^\\s*${BULLET} \\[[xX]\\]`, 'm');

export function uncheckedItems(markdown: string): string[] {
  return markdown
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => UNCHECKED_ITEM.test(line));
}

/** Refusal reasons for treating `markdown` as a complete gate; empty when the gate is open. */
export function gateProblems(markdown: string): string[] {
  const open = uncheckedItems(markdown);
  if (!ANY_CHECKED_ITEM.test(markdown) && open.length === 0) {
    return ['has no checklist items; refusing to treat it as complete'];
  }
  return open;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const path = process.argv[2] ?? 'docs/prod-readiness.md';
  const markdown = readFileSync(path, 'utf8');
  const problems = gateProblems(markdown);
  if (problems.length > 0) {
    console.error(`prod gate closed (${path}):\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }
  console.log(`prod gate open: every item in ${path} is checked`);
}
