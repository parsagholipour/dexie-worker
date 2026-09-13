import { Observable } from 'rxjs';
import { shareReplay } from 'rxjs/operators';
import {
  createProxy,
  addChangeListener,
  removeChangeListener,
  addLiveQueryAccessListener,
  removeLiveQueryAccessListener,
} from './createDexieProxy';

let liveQueryIdFallback = 0;

function generateLiveQueryId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  liveQueryIdFallback += 1;
  return `liveQuery-${Date.now()}-${liveQueryIdFallback}-${Math.random().toString(36).slice(2)}`;
}

export function liveQuery<T>(querier: (db: any) => Promise<T> | T): Observable<T> {
  let hasValue = false;
  let currentValue: T | undefined;

  const observable = new Observable<T>((subscriber) => {
    let isSubscribed = true;
    let queryGeneration = 0;
    const accessedTables = new Set<string>();
    const liveQueryId = generateLiveQueryId();
    let tableAccessHandler = (tableName: string) => {
      accessedTables.add(tableName);
    };

    addLiveQueryAccessListener(liveQueryId, (tableName) => {
      tableAccessHandler(tableName);
    });

    const executeQuery = () => {
      const generation = ++queryGeneration;
      const nextAccessed = new Set<string>();
      const tableAccessCallback = (tableName: string) => {
        nextAccessed.add(tableName);
        accessedTables.add(tableName);
      };
      tableAccessHandler = tableAccessCallback;
      const proxyDb = createProxy([], tableAccessCallback, liveQueryId);
      Promise.resolve(querier(proxyDb))
        .then((result) => {
          if (!isSubscribed || generation !== queryGeneration) {
            return;
          }
          accessedTables.clear();
          nextAccessed.forEach((table) => accessedTables.add(table));
          const nextValue = result !== undefined ? result : null as any;
          hasValue = true;
          currentValue = nextValue;
          subscriber.next(nextValue);
        })
        .catch((error) => {
          if (isSubscribed && generation === queryGeneration) {
            subscriber.error(error);
          }
        });
    };

    executeQuery();

    const changeHandler = (changedTables: Set<string>) => {
      const intersection = [...accessedTables].some((table) => changedTables.has(table));
      if (intersection) {
        executeQuery();
      }
    };

    addChangeListener(changeHandler);

    return () => {
      isSubscribed = false;
      removeChangeListener(changeHandler);
      removeLiveQueryAccessListener(liveQueryId);
    };
  }).pipe(shareReplay({ bufferSize: 1, refCount: true }));

  // useObservable (dexie-react-hooks) skips its eager subscribe/unsubscribe when
  // hasValue() is false, so the first render does not run the querier twice.
  Object.assign(observable, {
    hasValue: () => hasValue,
    getValue: () => currentValue,
  });

  return observable;
}
