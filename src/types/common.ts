export interface WorkerMessage {
  id: number;
  type: string;
  chain?: ChainItem[];
  schema?: DbSchema;
  [key: string]: string | number | DbSchema | ChainItem[] | undefined;
}

export interface WorkerResponse {
  id: number;
  result?: any;
  error?: string;
  type: string;
  changedTables?: string[];
}

export interface ChainItem {
  type: 'get' | 'call';
  prop?: string;
  method?: string;
  args?: any[];
}

export interface DbSchema {
  name: string;
  version: number;
  stores: { [tableName: string]: string };
}

export interface DexieWorkerOptions {
  workerUrl?: string,
  worker?: Worker;
  dexieVersion?: string;
  silenceWarning?: boolean;
}
