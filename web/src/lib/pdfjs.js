const PDFJS_MODULE_URL = '/vendor/pdfjs/build/pdf.mjs';
const PDFJS_WORKER_URL = '/vendor/pdfjs/build/pdf.worker.mjs';

let cachedPdfjs = null;

export async function loadPdfjs(importer = url => import(/* @vite-ignore */ url)) {
  if (cachedPdfjs) return cachedPdfjs;
  const mod = await importer(PDFJS_MODULE_URL);
  if (mod?.GlobalWorkerOptions) {
    mod.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
  }
  cachedPdfjs = mod;
  return mod;
}

export function resetPdfjsCache() {
  cachedPdfjs = null;
}
