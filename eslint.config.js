import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'drizzle', 'node_modules', 'coverage'] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message:
            'Use the injected Clock (src/platform/clock.ts) so time is controllable in tests.',
        },
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message:
            'Use the injected Clock (src/platform/clock.ts) so time is controllable in tests.',
        },
      ],
    },
  },
  {
    files: ['src/platform/clock.ts', 'src/platform/ids.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },
  {
    files: ['*.js', '*.cjs'],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    files: ['*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { module: 'writable', require: 'readonly' },
    },
  },
);
