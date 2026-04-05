export interface MetronomeClickPoint {
  timeMs: number;
  accentValue: number;
}

export function buildMetronomeClickPoints(
  beatTimesMs: number[],
  accentPattern = [1.35, 1, 1, 1]
): MetronomeClickPoint[] {
  return beatTimesMs.map((timeMs, index) => ({
    timeMs,
    accentValue: accentPattern[index % accentPattern.length] ?? 1
  }));
}
