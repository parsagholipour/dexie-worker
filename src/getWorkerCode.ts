export default () => {
  return `
importScripts('https://cdn.jsdelivr.net/npm/dexie@3.2.2/dist/dexie.min.js');
  var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/dexie-relationships/dist/index.js
var require_dist = __commonJS({
  "node_modules/dexie-relationships/dist/index.js"(exports, module) {
    (function(global, factory) {
      typeof exports === "object" && typeof module !== "undefined" ? module.exports = factory(self.Dexie) : typeof define === "function" && define.amd ? define(["dexie"], factory) : global.dexieRelationships = factory(global.Dexie);
    })(exports, function(Dexie2) {
            Dexie2 = "default" in Dexie2 ? Dexie2["default"] : Dexie2;
      var SchemaParser = function SchemaParser2(schema) {
        this.schema = schema;
      };
      SchemaParser.prototype.getForeignKeys = function getForeignKeys() {
        var this$1 = this;
        var foreignKeys = {};
        Object.keys(this.schema).forEach(function(table) {
          var indexes = this$1.schema[table].split(",");
          foreignKeys[table] = indexes.filter(function(idx) {
            return idx.indexOf("->") !== -1;
          }).map(function(idx) {
            var ref = idx.split("->").map(function(x) {
              return x.trim();
            });
            var column = ref[0];
            var target = ref[1];
            return {
              index: column,
              targetTable: target.split(".")[0],
              targetIndex: target.split(".")[1]
            };
          });
        });
        return foreignKeys;
      };
      SchemaParser.prototype.getCleanedSchema = function getCleanedSchema() {
        var this$1 = this;
        var schema = {};
        Object.keys(this.schema).forEach(function(table) {
          var indexes = this$1.schema[table].split(",");
          schema[table] = indexes.map(function(idx) {
            return idx.split("->")[0].trim();
          }).join(",");
        });
        return schema;
      };
      function isIndexableType(value) {
        return value != null && // Using "!=" instead of "!==" to check for both null and undefined!
        (typeof value === "string" || typeof value === "number" || value instanceof Date || Array.isArray(value) && value.every(isIndexableType));
      }
      var Relationships = function(db2) {
        var Promise2 = Dexie2.Promise;
        db2.Table.prototype.with = function(relationships) {
          return this.toCollection().with(relationships);
        };
        db2.Collection.prototype.with = function(relationships) {
          var this$1 = this;
          var baseTable = this._ctx.table.name;
          var databaseTables = db2._allTables;
          var usableForeignTables = [];
          Object.keys(relationships).forEach(function(column) {
            var tableOrIndex = relationships[column];
            var matchingIndex = this$1._ctx.table.schema.idxByName[tableOrIndex];
            if (matchingIndex && matchingIndex.hasOwnProperty("foreignKey")) {
              var index = matchingIndex;
              usableForeignTables.push({
                column,
                index: index.foreignKey.targetIndex,
                tableName: index.foreignKey.targetTable,
                targetIndex: index.foreignKey.index,
                oneToOne: true
              });
            } else {
              var table = tableOrIndex;
              if (!databaseTables.hasOwnProperty(table)) {
                throw new Error("Relationship table " + table + " doesn't exist.");
              }
              if (!databaseTables[table].schema.hasOwnProperty("foreignKeys")) {
                throw new Error("Relationship table " + table + " doesn't have foreign keys set.");
              }
              var columns = databaseTables[table].schema.foreignKeys.filter(function(column2) {
                return column2.targetTable === baseTable;
              });
              if (columns.length > 0) {
                usableForeignTables.push({
                  column,
                  index: columns[0].index,
                  tableName: table,
                  targetIndex: columns[0].targetIndex
                });
              }
            }
          });
          return this.toArray().then(function(rows) {
            var queries = usableForeignTables.map(function(foreignTable) {
              var tableName = foreignTable.tableName;
              var allRelatedKeys = rows.map(function(row) {
                return row[foreignTable.targetIndex];
              }).filter(isIndexableType);
              return databaseTables[tableName].where(foreignTable.index).anyOf(allRelatedKeys);
            });
            var queryPromises = queries.map(function(query) {
              return query.toArray();
            });
            return Promise2.all(queryPromises).then(function(queryResults) {
              usableForeignTables.forEach(function(foreignTable, idx) {
                var tableName = foreignTable.tableName;
                var result = queryResults[idx];
                var targetIndex = foreignTable.targetIndex;
                var foreignIndex = foreignTable.index;
                var column = foreignTable.column;
                var lookup = {};
                result.forEach(function(record) {
                  var foreignKey = record[foreignIndex];
                  if (foreignTable.oneToOne) {
                    lookup[foreignKey] = record;
                  } else {
                    (lookup[foreignKey] = lookup[foreignKey] || []).push(record);
                  }
                });
                rows.forEach(function(row) {
                  var foreignKey = row[targetIndex];
                  var record = lookup[foreignKey] || [];
                  if (foreignKey !== null && foreignKey !== void 0 && !record) {
                    throw new Error(
                      "Could not lookup foreign key where " + tableName + "." + foreignIndex + " == " + baseTable + "." + column + ". The content of the failing key was: " + JSON.stringify(foreignKey) + "."
                    );
                  }
                  Object.defineProperty(row, column, {
                    value: record,
                    enumerable: false,
                    configurable: true,
                    writable: true
                  });
                });
              });
            }).then(function() {
              return rows;
            });
          });
        };
        db2.Version.prototype._parseStoresSpec = Dexie2.override(
          db2.Version.prototype._parseStoresSpec,
          function(parseStoresSpec) {
            return function(storesSpec, outDbSchema) {
              var parser = new SchemaParser(storesSpec);
              var foreignKeys = parser.getForeignKeys();
              var rv = parseStoresSpec.call(this, parser.getCleanedSchema(), outDbSchema);
              Object.keys(outDbSchema).forEach(function(table) {
                if (foreignKeys.hasOwnProperty(table)) {
                  outDbSchema[table].foreignKeys = foreignKeys[table];
                  foreignKeys[table].forEach(function(fk) {
                    outDbSchema[table].idxByName[fk.index].foreignKey = fk;
                  });
                }
              });
              return rv;
            };
          }
        );
      };
      Relationships.default = Relationships;
      return Relationships;
    });
  }
});

var import_dexie_relationships = __toESM(require_dist(), 1);
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
      db = new Dexie(schema.name, { addons: [import_dexie_relationships.default] });
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
        if (typeof operations !== "undefined" && typeof operations[item.args[0]] === "function") {
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