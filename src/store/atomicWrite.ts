import fs from 'node:fs';

/**
 * Atomically replace a file's contents: write to a temp sibling, then rename.
 * On Windows, rename onto an existing path can fail (EPERM/EEXIST, often due
 * to AV scanners); fall back to unlink-then-rename.
 */
export function atomicWriteFileSync(file: string, contents: string, mode?: number): void {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, contents, mode === undefined ? undefined : { mode });
  try {
    fs.renameSync(tmp, file);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EPERM' || code === 'EEXIST' || code === 'EACCES') {
      try {
        fs.unlinkSync(file);
      } catch {
        // target already gone
      }
      try {
        fs.renameSync(tmp, file);
      } catch (err2) {
        // Never leave the destination missing while tmp holds the payload.
        try {
          fs.copyFileSync(tmp, file);
          fs.unlinkSync(tmp);
        } catch {
          throw err2;
        }
      }
    } else {
      try {
        fs.unlinkSync(tmp);
      } catch {
        // best effort cleanup
      }
      throw err;
    }
  }
  if (mode !== undefined) {
    try {
      fs.chmodSync(file, mode);
    } catch {
      // chmod is best-effort on platforms without POSIX modes
    }
  }
}
