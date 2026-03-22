export interface MetronomeClickPoint {
  timeMs: number;
  accent: boolean;
}

export function buildMetronomeClickPoints(
  beatTimesMs: number[],
  beatsPerBar = 4
): MetronomeClickPoint[] {
  return beatTimesMs.map((timeMs, index) => ({
    timeMs,
    accent: index % beatsPerBar === 0
  }));
}
