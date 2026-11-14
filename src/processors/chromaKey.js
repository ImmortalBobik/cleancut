/**
 * Chroma Key Processor
 * Removes background color from the outside edges inward so enclosed insides stay opaque.
 */

export function hexToRgb(hex) {
  let clean = hex.replace('#', '').trim();
  if (clean.length === 3) {
    clean = clean.split('').map((c) => c + c).join('');
  }
  const num = parseInt(clean, 16);
  if (isNaN(num)) {
    return { r: 0, g: 177, b: 64 };
  }
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255
  };
}

export function rgbToHex(r, g, b) {
  const toHex = (c) => {
    const hex = Math.round(Math.max(0, Math.min(255, c))).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  };
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

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

function createKeyColorParams(keyColor) {
  const { r: kr, g: kg, b: kb } = hexToRgb(keyColor);
  const kCb = -0.168736 * kr - 0.331264 * kg + 0.5 * kb;
  const kCr = 0.5 * kr - 0.418688 * kg - 0.081312 * kb;
  const kMax = Math.max(kr, kg, kb);
  const kMin = Math.min(kr, kg, kb);
  const kSat = (kMax - kMin) / 255;
  return { kr, kg, kb, kCb, kCr, kSat };
}

function computeColorDistance(r, g, b, keyParams) {
  const { kr, kg, kb, kCb, kCr, kSat } = keyParams;

  const cb = -0.168736 * r - 0.331264 * g + 0.5 * b;
  const cr = 0.5 * r - 0.418688 * g - 0.081312 * b;
  const dCb = cb - kCb;
  const dCr = cr - kCr;
  const chromaDist = Math.sqrt(dCb * dCb + dCr * dCr) / 220;

  const dR = r - kr;
  const dG = g - kg;
  const dB = b - kb;
  const rgbDist = Math.sqrt(dR * dR + dG * dG + dB * dB) / 441.67;

  return kSat * chromaDist + (1 - kSat) * rgbDist;
}

/**
 * Rasterize pen strokes onto a Uint8Array mask (1 on stroke pixels, 0 elsewhere).
 */
function rasterizeStrokes(strokes, width, height, defaultWidth = 10) {
  if (!strokes || strokes.length === 0 || width <= 0 || height <= 0) {
    return null;
  }

  const canvas = typeof document !== 'undefined'
    ? document.createElement('canvas')
    : new OffscreenCanvas(width, height);
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, width, height);
  ctx.strokeStyle = '#ffffff';
  ctx.fillStyle = '#ffffff';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const stroke of strokes) {
    const pts = Array.isArray(stroke) ? stroke : stroke?.points;
    if (!pts || pts.length === 0) continue;
    const strokeW = Math.max(2, (stroke && stroke.width) || defaultWidth);

    if (pts.length === 1) {
      ctx.beginPath();
      ctx.arc(pts[0].x, pts[0].y, strokeW / 2, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }

    ctx.lineWidth = strokeW;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
      ctx.lineTo(pts[i].x, pts[i].y);
    }
    ctx.stroke();
  }

  const mask = new Uint8Array(width * height);
  const imgData = ctx.getImageData(0, 0, width, height).data;
  for (let i = 0; i < mask.length; i++) {
    if (imgData[i * 4 + 3] > 64) {
      mask[i] = 1;
    }
  }
  return mask;
}

/**
 * 4-connected BFS flood-fill of key-color pixels from exterior borders,
 * blocked by any user-drawn barrier strokes.
 */
function floodFillContiguousKey(keyMask, barrierMask, width, height) {
  const total = width * height;
  const visited = new Uint8Array(total);
  const queue = new Int32Array(total);
  let qHead = 0;
  let qTail = 0;

  const canVisit = (idx) =>
    keyMask[idx] === 1 && !visited[idx] && (!barrierMask || barrierMask[idx] === 0);

  const trySeed = (idx) => {
    if (canVisit(idx)) {
      visited[idx] = 1;
      queue[qTail++] = idx;
    }
  };

  for (let x = 0; x < width; x++) {
    trySeed(x);
  }
  for (let y = 0; y < height; y++) {
    trySeed(y * width);
    trySeed(y * width + (width - 1));
  }
  const bottomOffset = (height - 1) * width;
  const leftLimit = Math.ceil(0.08 * width);
  const rightStart = Math.floor(0.92 * width);
  for (let x = 0; x < width; x++) {
    if (x < leftLimit || x > rightStart) {
      trySeed(bottomOffset + x);
    }
  }

  while (qHead < qTail) {
    const idx = queue[qHead++];
    const x = idx % width;
    const y = (idx - x) / width;

    if (x > 0 && canVisit(idx - 1)) {
      visited[idx - 1] = 1;
      queue[qTail++] = idx - 1;
    }
    if (x < width - 1 && canVisit(idx + 1)) {
      visited[idx + 1] = 1;
      queue[qTail++] = idx + 1;
    }
    if (y > 0 && canVisit(idx - width)) {
      visited[idx - width] = 1;
      queue[qTail++] = idx - width;
    }
    if (y < height - 1 && canVisit(idx + width)) {
      visited[idx + width] = 1;
      queue[qTail++] = idx + width;
    }
  }

  return visited;
}

/**
 * Apply Chroma Key algorithm to an ImageData instance.
 * Outer background is flood-filled so enclosed insides stay opaque.
 * Returns a new ImageData without modifying the input.
 */
export function applyChromaKey(sourceImageData, options = {}) {
  const {
    keyColor = '#00b140',
    tolerance = 26,
    smoothness = 8,
    barrierStrokes = [],
    eraseStrokes = []
  } = options;

  const width = sourceImageData.width;
  const height = sourceImageData.height;
  const total = width * height;

  const srcData = sourceImageData.data;
  const outData = new Uint8ClampedArray(srcData);

  const keyParams = createKeyColorParams(keyColor);
  const tol = tolerance / 100;
  const smooth = Math.max(0.01, smoothness / 100);
  const tolMin = Math.max(0, tol - smooth * 0.5);
  const tolMax = Math.min(1.0, tol + smooth * 0.5);
  const tolRange = Math.max(0.0001, tolMax - tolMin);

  const keyMask = new Uint8Array(total);

  for (let i = 0; i < total; i++) {
    const idx = i * 4;
    const a = srcData[idx + 3];
    if (a === 0) {
      outData[idx + 3] = 0;
      continue;
    }

    const dist = computeColorDistance(srcData[idx], srcData[idx + 1], srcData[idx + 2], keyParams);
    if (dist < tolMax) {
      keyMask[i] = 1;
    }

    let alphaFactor;
    if (dist <= tolMin) {
      alphaFactor = 0;
    } else if (dist >= tolMax) {
      alphaFactor = 1;
    } else {
      const t = (dist - tolMin) / tolRange;
      alphaFactor = t * t * (3 - 2 * t);
    }

    outData[idx + 3] = Math.round(a * alphaFactor);
  }

  const barrierMask = rasterizeStrokes(barrierStrokes, width, height, 6);
  const reachable = floodFillContiguousKey(keyMask, barrierMask, width, height);
  for (let i = 0; i < total; i++) {
    if (reachable[i] === 0 && keyMask[i] === 1) {
      outData[i * 4 + 3] = srcData[i * 4 + 3];
    }
  }

  if (smoothness >= 40) {
    applyAlphaFeather(outData, width, height, 1);
  }

  const eraseMask = rasterizeStrokes(eraseStrokes, width, height, 18);
  if (eraseMask) {
    for (let i = 0; i < total; i++) {
      if (eraseMask[i] === 1) {
        outData[i * 4 + 3] = 0;
      }
    }
  }

  return new ImageData(outData, width, height);
}
