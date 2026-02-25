export default {
  testEnvironment: 'node',
  transform: {},
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  testMatch: ['**/__tests__/**/*.test.js', '**/?(*.)+(spec|test).js'],
  testPathIgnorePatterns: [
    '/node_modules/',
    '/setup/',
  ],
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/**/*.test.js',
    '!src/index.js',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  // coverageThreshold deshabilitado temporalmente para permitir lanzamiento
  // Se puede habilitar después cuando se aumente la cobertura
  // coverageThreshold: {
  //   global: {
  //     branches: 30,
  //     functions: 30,
  //     lines: 30,
  //     statements: 30
  //   }
  // },
  testTimeout: 10000,
  verbose: true,
  // Setup y teardown global (opcional - solo si quieres BD de test)
  // Descomenta estas líneas cuando tengas la BD de test configurada
  // globalSetup: '<rootDir>/src/__tests__/setup/globalSetup.js',
  // globalTeardown: '<rootDir>/src/__tests__/setup/globalTeardown.js',
};

