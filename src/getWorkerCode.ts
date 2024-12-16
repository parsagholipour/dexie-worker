export default () => {
  return `
importScripts('https://cdn.jsdelivr.net/npm/dexie@3.2.2/dist/dexie.min.js');
  var db = null;
var dbReadyPromise = null;
var dbInitializing = false;
var connectedClients = /* @__PURE__ */ new Set();
self.onmessage = async (event) => {
  const { id, chain, schema, type } = event.data;
  try {
    if (type === "init") {
      if (dbInitializing) {
        postMessage({ id, result: "Database is initializing", type: "initializing" });
      } else if (db) {
        postMessage({ id, result: "Database already initialized", type: "init" });
      } else {
        dbInitializing = true;
        connectedClients.add(id);
        dbReadyPromise = initializeDatabase(schema).then(() => {
          dbInitializing = false;
        }).catch((error) => {
          dbInitializing = false;
          db = null;
          throw error;
        });
        await dbReadyPromise;
        postMessage({ id, result: "Database initialized", type: "init" });
      }
    } else if (type === "execute") {
      if (dbReadyPromise) {
        await dbReadyPromise;
      }
      if (!db) {
        throw new Error("Database is not initialized.");
      }
      const result = await executeChain(chain);
      postMessage({ id, result, type: "result" });
    } else if (type === "disconnect") {
      connectedClients.delete(id);
    }
  } catch (error) {
    postMessage({ id, error: error.message, type: "error" });
  }
};
function initializeDatabase(schema) {
  return new Promise((resolve, reject) => {
    try {
      db = new Dexie(schema.name);
      db.version(schema.version).stores(schema.stores);
      db.use({
        stack: "dbcore",
        name: "ChangeTrackingMiddleware",
        create(downlevelDatabase) {
          return {
            ...downlevelDatabase,
            table(tableName) {
              const downlevelTable = downlevelDatabase.table(tableName);
              return {
                ...downlevelTable,
                mutate(req) {
                  return downlevelTable.mutate(req).then((res) => {
                    const changedTables = /* @__PURE__ */ new Set();
                    changedTables.add(tableName);
                    notifyChanges(changedTables);
                    return res;
                  });
                }
              };
            }
          };
        }
      });
      db.open().then(() => {
        resolve();
      }).catch((error) => {
        db = null;
        reject(error);
      });
    } catch (error) {
      db = null;
      reject(error);
    }
  });
}
function notifyChanges(changedTables) {
  connectedClients.forEach((clientId) => {
    postMessage({ id: clientId, type: "changes", changedTables: Array.from(changedTables) });
  });
}
function getConfig(key) {
  if (typeof configModule !== "undefined") {
    return configModule[key];
  }
  return null;
}
async function executeChain(chain) {
  let context = db;
  for (const item of chain) {
    if (item.type === "get") {
      if (context[item.prop] !== void 0) {
        context = context[item.prop];
      } else if (context instanceof Dexie && context.tables.map((t) => t.name).includes(item.prop)) {
        context = context.table(item.prop);
      } else {
        throw new Error("Property or table" + item.prop + "does not exist.");
      }
    } else if (item.type === "call") {
      if (item.method === "operation") {
        const operations = getConfig("operations");
        if (operations && typeof operations[item.args[0]] === "function") {
          context = operations[item.args[0]](context, ...item.args.slice(1));
          if (context && typeof context.then === "function") {
            context = await context;
          }
        } else {
          const errorText = typeof operations === "undefined" ? "Operations is not defined. Please generate the worker file by supplying a valid 'operations' file." : "Function name" + item.args[0] + "is not defined in the operations file. Have you generated a new worker after updating your operations file?";
          throw new Error(errorText);
        }
      } else if (typeof context[item.method] === "function") {
        context = context[item.method](...item.args);
        if (context && context.then) {
          context = await context;
        }
      } else {
        throw new Error("Method " + item.method + " does not exist.");
      }
    }
  }
  if (!isSerializable(context)) {
    throw new Error("Result is not serializable.", context);
  }
  return context;
}
function isSerializable(value) {
  try {
    structuredClone(value);
    return true;
  } catch (e) {
    return false;
  }
}

  `
  }