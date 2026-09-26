import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
          exclude: ['**/*.int.test.ts', 'node_modules'],
        },
      },
      {
        test: {
          name: 'integration',
          include: ['src/**/*.int.test.ts', 'tests/**/*.int.test.ts'],
          globalSetup: ['tests/helpers/global-setup.ts'],
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
