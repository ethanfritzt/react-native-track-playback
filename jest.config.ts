import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // Map react-native-audio-api to our hand-written mock so tests never touch
  // native code.
  moduleNameMapper: {
    '^react-native-audio-api$': '<rootDir>/src/__mocks__/react-native-audio-api.ts',
  },
  // Each test file gets a fresh module registry so singleton state (emitter,
  // engine, queue) never leaks between tests.
  resetModules: true,
  clearMocks: true,
};

export default config;
