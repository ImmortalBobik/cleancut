/**
 * Batch Export & Share Utilities
 * Handles single PNG downloads, JSZip batch packaging, and Web Share API.
 */

import JSZip from 'jszip';

/**
 * Sanitize filename for safe file system exports
 */
export function getSafeBaseName(filename) {
  const base = filename.replace(/\.[^/.]+$/, '');
  return base.replace(/[^a-zA-Z0-9_-]/g, '_') || 'image';
}

/**
 * Render an item's cutout onto a selected backdrop
 * Returns an HTMLCanvasElement with correct alpha compositing
 */
export function renderFinalCanvas(item, backdrop = { type: 'transparent' }) {
  const resultData = item.resultImageData || item.origImageData;
  if (!resultData) {
    throw new Error('No image data available to render');
  }

  const width = resultData.width;
  const height = resultData.height;

  // Render cutout data to an offscreen canvas
  const cutoutCanvas = document.createElement('canvas');
  cutoutCanvas.width = width;
  cutoutCanvas.height = height;
  const cutoutCtx = cutoutCanvas.getContext('2d');
  cutoutCtx.putImageData(resultData, 0, 0);

  // Target canvas with composite backdrop
  const finalCanvas = document.createElement('canvas');
  finalCanvas.width = width;
  finalCanvas.height = height;
  const finalCtx = finalCanvas.getContext('2d');

  if (backdrop.type === 'white') {
    finalCtx.fillStyle = '#ffffff';
    finalCtx.fillRect(0, 0, width, height);
  } else if (backdrop.type === 'black') {
    finalCtx.fillStyle = '#000000';
    finalCtx.fillRect(0, 0, width, height);
  } else if (backdrop.type === 'custom') {
    finalCtx.fillStyle = backdrop.color || '#f3f4f6';
    finalCtx.fillRect(0, 0, width, height);
  }
  // 'transparent' leaves the canvas transparent

  finalCtx.drawImage(cutoutCanvas, 0, 0);
  return finalCanvas;
}

/**
 * Convert canvas to Blob
 */
export function canvasToBlob(canvas, type = 'image/png') {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Canvas export to blob failed'));
    }, type);
  });
}

/**
 * Trigger a browser file download for a Blob
 */
function triggerBlobDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Download a single processed item as PNG
 */
export async function downloadSinglePng(item, backdrop) {
  const canvas = renderFinalCanvas(item, backdrop);
  const blob = await canvasToBlob(canvas);
  const safeName = getSafeBaseName(item.name);
  triggerBlobDownload(blob, `${safeName}-cutout.png`);
}

/**
 * Download all processed items as individual PNG files (no ZIP)
 */
export async function downloadAllPngs(items, backdrop = { type: 'transparent' }, onProgress = () => {}) {
  const total = items.length;

  for (let i = 0; i < total; i++) {
    const item = items[i];
    onProgress({ current: i + 1, total, name: item.name });

    const canvas = renderFinalCanvas(item, backdrop);
    const blob = await canvasToBlob(canvas);
    const safeName = getSafeBaseName(item.name);
    triggerBlobDownload(blob, `${safeName}-cutout.png`);

    if (i < total - 1) {
      await new Promise((resolve) => setTimeout(resolve, 180));
    }
  }
}

/**
 * Download all processed items inside a ZIP archive using JSZip
 */
export async function downloadBatchZip(items, backdrop, onProgress = () => {}) {
  const zip = new JSZip();
  const total = items.length;

  for (let i = 0; i < total; i++) {
    const item = items[i];
    onProgress({ current: i + 1, total, stage: 'rendering', name: item.name });

    const canvas = renderFinalCanvas(item, backdrop);
    const blob = await canvasToBlob(canvas);
    const safeName = getSafeBaseName(item.name);
    const filename = `${safeName}-cutout.png`;

    zip.file(filename, blob);
  }

  onProgress({ current: total, total, stage: 'compressing', name: 'Packaging ZIP archive...' });

  const zipBlob = await zip.generateAsync({ type: 'blob' }, (metadata) => {
    onProgress({
      current: total,
      total,
      stage: 'compressing',
      percent: Math.round(metadata.percent),
      name: `Compressing (${Math.round(metadata.percent)}%)...`
    });
  });

  triggerBlobDownload(zipBlob, 'clean-cut-batch.zip');
}

/**
 * Check if Web Share API with file sharing support is available
 */
export function canShareFiles() {
  if (typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') {
    return false;
  }
  try {
    const dummy = new File([''], 'test.png', { type: 'image/png' });
    return navigator.canShare({ files: [dummy] });
  } catch (e) {
    return false;
  }
}

/**
 * Share batch files using native share sheet (e.g. iPad Safari / iOS / macOS)
 */
export async function shareBatchFiles(items, backdrop) {
  const files = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const canvas = renderFinalCanvas(item, backdrop);
    const blob = await canvasToBlob(canvas);
    const safeName = getSafeBaseName(item.name);
    files.push(new File([blob], `${safeName}-cutout.png`, { type: 'image/png' }));
  }

  await navigator.share({
    title: 'CleanCut Background Removal',
    text: `Exported ${files.length} cutouts from CleanCut.`,
    files
  });
}
