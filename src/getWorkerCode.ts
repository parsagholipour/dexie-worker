export default () => {
  return `
importScripts('https://cdn.jsdelivr.net/npm/dexie@3.2.2/dist/dexie.min.js');
// dbWorker.ts
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};

// Declare variables to hold the Dexie database instance and its schema
let db = null;
let dbSchema = null;
let dbReadyPromise = null;
let dbInitializing = false;
// Keep track of connected clients to send change notifications
const connectedClients = new Set();
// Handle messages from the main thread
self.onmessage = (event) => __awaiter(void 0, void 0, void 0, function* () {
    const { id, chain, schema, type } = event.data;
    try {
        if (type === 'init') {
            if (dbInitializing) {
                postMessage({ id, result: 'Database is initializing', type: 'initializing' });
            }
            else if (db) {
                postMessage({ id, result: 'Database already initialized', type: 'init' });
            }
            else {
                dbSchema = schema;
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
                yield dbReadyPromise;
                postMessage({ id, result: 'Database initialized', type: 'init' });
            }
        }
        else if (type === 'execute') {
            if (dbReadyPromise) {
                yield dbReadyPromise;
            }
            if (!db) {
                throw new Error('Database is not initialized.');
            }
            const result = yield executeChain(chain);
            postMessage({ id, result, type: 'result' });
        }
        else if (type === 'disconnect') {
            connectedClients.delete(id);
        }
    }
    catch (error) {
        postMessage({ id, error: error.message, type: 'error' });
    }
});
function initializeDatabase(schema) {
    return new Promise((resolve, reject) => {
        try {
            db = new Dexie(schema.name);
            db.version(schema.version).stores(schema.stores);
            // Add the change tracking middleware using db.use()
            db.use({
                stack: 'dbcore',
                name: 'ChangeTrackingMiddleware',
                create(downlevelDatabase) {
                    return Object.assign(Object.assign({}, downlevelDatabase), { table(tableName) {
                            const downlevelTable = downlevelDatabase.table(tableName);
                            return Object.assign(Object.assign({}, downlevelTable), { mutate(req) {
                                    // Perform the mutation
                                    return downlevelTable.mutate(req).then((res) => {
                                        // After the mutation, notify the main thread
                                        const changedTables = new Set();
                                        changedTables.add(tableName);
                                        notifyChanges(changedTables);
                                        return res;
                                    });
                                } });
                        } });
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
        }
        catch (error) {
            db = null;
            reject(error);
        }
    });
}
function notifyChanges(changedTables) {
    connectedClients.forEach((clientId) => {
        postMessage({ id: clientId, type: 'changes', changedTables: Array.from(changedTables) });
    });
}
function executeChain(chain) {
    return __awaiter(this, void 0, void 0, function* () {
        let context = db;
        for (const item of chain) {
            if (item.type === 'get') {
                if (context[item.prop] !== undefined) {
                    context = context[item.prop];
                }
                else if (context instanceof Dexie && context.tables.map((t) => t.name).includes(item.prop)) {
                    // Access table dynamically
                    context = context.table(item.prop);
                }
                else {
                    throw new Error("Property or table does not exist.");
                }
            }
            else if (item.type === 'call') {
                if (typeof context[item.method] === 'function') {
                    context = context[item.method](...item.args);
                    if (context && context.then) {
                        context = yield context;
                    }
                }
                else {
                    throw new Error(\`Method does not exist.\`);
                }
            }
        }
        // Ensure the result is serializable before returning
        if (!isSerializable(context)) {
            throw new Error('Result is not serializable.');
        }
        return context;
    });
}
function isSerializable(value) {
    try {
        // Use structuredClone or an alternative if structuredClone is not available
        structuredClone(value);
        return true;
    }
    catch (_a) {
        return false;
    }
}


`
}