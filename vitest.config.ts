import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      exclude: [
        'node_modules/',
        'dist/',
        'tests/',
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/types.ts',
        'examples/',
        '**/*.config.ts',
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
    include: ['tests/**/*.test.ts', 'packages/**/tests/**/*.test.ts'],
    exclude: ['node_modules/', 'dist/', 'examples/'],
  },
  resolve: {
    alias: {
      // Monorepo package aliases
      'forja-types': path.resolve(__dirname, './packages/types/src'),
      'forja-types/core/schema': path.resolve(__dirname, './packages/types/src/core/schema.ts'),
      'forja-types/core/query-builder': path.resolve(__dirname, './packages/types/src/core/query-builder.ts'),
      'forja-types/adapter': path.resolve(__dirname, './packages/types/src/adapter.ts'),
      'forja-types/utils': path.resolve(__dirname, './packages/types/src/utils.ts'),

      'forja-core': path.resolve(__dirname, './packages/core/src'),
      'forja-core/query-builder': path.resolve(__dirname, './packages/core/src/query-builder'),
      'forja-core/schema': path.resolve(__dirname, './packages/core/src/schema'),

      'forja-adapter-postgres': path.resolve(__dirname, './packages/adapter-postgres/src'),
      'forja-api': path.resolve(__dirname, './packages/api/src'),

      // Legacy aliases for backward compatibility with old tests
      '@': path.resolve(__dirname, './packages'),
      '@core': path.resolve(__dirname, './packages/core/src'),
      '@adapters': path.resolve(__dirname, './packages/adapter-postgres/src'),
      '@api': path.resolve(__dirname, './packages/api/src'),
    },
  },
});
