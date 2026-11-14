/**
 * CleanCut — Ultra-Minimalist Background Remover
 */

import { applyChromaKey, rgbToHex } from './processors/chromaKey.js';
import {
  downloadSinglePng,
  downloadAllPngs,
  canShareFiles,
  shareBatchFiles
} from './utils/batchExport.js';

const TRANSPARENT_BACKDROP = { type: 'transparent' };

function cloneSettings(settings) {
  return JSON.parse(JSON.stringify(settings));
}

const state = {
  items: [], // { id, name, file, width, height, workCanvas, origImageData, resultImageData, dirty, barrierStrokes, eraseStrokes, settings }
  activeId: null,
  scope: 'all', // 'all' | 'one'
  activeTool: 'pick', // 'pick' | 'close' | 'erase'
  settings: {
    keyColor: '#ffffff',
    tolerance: 26,
    smoothness: 8
  }
};

let debounceTimer = null;
let processRunId = 0;
let userEditedColor = false;
const cardRefs = new Map();

const dom = {
  fileInput: document.getElementById('file-input'),
  fileInputDz: document.getElementById('file-input-dz'),
  btnDownloadZip: document.getElementById('btn-download-zip'),
  btnShareAll: document.getElementById('btn-share-all'),
  controlsPanel: document.getElementById('controls-panel'),
  scopeGroup: document.getElementById('scope-group'),
  emptyDropzone: document.getElementById('empty-dropzone'),
  photoFeed: document.getElementById('photo-feed'),
  chromaColor: document.getElementById('chroma-color'),
  chromaColorHex: document.getElementById('chroma-color-hex'),
  toolPick: document.getElementById('tool-pick'),
  toolClose: document.getElementById('tool-close'),
  toolErase: document.getElementById('tool-erase'),
  btnClearStrokes: document.getElementById('btn-clear-strokes'),
  chromaTolerance: document.getElementById('chroma-tolerance'),
  chromaToleranceVal: document.getElementById('chroma-tolerance-val'),
  chromaSmoothness: document.getElementById('chroma-smoothness'),
  chromaSmoothnessVal: document.getElementById('chroma-smoothness-val'),
  btnDownloadOne: document.getElementById('btn-download-one'),
  batchProgress: document.getElementById('batch-progress')
};

// --------------------------------------------------------------------------
// Sliders & Helpers
// --------------------------------------------------------------------------

function updateSliderProgress(slider) {
  const min = parseFloat(slider.min) || 0;
  const max = parseFloat(slider.max) || 100;
  const val = parseFloat(slider.value) || 0;
  slider.style.setProperty('--attr-min', min);
  slider.style.setProperty('--attr-max', max);
  slider.style.setProperty('--control-value', val);
  slider.setAttribute('aria-valuetext', `${val}`);
}

function initSliders() {
  document.querySelectorAll('input[type="range"]').forEach((slider) => {
    updateSliderProgress(slider);
    if (!slider.dataset.progressBound) {
      slider.addEventListener('input', () => updateSliderProgress(slider));
      slider.dataset.progressBound = '1';
    }
  });
}

function getActiveItem() {
  return state.items.find((item) => item.id === state.activeId) || null;
}

function getItemSettings(item) {
  return state.scope === 'all' ? state.settings : item.settings;
}

function getTargetSettings() {
  if (state.scope === 'one') {
    const active = getActiveItem();
    if (active) return active.settings;
  }
  return state.settings;
}

function applySettingsChange(mutator, { immediate = false } = {}) {
  const target = getTargetSettings();
  mutator(target);

  if (state.scope === 'all') {
    state.items.forEach((item) => {
      item.settings = cloneSettings(state.settings);
      item.dirty = true;
    });
  } else {
    const active = getActiveItem();
    if (active) {
      active.dirty = true;
    }
  }

  if (immediate) {
    clearTimeout(debounceTimer);
    processAllDirtyItems();
  } else {
    debounceProcessAll();
  }
}

// --------------------------------------------------------------------------
// Backdrop Color Auto-Detection
// --------------------------------------------------------------------------

function median(values) {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function detectBackdropColor(imageData) {
  const { width, height, data } = imageData;
  if (!width || !height) return '#ffffff';

  const rSamples = [];
  const gSamples = [];
  const bSamples = [];

  const pushPixel = (x, y) => {
    const idx = (y * width + x) * 4;
    rSamples.push(data[idx]);
    gSamples.push(data[idx + 1]);
    bSamples.push(data[idx + 2]);
  };

  const edgeSamples = 25;
  const xStep = Math.max(1, Math.floor(width / edgeSamples));
  const yStep = Math.max(1, Math.floor(height / edgeSamples));

  for (let x = 0; x < width; x += xStep) {
    pushPixel(x, 0);
    if (height > 1) pushPixel(x, height - 1);
  }
  for (let y = 0; y < height; y += yStep) {
    pushPixel(0, y);
    if (width > 1) pushPixel(width - 1, y);
  }

  const r = median(rSamples);
  const g = median(gSamples);
  const b = median(bSamples);

  if (r >= 220 && g >= 220 && b >= 220) return '#ffffff';
  return rgbToHex(r, g, b);
}

// --------------------------------------------------------------------------
// Image Ingestion
// --------------------------------------------------------------------------

async function loadImageFile(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);

      const maxDim = 1600;
      let width = img.naturalWidth;
      let height = img.naturalHeight;

      if (width > maxDim || height > maxDim) {
        if (width >= height) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
      }

      const workCanvas = document.createElement('canvas');
      workCanvas.width = width;
      workCanvas.height = height;
      const ctx = workCanvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);

      const origImageData = ctx.getImageData(0, 0, width, height);
      const itemSettings = cloneSettings(state.settings);
      itemSettings.keyColor = detectBackdropColor(origImageData);

      resolve({
        id: `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name: file.name,
        file,
        width,
        height,
        workCanvas,
        origImageData,
        resultImageData: null,
        dirty: true,
        autoDetectedColor: true,
        barrierStrokes: [],
        eraseStrokes: [],
        settings: itemSettings
      });
    };
    img.onerror = (err) => {
      URL.revokeObjectURL(url);
      reject(err);
    };
    img.src = url;
  });
}

async function addFiles(files) {
  if (!files || files.length === 0) return;

  const loaded = [];
  for (const file of files) {
    try {
      loaded.push(await loadImageFile(file));
    } catch (err) {
      console.error('Failed to load image:', file.name, err);
    }
  }

  if (loaded.length === 0) return;

  const wasEmpty = state.items.length === 0;
  state.items.push(...loaded);

  if (wasEmpty && state.items.length > 0) {
    state.activeId = state.items[0].id;
    state.settings.keyColor = state.items[0].settings.keyColor;
    dom.chromaColor.value = state.settings.keyColor;
    dom.chromaColorHex.textContent = state.settings.keyColor;
  }

  updateUI();
  processAllDirtyItems();
}

// --------------------------------------------------------------------------
// Processing Engine
// --------------------------------------------------------------------------

async function processItem(item) {
  const settings = getItemSettings(item);
  const keyColor =
    state.scope === 'all' && !userEditedColor && item.autoDetectedColor
      ? item.settings.keyColor
      : settings.keyColor;

  item.resultImageData = applyChromaKey(item.origImageData, {
    keyColor,
    tolerance: settings.tolerance,
    smoothness: settings.smoothness,
    barrierStrokes: item.barrierStrokes || [],
    eraseStrokes: item.eraseStrokes || []
  });

  item.dirty = false;
  renderGuideOverlay(item);
}

function debounceProcessAll() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    processAllDirtyItems();
  }, 40);
}

async function processAllDirtyItems() {
  const runId = ++processRunId;
  const dirtyItems = state.items.filter((item) => !item.resultImageData || item.dirty);
  if (dirtyItems.length === 0) return;

  dirtyItems.sort((a, b) => {
    if (a.id === state.activeId) return -1;
    if (b.id === state.activeId) return 1;
    return 0;
  });

  for (let i = 0; i < dirtyItems.length; i++) {
    if (runId !== processRunId) return;
    const item = dirtyItems[i];
    try {
      await processItem(item);
    } catch (err) {
      console.error('Error processing photo:', item.name, err);
    }
    if (runId !== processRunId) return;
    renderItemResult(item);

    if (i < dirtyItems.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
}

async function ensureAllProcessed() {
  const pending = state.items.filter((item) => !item.resultImageData || item.dirty);
  if (pending.length === 0) return;

  dom.batchProgress.hidden = false;
  dom.batchProgress.value = 0;

  for (let i = 0; i < pending.length; i++) {
    const item = pending[i];
    await processItem(item);
    renderItemResult(item);
    dom.batchProgress.value = Math.round(((i + 1) / pending.length) * 100);
  }
}

// --------------------------------------------------------------------------
// Canvas Coordinates & Overlay Rendering
// --------------------------------------------------------------------------

function getRenderedImageRect(canvas, item) {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height || !item.width || !item.height) return null;

  const imgAspect = item.width / item.height;
  const boxAspect = rect.width / rect.height;
  let drawW;
  let drawH;
  let offsetX;
  let offsetY;

  if (imgAspect > boxAspect) {
    drawW = rect.width;
    drawH = rect.width / imgAspect;
    offsetX = 0;
    offsetY = (rect.height - drawH) / 2;
  } else {
    drawH = rect.height;
    drawW = rect.height * imgAspect;
    offsetX = (rect.width - drawW) / 2;
    offsetY = 0;
  }

  return {
    left: rect.left + offsetX,
    top: rect.top + offsetY,
    width: drawW,
    height: drawH
  };
}

function pointerToImageCoords(e, canvas, item) {
  const imgRect = getRenderedImageRect(canvas, item);
  if (!imgRect || !imgRect.width || !imgRect.height) return null;

  const x = Math.max(0, Math.min(item.width, ((e.clientX - imgRect.left) * item.width) / imgRect.width));
  const y = Math.max(0, Math.min(item.height, ((e.clientY - imgRect.top) * item.height) / imgRect.height));
  return { x, y };
}

function renderGuideOverlay(item) {
  const ref = cardRefs.get(item.id);
  if (!ref || !ref.guideOverlay) return;

  const overlay = ref.guideOverlay;
  const overlayRect = overlay.getBoundingClientRect();
  const imgRect = getRenderedImageRect(ref.origCanvas, item);
  if (!overlayRect.width || !overlayRect.height || !imgRect) return;

  const dpr = window.devicePixelRatio || 1;
  const targetW = Math.max(1, Math.round(overlayRect.width * dpr));
  const targetH = Math.max(1, Math.round(overlayRect.height * dpr));
  if (overlay.width !== targetW || overlay.height !== targetH) {
    overlay.width = targetW;
    overlay.height = targetH;
  }

  const ctx = overlay.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, overlayRect.width, overlayRect.height);

  const originX = imgRect.left - overlayRect.left;
  const originY = imgRect.top - overlayRect.top;
  const scaleX = imgRect.width / item.width;
  const scaleY = imgRect.height / item.height;

  const drawStroke = (pts, color, widthPx, dashed = false) => {
    if (!pts || pts.length === 0) return;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = widthPx;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (dashed) ctx.setLineDash([4, 4]);

    if (pts.length === 1) {
      ctx.beginPath();
      ctx.arc(originX + pts[0].x * scaleX, originY + pts[0].y * scaleY, widthPx / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.moveTo(originX + pts[0].x * scaleX, originY + pts[0].y * scaleY);
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(originX + pts[i].x * scaleX, originY + pts[i].y * scaleY);
      }
      ctx.stroke();
    }
    ctx.restore();
  };

  (item.barrierStrokes || []).forEach((s) => {
    drawStroke(s.points, 'rgba(17, 17, 17, 0.55)', 2, true);
  });

  if (ref.activeStroke && ref.activeStroke.points.length > 0) {
    if (ref.activeStroke.type === 'close') {
      drawStroke(ref.activeStroke.points, '#111111', 2.5, true);
    } else if (ref.activeStroke.type === 'erase') {
      drawStroke(ref.activeStroke.points, 'rgba(220, 38, 38, 0.65)', Math.max(4, ref.activeStroke.width * scaleX), false);
    }
  }
}

function createPhotoCard(item) {
  const card = document.createElement('article');
  card.className = 'photo-pair-card';
  card.setAttribute('role', 'listitem');
  card.dataset.id = item.id;

  const header = document.createElement('div');
  header.className = 'pair-header';

  const filename = document.createElement('span');
  filename.className = 'pair-filename';
  filename.textContent = item.name;
  filename.title = item.name;

  const actions = document.createElement('div');
  actions.className = 'pair-actions';

  const downloadBtn = document.createElement('button');
  downloadBtn.type = 'button';
  downloadBtn.className = 'btn btn-outline btn-sm';
  downloadBtn.textContent = 'Download PNG';
  downloadBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!item.resultImageData || item.dirty) {
      await processItem(item);
      renderItemResult(item);
    }
    downloadSinglePng(item, TRANSPARENT_BACKDROP);
  });

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'pair-remove-btn';
  removeBtn.setAttribute('aria-label', `Remove ${item.name}`);
  removeBtn.textContent = '×';
  removeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    removeItem(item.id);
  });

  actions.append(downloadBtn, removeBtn);
  header.append(filename, actions);

  const compare = document.createElement('div');
  compare.className = 'pair-compare';

  const origFrame = document.createElement('div');
  origFrame.className = 'canvas-frame';
  const origLabel = document.createElement('span');
  origLabel.className = 'canvas-corner-label';
  origLabel.textContent = 'Original';
  const origCanvas = document.createElement('canvas');
  origCanvas.className = 'pair-canvas';
  origCanvas.width = item.width;
  origCanvas.height = item.height;
  origCanvas.getContext('2d').putImageData(item.origImageData, 0, 0);

  const guideOverlay = document.createElement('canvas');
  guideOverlay.className = 'guide-overlay';
  origFrame.append(origLabel, origCanvas, guideOverlay);

  const resultFrame = document.createElement('div');
  resultFrame.className = 'canvas-frame checkerboard';
  const resultLabel = document.createElement('span');
  resultLabel.className = 'canvas-corner-label';
  resultLabel.textContent = 'Result';
  const resultCanvas = document.createElement('canvas');
  resultCanvas.className = 'pair-canvas';
  resultCanvas.width = item.width;
  resultCanvas.height = item.height;
  resultFrame.append(resultLabel, resultCanvas);

  compare.append(origFrame, resultFrame);
  card.append(header, compare);

  const refObj = {
    card,
    origCanvas,
    guideOverlay,
    resultCanvas,
    activeStroke: null,
    resizeObserver: null
  };

  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => renderGuideOverlay(item));
    ro.observe(origFrame);
    refObj.resizeObserver = ro;
  }

  card.addEventListener('click', () => selectItem(item.id));

  const handleEyedropper = (e, canvas) => {
    const hex = sampleColorAtPointer(e, canvas, item);
    if (!hex) return;

    e.stopPropagation();
    if (state.scope === 'one' && state.activeId !== item.id) {
      selectItem(item.id);
    }
    if (state.scope === 'all') {
      userEditedColor = true;
    }

    dom.chromaColor.value = hex;
    dom.chromaColorHex.textContent = hex;
    applySettingsChange((s) => {
      s.keyColor = hex;
    }, { immediate: true });
  };

  const attachStrokeHandlers = (surface, referenceCanvas) => {
    surface.addEventListener('pointerdown', (e) => {
      if (state.activeTool === 'pick') {
        handleEyedropper(e, referenceCanvas);
        return;
      }

      const pt = pointerToImageCoords(e, referenceCanvas, item);
      if (!pt) return;

      e.stopPropagation();
      e.preventDefault();
      if (state.activeId !== item.id) {
        selectItem(item.id);
      }

      surface.setPointerCapture(e.pointerId);
      const strokeWidth = state.activeTool === 'erase'
        ? Math.max(10, Math.round(Math.max(item.width, item.height) * 0.018))
        : Math.max(4, Math.round(Math.max(item.width, item.height) * 0.005));

      refObj.activeStroke = {
        type: state.activeTool,
        width: strokeWidth,
        points: [pt]
      };
      renderGuideOverlay(item);
    });

    surface.addEventListener('pointermove', (e) => {
      if (!refObj.activeStroke) return;
      const pt = pointerToImageCoords(e, referenceCanvas, item);
      if (!pt) return;

      const pts = refObj.activeStroke.points;
      const last = pts[pts.length - 1];
      const dx = pt.x - last.x;
      const dy = pt.y - last.y;
      if (dx * dx + dy * dy >= 4) {
        pts.push(pt);
        renderGuideOverlay(item);
      }
    });

    const finishStroke = async (e) => {
      if (!refObj.activeStroke) return;
      const stroke = refObj.activeStroke;
      refObj.activeStroke = null;
      if (surface.hasPointerCapture && surface.hasPointerCapture(e.pointerId)) {
        surface.releasePointerCapture(e.pointerId);
      }

      if (stroke.points.length >= 1) {
        if (stroke.type === 'close') {
          item.barrierStrokes = item.barrierStrokes || [];
          item.barrierStrokes.push({ points: stroke.points, width: stroke.width });
        } else if (stroke.type === 'erase') {
          item.eraseStrokes = item.eraseStrokes || [];
          item.eraseStrokes.push({ points: stroke.points, width: stroke.width });
        }
        item.dirty = true;
        renderGuideOverlay(item);
        updateClearStrokesButton();
        await processItem(item);
        renderItemResult(item);
      } else {
        renderGuideOverlay(item);
      }
    };

    surface.addEventListener('pointerup', finishStroke);
    surface.addEventListener('pointercancel', finishStroke);
  };

  attachStrokeHandlers(guideOverlay, origCanvas);
  attachStrokeHandlers(resultCanvas, resultCanvas);

  return refObj;
}

function renderItemResult(item) {
  const ref = cardRefs.get(item.id);
  if (!ref) return;

  const ctx = ref.resultCanvas.getContext('2d');
  ctx.clearRect(0, 0, item.width, item.height);
  ctx.putImageData(item.resultImageData || item.origImageData, 0, 0);
}

function syncPhotoFeedDOM() {
  if (state.items.length === 0) {
    dom.emptyDropzone.hidden = false;
    dom.photoFeed.hidden = true;
    dom.photoFeed.innerHTML = '';
    cardRefs.clear();
    return;
  }

  dom.emptyDropzone.hidden = true;
  dom.photoFeed.hidden = false;

  const currentIds = new Set(state.items.map((item) => item.id));
  for (const [id, ref] of cardRefs.entries()) {
    if (!currentIds.has(id)) {
      ref.resizeObserver?.disconnect();
      ref.card.remove();
      cardRefs.delete(id);
    }
  }

  state.items.forEach((item) => {
    let ref = cardRefs.get(item.id);
    if (!ref) {
      ref = createPhotoCard(item);
      cardRefs.set(item.id, ref);
      dom.photoFeed.appendChild(ref.card);
      renderItemResult(item);
      requestAnimationFrame(() => renderGuideOverlay(item));
    }
    ref.card.classList.toggle('active', item.id === state.activeId);
  });
}

function updateClearStrokesButton() {
  const active = getActiveItem();
  const hasStrokes = Boolean(
    active &&
    ((active.barrierStrokes && active.barrierStrokes.length > 0) ||
      (active.eraseStrokes && active.eraseStrokes.length > 0))
  );
  dom.btnClearStrokes.disabled = !hasStrokes;
  dom.btnClearStrokes.hidden = !hasStrokes;
}

function updateToolCursor() {
  dom.photoFeed.classList.toggle('eyedropper-active', state.activeTool === 'pick');
  dom.photoFeed.classList.toggle('draw-active', state.activeTool === 'close' || state.activeTool === 'erase');
}

function updateUI() {
  const count = state.items.length;
  dom.controlsPanel.hidden = count === 0;
  dom.btnDownloadZip.hidden = count === 0;
  dom.btnDownloadZip.disabled = count === 0;
  dom.scopeGroup.hidden = count <= 1;
  dom.btnDownloadOne.disabled = count === 0;

  updateClearStrokesButton();
  updateToolCursor();
  syncPhotoFeedDOM();
}

function selectItem(id) {
  if (state.activeId === id) return;
  state.activeId = id;
  const item = getActiveItem();
  if (item) {
    if (state.scope === 'one') {
      syncControlsToSettings(item.settings);
    } else if (!userEditedColor && item.autoDetectedColor) {
      dom.chromaColor.value = item.settings.keyColor;
      dom.chromaColorHex.textContent = item.settings.keyColor;
    }
  }
  updateUI();
  if (item && (!item.resultImageData || item.dirty)) {
    processAllDirtyItems();
  }
}

function removeItem(id) {
  const index = state.items.findIndex((item) => item.id === id);
  if (index === -1) return;

  state.items.splice(index, 1);
  if (state.items.length === 0) {
    userEditedColor = false;
  }
  if (state.activeId === id) {
    state.activeId = state.items.length > 0 ? state.items[Math.max(0, index - 1)].id : null;
  }

  const active = getActiveItem();
  if (active && state.scope === 'one') {
    syncControlsToSettings(active.settings);
  }

  updateUI();
  if (active && (!active.resultImageData || active.dirty)) {
    processAllDirtyItems();
  }
}

function syncControlsToSettings(settings) {
  dom.chromaColor.value = settings.keyColor;
  dom.chromaColorHex.textContent = settings.keyColor;
  dom.chromaTolerance.value = settings.tolerance;
  dom.chromaToleranceVal.textContent = `${settings.tolerance}%`;
  dom.chromaSmoothness.value = settings.smoothness;
  dom.chromaSmoothnessVal.textContent = `${settings.smoothness}%`;

  initSliders();
  updateToolCursor();
}

// --------------------------------------------------------------------------
// Scope, Tool & Eyedropper
// --------------------------------------------------------------------------

function setScope(scope) {
  if (state.scope === scope) return;
  state.scope = scope;

  document.querySelectorAll('.scope-tab').forEach((btn) => {
    const active = btn.dataset.scope === scope;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-checked', active ? 'true' : 'false');
  });

  const activeItem = getActiveItem();
  if (scope === 'all') {
    if (activeItem) {
      state.settings = cloneSettings(activeItem.settings);
    }
    state.items.forEach((item) => {
      item.settings = cloneSettings(state.settings);
      if (item.id !== state.activeId) {
        item.dirty = true;
      }
    });
    processAllDirtyItems();
  } else if (activeItem) {
    syncControlsToSettings(activeItem.settings);
  }
}

function setActiveTool(tool) {
  state.activeTool = tool === 'close' || tool === 'erase' ? tool : 'pick';

  const tools = [
    [dom.toolPick, 'pick'],
    [dom.toolClose, 'close'],
    [dom.toolErase, 'erase']
  ];
  tools.forEach(([btn, name]) => {
    const active = state.activeTool === name;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });

  updateToolCursor();
}

function sampleColorAtPointer(e, canvas, item) {
  if (!item) return null;

  const rect = getRenderedImageRect(canvas, item);
  if (!rect || !rect.width || !rect.height) return null;

  const px = Math.floor(((e.clientX - rect.left) * item.width) / rect.width);
  const py = Math.floor(((e.clientY - rect.top) * item.height) / rect.height);

  if (px < 0 || px >= item.width || py < 0 || py >= item.height) {
    return null;
  }

  const idx = (py * item.width + px) * 4;
  return rgbToHex(
    item.origImageData.data[idx],
    item.origImageData.data[idx + 1],
    item.origImageData.data[idx + 2]
  );
}

// --------------------------------------------------------------------------
// Event Listeners
// --------------------------------------------------------------------------

function setupEventListeners() {
  dom.fileInput.addEventListener('change', (e) => {
    addFiles(Array.from(e.target.files));
    e.target.value = '';
  });

  dom.fileInputDz.addEventListener('change', (e) => {
    addFiles(Array.from(e.target.files));
    e.target.value = '';
  });

  dom.emptyDropzone.addEventListener('click', (e) => {
    if (e.target.closest('label, input')) return;
    dom.fileInputDz.click();
  });

  dom.emptyDropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      dom.fileInputDz.click();
    }
  });

  dom.emptyDropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dom.emptyDropzone.classList.add('dragover');
  });

  dom.emptyDropzone.addEventListener('dragleave', () => {
    dom.emptyDropzone.classList.remove('dragover');
  });

  dom.emptyDropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dom.emptyDropzone.classList.remove('dragover');
    if (e.dataTransfer && e.dataTransfer.files) {
      addFiles(Array.from(e.dataTransfer.files));
    }
  });

  document.querySelectorAll('.scope-tab').forEach((btn) => {
    btn.addEventListener('click', () => setScope(btn.dataset.scope));
  });

  dom.chromaColor.addEventListener('input', (e) => {
    const hex = e.target.value;
    if (state.scope === 'all') userEditedColor = true;
    dom.chromaColorHex.textContent = hex;
    applySettingsChange((s) => {
      s.keyColor = hex;
    });
  });

  dom.toolPick.addEventListener('click', () => setActiveTool('pick'));
  dom.toolClose.addEventListener('click', () => setActiveTool('close'));
  dom.toolErase.addEventListener('click', () => setActiveTool('erase'));

  dom.btnClearStrokes.addEventListener('click', async () => {
    const active = getActiveItem();
    if (!active) return;
    active.barrierStrokes = [];
    active.eraseStrokes = [];
    active.dirty = true;
    renderGuideOverlay(active);
    updateClearStrokesButton();
    await processItem(active);
    renderItemResult(active);
  });

  document.querySelectorAll('.swatch-btn').forEach((swatch) => {
    swatch.addEventListener('click', () => {
      const color = swatch.dataset.color;
      if (state.scope === 'all') userEditedColor = true;
      dom.chromaColor.value = color;
      dom.chromaColorHex.textContent = color;
      applySettingsChange((s) => {
        s.keyColor = color;
      }, { immediate: true });
    });
  });

  dom.chromaTolerance.addEventListener('input', (e) => {
    const val = parseInt(e.target.value, 10);
    dom.chromaToleranceVal.textContent = `${val}%`;
    applySettingsChange((s) => {
      s.tolerance = val;
    });
  });

  dom.chromaSmoothness.addEventListener('input', (e) => {
    const val = parseInt(e.target.value, 10);
    dom.chromaSmoothnessVal.textContent = `${val}%`;
    applySettingsChange((s) => {
      s.smoothness = val;
    });
  });

  dom.btnDownloadOne.addEventListener('click', async () => {
    const item = getActiveItem();
    if (!item) return;
    if (!item.resultImageData || item.dirty) {
      await processItem(item);
      renderItemResult(item);
    }
    downloadSinglePng(item, TRANSPARENT_BACKDROP);
  });

  dom.btnDownloadZip.addEventListener('click', async () => {
    if (state.items.length === 0) return;
    dom.btnDownloadZip.disabled = true;
    dom.batchProgress.hidden = false;
    dom.batchProgress.value = 0;

    try {
      await ensureAllProcessed();
      await downloadAllPngs(state.items, TRANSPARENT_BACKDROP, (progress) => {
        if (progress && typeof progress.current === 'number' && progress.total) {
          dom.batchProgress.value = Math.round((progress.current / progress.total) * 100);
        } else if (typeof progress === 'number') {
          dom.batchProgress.value = progress <= 1 ? Math.round(progress * 100) : Math.round(progress);
        }
      });
    } catch (err) {
      console.error('PNG batch export error:', err);
    } finally {
      dom.btnDownloadZip.disabled = state.items.length === 0;
      setTimeout(() => {
        dom.batchProgress.hidden = true;
      }, 1000);
    }
  });

  if (canShareFiles()) {
    dom.btnShareAll.hidden = false;
    dom.btnShareAll.addEventListener('click', async () => {
      if (state.items.length === 0) return;
      dom.btnShareAll.disabled = true;
      try {
        await ensureAllProcessed();
        await shareBatchFiles(state.items, TRANSPARENT_BACKDROP);
      } catch (err) {
        if (err.name !== 'AbortError') {
          console.error('Share error:', err);
        }
      } finally {
        dom.btnShareAll.disabled = false;
        dom.batchProgress.hidden = true;
      }
    });
  }
}

function initApp() {
  initSliders();
  setupEventListeners();
  updateUI();
}

window.addEventListener('DOMContentLoaded', initApp);
