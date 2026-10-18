import { createWorker, OEM, PSM } from 'tesseract.js';
import { parseForesightText } from './parseShot';
import { tesseractPaths } from './ocrPaths';
import type { ShotData } from '../types';

async function prepareScreenshot(file: Blob): Promise<Blob | HTMLCanvasElement> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(2, 1800 / Math.max(bitmap.width, bitmap.height, 1));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * Math.max(1, scale)));
    canvas.height = Math.max(1, Math.round(bitmap.height * Math.max(1, scale)));
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = image.data;
    for (let i = 0; i < data.length; i += 4) {
      const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      const stretched = Math.max(0, Math.min(255, (gray - 128) * 1.45 + 128));
      data[i] = stretched;
      data[i + 1] = stretched;
      data[i + 2] = stretched;
    }
    ctx.putImageData(image, 0, 0);
    bitmap.close();
    return canvas;
  } catch {
    return file;
  }
}

/** Read a Foresight shot screenshot on this phone. Language data is served with the app. */
export async function readShotScreenshot(file: Blob): Promise<ShotData> {
  const paths = tesseractPaths(import.meta.env.BASE_URL);
  const worker = await createWorker('eng', OEM.LSTM_ONLY, {
    workerPath: paths.workerPath,
    corePath: paths.corePath,
    langPath: paths.langPath,
    gzip: true,
    workerBlobURL: false,
    cacheMethod: 'write',
  });
  try {
    await worker.setParameters({
      tessedit_pageseg_mode: PSM.SPARSE_TEXT,
      preserve_interword_spaces: '1',
      user_defined_dpi: '300',
    });
    const image = await prepareScreenshot(file);
    const result = await worker.recognize(image);
    return parseForesightText(result.data.text ?? '');
  } finally {
    await worker.terminate();
  }
}
