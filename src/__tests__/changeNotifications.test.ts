import {afterEach, describe, expect, it, vi} from 'vitest';
import getWebWorkerDB from '../getWebWorkerDB';
import {
  __notifyForTests,
  __resetForTests,
  addChangeListener,
  removeChangeListener,
} from '../createDexieProxy';
import * as helpers from '../helpers';
import {createTestDb, flushMicrotasks, MockWorker} from './helpers';

afterEach(async () => {
  __resetForTests();
  vi.restoreAllMocks();
  await Promise.resolve();
});

describe('change notifications', () => {
  it('coalesces same-tick notifications into one listener call', async () => {
    const listener = vi.fn();
    addChangeListener(listener);

    __notifyForTests(new Set(['users']));
    __notifyForTests(new Set(['products']));
    expect(listener).not.toHaveBeenCalled();

    await flushMicrotasks();

    expect(listener).toHaveBeenCalledTimes(1);
    expect([...listener.mock.calls[0][0]].sort()).toEqual(['products', 'users']);
    removeChangeListener(listener);
  });

  it('ignores worker change messages when storagemutated is active', async () => {
    const db = await createTestDb();
    const worker = new MockWorker();
    getWebWorkerDB(db, {worker: worker as unknown as Worker});

    const listener = vi.fn();
    addChangeListener(listener);
    await flushMicrotasks();

    worker.emitChanges(['users']);
    await flushMicrotasks();

    expect(listener).not.toHaveBeenCalled();
    removeChangeListener(listener);
  });

  it('forwards worker change messages when storagemutated is unavailable', async () => {
    vi.spyOn(helpers, 'supportsBroadcastChannel').mockReturnValue(false);

    const db = await createTestDb();
    const worker = new MockWorker();
    getWebWorkerDB(db, {worker: worker as unknown as Worker});

    const listener = vi.fn();
    addChangeListener(listener);
    await flushMicrotasks();

    worker.emitChanges(['users']);
    await flushMicrotasks();

    expect(listener).toHaveBeenCalledTimes(1);
    expect([...listener.mock.calls[0][0]]).toEqual(['users']);
    removeChangeListener(listener);
  });
});
