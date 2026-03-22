import type { BeatStrideApi } from '@shared/ipc';

declare global {
  interface Window {
    beatStride: BeatStrideApi;
  }
}

export {};
