import { useCallback, useEffect, useState } from "react";

/** Ejecuta `fn` cuando cambian `deps`. Conserva `data` mientras recarga. */
export default function useFetch(fn, deps = [], enabled = true) {
  const [state, setState] = useState({ data: null, error: null, loading: enabled });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!enabled) { setState({ data: null, error: null, loading: false }); return; }
    let vivo = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    fn()
      .then((data) => vivo && setState({ data, error: null, loading: false }))
      .catch((e) => vivo && setState({ data: null, error: e.message, loading: false }));
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick, enabled]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}
