import Dexie from 'dexie';

export class MockWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  executeResult: unknown = [];
  accessedTables: string[] = ['users'];
  lastChain: unknown = null;
  lastLiveQueryId: string | undefined;
  liveQueryIds: string[] = [];
  delayInit = false;
  delayExecute = false;
  executeCount = 0;
  private pendingInitId: number | null = null;
  private pendingExecutes: Array<{id: number; result: unknown}> = [];

  get pendingExecuteIds(): number[] {
    return this.pendingExecutes.map((pending) => pending.id);
  }

  postMessage(data: { id: number; type: string; chain?: unknown; liveQueryId?: string }) {
    queueMicrotask(() => {
      if (data.type === 'init') {
        if (this.delayInit) {
          this.pendingInitId = data.id;
          return;
        }
        this.dispatch({id: data.id, type: 'init', result: 'Database initialized'});
        return;
      }
      if (data.type === 'execute') {
        this.lastChain = data.chain;
        this.executeCount += 1;
        if (data.liveQueryId) {
          this.lastLiveQueryId = data.liveQueryId;
          this.liveQueryIds.push(data.liveQueryId);
          this.dispatch({
            type: 'accessedTables',
            liveQueryId: data.liveQueryId,
            accessedTables: this.accessedTables.slice(),
          });
        }
        if (this.delayExecute) {
          this.pendingExecutes.push({id: data.id, result: this.executeResult});
          return;
        }
        this.dispatch({
          id: data.id,
          type: 'result',
          result: this.executeResult,
        });
      }
    });
  }

  completeInit() {
    if (this.pendingInitId === null) {
      return;
    }
    this.dispatch({id: this.pendingInitId, type: 'init', result: 'Database initialized'});
    this.pendingInitId = null;
  }

  completeNextExecute() {
    const pending = this.pendingExecutes.shift();
    if (!pending) {
      return;
    }
    this.dispatch({id: pending.id, type: 'result', result: pending.result});
  }

  completePendingExecute(id: number) {
    const index = this.pendingExecutes.findIndex((pending) => pending.id === id);
    if (index === -1) {
      return;
    }
    const [pending] = this.pendingExecutes.splice(index, 1);
    this.dispatch({id: pending.id, type: 'result', result: pending.result});
  }

  emitChanges(changedTables: string[]) {
    this.dispatch({id: 0, type: 'changes', changedTables});
  }

  dispatch(data: unknown) {
    this.onmessage?.({data} as MessageEvent);
  }

  terminate() {}
}

export async function createTestDb(name = `TestDB-${Math.random()}`): Promise<Dexie> {
  const db = new Dexie(name);
  db.version(1).stores({users: '++id,name', products: '++id,name'});
  await db.open();
  return db;
}

export async function waitFor(predicate: () => boolean, timeout = 1000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeout) {
      throw new Error('Timed out waiting for condition');
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

export function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => queueMicrotask(resolve));
}
