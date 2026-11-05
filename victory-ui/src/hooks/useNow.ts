import { useEffect, useState } from 'react';
import { nowUnix } from '../domain/timeLog';

/** Current unix time, re-rendering every second while `active`. */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(nowUnix);
  useEffect(() => {
    if (!active) return;
    setNow(nowUnix());
    const id = setInterval(() => setNow(nowUnix()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return active ? now : nowUnix();
}
