import type pg from 'pg';
import { expireDue } from './service.js';

export function startAttendanceWorker(pool: pg.Pool, onFailure: () => void) {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: Promise<void> = Promise.resolve();
  const tick = () => {
    pending = expireDue(pool)
      .catch(onFailure)
      .finally(() => {
        if (!stopped) timer = setTimeout(tick, 1000);
      });
  };
  tick();
  return async () => {
    stopped = true;
    clearTimeout(timer);
    await pending;
  };
}
