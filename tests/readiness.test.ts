import { describe, expect, it } from 'vitest';
import { gateProblems, uncheckedItems } from '../scripts/readiness.js';

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

  it('catches GitHub task boxes on `+` bullets and numbered lists (`1.` and `1)`)', () => {
    const md = '+ [ ] plus bullet\n1. [ ] dotted number\n1) [ ] parenthesised number\n- [x] done\n';
    expect(uncheckedItems(md)).toEqual([
      '+ [ ] plus bullet',
      '1. [ ] dotted number',
      '1) [ ] parenthesised number',
    ]);
  });
});

describe('gateProblems', () => {
  it('refuses a file with no checklist items at all', () => {
    expect(gateProblems('# Just a heading\nSome prose, no boxes.\n')).toEqual([
      'has no checklist items; refusing to treat it as complete',
    ]);
  });

  it('accepts a fully checked file using `+` and numbered bullets', () => {
    expect(gateProblems('+ [x] a\n1. [X] b\n1) [x] c\n')).toEqual([]);
  });

  it('reports unchecked `+` and numbered items as open problems', () => {
    const md = '+ [ ] plus bullet\n1. [ ] dotted number\n- [x] done\n';
    expect(gateProblems(md)).toHaveLength(2);
  });
});
