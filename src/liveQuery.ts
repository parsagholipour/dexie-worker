import { Observable } from 'rxjs';
import { shareReplay } from 'rxjs/operators';
import { createProxy, addChangeListener, removeChangeListener } from './createDexieProxy';

export function liveQuery<T>(querier: (db: any) => Promise<T> | T): Observable<T> {
  return new Observable<T>((subscriber) => {
    let isSubscribed = true;
    const accessedTables = new Set<string>();

    // Function to track table accesses
    const tableAccessCallback = (tableName: string) => {
      accessedTables.add(tableName);
    };

    const executeQuery = () => {
      accessedTables.clear();
      const proxyDb = createProxy([], tableAccessCallback);
      Promise.resolve(querier(proxyDb))
        .then((result) => {
          if (isSubscribed) {
            if (result !== undefined) {
              subscriber.next(result);
            } else {
              subscriber.next(null as any);
            }
          }
        })
        .catch((error) => {
          if (isSubscribed) {
            subscriber.error(error);
          }
        });
    };

    // Initial execution
    executeQuery();

    // Change handler
    const changeHandler = (changedTables: Set<string>) => {
      const intersection = [...accessedTables].some((table) => changedTables.has(table));
      if (intersection) {
        executeQuery();
      }
    };

    // Add change listener
    addChangeListener(changeHandler);

    // Cleanup function
    return () => {
      isSubscribed = false;
      removeChangeListener(changeHandler);
    };
  }).pipe(shareReplay(1));
}
