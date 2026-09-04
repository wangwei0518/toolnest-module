import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";

type Subscribe = (listener: () => void) => () => void;
type Snapshot = () => unknown;
type Selector = (snapshot: unknown) => unknown;
type IsEqual = (left: unknown, right: unknown) => boolean;

function sameValue(left: unknown, right: unknown) {
  return Object.is(left, right);
}

export function useSyncExternalStoreWithSelector(
  subscribe: Subscribe,
  getSnapshot: Snapshot,
  getServerSnapshot: Snapshot | undefined,
  selector: Selector,
  isEqual?: IsEqual,
) {
  const instance = useRef<{ hasValue: boolean; value: unknown }>({
    hasValue: false,
    value: undefined,
  });
  const [getSelection, getServerSelection] = useMemo(() => {
    let hasMemo = false;
    let memoizedSnapshot: unknown;
    let memoizedSelection: unknown;
    const memoizedSelector = (snapshot: unknown) => {
      if (!hasMemo) {
        hasMemo = true;
        memoizedSnapshot = snapshot;
        const nextSelection = selector(snapshot);
        if (
          isEqual &&
          instance.current.hasValue &&
          isEqual(instance.current.value, nextSelection)
        ) {
          memoizedSelection = instance.current.value;
          return memoizedSelection;
        }
        memoizedSelection = nextSelection;
        return nextSelection;
      }
      if (sameValue(memoizedSnapshot, snapshot)) return memoizedSelection;
      const nextSelection = selector(snapshot);
      if (isEqual && isEqual(memoizedSelection, nextSelection)) {
        memoizedSnapshot = snapshot;
        return memoizedSelection;
      }
      memoizedSnapshot = snapshot;
      memoizedSelection = nextSelection;
      return nextSelection;
    };
    return [
      () => memoizedSelector(getSnapshot()),
      getServerSnapshot
        ? () => memoizedSelector(getServerSnapshot())
        : undefined,
    ] as const;
  }, [getServerSnapshot, getSnapshot, isEqual, selector]);
  const value = useSyncExternalStore(
    subscribe,
    getSelection,
    getServerSelection,
  );
  useEffect(() => {
    instance.current.hasValue = true;
    instance.current.value = value;
  }, [value]);
  return value;
}
