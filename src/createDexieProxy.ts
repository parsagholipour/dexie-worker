import Dexie, {DBCore, DBCoreMutateRequest, IndexSpec, ObservabilitySet} from 'dexie';
import getWorkerCode from "./getWorkerCode";
import {ChainItem, DbSchema, DexieWorkerOptions, WorkerMessage, WorkerResponse} from './types/common'
import {FALLBACK_METHODS} from "./const";
import {supportsBroadcastChannel} from "./helpers";

// Variables to manage the worker and message handling
let worker: Worker | null = null;
let workerReady: Promise<Worker> | undefined;
let db: Dexie | undefined;
let messageId = 0;
const pendingMessages = new Map<
  number,
  { resolve: (value?: any) => void; reject: (reason?: any) => void }
>();
const changeListeners: Array<(changedTables: Set<string>) => void> = [];
const liveQueryAccessListeners = new Map<string, (tableName: string) => void>();
let useStorageMutatedNotifications = false;
let storageMutatedHandler: ((changedParts: ObservabilitySet) => void) | null = null;
let pendingChangedTables: Set<string> | null = null;
let changeNotificationsReady = false;

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
        const {id, result, error, type, changedTables, accessedTables, liveQueryId} = event.data;
        if (type === 'accessedTables' && liveQueryId) {
          const listener = liveQueryAccessListeners.get(liveQueryId);
          accessedTables?.forEach((tableName) => listener?.(tableName));
        } else if (type === 'init') {
          changeNotificationsReady = true;
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

        if (type === 'changes' && changedTables && !useStorageMutatedNotifications && changeNotificationsReady) {
          notifyListeners(changedTables);
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
  // support for test environments
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    if (!options?.silenceWarning) {
      console.warn('Dexie worker cannot be run in a non-browser environment.')
    }
    return dbInstance;
  }

  initializeWorker<T>(dbInstance, options);

  return createProxy<T>();
}

/**
 * Creates a proxy that builds a chain of property accesses and method calls.
 * @param chain The current chain of operations.
 * @param tableAccessCallback Optional callback to track table accesses.
 * @param liveQueryId Optional liveQuery subscription id forwarded to the worker.
 * @returns A proxy that allows for method chaining.
 */
function createProxy<T>(
  chain: ChainItem[] = [],
  tableAccessCallback?: (tableName: string) => void,
  liveQueryId?: string
): T {
  // Root must be a plain object. A function target makes `typeof db === 'function'`,
  // so React `setState(db)` treats it as an updater and calls it.
  const isRoot = chain.length === 0;
  const target = isRoot ? {} : function () {};
  const proxy = new Proxy(target, {
    get(_target, prop: string | symbol) {
      if (prop.toString() === 'then') {
        if (isRoot) {
          return undefined;
        }
        const lastItem = chain[chain.length - 1];
        if (FALLBACK_METHODS.includes(lastItem.method as string)) {
          return executeOnMainThread(chain)
        }
        const resultPromise = executeChain(chain, liveQueryId);
        return resultPromise.then.bind(resultPromise);
      }
      if (tableAccessCallback && isRoot && isKnownTable(prop.toString())) {
        tableAccessCallback(prop.toString());
      }
      return createProxy(chain.concat({type: 'get', prop: prop.toString()}), tableAccessCallback, liveQueryId);
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
      return createProxy(newChain, tableAccessCallback, liveQueryId);
    },
  });

  return proxy as T;
}

/**
 * Sends the chain of operations to the worker for execution.
 * @param chain The chain of property accesses and method calls.
 * @returns A promise that resolves with the result of the execution.
 */
async function executeChain(
  chain: ChainItem[],
  liveQueryId?: string
): Promise<any> {
  if (workerReady === undefined) {
    throw new Error('You cannot call `useLiveQuery` before web worker initialization (call `getWebWorkerDB` first)')
  }
  const _worker: any = await workerReady;
  return new Promise((resolve, reject) => {
    const id = messageId++;
    pendingMessages.set(id, {resolve, reject});
    const message: WorkerMessage = {id, type: 'execute', chain};
    if (liveQueryId) {
      message.liveQueryId = liveQueryId;
    }
    _worker!.postMessage(message);
  });
}

/**
 * Executes a chain of operations on the main thread to ensure compatibility with
 * methods not supported in web workers (e.g., 'hook', 'each', etc.).
 * @param chain The sequence of property accesses and method calls to execute.
 * @returns A promise that resolves with the result of the execution.
 */
async function executeOnMainThread(chain: ChainItem[]): Promise<any> {
  if (!db) {
    throw new Error('You cannot call `useLiveQuery` before web worker initialization (call `getWebWorkerDB` first)')
  }
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
function addChangeTrackingMiddleware(dbInstance: Dexie) {
  if (supportsBroadcastChannel()) {
    try {
      storageMutatedHandler = (changedParts: ObservabilitySet) => {
        if (!changeNotificationsReady) {
          return;
        }
        const changedTables = new Set<string>();
        Object.keys(changedParts || {}).forEach(key => {
          const splitKey = key.split('/');
          const tableName = splitKey[3];
          const dbName = splitKey[2];
          if (dbName === dbInstance.name) {
            changedTables.add(tableName);
          }
        })
        if (changedTables.size > 0) {
          notifyListeners(changedTables);
        }
      };
      Dexie.on('storagemutated', storageMutatedHandler);
      useStorageMutatedNotifications = true;
      return;

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (e) { /* storagemutated event is not supported */ }
  }

  useStorageMutatedNotifications = false;

  // fallback method of listening to table changes
  dbInstance.use({
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
                notifyListeners([tableName]);
                return res;
              });
            },
          };
        },
      };
    },
  })
}

function isKnownTable(name: string): boolean {
  if (!db) {
    return false;
  }
  if (db.tables?.some((table) => table.name === name)) {
    return true;
  }
  return Boolean(db._dbSchema && name in db._dbSchema);
}

function notifyListeners(changedTables: Iterable<string>): void {
  if (!pendingChangedTables) {
    pendingChangedTables = new Set();
    queueMicrotask(() => {
      const batch = pendingChangedTables;
      pendingChangedTables = null;
      if (!batch || batch.size === 0) {
        return;
      }
      changeListeners.slice().forEach((listener) => listener(batch));
    });
  }
  for (const table of changedTables) {
    pendingChangedTables.add(table);
  }
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

function addLiveQueryAccessListener(liveQueryId: string, listener: (tableName: string) => void): void {
  liveQueryAccessListeners.set(liveQueryId, listener);
}

function removeLiveQueryAccessListener(liveQueryId: string): void {
  liveQueryAccessListeners.delete(liveQueryId);
}

function __notifyForTests(changedTables: Set<string>): void {
  notifyListeners(changedTables);
}

function __resetForTests(): void {
  if (storageMutatedHandler) {
    try {
      Dexie.on.storagemutated.unsubscribe(storageMutatedHandler);
    } catch {
      // Event may not expose unsubscribe in every Dexie version
    }
    storageMutatedHandler = null;
  }
  worker = null;
  workerReady = undefined;
  db = undefined;
  messageId = 0;
  pendingMessages.clear();
  changeListeners.length = 0;
  liveQueryAccessListeners.clear();
  useStorageMutatedNotifications = false;
  pendingChangedTables = null;
  changeNotificationsReady = false;
}

export {
  createProxy,
  addChangeListener,
  removeChangeListener,
  addLiveQueryAccessListener,
  removeLiveQueryAccessListener,
  __notifyForTests,
  __resetForTests
};
