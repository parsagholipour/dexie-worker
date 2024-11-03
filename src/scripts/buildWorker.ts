import * as fs from 'fs';
import * as path from 'path';
import getWorkerCode from '../../src/getWorkerCode';

const workerCode = getWorkerCode();

const outputPath = path.join(process.cwd(), '/dist/dexieWorker.js');
fs.writeFileSync(outputPath, workerCode, 'utf8');
console.log(`Worker code written to ${outputPath}`);
