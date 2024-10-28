import createDexieProxy from './createDexieProxy';
import Dexie from 'dexie';

export default function getWebWorkerDB(db: Dexie) {
  return createDexieProxy(db);
}
