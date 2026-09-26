/**
 * The prod gate: refuses while docs/prod-readiness.md has any unchecked box.
 * Usage: pnpm readiness [path]
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function uncheckedItems(markdown: string): string[] {
  return markdown
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^[-*] \[ \]/.test(line));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const path = process.argv[2] ?? 'docs/prod-readiness.md';
  const markdown = readFileSync(path, 'utf8');
  if (!/^\s*[-*] \[[xX]\]/m.test(markdown) && uncheckedItems(markdown).length === 0) {
    console.error(`${path} has no checklist items; refusing to treat it as complete`);
    process.exit(1);
  }
  const open = uncheckedItems(markdown);
  if (open.length > 0) {
    console.error(
      `prod gate closed: ${open.length} unchecked item(s) in ${path}:\n  ${open.join('\n  ')}`,
    );
    process.exit(1);
  }
  console.log(`prod gate open: every item in ${path} is checked`);
}
