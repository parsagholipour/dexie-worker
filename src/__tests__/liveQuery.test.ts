import Dexie from 'dexie';
import {afterEach, describe, expect, it, vi} from 'vitest';
import getWebWorkerDB from '../getWebWorkerDB';
import {liveQuery} from '../liveQuery';
import {__notifyForTests, __resetForTests} from '../createDexieProxy';
import * as helpers from '../helpers';
import {createTestDb, flushMicrotasks, MockWorker, waitFor} from './helpers';

async function setupLiveQuery() {
  const db = await createTestDb();
  const worker = new MockWorker();
  getWebWorkerDB(db, {worker: worker as unknown as Worker});
  return {db, worker};
}

afterEach(async () => {
  __resetForTests();
  await Promise.resolve();
});

describe('liveQuery', () => {
  it('does not keep running a querier after unsubscribe (deps-style resubscribe)', async () => {
    await setupLiveQuery();
    const querier = vi.fn(async (workerDb: { users: { toArray: () => Promise<unknown> } }) => {
      return workerDb.users.toArray();
    });

    const first = liveQuery(querier);
    const firstSub = first.subscribe();
    await waitFor(() => querier.mock.calls.length === 1);
    firstSub.unsubscribe();

    const second = liveQuery(querier);
    const secondSub = second.subscribe();
    await waitFor(() => querier.mock.calls.length === 2);

    __notifyForTests(new Set(['users']));
    await waitFor(() => querier.mock.calls.length > 2);

    expect(querier.mock.calls.length).toBe(3);
    secondSub.unsubscribe();
  });

  it('re-runs a custom operation when a table it read is mutated', async () => {
    const {worker} = await setupLiveQuery();
    worker.executeResult = [{id: 1, name: 'Ada'}];
    worker.accessedTables = ['users'];

    const values: unknown[] = [];
    const querier = vi.fn(async (workerDb: { operation: (name: string) => Promise<unknown> }) => {
      return workerDb.operation('listUsers');
    });

    const sub = liveQuery(querier).subscribe((value) => values.push(value));
    await waitFor(() => values.length === 1);
    expect(values[0]).toEqual([{id: 1, name: 'Ada'}]);

    worker.executeResult = [{id: 1, name: 'Ada'}, {id: 2, name: 'Grace'}];
    __notifyForTests(new Set(['users']));
    await waitFor(() => values.length === 2);

    expect(values[1]).toEqual([{id: 1, name: 'Ada'}, {id: 2, name: 'Grace'}]);
    expect(querier.mock.calls.length).toBe(2);
    sub.unsubscribe();
  });

  it('gives each live query its own id and ignores the other query table broadcasts', async () => {
    const {worker} = await setupLiveQuery();
    worker.accessedTables = ['users'];

    const querierA = vi.fn(async (workerDb: { operation: (name: string) => Promise<unknown> }) => {
      return workerDb.operation('listUsers');
    });
    const querierB = vi.fn(async (workerDb: { operation: (name: string) => Promise<unknown> }) => {
      return workerDb.operation('listProducts');
    });

    const subA = liveQuery(querierA).subscribe();
    await waitFor(() => worker.liveQueryIds.length === 1);
    const idA = worker.lastLiveQueryId;

    worker.accessedTables = ['products'];
    const subB = liveQuery(querierB).subscribe();
    await waitFor(() => worker.liveQueryIds.length === 2);
    const idB = worker.lastLiveQueryId;

    expect(idA).toBeTruthy();
    expect(idB).toBeTruthy();
    expect(idA).not.toBe(idB);
    expect(new Set(worker.liveQueryIds).size).toBe(2);

    worker.accessedTables = ['users'];
    __notifyForTests(new Set(['users']));
    await waitFor(() => querierA.mock.calls.length === 2);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(querierB.mock.calls.length).toBe(1);

    worker.accessedTables = ['products'];
    __notifyForTests(new Set(['products']));
    await waitFor(() => querierB.mock.calls.length === 2);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(querierA.mock.calls.length).toBe(2);

    subA.unsubscribe();
    subB.unsubscribe();
  });

  it('still invalidates a normal table query when that table changes', async () => {
    const {worker} = await setupLiveQuery();
    worker.executeResult = [{id: 1, name: 'Ada'}];

    const values: unknown[] = [];
    const querier = vi.fn(async (workerDb: { users: { toArray: () => Promise<unknown> } }) => {
      return workerDb.users.toArray();
    });

    const sub = liveQuery(querier).subscribe((value) => values.push(value));
    await waitFor(() => values.length === 1);

    worker.executeResult = [{id: 1, name: 'Ada'}, {id: 2, name: 'Grace'}];
    __notifyForTests(new Set(['users']));
    await waitFor(() => values.length === 2);

    expect(values[1]).toEqual([{id: 1, name: 'Ada'}, {id: 2, name: 'Grace'}]);
    sub.unsubscribe();
  });

  it('does not re-run when an unrelated table changes', async () => {
    await setupLiveQuery();
    const querier = vi.fn(async (workerDb: { users: { toArray: () => Promise<unknown> } }) => {
      return workerDb.users.toArray();
    });

    const sub = liveQuery(querier).subscribe();
    await waitFor(() => querier.mock.calls.length === 1);

    __notifyForTests(new Set(['products']));
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(querier.mock.calls.length).toBe(1);
    sub.unsubscribe();
  });

  it('executes the querier once after subscribe', async () => {
    const {worker} = await setupLiveQuery();
    const querier = vi.fn(async (workerDb: { users: { toArray: () => Promise<unknown> } }) => {
      return workerDb.users.toArray();
    });

    const observable = liveQuery(querier);
    const live = observable as unknown as {hasValue: () => boolean};
    expect(typeof live.hasValue).toBe('function');
    expect(live.hasValue()).toBe(false);

    const sub = observable.subscribe();
    await waitFor(() => querier.mock.calls.length === 1);
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(querier.mock.calls.length).toBe(1);
    expect(worker.executeCount).toBe(1);
    expect(live.hasValue()).toBe(true);
    sub.unsubscribe();
  });

  it('does not let a stale query completion replace the current invalidation set', async () => {
    const {worker} = await setupLiveQuery();
    worker.delayExecute = true;
    worker.accessedTables = ['users'];
    worker.executeResult = [{id: 1, name: 'Ada'}];

    const values: unknown[] = [];
    const querier = vi.fn(async (workerDb: { operation: (name: string) => Promise<unknown> }) => {
      return workerDb.operation('listItems');
    });

    const sub = liveQuery(querier).subscribe((value) => values.push(value));
    await waitFor(() => querier.mock.calls.length >= 1 && worker.executeCount >= 1);
    expect(values.length).toBe(0);

    worker.accessedTables = ['products'];
    worker.executeResult = [{id: 1, name: 'Widget'}];
    __notifyForTests(new Set(['users']));
    await waitFor(() => querier.mock.calls.length >= 2 && worker.executeCount >= 2);
    expect(worker.pendingExecuteIds.length).toBe(2);

    const [staleExecuteId, currentExecuteId] = worker.pendingExecuteIds;
    worker.completePendingExecute(currentExecuteId);
    await waitFor(() => values.length === 1);
    expect(values[0]).toEqual([{id: 1, name: 'Widget'}]);

    worker.completePendingExecute(staleExecuteId);
    await flushMicrotasks();

    const runsAfterLatest = querier.mock.calls.length;
    __notifyForTests(new Set(['users']));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(querier.mock.calls.length).toBe(runsAfterLatest);

    __notifyForTests(new Set(['products']));
    await waitFor(() => querier.mock.calls.length === runsAfterLatest + 1);

    sub.unsubscribe();
  });

  it('does not rerun from storagemutated events that arrive before the worker is ready', async () => {
    vi.spyOn(helpers, 'supportsBroadcastChannel').mockReturnValue(true);

    const db = await createTestDb();
    const worker = new MockWorker();
    worker.delayInit = true;
    getWebWorkerDB(db, {worker: worker as unknown as Worker});

    const querier = vi.fn(async (workerDb: { users: { toArray: () => Promise<unknown> } }) => {
      return workerDb.users.toArray();
    });
    const sub = liveQuery(querier).subscribe();
    await flushMicrotasks();

    Dexie.on.storagemutated.fire({
      [`idb://${db.name}/users/`]: {},
    } as never);
    await flushMicrotasks();
    expect(querier.mock.calls.length).toBe(1);

    worker.completeInit();
    await waitFor(() => worker.executeCount === 1);
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(querier.mock.calls.length).toBe(1);
    expect(worker.executeCount).toBe(1);
    sub.unsubscribe();
  });
});
