import {afterEach, describe, expect, it} from 'vitest';
import getWebWorkerDB from '../getWebWorkerDB';
import {__resetForTests} from '../createDexieProxy';
import {createTestDb, flushMicrotasks, MockWorker} from './helpers';

function reactStyleSetState<T>(next: T | ((prev: T | undefined) => T), prev?: T): T {
  if (typeof next === 'function') {
    return (next as (previous: T | undefined) => T)(prev);
  }
  return next;
}

afterEach(async () => {
  __resetForTests();
  await Promise.resolve();
});

describe('getWebWorkerDB root proxy', () => {
  it('is not a function, so React setState stores it instead of calling it', async () => {
    const db = await createTestDb();
    const worker = new MockWorker();
    const workerDb = getWebWorkerDB(db, {worker: worker as unknown as Worker});
    await flushMicrotasks();

    expect(typeof workerDb).not.toBe('function');
    expect(reactStyleSetState(workerDb)).toBe(workerDb);
  });

  it('does not send an execute chain when the root proxy is invoked', async () => {
    const db = await createTestDb();
    const worker = new MockWorker();
    const workerDb = getWebWorkerDB(db, {worker: worker as unknown as Worker}) as unknown as () => unknown;
    await flushMicrotasks();
    worker.lastChain = null;

    expect(() => workerDb()).toThrow(TypeError);
    await flushMicrotasks();
    expect(worker.lastChain).toBeNull();
  });

  it('does not throw when reading .then on the root proxy', async () => {
    const db = await createTestDb();
    const worker = new MockWorker();
    const workerDb = getWebWorkerDB(db, {worker: worker as unknown as Worker}) as {then?: unknown};
    await flushMicrotasks();

    expect(() => workerDb.then).not.toThrow();
    expect(workerDb.then).toBeUndefined();
  });

  it('still uses the apply trap for method chains like db.users.toArray()', async () => {
    const db = await createTestDb();
    const worker = new MockWorker();
    worker.executeResult = [{id: 1, name: 'Ada'}];
    const workerDb = getWebWorkerDB(db, {worker: worker as unknown as Worker}) as {
      users: {toArray: () => Promise<unknown>};
    };
    await flushMicrotasks();

    const result = await workerDb.users.toArray();

    expect(result).toEqual([{id: 1, name: 'Ada'}]);
    expect(worker.lastChain).toEqual([
      {type: 'get', prop: 'users'},
      {type: 'call', method: 'toArray', args: []},
    ]);
  });
});
