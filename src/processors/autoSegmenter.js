/**
 * Auto (Keep Person) Background Segmenter
 * Powered by MediaPipe Vision Tasks ImageSegmenter with local WASM and TFLite model,
 * plus a high-accuracy fallback color-flood and spatial segmenter for restricted environments.
 */

import { FilesetResolver, ImageSegmenter } from '@mediapipe/tasks-vision';

let segmenterInstance = null;
let activeEngine = null; // 'gpu' | 'cpu' | 'fallback'
let segmenterInitPromise = null;

/**
 * Initialize MediaPipe ImageSegmenter using local WASM and TFLite assets
 */
export async function initSegmenter() {
  if (segmenterInstance) {
    return { engine: activeEngine, segmenter: segmenterInstance };
  }
  if (segmenterInitPromise) {
    return segmenterInitPromise;
  }

  segmenterInitPromise = (async () => {
    try {
      // Load FilesetResolver pointing to local /wasm directory
      const vision = await FilesetResolver.forVisionTasks('/wasm');

      // Attempt GPU delegate first for optimal performance
      try {
        segmenterInstance = await ImageSegmenter.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: '/models/selfie_segmenter.tflite',
            delegate: 'GPU'
          },
          runningMode: 'IMAGE',
          outputConfidenceMasks: true,
          outputCategoryMask: false
        });
        activeEngine = 'gpu';
        return { engine: 'gpu', segmenter: segmenterInstance };
      } catch (gpuErr) {
        console.warn('MediaPipe GPU delegate unavailable, attempting CPU delegate:', gpuErr);
        segmenterInstance = await ImageSegmenter.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: '/models/selfie_segmenter.tflite',
            delegate: 'CPU'
          },
          runningMode: 'IMAGE',
          outputConfidenceMasks: true,
          outputCategoryMask: false
        });
        activeEngine = 'cpu';
        return { engine: 'cpu', segmenter: segmenterInstance };
      }
    } catch (err) {
      console.warn('MediaPipe initialization failed; falling back to local fallback segmenter:', err);
      activeEngine = 'fallback';
      return { engine: 'fallback', segmenter: null };
    }
  })();

  return segmenterInitPromise;
}

/**
 * Fast 1D Separable Box Blur for edge feathering
 */
function applyAlphaFeather(data, width, height, radius) {
  if (radius <= 0) return;
  const r = Math.min(20, Math.round(radius));
  const total = width * height;

  const alphaIn = new Uint8Array(total);
  for (let i = 0; i < total; i++) {
    alphaIn[i] = data[i * 4 + 3];
  }

  const temp = new Float32Array(total);
  const alphaOut = new Uint8Array(total);
  const windowSize = 2 * r + 1;

  // Horizontal pass
  for (let y = 0; y < height; y++) {
    const rowOffset = y * width;
    let windowSum = 0;
    for (let k = -r; k <= r; k++) {
      const px = Math.min(width - 1, Math.max(0, k));
      windowSum += alphaIn[rowOffset + px];
    }
    temp[rowOffset] = windowSum / windowSize;

    for (let x = 1; x < width; x++) {
      const leavingX = Math.min(width - 1, Math.max(0, x - 1 - r));
      const enteringX = Math.min(width - 1, Math.max(0, x + r));
      windowSum += alphaIn[rowOffset + enteringX] - alphaIn[rowOffset + leavingX];
      temp[rowOffset + x] = windowSum / windowSize;
    }
  }

  // Vertical pass
  for (let x = 0; x < width; x++) {
    let windowSum = 0;
    for (let k = -r; k <= r; k++) {
      const py = Math.min(height - 1, Math.max(0, k));
      windowSum += temp[py * width + x];
    }
    alphaOut[x] = Math.round(windowSum / windowSize);

    for (let y = 1; y < height; y++) {
      const leavingY = Math.min(height - 1, Math.max(0, y - 1 - r));
      const enteringY = Math.min(height - 1, Math.max(0, y + r));
      windowSum += temp[enteringY * width + x] - temp[leavingY * width + x];
      alphaOut[y * width + x] = Math.round(Math.min(255, Math.max(0, windowSum / windowSize)));
    }
  }

  for (let i = 0; i < total; i++) {
    data[i * 4 + 3] = alphaOut[i];
  }
}

/**
 * Fast 1D Separable Min/Max morphology filter for alpha channel choke/expand
 */
function applyAlphaChoke(data, width, height, radius) {
  if (radius === 0) return;

  const isErosion = radius > 0;
  const r = Math.abs(radius);
  const total = width * height;

  const alphaIn = new Uint8Array(total);
  for (let i = 0; i < total; i++) {
    alphaIn[i] = data[i * 4 + 3];
  }

  const temp = new Uint8Array(total);
  const alphaOut = new Uint8Array(total);

  // Horizontal pass
  for (let y = 0; y < height; y++) {
    const rowOffset = y * width;
    for (let x = 0; x < width; x++) {
      let val = alphaIn[rowOffset + x];
      const start = Math.max(0, x - r);
      const end = Math.min(width - 1, x + r);
      for (let k = start; k <= end; k++) {
        const v = alphaIn[rowOffset + k];
        if (isErosion) {
          if (v < val) val = v;
        } else {
          if (v > val) val = v;
        }
      }
      temp[rowOffset + x] = val;
    }
  }

  // Vertical pass
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      let val = temp[y * width + x];
      const start = Math.max(0, y - r);
      const end = Math.min(height - 1, y + r);
      for (let k = start; k <= end; k++) {
        const v = temp[k * width + x];
        if (isErosion) {
          if (v < val) val = v;
        } else {
          if (v > val) val = v;
        }
      }
      alphaOut[y * width + x] = val;
    }
  }

  for (let i = 0; i < total; i++) {
    data[i * 4 + 3] = alphaOut[i];
  }
}

/**
 * Keep the largest central connected component
 * Scored by area * (0.35 + 0.65 * centralityScore)
 */
export function keepLargestCentralComponent(binaryMask, width, height) {
  const scale = Math.max(1, Math.floor(Math.max(width, height) / 200));
  const sw = Math.floor(width / scale);
  const sh = Math.floor(height / scale);

  const grid = new Uint8Array(sw * sh);
  for (let sy = 0; sy < sh; sy++) {
    for (let sx = 0; sx < sw; sx++) {
      const origX = sx * scale;
      const origY = sy * scale;
      if (binaryMask[origY * width + origX] === 1) {
        grid[sy * sw + sx] = 1;
      }
    }
  }

  const labels = new Int32Array(sw * sh).fill(0);
  let currentLabel = 1;
  const components = [];

  const queueX = new Int32Array(sw * sh);
  const queueY = new Int32Array(sw * sh);

  for (let sy = 0; sy < sh; sy++) {
    for (let sx = 0; sx < sw; sx++) {
      const idx = sy * sw + sx;
      if (grid[idx] === 1 && labels[idx] === 0) {
        let qHead = 0;
        let qTail = 0;
        queueX[qTail] = sx;
        queueY[qTail] = sy;
        qTail++;
        labels[idx] = currentLabel;

        let count = 0;
        let sumX = 0;
        let sumY = 0;

        while (qHead < qTail) {
          const cx = queueX[qHead];
          const cy = queueY[qHead];
          qHead++;

          count++;
          sumX += cx;
          sumY += cy;

          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue;
              const nx = cx + dx;
              const ny = cy + dy;
              if (nx >= 0 && nx < sw && ny >= 0 && ny < sh) {
                const nIdx = ny * sw + nx;
                if (grid[nIdx] === 1 && labels[nIdx] === 0) {
                  labels[nIdx] = currentLabel;
                  queueX[qTail] = nx;
                  queueY[qTail] = ny;
                  qTail++;
                }
              }
            }
          }
        }

        const avgX = sumX / count;
        const avgY = sumY / count;
        const dxNorm = (avgX - sw / 2) / (sw / 2);
        const dyNorm = (avgY - sh / 2) / (sh / 2);
        const dist = Math.sqrt(dxNorm * dxNorm + dyNorm * dyNorm);
        const centralityScore = Math.max(0.1, 1.0 - Math.min(1.0, dist * 0.8));
        const score = count * (0.35 + 0.65 * centralityScore);

        components.push({
          label: currentLabel,
          count,
          score
        });

        currentLabel++;
      }
    }
  }

  if (components.length === 0) return;

  components.sort((a, b) => b.score - a.score);
  const bestLabel = components[0].label;

  const keepGrid = new Uint8Array(sw * sh);
  for (let i = 0; i < sw * sh; i++) {
    if (labels[i] === bestLabel) {
      keepGrid[i] = 1;
    }
  }

  // Slight dilation to avoid shaving thin extremities
  const dilated = new Uint8Array(sw * sh);
  for (let sy = 0; sy < sh; sy++) {
    for (let sx = 0; sx < sw; sx++) {
      let keep = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = sx + dx;
          const ny = sy + dy;
          if (nx >= 0 && nx < sw && ny >= 0 && ny < sh) {
            if (keepGrid[ny * sw + nx] === 1) {
              keep = 1;
              break;
            }
          }
        }
        if (keep) break;
      }
      dilated[sy * sw + sx] = keep;
    }
  }

  for (let y = 0; y < height; y++) {
    const sy = Math.min(sh - 1, Math.floor(y / scale));
    const rowOffset = y * width;
    for (let x = 0; x < width; x++) {
      const sx = Math.min(sw - 1, Math.floor(x / scale));
      if (dilated[sy * sw + sx] === 0) {
        binaryMask[rowOffset + x] = 0;
      }
    }
  }
}

/**
 * Fallback Segmenter
 * Downsamples to max 320px for fast border palette sampling + center spatial weighting,
 * then bilinearly upsamples the confidence map back to full resolution.
 */
export function fallbackSegmenter(sourceCanvas) {
  const width = sourceCanvas.width;
  const height = sourceCanvas.height;
  const maxDim = Math.max(width, height);
  const scale = maxDim > 320 ? 320 / maxDim : 1;
  const sw = Math.max(1, Math.round(width * scale));
  const sh = Math.max(1, Math.round(height * scale));

  // Downsample onto a tiny offscreen canvas
  const smallCanvas = document.createElement('canvas');
  smallCanvas.width = sw;
  smallCanvas.height = sh;
  const sCtx = smallCanvas.getContext('2d', { willReadFrequently: true });
  sCtx.drawImage(sourceCanvas, 0, 0, sw, sh);
  const data = sCtx.getImageData(0, 0, sw, sh).data;

  // Sample border pixels on the downsampled buffer
  const borderSamples = [];
  const sampleStep = Math.max(1, Math.floor(Math.max(sw, sh) / 100));

  // Top border (full width) and bottom corners only (avoid bottom-center torso/jacket)
  for (let x = 0; x < sw; x += sampleStep) {
    const topIdx = x * 4;
    borderSamples.push({ r: data[topIdx], g: data[topIdx + 1], b: data[topIdx + 2] });
    if (x < sw * 0.12 || x > sw * 0.88) {
      const botIdx = ((sh - 1) * sw + x) * 4;
      borderSamples.push({ r: data[botIdx], g: data[botIdx + 1], b: data[botIdx + 2] });
    }
  }

  // Left and right borders (upper 88% only)
  const sideLimit = Math.floor(sh * 0.88);
  for (let y = 0; y < sideLimit; y += sampleStep) {
    const leftIdx = (y * sw) * 4;
    const rightIdx = (y * sw + sw - 1) * 4;
    borderSamples.push({ r: data[leftIdx], g: data[leftIdx + 1], b: data[leftIdx + 2] });
    borderSamples.push({ r: data[rightIdx], g: data[rightIdx + 1], b: data[rightIdx + 2] });
  }

  const smallConf = new Float32Array(sw * sh);
  const cx = sw / 2;
  const cy = sh / 2;
  const maxDistFromCenter = Math.sqrt(cx * cx + cy * cy) || 1;
  const numSamples = borderSamples.length;

  for (let y = 0; y < sh; y++) {
    const rowOffset = y * sw;
    const dy = y - cy;
    for (let x = 0; x < sw; x++) {
      const idx = (rowOffset + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];

      // Minimum distance to border background samples
      let minBorderDist = 999999;
      for (let s = 0; s < numSamples; s++) {
        const sample = borderSamples[s];
        const dr = r - sample.r;
        const dg = g - sample.g;
        const db = b - sample.b;
        const d = dr * dr + dg * dg + db * db;
        if (d < minBorderDist) minBorderDist = d;
      }
      const normColorDist = Math.min(1.0, Math.sqrt(minBorderDist) / 180);

      // Distance from center
      const dx = x - cx;
      const distFromCenter = Math.sqrt(dx * dx + dy * dy) / maxDistFromCenter;
      const centerPrior = Math.max(0.0, 1.0 - Math.pow(distFromCenter, 1.5));

      // Subject probability is high if color differs from border background and is centered
      const prob = normColorDist * 0.65 + centerPrior * 0.35;
      smallConf[rowOffset + x] = Math.min(1.0, Math.max(0.0, prob));
    }
  }

  if (sw === width && sh === height) {
    return smallConf;
  }

  // Bilinearly upsample confidence map back to width x height
  const confidence = new Float32Array(width * height);
  const scaleX = sw / width;
  const scaleY = sh / height;

  for (let y = 0; y < height; y++) {
    const fy = Math.min(sh - 1, Math.max(0, (y + 0.5) * scaleY - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(sh - 1, y0 + 1);
    const ty = fy - y0;
    const row0 = y0 * sw;
    const row1 = y1 * sw;
    const outRow = y * width;

    for (let x = 0; x < width; x++) {
      const fx = Math.min(sw - 1, Math.max(0, (x + 0.5) * scaleX - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(sw - 1, x0 + 1);
      const tx = fx - x0;

      const c00 = smallConf[row0 + x0];
      const c10 = smallConf[row0 + x1];
      const c01 = smallConf[row1 + x0];
      const c11 = smallConf[row1 + x1];

      const top = c00 + (c10 - c00) * tx;
      const bot = c01 + (c11 - c01) * tx;
      confidence[outRow + x] = top + (bot - top) * ty;
    }
  }

  return confidence;
}

/**
 * Segment Person from an HTMLCanvasElement
 */
export async function segmentPerson(sourceCanvas, options = {}) {
  const {
    threshold = 50,      // 10..90%
    feather = 3,         // 0..20 px
    choke = -1,          // -10..10 px
    keepMainPerson = true
  } = options;

  const width = sourceCanvas.width;
  const height = sourceCanvas.height;
  const total = width * height;

  const ctx = sourceCanvas.getContext('2d');
  const srcImgData = ctx.getImageData(0, 0, width, height);
  const outData = new Uint8ClampedArray(srcImgData.data);

  let confidenceArray = null;

  // Ensure segmenter is ready
  const { engine, segmenter } = await initSegmenter();

  if (segmenter && (engine === 'gpu' || engine === 'cpu')) {
    try {
      const result = segmenter.segment(sourceCanvas);
      if (result && result.confidenceMasks && result.confidenceMasks.length > 0) {
        let personIdx = 0;
        const labels = segmenter.getLabels ? segmenter.getLabels() : [];
        if (labels.length > 0) {
          const found = labels.findIndex(l => /person|selfie|foreground/i.test(l));
          if (found >= 0) personIdx = found;
          else if (labels.length > 1 && /background/i.test(labels[0])) personIdx = 1;
        } else if (result.confidenceMasks.length > 1) {
          personIdx = 1;
        }

        const mask = result.confidenceMasks[personIdx];
        confidenceArray = new Float32Array(mask.getAsFloat32Array());

        // Close masks to release GPU/WASM memory
        for (const m of result.confidenceMasks) {
          if (m && typeof m.close === 'function') m.close();
        }
        if (typeof result.close === 'function') {
          result.close();
        }
      }
    } catch (segErr) {
      console.warn('Inference error in MediaPipe segmenter, using fallback:', segErr);
    }
  }

  const thresh = threshold / 100;

  if (confidenceArray) {
    if (confidenceArray.length !== total) {
      confidenceArray = null;
    } else if (total > 0) {
      let fgCount = 0;
      for (let i = 0; i < total; i++) {
        if (confidenceArray[i] >= thresh) fgCount++;
      }
      const fgRatio = fgCount / total;
      if (fgRatio < 0.03 || fgRatio > 0.95) {
        console.warn(`MediaPipe mask foreground ratio (${(fgRatio * 100).toFixed(1)}%) out of bounds, using fallback.`);
        confidenceArray = null;
      }
    }
  }

  // If MediaPipe failed, produced degenerate mask, or in fallback mode
  if (!confidenceArray) {
    confidenceArray = fallbackSegmenter(sourceCanvas);
  }

  const low = Math.max(0, thresh - 0.14);
  const high = Math.min(1, thresh + 0.14);
  const range = Math.max(0.0001, high - low);

  const binaryMask = new Uint8Array(total);

  for (let i = 0; i < total; i++) {
    binaryMask[i] = confidenceArray[i] >= low ? 1 : 0;
  }

  if (keepMainPerson) {
    keepLargestCentralComponent(binaryMask, width, height);
  }

  // Compute soft alpha using smoothstep ramp around thresh
  for (let i = 0; i < total; i++) {
    const idx = i * 4;
    if (keepMainPerson && binaryMask[i] === 0) {
      outData[idx + 3] = 0;
    } else {
      const conf = confidenceArray[i];
      const t = Math.min(1.0, Math.max(0.0, (conf - low) / range));
      const alpha = t * t * (3 - 2 * t);
      outData[idx + 3] = Math.round(srcImgData.data[idx + 3] * alpha);
    }
  }

  // Apply Choke (Shrink/Expand)
  if (choke !== 0) {
    applyAlphaChoke(outData, width, height, choke);
  }

  // Apply 2-pass Feathering (approximates smooth Gaussian edge without blocky artifacts)
  if (feather > 0) {
    const passRadius = Math.max(1, Math.round(feather * 0.65));
    applyAlphaFeather(outData, width, height, passRadius);
    applyAlphaFeather(outData, width, height, passRadius);
  }

  // Lightweight edge halo decontamination on semi-transparent boundary pixels
  const offsets = [-2, 0, 2];
  for (let y = 0; y < height; y++) {
    const rowOffset = y * width;
    for (let x = 0; x < width; x++) {
      const idx = (rowOffset + x) * 4;
      const a = outData[idx + 3];
      if (a > 15 && a < 235) {
        let sumR = 0;
        let sumG = 0;
        let sumB = 0;
        let count = 0;

        for (let oy = 0; oy < 3; oy++) {
          const ny = y + offsets[oy];
          if (ny < 0 || ny >= height) continue;
          const nRow = ny * width;
          for (let ox = 0; ox < 3; ox++) {
            if (ox === 1 && oy === 1) continue;
            const nx = x + offsets[ox];
            if (nx < 0 || nx >= width) continue;
            const nIdx = (nRow + nx) * 4;
            if (outData[nIdx + 3] >= 235) {
              sumR += srcImgData.data[nIdx];
              sumG += srcImgData.data[nIdx + 1];
              sumB += srcImgData.data[nIdx + 2];
              count++;
            }
          }
        }

        if (count > 0) {
          const intR = sumR / count;
          const intG = sumG / count;
          const intB = sumB / count;
          const blend = Math.min(0.65, ((235 - a) / 220) * 0.65);
          outData[idx] = Math.round(outData[idx] + (intR - outData[idx]) * blend);
          outData[idx + 1] = Math.round(outData[idx + 1] + (intG - outData[idx + 1]) * blend);
          outData[idx + 2] = Math.round(outData[idx + 2] + (intB - outData[idx + 2]) * blend);
        }
      }
    }
  }

  return new ImageData(outData, width, height);
}
