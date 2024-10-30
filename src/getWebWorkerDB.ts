import createDexieProxy from './createDexieProxy';
import Dexie from 'dexie';
import {DexieWorkerOptions} from "./types/common";

export default function getWebWorkerDB<T extends Dexie>(db: T, options?: DexieWorkerOptions): T {
  return createDexieProxy<T>(db, options);
}
