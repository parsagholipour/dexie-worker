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
    external: ['dexie'],
    banner: { js: '' }
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
