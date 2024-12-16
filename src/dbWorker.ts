import Dexie, { DBCore, DBCoreMutateRequest } from 'dexie';

// Declare variables to hold the Dexie database instance and its schema
let db: Dexie | null = null;
let dbReadyPromise: Promise<void> | null = null;
let dbInitializing = false;

// Keep track of connected clients to send change notifications
const connectedClients = new Set<number>();

// Handle messages from the main thread
self.onmessage = async (event: MessageEvent) => {
  const { id, chain, schema, type } = event.data;

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
      if (dbReadyPromise) {
        await dbReadyPromise;
      }
      if (!db) {
        throw new Error('Database is not initialized.');
      }
      const result = await executeChain(chain);
      postMessage({ id, result, type: 'result' });
    } else if (type === 'disconnect') {
      connectedClients.delete(id);
    }
  } catch (error) {
    postMessage({ id, error: (error as any).message, type: 'error' });
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

async function executeChain(chain: any[]) {
  let context: any = db;
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
        const operations = getConfig('operations')
        //Call a custom operation defined by the user
        if (operations && typeof operations[item.args[0]] === 'function') {
          context = operations[item.args[0]](context, ...item.args.slice(1))
          if (context && typeof context.then === 'function') {
            context = await context;
          }
        } else {
          // @ts-ignore
          const errorText = typeof operations === 'undefined' ? 'Operations is not defined. Please generate the worker file by supplying a valid \'operations\' file.' :
            'Function name' + item.args[0] + 'is not defined in the operations file. Have you generated a new worker after updating your operations file?';
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
    throw new Error('Result is not serializable.', context);
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
