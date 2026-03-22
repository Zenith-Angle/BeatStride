import { useMemo, useState } from 'react';

const WINDOW_SIZE = 8;

export function useTapTempo(): {
  bpm: number | null;
  tap: () => void;
  reset: () => void;
} {
  const [timestamps, setTimestamps] = useState<number[]>([]);

  const bpm = useMemo(() => {
    if (timestamps.length < 2) {
      return null;
    }
    const intervals: number[] = [];
    for (let i = 1; i < timestamps.length; i += 1) {
      intervals.push(timestamps[i] - timestamps[i - 1]);
    }
    const avg = intervals.reduce((sum, value) => sum + value, 0) / intervals.length;
    if (avg <= 0) {
      return null;
    }
    return Math.round(60000 / avg);
  }, [timestamps]);

  const tap = () => {
    const now = Date.now();
    setTimestamps((prev) => [...prev.slice(-(WINDOW_SIZE - 1)), now]);
  };

  const reset = () => setTimestamps([]);

  return { bpm, tap, reset };
}
