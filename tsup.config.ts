import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  external: ['react', 'react-native', 'react-native-audio-api'],
  outExtension: ({ format }) => ({ js: format === 'esm' ? '.mjs' : '.js' }),
});
