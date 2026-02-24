import { writeFileSync, readFileSync, unlinkSync, existsSync, statSync } from 'fs';
import { join } from 'path';
import { getDataDir } from './db.js';

const STALE_MS = 15 * 60 * 1000; // 15 minutes

function lockPath() {
  return join(getDataDir(), 'kb.lock');
}

function isPidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

export function acquireLock() {
  const lp = lockPath();

  if (existsSync(lp)) {
    try {
      const data = JSON.parse(readFileSync(lp, 'utf-8'));
      const age = Date.now() - data.ts;
      if (age < STALE_MS && isPidAlive(data.pid)) {
        throw new Error('Another ingestion is running. Try again later.');
      }
    } catch (err) {
      if (err.message.includes('Another ingestion')) throw err;
      // Corrupt lock file — remove it
    }
    unlinkSync(lp);
  }

  writeFileSync(lp, JSON.stringify({ pid: process.pid, ts: Date.now() }));

  return function release() {
    try { unlinkSync(lp); } catch { /* ignore */ }
  };
}
