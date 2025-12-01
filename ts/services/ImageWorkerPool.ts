/* eslint-disable no-console */
/* eslint-disable no-param-reassign */
// app/services/ImageWorkerPool.ts
import { Worker } from 'worker_threads';
import path from 'path';
import os from 'os';

interface PendingTask {
  resolve: (value: any) => void;
  reject: (reason: any) => void;
  timestamp: number;
}

interface WorkerInstance {
  worker: Worker;
  busy: boolean;
  tasksProcessed: number;
}

export class ImageWorkerPool {
  private workers: Array<WorkerInstance> = [];
  private queue: Array<{
    id: number;
    data: any;
    pending: PendingTask;
  }> = [];
  private pending = new Map<number, PendingTask>();
  private messageId = 0;
  private readonly poolSize: number;
  private readonly workerPath: string;
  private shuttingDown = false;

  constructor(options?: { poolSize?: number; workerPath?: string }) {
    // Default to CPU count - 1, or minimum 2 workers
    this.poolSize = options?.poolSize ?? Math.max(2, os.cpus().length - 1);
    this.workerPath = options?.workerPath ?? path.join(__dirname, 'imageProcessor.worker.js');

    console.log(`Initializing ImageWorkerPool with ${this.poolSize} workers`);
    this.initializeWorkers();
  }

  private initializeWorkers() {
    for (let i = 0; i < this.poolSize; i++) {
      this.createWorker(i);
    }
  }

  private createWorker(id: number) {
    console.log(`Creating worker ${id}`);

    const worker = new Worker(this.workerPath, {
      workerData: { workerId: id },
    });

    const instance: WorkerInstance = {
      worker,
      busy: false,
      tasksProcessed: 0,
    };

    worker.on('message', (message: any) => {
      this.handleWorkerMessage(instance, message);
    });

    worker.on('error', error => {
      console.error(`Worker ${id} error:`, error);
      this.handleWorkerError(instance, error);
    });

    worker.on('exit', code => {
      if (!this.shuttingDown) {
        console.warn(`Worker ${id} exited with code ${code}, restarting...`);
        this.workers = this.workers.filter(w => w !== instance);
        this.createWorker(id);
      }
    });

    this.workers.push(instance);
  }

  private handleWorkerMessage(instance: WorkerInstance, message: any) {
    const { id, result, error } = message;

    instance.busy = false;
    instance.tasksProcessed++;

    const pending = this.pending.get(id);
    if (!pending) {
      console.warn(`Received result for unknown task ${id}`);
      return;
    }

    this.pending.delete(id);

    if (error) {
      pending.reject(new Error(error));
    } else {
      pending.resolve(result);
    }

    // Process next queued task
    this.processQueue();
  }

  private handleWorkerError(instance: WorkerInstance, error: Error) {
    instance.busy = false;

    // Reject all pending tasks from this worker
    // (In practice, we'd need to track which worker owns which task)
    console.error('Worker error:', error);
  }

  private processQueue() {
    if (this.queue.length === 0) {
      return;
    }

    // Find an available worker
    const availableWorker = this.workers.find(w => !w.busy);
    if (!availableWorker) {
      return;
    }

    const task = this.queue.shift();
    if (!task) {
      return;
    }

    availableWorker.busy = true;
    this.pending.set(task.id, task.pending);
    availableWorker.worker.postMessage(task.data);
  }

  async process(operation: string, data: any): Promise<any> {
    if (this.shuttingDown) {
      throw new Error('Worker pool is shutting down');
    }

    const id = this.messageId++;
    const taskData = { id, operation, data };

    return new Promise((resolve, reject) => {
      const pending: PendingTask = {
        resolve,
        reject,
        timestamp: Date.now(),
      };

      // Try to assign to an available worker immediately
      const availableWorker = this.workers.find(w => !w.busy);

      if (availableWorker) {
        availableWorker.busy = true;
        this.pending.set(id, pending);
        availableWorker.worker.postMessage(taskData);
      } else {
        // Queue it
        this.queue.push({ id, data: taskData, pending });
      }

      // Timeout after 30 seconds
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error('Image processing timeout'));
        }
      }, 30000);
    });
  }

  // Convenience methods for common operations
  async processImage(
    buffer: ArrayBuffer,
    options: {
      maxSidePx: number;
      quality?: number;
      withoutEnlargement?: boolean;
    }
  ) {
    return this.process('thumbnail', { buffer, options });
  }

  // Graceful shutdown
  async shutdown(): Promise<void> {
    this.shuttingDown = true;

    // Wait for pending tasks to complete (with timeout)
    const waitForPending = new Promise(resolve => {
      const checkInterval = setInterval(() => {
        if (this.pending.size === 0) {
          clearInterval(checkInterval);
          resolve(true);
        }
      }, 100);

      // Force shutdown after 5 seconds
      setTimeout(() => {
        clearInterval(checkInterval);
        resolve(false);
      }, 5000);
    });

    await waitForPending;

    // Terminate all workers
    await Promise.all(this.workers.map(({ worker }) => worker.terminate()));

    this.workers = [];
    console.log('Worker pool shut down');
  }

  // Stats for monitoring
  getStats() {
    return {
      poolSize: this.poolSize,
      activeWorkers: this.workers.filter(w => w.busy).length,
      queueLength: this.queue.length,
      pendingTasks: this.pending.size,
      totalProcessed: this.workers.reduce((sum, w) => sum + w.tasksProcessed, 0),
    };
  }
}
