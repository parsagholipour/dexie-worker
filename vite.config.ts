import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  build: {
    sourcemap: true,
    minify: false,
    lib: {
      entry: path.resolve(__dirname, 'src/index.ts'),
      name: 'DexieWorker',
      fileName: (format) => `dexie-worker.${format}.js`,
      formats: ['umd', 'es'],
    },
    rollupOptions: {
      external: ['dexie', 'react', 'rxjs', 'dexie-react-hooks'],
      output: {
        globals: {
          dexie: 'Dexie',
          react: 'React',
          rxjs: 'rxjs',
          'dexie-react-hooks': 'dexieReactHooks',
        },
      },
    },
  },
  worker: {
    format: 'es',
  },
});
