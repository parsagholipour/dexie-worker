import Dexie, { DBCore, DBCoreMutateRequest } from 'dexie';

interface MessageListenerOptions {
  operations?: Record<string, any>;
}

// Declare variables to hold the Dexie database instance and its schema
let db: Dexie | null = null;
let dbReadyPromise: Promise<void> | null = null;
let dbInitializing = false;
let currentLiveQueryId: string | null = null;
let executeQueue: Promise<void> = Promise.resolve();

// Keep track of connected clients to send change notifications
const connectedClients = new Set<number>();

function enqueueExecute<T>(work: () => Promise<T>): Promise<T> {
  const run = executeQueue.then(work, work);
  executeQueue = run.then(() => undefined, () => undefined);
  return run;
}

function isKnownTableName(name: string): boolean {
  if (!db) {
    return false;
  }
  if (db.tables?.some((table) => table.name === name)) {
    return true;
  }
  return Boolean((db as any)._dbSchema && name in (db as any)._dbSchema);
}

function trackTableAccess(tableName: string) {
  if (!currentLiveQueryId) {
    return;
  }
  postMessage({ type: 'accessedTables', liveQueryId: currentLiveQueryId, accessedTables: [tableName] });
}

function createDbAccessProxy(database: Dexie) {
  return new Proxy(database, {
    get(target, prop) {
      if (prop === 'table') {
        return (name: string) => {
          if (typeof name === 'string') {
            trackTableAccess(name);
          }
          return target.table(name);
        };
      }
      if (typeof prop === 'string' && isKnownTableName(prop)) {
        trackTableAccess(prop);
      }
      const value = (target as any)[prop];
      if (typeof value === 'function') {
        return value.bind(target);
      }
      return value;
    },
  });
}

const getMessageListener = (options?: MessageListenerOptions) => {
  return async (event: MessageEvent) => {
    const { id, chain, schema, type, liveQueryId } = event.data;

    try {
      if (type === 'init') {
        if (dbInitializing) {
          postMessage({ id, result: 'Database is initializing', type: 'initializing' });
        }
        else if (db) {
          postMessage({ id, result: 'Database already initialized', type: 'init' });
        } else {
          dbInitializing = true;
          connectedClients.add(id); // Add client to connected clients
          dbReadyPromise = initializeDatabase(schema)
            .then(() => {
              dbInitializing = false;
            })
            .catch((error) => {
              dbInitializing = false;
              db = null;
              throw error;
            });
          await dbReadyPromise;
          postMessage({ id, result: 'Database initialized', type: 'init' });
        }
      } else if (type === 'execute') {
        const result = await enqueueExecute(async () => {
          if (dbReadyPromise) {
            await dbReadyPromise;
          }
          if (!db) {
            throw new Error('Database is not initialized.');
          }
          currentLiveQueryId = liveQueryId || null;
          try {
            return await executeChain(chain, options?.operations);
          } finally {
            currentLiveQueryId = null;
          }
        });
        postMessage({ id, result, type: 'result' });
      } else if (type === 'disconnect') {
        connectedClients.delete(id);
      }
    } catch (error) {
      postMessage({ id, error: (error as any).message, type: 'error' });
    }
  }
};

function initializeDatabase(schema: any): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      db = new Dexie(schema.name);

      db.version(schema.version).stores(schema.stores);

      // Add the change tracking middleware using db.use()
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
                get: (req) => {
                  trackTableAccess(tableName);
                  return downlevelTable.get(req);
                },
                getMany: (req) => {
                  trackTableAccess(tableName);
                  return downlevelTable.getMany(req);
                },
                query: (req) => {
                  trackTableAccess(tableName);
                  return downlevelTable.query(req);
                },
                openCursor: (req) => {
                  trackTableAccess(tableName);
                  return downlevelTable.openCursor(req);
                },
                count: (req) => {
                  trackTableAccess(tableName);
                  return downlevelTable.count(req);
                },
                mutate(req: DBCoreMutateRequest) {
                  // Perform the mutation
                  return downlevelTable.mutate(req).then((res) => {
                    // After the mutation, notify the main thread
                    const changedTables = new Set<string>();
                    changedTables.add(tableName);
                    notifyChanges(changedTables);
                    return res;
                  });
                },
              };
            },
          };
        },
      });

      db.open()
        .then(() => {
          resolve();
        })
        .catch((error) => {
          db = null;
          reject(error);
        });
    } catch (error) {
      db = null;
      reject(error);
    }
  });
}

function notifyChanges(changedTables: Set<string>) {
  connectedClients.forEach((clientId) => {
    postMessage({ id: clientId, type: 'changes', changedTables: Array.from(changedTables) });
  });
}

function getConfig(key: string) {
  // @ts-ignore
  if (typeof configModule !== 'undefined') {
    // @ts-ignore
    return configModule[key]
  }
  return null
}

async function executeChain(chain: any[], _operations?: Record<string, any>) {
  let context: any = createDbAccessProxy(db!);
  for (const item of chain) {
    if (item.type === 'get') {
      if (context[item.prop] !== undefined) {
        context = context[item.prop];
      } else if (context instanceof Dexie && context.tables.map((t) => t.name).includes(item.prop)) {
        // Access table dynamically
        context = context.table(item.prop);
      } else {
        throw new Error("Property or table" + item.prop + "does not exist.");
      }
    } else if (item.type === 'call') {
      if (item.method === 'operation') {
        const operations = _operations || getConfig('operations')
        //Call a custom operation defined by the user
        if (operations && typeof operations[item.args[0]] === 'function') {
          context = operations[item.args[0]](context, ...item.args.slice(1))
          if (context && typeof context.then === 'function') {
            context = await context;
          }
        } else {
          // @ts-ignore
          const errorText = typeof operations === 'undefined' ? 'Operations is not defined. Please generate the worker file by supplying a valid \'operations\' file.' :
            'The function name ' + item.args[0] + ' is not defined in the operations file. Have you generated a new worker after updating your operations file?';
          throw new Error(errorText)
        }
      } else if (typeof context[item.method] === 'function') {
        context = context[item.method](...item.args);
        if (context && context.then) {
          context = await context;
        }
      } else {
        throw new Error("Method " + item.method + " does not exist.");
      }
    }
  }

  // Ensure the result is serializable before returning
  if (!isSerializable(context)) {
    throw new Error('Result is not serializable. Chain: ' + JSON.stringify(chain), context);
  }

  return context;
}

function isSerializable(value: any): boolean {
  try {
    structuredClone(value);
    return true;
  } catch {
    return false;
  }
}

function __resetForTests() {
  if (db) {
    try {
      db.close();
    } catch {
      // Database may already be closed
    }
  }
  db = null;
  dbReadyPromise = null;
  dbInitializing = false;
  currentLiveQueryId = null;
  executeQueue = Promise.resolve();
  connectedClients.clear();
}

export {getMessageListener, __resetForTests}
