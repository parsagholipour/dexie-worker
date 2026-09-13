import Dexie from 'dexie';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {__resetForTests, getMessageListener} from '../dbWorker';
import {waitFor} from './helpers';

const posted: Array<{
  type: string;
  accessedTables?: string[];
  liveQueryId?: string;
  result?: unknown;
  error?: string
}> = [];

function schema(name = `WorkerDB-${Math.random()}`) {
  return {
    name,
    version: 1,
    stores: {users: '++id,name', products: '++id,name'},
  };
}

async function lastOfType(type: string) {
  await waitFor(() => posted.some((message) => message.type === type));
  return posted.filter((message) => message.type === type).at(-1);
}

function broadcastedTables() {
  return posted
    .filter((message) => message.type === 'accessedTables')
    .flatMap((message) => message.accessedTables ?? []);
}

beforeEach(() => {
  posted.length = 0;
  vi.stubGlobal('postMessage', (message: typeof posted[number]) => {
    posted.push(message);
  });
});

afterEach(() => {
  __resetForTests();
  vi.unstubAllGlobals();
});

describe('getMessageListener accessed tables', () => {
  it('broadcasts tables read inside a custom operation when liveQueryId is present', async () => {
    const listener = getMessageListener({
      operations: {
        async listUsers(dexie: Dexie) {
          return dexie.table('users').toArray();
        },
      },
    });

    await listener({data: {id: 1, type: 'init', schema: schema()}} as MessageEvent);
    await lastOfType('init');

    await listener({
      data: {
        id: 2,
        type: 'execute',
        liveQueryId: 'lq-1',
        chain: [{type: 'call', method: 'operation', args: ['listUsers']}],
      },
    } as MessageEvent);

    const result = await lastOfType('result');
    expect(broadcastedTables()).toContain('users');
    expect(broadcastedTables()).not.toContain('operation');
    expect(posted.some((message) => message.type === 'accessedTables' && message.liveQueryId === 'lq-1')).toBe(true);
    expect(result?.accessedTables).toBeUndefined();
  });

  it('broadcasts tables read by a normal query chain when liveQueryId is present', async () => {
    const listener = getMessageListener();

    await listener({data: {id: 1, type: 'init', schema: schema()}} as MessageEvent);
    await lastOfType('init');

    await listener({
      data: {
        id: 2,
        type: 'execute',
        liveQueryId: 'lq-2',
        chain: [
          {type: 'get', prop: 'users'},
          {type: 'call', method: 'toArray', args: []},
        ],
      },
    } as MessageEvent);

    const result = await lastOfType('result');
    expect(broadcastedTables()).toContain('users');
    expect(posted.find((message) => message.type === 'accessedTables')?.liveQueryId).toBe('lq-2');
    expect(result?.accessedTables).toBeUndefined();
  });

  it('broadcasts every table a custom operation reads when liveQueryId is present', async () => {
    const listener = getMessageListener({
      operations: {
        async joinTables(dexie: Dexie) {
          const users = await dexie.table('users').toArray();
          const products = await dexie.table('products').count();
          return {users, products};
        },
      },
    });

    await listener({data: {id: 1, type: 'init', schema: schema()}} as MessageEvent);
    await lastOfType('init');

    await listener({
      data: {
        id: 2,
        type: 'execute',
        liveQueryId: 'lq-3',
        chain: [{type: 'call', method: 'operation', args: ['joinTables']}],
      },
    } as MessageEvent);

    const result = await lastOfType('result');
    expect(broadcastedTables()).toEqual(expect.arrayContaining(['users', 'products']));
    expect(result?.accessedTables).toBeUndefined();
  });

  it('does not broadcast accessedTables when liveQueryId is omitted', async () => {
    const listener = getMessageListener();

    await listener({data: {id: 1, type: 'init', schema: schema()}} as MessageEvent);
    await lastOfType('init');

    await listener({
      data: {
        id: 2,
        type: 'execute',
        chain: [
          {type: 'get', prop: 'users'},
          {type: 'call', method: 'toArray', args: []},
        ],
      },
    } as MessageEvent);

    const result = await lastOfType('result');
    expect(posted.some((message) => message.type === 'accessedTables')).toBe(false);
    expect(result?.accessedTables).toBeUndefined();
  });
});
