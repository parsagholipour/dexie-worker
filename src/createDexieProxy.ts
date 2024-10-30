import Dexie from 'dexie';
import getWorkerCode from "./getWorkerCode";
import {ChainItem, DbSchema, DexieWorkerOptions, WorkerMessage, WorkerResponse} from './types/common'

// Variables to manage the worker and message handling
let worker: Worker | null = null;
let workerReady: Promise<Worker>;
let messageId = 0;
const pendingMessages = new Map<
  number,
  { resolve: (value?: any) => void; reject: (reason?: any) => void }
>();
const changeListeners: Array<(changedTables: Set<string>) => void> = [];

/**
 * Initializes the web worker and sets up message handling.
 * @param dbInstance The existing Dexie instance from which to extract the schema.
 * @param options
 */
function initializeWorker<T extends Dexie>(dbInstance: T, options?: DexieWorkerOptions): Promise<Worker> {
  if (!workerReady) {
    workerReady = new Promise<Worker>((resolve) => {
      let workerURL;
      if (options?.workerUrl) {
        workerURL = options?.workerUrl;
      } else {
        const workerCode = getWorkerCode();
        const blob = new Blob([workerCode], { type: 'text/javascript' });
        workerURL = URL.createObjectURL(blob);
      }

      worker = new Worker(workerURL, { type: 'classic' });
      worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        const { id, result, error, type, changedTables } = event.data;
        if (type === 'init') {
          resolve(worker!);
        } else {
          if (event.data.error) {
            console.error(event.data.error)
          }
          const pending = pendingMessages.get(id);
          if (pending) {
            const { resolve: res, reject: rej } = pending;
            pendingMessages.delete(id);
            if (error) {
              rej(new Error(error));
            } else {
              res(result);
            }
          }
        }

        // Existing change listener handling
        if (type === 'changes' && changedTables) {
          const changedTablesSet = new Set<string>(changedTables);
          changeListeners.forEach((listener) => listener(changedTablesSet));
        }
      };

      // Extract the schema from the existing Dexie instance
      const dbSchema = extractSchema(dbInstance);

      // Initialize the worker with the database schema
      const initId = messageId++;
      worker.postMessage({ id: initId, type: 'init', schema: dbSchema } as WorkerMessage);
    });
  }
  return workerReady;
}

/**
 * Creates a proxy that intercepts property accesses and method calls.
 * @param dbInstance The Dexie instance used to extract the schema.
 * @returns A proxy that represents the Dexie database.
 */
export default function createDexieProxy<T extends Dexie>(dbInstance: T, options?: DexieWorkerOptions): T {
  initializeWorker<T>(dbInstance);

  return createProxy<T>();
}

/**
 * Creates a proxy that builds a chain of property accesses and method calls.
 * @param chain The current chain of operations.
 * @param tableAccessCallback Optional callback to track table accesses.
 * @returns A proxy that allows for method chaining.
 */
function createProxy<T>(
  chain: ChainItem[] = [],
  tableAccessCallback?: (tableName: string) => void
): T {
  const proxyFunction = function () {};
  const proxy = new Proxy(proxyFunction, {
    get(_target, prop: string | symbol) {
      if (prop.toString() === 'then') {
        const resultPromise = executeChain(chain);
        return resultPromise.then.bind(resultPromise);
      }
      if (tableAccessCallback && chain.length === 0) {
        // At the root level, the first property access might be a table name
        tableAccessCallback(prop.toString());
      }
      return createProxy(chain.concat({ type: 'get', prop: prop.toString() }), tableAccessCallback);
    },
    apply(_target, _thisArg, args: any[]) {
      const lastItem = chain[chain.length - 1];
      let newChain: ChainItem[];
      if (lastItem && lastItem.type === 'get') {
        const methodName = lastItem.prop!;
        newChain = chain.slice(0, -1).concat({ type: 'call', method: methodName, args });
      } else {
        newChain = chain.concat({ type: 'call', method: '<anonymous>', args });
      }
      return createProxy(newChain, tableAccessCallback);
    },
  });

  return proxy as T;
}

/**
 * Sends the chain of operations to the worker for execution.
 * @param chain The chain of property accesses and method calls.
 * @returns A promise that resolves with the result of the execution.
 */
async function executeChain(chain: ChainItem[]): Promise<any> {
  const _worker: any = await workerReady;
  return new Promise((resolve, reject) => {
    const id = messageId++;
    pendingMessages.set(id, { resolve, reject });
    _worker!.postMessage({ id, type: 'execute', chain } as WorkerMessage);
  });
}


/**
 * Extracts the database schema from the Dexie instance.
 * @param dbInstance The Dexie instance.
 * @returns An object representing the database schema.
 */
function extractSchema(dbInstance: Dexie): DbSchema {
  const schema: DbSchema = {
    name: dbInstance.name,
    version: dbInstance.verno,
    stores: {},
  };

  dbInstance.tables.forEach((table) => {
    const tableName = table.name;
    let storeDef = table.schema.primKey.src;
    if (table.schema.indexes.length > 0) {
      storeDef += ',' + table.schema.indexes.map((idx) => idx.src).join(',');
    }
    schema.stores[tableName] = storeDef;
  });

  return schema;
}

/**
 * Adds a listener to be notified when database changes occur.
 * @param listener The function to call when changes occur.
 */
function addChangeListener(listener: (changedTables: Set<string>) => void): void {
  changeListeners.push(listener);
}

/**
 * Removes a previously added change listener.
 * @param listener The listener function to remove.
 */
function removeChangeListener(listener: (changedTables: Set<string>) => void): void {
  const index = changeListeners.indexOf(listener);
  if (index !== -1) {
    changeListeners.splice(index, 1);
  }
}

export { createProxy, addChangeListener, removeChangeListener };
