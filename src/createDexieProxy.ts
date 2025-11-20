import Dexie, {DBCore, DBCoreMutateRequest, IndexSpec, ObservabilitySet} from 'dexie';
import getWorkerCode from "./getWorkerCode";
import {ChainItem, DbSchema, DexieWorkerOptions, WorkerMessage, WorkerResponse} from './types/common'
import {FALLBACK_METHODS} from "./const";
import {supportsBroadcastChannel} from "./helpers";

// Variables to manage the worker and message handling
let worker: Worker | null = null;
let workerReady: Promise<Worker>;
let db: Dexie;
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
      let workerURL = '';
      if (!options?.worker) {
        if (options?.workerUrl) {
          workerURL = options.workerUrl!;
        } else {
          let workerCode = getWorkerCode();
          if (options?.dexieVersion) {
            workerCode = workerCode.replace('3.2.2', options.dexieVersion!)
          }
          const blob = new Blob([workerCode], {type: 'text/javascript'});
          workerURL = URL.createObjectURL(blob);
        }
      }

      const workerMessageHandler = (event: MessageEvent<WorkerResponse>) => {
        const {id, result, error, type, changedTables} = event.data;
        if (type === 'init') {
          resolve(worker!);
        } else {
          if (event.data.error) {
            console.error(event.data.error)
          }
          const pending = pendingMessages.get(id);
          if (pending) {
            const {resolve: res, reject: rej} = pending;
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
      }
      worker = options?.worker ?? new Worker(workerURL, {type: 'classic'})
      worker.onmessage = workerMessageHandler;


      // Extract the schema from the existing Dexie instance
      const dbSchema = extractSchema(dbInstance);
      db = dbInstance;

      // To support live queries
      addChangeTrackingMiddleware(db);

      // Initialize the worker with the database schema
      const initId = messageId++;
      worker.postMessage({id: initId, type: 'init', schema: dbSchema} as WorkerMessage);
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
  initializeWorker<T>(dbInstance, options);

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
  const proxyFunction = function () {
  };
  const proxy = new Proxy(proxyFunction, {
    get(_target, prop: string | symbol) {
      if (prop.toString() === 'then') {
        const lastItem = chain[chain.length - 1];
        if (FALLBACK_METHODS.includes(lastItem.method as string)) {
          return executeOnMainThread(chain)
        }
        const resultPromise = executeChain(chain);
        return resultPromise.then.bind(resultPromise);
      }
      if (tableAccessCallback && chain.length === 0) {
        // At the root level, the first property access might be a table name
        tableAccessCallback(prop.toString());
      }
      return createProxy(chain.concat({type: 'get', prop: prop.toString()}), tableAccessCallback);
    },
    apply(_target, _thisArg, args: any[]) {
      const lastItem = chain[chain.length - 1];
      let newChain: ChainItem[];
      if (lastItem && lastItem.type === 'get') {
        const methodName = lastItem.prop!;
        newChain = chain.slice(0, -1).concat({type: 'call', method: methodName, args});
      } else {
        newChain = chain.concat({type: 'call', method: '<anonymous>', args});
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
  if (workerReady === undefined) {
    throw new Error('You cannot call `useLiveQuery` before web worker initialization (call `getWebWorkerDB` first)')
  }
  const _worker: any = await workerReady;
  return new Promise((resolve, reject) => {
    const id = messageId++;
    pendingMessages.set(id, {resolve, reject});
    _worker!.postMessage({id, type: 'execute', chain} as WorkerMessage);
  });
}

/**
 * Executes a chain of operations on the main thread to ensure compatibility with
 * methods not supported in web workers (e.g., 'hook', 'each', etc.).
 * @param chain The sequence of property accesses and method calls to execute.
 * @returns A promise that resolves with the result of the execution.
 */
async function executeOnMainThread(chain: ChainItem[]): Promise<any> {
  let current: any = db; // Start from the Dexie database instance

  for (const item of chain) {
    // If the current value is a promise, wait for it to resolve
    if (current && typeof current.then === 'function') {
      current = await current;
    }

    if (item.type === 'get') {
      // Access the property specified by 'prop'
      current = current[item.prop!];
    } else if (item.type === 'call') {
      // Call the method specified by 'method' with arguments 'args'
      const func = current[item.method!];
      if (typeof func !== 'function') {
        throw new Error(`Property '${item.method}' is not a function`);
      }

      // Invoke the function with the provided arguments
      current = func.apply(current, item.args || []);

      // Optional: await the result if it's a promise
      if (current && typeof current.then === 'function') {
        current = await current;
      }
    } else {
      throw new Error(`Unknown chain item type: ${item.type}`);
    }
  }

  // Ensure the final result is resolved if it's a promise
  if (current && typeof current.then === 'function') {
    current = await current;
  }

  return current;
}

/**
 * Adds a change-tracking middleware to the Dexie instance to monitor table mutations executed on the main thread.
 * This is necessary because some Dexie methods (e.g., 'hook', 'each') cannot be executed within web workers.
 * By handling these methods on the main thread, we ensure that change events are appropriately triggered.
 *
 * @param db - The Dexie database instance to which the middleware will be attached.
 */
function addChangeTrackingMiddleware(db: Dexie) {
  if (supportsBroadcastChannel()) {
    try {
      Dexie.on('storagemutated', (changedParts: ObservabilitySet) => {
        const changedTables = new Set<string>();
        Object.keys(changedParts || {}).forEach(key => {
          const splitKey = key.split('/');
          const tableName = splitKey[3];
          const dbName = splitKey[2];
          if (dbName === db.name) {
            changedTables.add(tableName);
          }
        })
        if (changedTables.size > 0) {
          changeListeners.forEach((listener) => listener(changedTables));
        }
      })

      return;

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (e) { /* storagemutated event is not supported */ }
  }

  // fallback method of listening to table changes
  db.use({
    stack: 'dbcore',
    name: 'ChangeTrackingMiddleware',
    create(downlevelDatabase: DBCore) {
      return {
        ...downlevelDatabase,
        table(tableName: string) {
          const downlevelTable = downlevelDatabase.table(tableName);
          return {
            ...downlevelTable,
            mutate(req: DBCoreMutateRequest) {
              // Perform the mutation
              return downlevelTable.mutate(req).then((res) => {
                // After the mutation, notify the main thread
                const changedTables = new Set<string>();
                changedTables.add(tableName);
                changeListeners.forEach((listener) => listener(changedTables));
                return res;
              });
            },
          };
        },
      };
    },
  })
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

  // Access internal Dexie properties
  const dbSchema = dbInstance._dbSchema; // Internal property

  for (const tableName in dbSchema) {
    const tableSchema = dbSchema[tableName];
    // Reconstruct the store definition including annotations
    const primKey = tableSchema.primKey.src;

    // @ts-ignore
    const indexes = tableSchema.indexes.filter(idx => !idx.foreignKey).map((idx: IndexSpec & { foreignKey: any }) => idx.src);
    // @ts-ignore
    const foreignKeys = tableSchema.indexes.filter(idx => idx.foreignKey).map((idx: IndexSpec & {
      foreignKey: any
    }) => idx.foreignKey && (idx.foreignKey.index + '->' + idx.foreignKey.targetTable + '.' + idx.foreignKey.targetIndex));
    const storeDef = Array.from(new Set([primKey, ...indexes, ...foreignKeys])).join(',');
    schema.stores[tableName] = storeDef;
  }

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

export {createProxy, addChangeListener, removeChangeListener};
