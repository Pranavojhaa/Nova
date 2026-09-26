/**
 * Module boundary rules. These are architecture, not style: if a rule blocks you,
 * change the design or discuss it, do not add an exception casually.
 */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'modules-only-through-index',
      comment:
        'A module is imported only through its index.ts. schema.ts files may reference other schema.ts files for foreign keys.',
      severity: 'error',
      from: { path: '^src/modules/([^/]+)/', pathNot: '^src/modules/[^/]+/schema\\.ts$' },
      to: {
        path: '^src/modules/([^/]+)/(?!index\\.ts$)',
        pathNot: '^src/modules/$1/',
      },
    },
    {
      name: 'outside-modules-only-through-index',
      severity: 'error',
      from: { pathNot: '^src/modules/' },
      to: { path: '^src/modules/[^/]+/(?!index\\.ts$)' },
    },
    {
      name: 'platform-is-leaf',
      comment: 'platform/ is infrastructure; it must not know about the domain.',
      severity: 'error',
      from: { path: '^src/platform/' },
      to: { path: '^src/(modules|api|entrypoints)/' },
    },
    {
      name: 'reasoner-has-no-side-effects',
      comment: 'The reasoner proposes. It must not reach anything that can act on the world.',
      severity: 'error',
      from: { path: '^src/modules/reasoner/' },
      to: { path: '^src/modules/(actions|capabilities|authorization|connections)/' },
    },
    {
      name: 'policy-is-pure',
      comment: 'Policy is a deterministic function over data. No database, no network, no model.',
      severity: 'error',
      from: { path: '^src/modules/policy/' },
      to: {
        path: '^(src/platform/(db|jobs)|src/modules/(actions|reasoner|connections))|node_modules/(pg|drizzle-orm|graphile-worker)/',
      },
    },
    {
      name: 'only-actions-executes-capabilities',
      comment: 'Nothing but the action executor may import capability implementations to run them.',
      severity: 'error',
      from: { path: '^src/modules/', pathNot: '^src/modules/(actions|capabilities)/' },
      to: { path: '^src/modules/capabilities/(?!index\\.ts$|types\\.ts$)' },
    },
    {
      name: 'no-tests-in-src-imports',
      severity: 'error',
      from: { path: '^src/', pathNot: '\\.test\\.ts$' },
      to: { path: '^tests/' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    exclude: { path: '\\.test\\.ts$' },
  },
};
