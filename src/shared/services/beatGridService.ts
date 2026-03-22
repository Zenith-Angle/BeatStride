export function generateBeatTimes(
  durationMs: number,
  bpm: number,
  offsetMs: number
): number[] {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return [];
  }
  if (!Number.isFinite(bpm) || bpm <= 0) {
    return [];
  }
  if (!Number.isFinite(offsetMs)) {
    return [];
  }

  const interval = 60000 / bpm;
  const times: number[] = [];

  let start = offsetMs;
  if (start < 0) {
    const steps = Math.ceil((0 - start) / interval);
    start += steps * interval;
  }

  for (let time = start; time <= durationMs; time += interval) {
    if (time >= 0) {
      times.push(Math.round(time));
    }
  }

  return times;
}
