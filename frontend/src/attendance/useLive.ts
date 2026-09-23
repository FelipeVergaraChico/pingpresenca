import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';

// No overlapping polls and no stale response after unmount/resource change.
export function useLive<T>(path: string, interval = 3000) {
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState('');
  const generation = useRef(0);
  const refresh = useRef<() => Promise<void>>(async () => {});
  const reload = useCallback(async () => {
    await refresh.current();
  }, []);
  useEffect(() => {
    const current = ++generation.current;
    let timer: ReturnType<typeof setTimeout>;
    let pending: Promise<void> | undefined;
    setData(null);
    const fetchData = async () => {
      clearTimeout(timer);
      const started = performance.now();
      try {
        const result = await api<T>(path);
        if (generation.current === current) {
          // Conservatively deduct the full round trip from display countdowns.
          // This does not change server-side authorization or persist a client time.
          if (
            result &&
            typeof result === 'object' &&
            'serverNow' in result &&
            typeof result.serverNow === 'string'
          )
            result.serverNow = new Date(
              Date.parse(result.serverNow) + (performance.now() - started),
            ).toISOString();
          setData(result);
          setError('');
        }
      } catch (e) {
        if (generation.current === current)
          setError(e instanceof Error ? e.message : 'Sem conexão com o servidor.');
        throw e;
      } finally {
        pending = undefined;
        if (generation.current === current) timer = setTimeout(tick, interval);
      }
    };
    const tick = () => {
      pending = fetchData();
      void pending.catch(() => {});
    };
    refresh.current = async () => {
      await pending?.catch(() => {});
      if (generation.current !== current) return;
      pending = fetchData();
      await pending;
    };
    tick();
    return () => {
      generation.current++;
      clearTimeout(timer);
      refresh.current = async () => {};
    };
  }, [path, interval]);
  return { data, error, reload };
}
// Monotonic elapsed time is only a display hint, never an authorization decision.
export function useRemaining(serverNow: string | undefined, deadline: string | undefined) {
  const [remaining, setRemaining] = useState(0);
  useEffect(() => {
    if (!serverNow || !deadline) {
      setRemaining(0);
      return;
    }
    const start = performance.now(),
      duration = Date.parse(deadline) - Date.parse(serverNow);
    const tick = () =>
      setRemaining(Math.max(0, Math.ceil((duration - (performance.now() - start)) / 1000)));
    tick();
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [serverNow, deadline]);
  return remaining;
}
