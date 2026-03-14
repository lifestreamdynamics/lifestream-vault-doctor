import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    root: '.',
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/__tests__/**/*.test.ts'],
    exclude: ['dist/**', 'node_modules/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'node_modules/',
        'dist/',
        '**/*.test.ts',
        '**/__tests__/**',
        'src/index.ts',
        'src/types.ts',
        'src/queue/storage.ts',
        'src/adapters/**',
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      },
    },
  },
});
