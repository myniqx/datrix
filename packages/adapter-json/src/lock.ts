
import fs from 'node:fs/promises';
import path from 'node:path';

export class SimpleLock {
  private lockPath: string;
  private lockTimeout: number; // How long to wait to acquire lock
  private staleTimeout: number; // How long a lock is valid

  constructor(root: string, lockTimeout: number = 5000, staleTimeout: number = 30000) {
    this.lockPath = path.join(root, 'db.lock');
    this.lockTimeout = lockTimeout;
    this.staleTimeout = staleTimeout;
  }

  async acquire(): Promise<void> {
    const start = Date.now();

    while (true) {
      try {
        // Try to create the lock file (fails if exists)
        // "wx" flag: Open file for writing. The file is created (if it does not exist) or fails (if it exists).
        await fs.writeFile(this.lockPath, Date.now().toString(), { flag: 'wx' });
        return; // Acquired!
      } catch (error: any) {
        if (error.code !== 'EEXIST') {
          throw error; // Unexpected error
        }

        // Lock exists. Check if stale.
        const isStale = await this.checkStale();
        if (isStale) {
          try {
            await fs.unlink(this.lockPath);
            continue; // Retry immediately
          } catch (unlinkError) {
            // Could happen if another process released it just now.
            // Just continue loop to try acquiring again.
          }
        }

        // Check timeout
        if (Date.now() - start > this.lockTimeout) {
          throw new Error(`Could not acquire lock within ${this.lockTimeout}ms`);
        }

        // Wait a bit before retrying
        await new Promise(resolve => setTimeout(resolve, 100)); // 100ms poll
      }
    }
  }

  async release(): Promise<void> {
    try {
      await fs.unlink(this.lockPath);
    } catch (error: any) {
      // Ignore if file doesn't exist (maybe already released or stolen?)
      if (error.code !== 'ENOENT') {
        // warning?
      }
    }
  }

  private async checkStale(): Promise<boolean> {
    try {
      const content = await fs.readFile(this.lockPath, 'utf-8');
      const timestamp = parseInt(content, 10);
      if (isNaN(timestamp)) return true; // Corrupt lock

      const age = Date.now() - timestamp;
      return age > this.staleTimeout;
    } catch {
      // If can't read (e.g. deleted while checking), assume free/stale logic handles it by retry loop
      return false;
    }
  }
}
