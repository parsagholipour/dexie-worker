#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';
import esbuild from 'esbuild';

(async () => {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  const packageDexieWorkerPath = path.resolve(__dirname, '..', '.', 'dbWorker.ts');
  const destDexieWorkerPath = path.resolve(process.cwd(), './src', 'dbWorker.js');

  // Create a temporary entry file that imports dexieWorker.js and operations.js
  const tempEntryFile = path.resolve(process.cwd(), 'tempDexieWorkerEntry.ts');

  let entryFileContent = '';
  // Import dexieWorker.js content
  const dexieWorkerContent = fs.readFileSync(packageDexieWorkerPath, 'utf-8');
  entryFileContent += dexieWorkerContent;

  // Write the entry file
  fs.writeFileSync(tempEntryFile, entryFileContent);

  // This plugin helps to support dexie-relationships
  const replaceDexieImportsWithGlobal = {
    name: 'replace-dexie-imports-with-global',
    setup(build) {
      // Intercept loading of all JavaScript and TypeScript files
      build.onLoad({ filter: /\.(js|ts)$/, namespace: 'file' }, async (args) => {
        let contents = await fs.promises.readFile(args.path, 'utf8');

        contents = contents.replace(
          /import\s+Dexie\s+from\s+['"]dexie['"];?/g,
          'const Dexie = self.Dexie;'
        );
        contents = contents.replace(
          /import\s+\*\s+as\s+Dexie\s+from\s+['"]dexie['"];?/g,
          'const Dexie = self.Dexie;'
        );
        contents = contents.replace(
          /import\s+\{[^}]*\}\s+from\s+['"]dexie['"];?/g,
          ''
        );
        contents = contents.replace(
          /import\s+['"]dexie['"];?/g,
          ''
        );
        contents = contents.replace(
          /require\(['"]dexie['"]\)/g,
          'self.Dexie'
        );

        return {
          contents,
          loader: args.path.endsWith('.ts') ? 'ts' : 'js',
        };
      });
    },
  };


  // Bundle the entry file
  const result = await esbuild.build({
    entryPoints: [tempEntryFile],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    target: ['es2018'],
    loader: {
      '.js': 'js',
      '.ts': 'ts',
    },
    banner: { js: '' },
    plugins: [replaceDexieImportsWithGlobal],
    external: ['dexie']
  });

  // Get the bundled code
  let bundledCode = result.outputFiles[0].text;
  bundledCode = bundledCode.replace(/"use strict";\n?/, '');
  bundledCode = bundledCode.replace(/import Dexie from "dexie";\n?/, '');
  bundledCode = bundledCode.replace(/\/\/ tempDexieWorkerEntry.ts\n?/, '');
  bundledCode = `
importScripts('https://cdn.jsdelivr.net/npm/dexie@3.2.2/dist/dexie.min.js');
  ${bundledCode}
  `
  // Write the final dexieWorker.js
  fs.writeFileSync(destDexieWorkerPath, bundledCode);

  // Write getWorkerCode.ts
  const getWorkerCodePath = path.resolve(process.cwd(), './src', 'getWorkerCode.ts');
  fs.writeFileSync(getWorkerCodePath, `export default () => {
  return \`${bundledCode}\`
  }`);

  // Clean up the temporary entry file
  fs.unlinkSync(tempEntryFile);

  console.log('dexieWorker.js generated successfully.');
})();
