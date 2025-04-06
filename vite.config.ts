import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig(({mode}) => ({
  build: {
    sourcemap: true,
    minify: mode === 'production',
    lib: {
      entry: path.resolve(__dirname, 'src/index.ts'),
      name: 'DexieWorker',
      fileName: (format) => `dexie-worker.${format}.js`,
      formats: ['umd', 'es', 'cjs'],
    },
    rollupOptions: {
      external: ['dexie', 'react', /rxjs/, 'dexie-react-hooks'],
    },
  },
  worker: {
    format: 'es',
  },
}));
