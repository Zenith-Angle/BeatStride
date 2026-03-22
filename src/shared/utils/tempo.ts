export function computeSpeedRatio(sourceBpm: number, targetBpm: number): number {
  if (!Number.isFinite(sourceBpm) || !Number.isFinite(targetBpm)) {
    throw new Error('BPM must be a finite number');
  }
  if (sourceBpm <= 0 || targetBpm <= 0) {
    throw new Error('BPM must be greater than 0');
  }
  return Number((targetBpm / sourceBpm).toFixed(8));
}

export function splitAtempoChain(ratio: number): number[] {
  if (!Number.isFinite(ratio) || ratio <= 0) {
    throw new Error('Tempo ratio must be greater than 0');
  }

  if (Math.abs(ratio - 1) < 1e-8) {
    return [1];
  }

  const chain: number[] = [];
  let remain = ratio;

  while (remain < 0.5) {
    chain.push(0.5);
    remain /= 0.5;
  }

  while (remain > 2) {
    chain.push(2);
    remain /= 2;
  }

  chain.push(Number(remain.toFixed(8)));
  return chain;
}
