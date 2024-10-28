import {liveQuery} from "./liveQuery";
import {useObservable} from "dexie-react-hooks";

export default function useLiveQuery<TDatabase = any, T = any,TDefault = any>(queryCallback: (db: TDatabase) => Promise<any>, deps: any[] = [], initialValue?: TDefault) {
  return useObservable<T, TDefault>(() => liveQuery(queryCallback), deps, initialValue as TDefault);
}