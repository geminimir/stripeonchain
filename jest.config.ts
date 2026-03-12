import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/packages/', '<rootDir>/services/'],
  testMatch: ['**/__tests__/**/*.test.ts', '**/*.test.ts'],
  moduleNameMapper: {
    '^@stripeonchain/shared$': '<rootDir>/packages/shared/src',
  },
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.base.json' }],
  },
  collectCoverageFrom: ['**/src/**/*.ts', '!**/src/**/index.ts', '!**/node_modules/**'],
};

export default config;
