import path from 'node:path';

function positiveNumber(name, fallback) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive whole number`);
  return value;
}

export const config = {
  dataDir: path.resolve(process.env.DATA_DIR || './data'),
  port: positiveNumber('PORT', 3000),
  host: process.env.HOST || '127.0.0.1',
  maxPdfBytes: positiveNumber('MAX_PDF_MB', 50) * 1024 * 1024,
  maxStorageBytes: positiveNumber('MAX_STORAGE_MB', 1024) * 1024 * 1024
};
