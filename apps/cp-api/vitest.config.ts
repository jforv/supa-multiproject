import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // Wiring only; exercised by the compose smoke test instead of unit tests.
      exclude: ['src/**/*.test.ts', 'src/server.ts', 'src/compose.ts', 'src/cli/**'],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
})
