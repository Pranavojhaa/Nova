import { describe, expect, it } from 'vitest';
import { uncheckedItems } from '../scripts/readiness.js';

describe('uncheckedItems', () => {
  it('lists every unchecked box', () => {
    const md =
      '# Gate\n- [x] done: run 42\n- [ ] backups restored\n  - [ ] nested item\n* [ ] star bullet\n';
    expect(uncheckedItems(md)).toEqual([
      '- [ ] backups restored',
      '- [ ] nested item',
      '* [ ] star bullet',
    ]);
  });

  it('returns nothing when every box is checked', () => {
    expect(uncheckedItems('- [x] a\n- [X] b\n')).toEqual([]);
  });
});
