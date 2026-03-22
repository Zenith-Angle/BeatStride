import type { ExportJob } from '@shared/types';

type JobRunner = () => Promise<string>;

interface QueuedJob {
  info: ExportJob;
  run: JobRunner;
  resolve: (outputPath: string) => void;
  reject: (error: Error) => void;
}

export class ExportQueueService {
  private queue: QueuedJob[] = [];
  private running = false;

  enqueue(job: QueuedJob): void {
    this.queue.push(job);
    void this.drain();
  }

  async runJob(id: string, mode: ExportJob['mode'], run: JobRunner): Promise<string> {
    return new Promise((resolve, reject) => {
      this.enqueue({
        info: { id, mode, status: 'queued', progress: 0 },
        run,
        resolve,
        reject
      });
    });
  }

  private async drain(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    while (this.queue.length > 0) {
      const next = this.queue.shift();
      if (!next) {
        break;
      }
      try {
        const outputPath = await next.run();
        next.resolve(outputPath);
      } catch (error) {
        next.reject(error as Error);
      }
    }
    this.running = false;
  }
}
