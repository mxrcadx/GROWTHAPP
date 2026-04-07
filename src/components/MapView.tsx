import { useEffect, useRef, useCallback, useState } from 'react';
import { useStore } from '../store';
import { themeColor } from '../utils/colors';
import type { CellData, GrowthCellDataFile, GrowthAdjacencyFile, ColorTheme } from '../types';

// Module-level data cache
let cellDataCache: Record<string, CellData> | null = null;
let adjacencyCache: Record<string, string[]> | null = null;
let coastlineData: { lines: [number, number][][] } | null = null;
let terrainImage: HTMLImageElement | null = null;
let terrainMeta: { left: number; bottom: number; right: number; top: number } | null = null;
let clippedTerrainCanvas: HTMLCanvasElement | null = null;
let icelandImage: HTMLImageElement | null = null;
let icelandMeta: { left: number; bottom: number; right: number; top: number } | null = null;

export function getCellData() { return cellDataCache; }
export function getAdjacency() { return adjacencyCache; }

// Module-level blend value — written by animation loop, read by renderer (avoids 60 store writes/sec)
let _phaseBlend = 0;
export function setPhaseBlendDirect(v: number) { _phaseBlend = v; }
export function getPhaseBlend() { return _phaseBlend; }

// Coordinate bounds
let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

type ProjectFn = (wx: number, wy: number, wz: number) => [number, number];

const HALF = 250;
const GAP = 10;
const DRAW_HALF = HALF - GAP;

// ====================== COASTLINE CLIP ======================

function buildClippedTerrain() {
  if (!terrainImage || !terrainMeta || !coastlineData) return;
  const cw = terrainImage.width;
  const ch = terrainImage.height;
  const offCanvas = document.createElement('canvas');
  offCanvas.width = cw;
  offCanvas.height = ch;
  const ctx = offCanvas.getContext('2d')!;

  const m = terrainMeta;
  const toPixX = (wx: number) => ((wx - m.left) / (m.right - m.left)) * cw;
  const toPixY = (wy: number) => ((m.top - wy) / (m.top - m.bottom)) * ch;

  ctx.beginPath();
  for (const line of coastlineData.lines) {
    if (line.length < 3) continue;
    ctx.moveTo(toPixX(line[0][0]), toPixY(line[0][1]));
    for (let i = 1; i < line.length; i++) {
      ctx.lineTo(toPixX(line[i][0]), toPixY(line[i][1]));
    }
    ctx.closePath();
  }
  ctx.clip();
  ctx.drawImage(terrainImage, 0, 0);

  clippedTerrainCanvas = offCanvas;
}

// ====================== PROJECTION ======================

function makePlanProject(vw: number, vh: number, cx: number, cy: number, scale: number): ProjectFn {
  const ox = vw / 2 - cx * scale;
  const oy = vh / 2 + cy * scale;
  return (wx, wy, _wz) => [wx * scale + ox, -wy * scale + oy];
}

// ====================== RENDER ENGINE ======================

function renderViewport(
  ctx: CanvasRenderingContext2D,
  vw: number, vh: number,
  project: ProjectFn,
  showTerrain: boolean,
  transparentBg: boolean = false,
  showLabels: boolean = true,
  colorTheme: ColorTheme = 'age',
) {
  if (!cellDataCache) return;

  const store = useStore.getState();
  const snapshot = store.phases.length > 0 && store.currentPhase < store.phases.length
    ? store.phases[store.currentPhase] : null;
  const nextSnapshot = store.phases.length > 0 && store.currentPhase + 1 < store.phases.length
    ? store.phases[store.currentPhase + 1] : null;
  const blend = _phaseBlend; // 0-1 fractional interpolation (set directly by animation loop)
  const maxAge = store.currentPhase;
  const scale = store.viewScale;
  const cellPx = DRAW_HALF * scale;

  // Background
  if (transparentBg) {
    ctx.clearRect(0, 0, vw, vh);
  } else {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, vw, vh);
  }

  // Full-Iceland terrain (dim background layer)
  if (icelandImage && icelandMeta) {
    const [tlx, tly] = project(icelandMeta.left, icelandMeta.top, 0);
    const [brx, bry] = project(icelandMeta.right, icelandMeta.bottom, 0);
    ctx.globalAlpha = 0.6;
    ctx.drawImage(icelandImage, tlx, tly, brx - tlx, bry - tly);
    ctx.globalAlpha = 1.0;
  }

  // Study area terrain (bright, clipped)
  if (showTerrain && terrainMeta) {
    const src = clippedTerrainCanvas || terrainImage;
    if (src) {
      const [tlx, tly] = project(terrainMeta.left, terrainMeta.top, 0);
      const [brx, bry] = project(terrainMeta.right, terrainMeta.bottom, 0);
      ctx.drawImage(src, tlx, tly, brx - tlx, bry - tly);
    }
  }

  // Coastline
  if (coastlineData) {
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1.2;
    for (const line of coastlineData.lines) {
      if (line.length < 2) continue;
      ctx.beginPath();
      const [sx0, sy0] = project(line[0][0], line[0][1], 0);
      ctx.moveTo(sx0, sy0);
      for (let i = 1; i < line.length; i++) {
        const [sx, sy] = project(line[i][0], line[i][1], 0);
        ctx.lineTo(sx, sy);
      }
      ctx.stroke();
    }
  }

  // Coordinate grid — grid lines move with map, labels pinned to viewport edges
  {
    const stepCandidates = [1000, 2000, 5000, 10000, 20000, 50000];
    let gridStep = stepCandidates[stepCandidates.length - 1];
    for (const s of stepCandidates) {
      if (s * scale >= 80) { gridStep = s; break; }
    }

    const ox = vw / 2 - store.viewCenterX * scale;
    const oy = vh / 2 + store.viewCenterY * scale;
    const visMinWX = (0 - ox) / scale;
    const visMaxWX = (vw - ox) / scale;
    const visMaxWY = -(0 - oy) / scale;
    const visMinWY = -(vh - oy) / scale;

    const gridStartX = Math.floor(visMinWX / gridStep) * gridStep;
    const gridEndX = Math.ceil(visMaxWX / gridStep) * gridStep;
    const gridStartY = Math.floor(visMinWY / gridStep) * gridStep;
    const gridEndY = Math.ceil(visMaxWY / gridStep) * gridStep;

    const RULER_H = 16; // bottom ruler
    const RULER_W = 50; // right ruler (moved from left to right per Figma)

    // Grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 0.5;
    ctx.setLineDash([4, 8]);
    for (let x = gridStartX; x <= gridEndX; x += gridStep) {
      const [sx] = project(x, 0, 0);
      ctx.beginPath();
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, vh);
      ctx.stroke();
    }
    for (let y = gridStartY; y <= gridEndY; y += gridStep) {
      const [, sy] = project(0, y, 0);
      ctx.beginPath();
      ctx.moveTo(0, sy);
      ctx.lineTo(vw, sy);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Ruler backgrounds — top edge for easting, right edge for northing
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 0, vw, RULER_H); // top ruler
    ctx.fillRect(vw - RULER_W, RULER_H, RULER_W, vh - RULER_H); // right ruler

    // Easting labels — pinned to top edge
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.font = '10px "ABC Diatype", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let x = gridStartX; x <= gridEndX; x += gridStep) {
      const [sx] = project(x, 0, 0);
      if (sx > 10 && sx < vw - RULER_W - 10) {
        ctx.fillText(`${(x / 1000).toFixed(0)}`, sx, 3);
      }
    }

    // Northing labels — pinned to right edge
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (let y = gridStartY; y <= gridEndY; y += gridStep) {
      const [, sy] = project(0, y, 0);
      if (sy > RULER_H + 10 && sy < vh - 10) {
        ctx.fillText(`${(y / 1000).toFixed(0)}`, vw - RULER_W + 6, sy);
      }
    }

    // Corner unit label
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.font = '8px "ABC Diatype", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('km', vw - RULER_W / 2, RULER_H / 2);
  }

  // Base grid cells
  for (const [, c] of Object.entries(cellDataCache)) {
    const [sx, sy] = project(c.cx, c.cy, 0);
    if (sx + cellPx < 0 || sx - cellPx > vw || sy + cellPx < 0 || sy - cellPx > vh) continue;
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 0.5;
    ctx.strokeRect(sx - cellPx, sy - cellPx, cellPx * 2, cellPx * 2);
  }

  // Occupied cells — with interpolation between phases for smooth animation
  if (snapshot) {
    // Collect all cell IDs from current and next phase for blending
    const allIds = new Set(Object.keys(snapshot.occupied));
    if (nextSnapshot && blend > 0) {
      for (const id of Object.keys(nextSnapshot.occupied)) allIds.add(id);
    }

    for (const id of allIds) {
      const c = cellDataCache![id];
      if (!c) continue;

      const currData = snapshot.occupied[id];
      const nextData = nextSnapshot?.occupied[id];

      // Determine effective levels and age
      let levels: number;
      let age: number;
      let cellAlpha = 1;

      if (currData && nextData) {
        // Cell exists in both — interpolate
        levels = currData.levels;
        age = currData.age;
      } else if (currData && !nextData) {
        // Cell being shed — fade out
        levels = currData.levels;
        age = currData.age;
        cellAlpha = 1 - blend;
      } else if (!currData && nextData) {
        // Cell being added — fade in
        levels = nextData.levels;
        age = nextData.age;
        cellAlpha = blend;
      } else {
        continue;
      }

      if (levels === 0) {
        if (cellAlpha < 0.1) continue;
        const [sx, sy] = project(c.cx, c.cy, 0);
        ctx.strokeStyle = `rgba(255,255,255,${0.06 * cellAlpha})`;
        ctx.lineWidth = 0.5;
        ctx.strokeRect(sx - cellPx, sy - cellPx, cellPx * 2, cellPx * 2);
        continue;
      }

      const [r, g, b, a] = themeColor(colorTheme, age, maxAge, c, levels, store.maxLevels);
      const baseAlpha = (a / 255) * cellAlpha;

      const [sx, sy] = project(c.cx, c.cy, 0);
      if (sx + cellPx * 2 < 0 || sx - cellPx * 2 > vw || sy + cellPx * 2 < 0 || sy - cellPx * 2 > vh) continue;
      ctx.fillStyle = `rgba(${r},${g},${b},${baseAlpha.toFixed(3)})`;
      ctx.fillRect(sx - cellPx, sy - cellPx, cellPx * 2, cellPx * 2);
      ctx.strokeStyle = `rgba(${Math.min(255, r + 60)},${Math.min(255, g + 60)},${Math.min(255, b + 60)},${(0.3 * cellAlpha).toFixed(3)})`;
      ctx.lineWidth = 0.5;
      ctx.strokeRect(sx - cellPx, sy - cellPx, cellPx * 2, cellPx * 2);
      if (levels > 1 && cellAlpha > 0.5) {
        ctx.fillStyle = `rgba(255,255,255,${cellAlpha.toFixed(2)})`;
        ctx.font = `${Math.max(7, cellPx * 0.8)}px "ABC Diatype Mono", monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${levels}`, sx, sy);
      }
    }
  }

  // Seed/target markers
  if (showLabels) {
    if (store.seedId && cellDataCache![store.seedId]) {
      const c = cellDataCache![store.seedId];
      const [sx, sy] = project(c.cx, c.cy, 0);
      ctx.fillStyle = '#FF0000';
      ctx.fillRect(sx - 5, sy - 5, 10, 10);
      ctx.font = '11px "ABC Diatype", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText('SEED', sx, sy - 12);
    }
    if (store.targetId && cellDataCache![store.targetId]) {
      const c = cellDataCache![store.targetId];
      const [sx, sy] = project(c.cx, c.cy, 0);
      ctx.fillStyle = '#FF0000';
      ctx.fillRect(sx - 5, sy - 5, 10, 10);
      ctx.font = '11px "ABC Diatype", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText('TARGET', sx, sy - 12);
    }
    if (store.seedId && store.targetId && cellDataCache![store.seedId] && cellDataCache![store.targetId]) {
      const s = cellDataCache![store.seedId], t = cellDataCache![store.targetId];
      const [sx1, sy1] = project(s.cx, s.cy, 0);
      const [sx2, sy2] = project(t.cx, t.cy, 0);
      ctx.strokeStyle = 'rgba(255,0,0,0.3)';
      ctx.lineWidth = 1;
      ctx.setLineDash([8, 6]);
      ctx.beginPath();
      ctx.moveTo(sx1, sy1);
      ctx.lineTo(sx2, sy2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
}

// ====================== PUBLIC RENDER API ======================

export function renderPlanToCanvas(canvas: HTMLCanvasElement, _phaseIndex: number) {
  if (!cellDataCache) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  const dataW = maxX - minX + 4000;
  const dataH = maxY - minY + 4000;
  const fitScale = Math.min(w / dataW, h / dataH);
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const proj = makePlanProject(w, h, centerX, centerY, fitScale);
  renderViewport(ctx, w, h, proj, false, true, false);
}

// ====================== MAIN COMPONENT ======================

export default function MapView() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderRef = useRef<(() => void) | null>(null);

  const dragRef = useRef<{ dragging: boolean; lastX: number; lastY: number }>({
    dragging: false, lastX: 0, lastY: 0,
  });

  // Only subscribe to fields that affect React rendering decisions (not canvas rendering)
  const setDataLoaded = useStore(s => s.setDataLoaded);
  const setSeedId = useStore(s => s.setSeedId);
  const setTargetId = useStore(s => s.setTargetId);
  const setPlacementMode = useStore(s => s.setPlacementMode);
  const playing = useStore(s => s.playing);
  // These trigger static re-render when not playing
  const currentPhase = useStore(s => s.currentPhase);
  const seedId = useStore(s => s.seedId);
  const targetId = useStore(s => s.targetId);
  const phases = useStore(s => s.phases);
  const colorTheme = useStore(s => s.colorTheme);
  const viewCenterX = useStore(s => s.viewCenterX);
  const viewCenterY = useStore(s => s.viewCenterY);
  const viewScale = useStore(s => s.viewScale);

  const [ready, setReady] = useState(false);
  const [gridInfo, setGridInfo] = useState<{
    cellCount: number; eMin: number; eMax: number; nMin: number; nMax: number;
  } | null>(null);

  // Load data
  useEffect(() => {
    Promise.all([
      fetch('/data/growth_cell_data_500m.json').then(r => r.json()) as Promise<GrowthCellDataFile>,
      fetch('/data/growth_adjacency_500m.json').then(r => r.json()) as Promise<GrowthAdjacencyFile>,
      fetch('/data/coastline_3057.json').then(r => r.json()).catch(() => null),
      fetch('/data/terrain_meta.json').then(r => r.json()).catch(() => null),
      fetch('/data/iceland_hillshade_meta.json').then(r => r.json()).catch(() => null),
    ]).then(([cellFile, adjFile, coast, tMeta, iMeta]) => {
      cellDataCache = cellFile.cells;
      adjacencyCache = adjFile;
      coastlineData = coast;
      terrainMeta = tMeta;

      // Load study area terrain
      if (tMeta) {
        const img = new Image();
        img.onload = () => {
          terrainImage = img;
          buildClippedTerrain();
          renderRef.current?.();
        };
        img.src = '/data/terrain_hillshade.png';
      }

      // Load full-Iceland terrain
      if (iMeta) {
        icelandMeta = iMeta.bounds;
        const img = new Image();
        img.onload = () => {
          icelandImage = img;
          renderRef.current?.();
        };
        img.src = '/data/iceland_hillshade.png';
      }

      for (const c of Object.values(cellFile.cells)) {
        if (c.cx < minX) minX = c.cx;
        if (c.cx > maxX) maxX = c.cx;
        if (c.cy < minY) minY = c.cy;
        if (c.cy > maxY) maxY = c.cy;
      }

      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      const dataW = maxX - minX + 4000;
      const dataH = maxY - minY + 4000;
      // Keep the store's initial Iceland-wide view; don't override with study-area fit

      setGridInfo({
        cellCount: Object.keys(cellFile.cells).length,
        eMin: minX, eMax: maxX, nMin: minY, nMax: maxY,
      });
      setDataLoaded(true);
      setReady(true);
    });
  }, []);

  // Render function (reads all state from store, no closures over React state)
  const renderFrame = useCallback(() => {
    const store = useStore.getState();
    const { viewCenterX: cx, viewCenterY: cy, viewScale: scale } = store;
    const canvasEl = canvasRef.current;
    if (!canvasEl || !cellDataCache) return;
    const rect = canvasEl.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const dpr = devicePixelRatio;
    canvasEl.width = rect.width * dpr;
    canvasEl.height = rect.height * dpr;
    const ctx = canvasEl.getContext('2d')!;
    ctx.scale(dpr, dpr);
    const proj = makePlanProject(rect.width, rect.height, cx, cy, scale);
    renderViewport(ctx, rect.width, rect.height, proj, true, false, true, store.colorTheme);
  }, []);

  // Store render function ref
  useEffect(() => {
    renderRef.current = renderFrame;
    return () => { renderRef.current = null; };
  }, [renderFrame]);

  // Continuous rAF loop when playing — runs independently of React state changes
  useEffect(() => {
    if (!ready || !playing) return;
    let rafId: number;
    const loop = () => {
      renderFrame();
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [ready, playing, renderFrame]);

  // Static render when not playing — re-render on relevant state changes
  useEffect(() => {
    if (!ready || playing) return;
    renderFrame();
  }, [ready, playing, currentPhase, phases, seedId, targetId, viewCenterX, viewCenterY, viewScale, colorTheme]);

  // Zoom
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const store = useStore.getState();
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    const newScale = store.viewScale * factor;

    const canvas = canvasRef.current;
    if (canvas) {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const ox = rect.width / 2 - store.viewCenterX * store.viewScale;
      const oy = rect.height / 2 + store.viewCenterY * store.viewScale;
      const wx = (mx - ox) / store.viewScale;
      const wy = -(my - oy) / store.viewScale;
      const ncx = wx + (store.viewCenterX - wx) / factor;
      const ncy = wy + (store.viewCenterY - wy) / factor;
      store.setView(ncx, ncy, newScale);
      renderRef.current?.();
      return;
    }
    store.setView(store.viewCenterX, store.viewCenterY, newScale);
    renderRef.current?.();
  }, []);

  // Pan
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 1 || e.button === 2 || (e.button === 0 && e.altKey)) {
      dragRef.current = { dragging: true, lastX: e.clientX, lastY: e.clientY };
      e.preventDefault();
    }
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const d = dragRef.current;
    if (!d.dragging) return;
    const store = useStore.getState();
    const dx = e.clientX - d.lastX;
    const dy = e.clientY - d.lastY;
    d.lastX = e.clientX;
    d.lastY = e.clientY;
    const wcx = store.viewCenterX - dx / store.viewScale;
    const wcy = store.viewCenterY + dy / store.viewScale;
    store.setView(wcx, wcy, store.viewScale);
    renderRef.current?.();
  }, []);

  const handleMouseUp = useCallback(() => {
    dragRef.current.dragging = false;
  }, []);

  // Click to place seed/target
  const handlePlanClick = useCallback((e: React.MouseEvent) => {
    if (!cellDataCache) return;
    const pm = useStore.getState().placementMode;
    if (pm === 'none') return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const store = useStore.getState();
    const proj = makePlanProject(rect.width, rect.height, store.viewCenterX, store.viewCenterY, store.viewScale);
    const cellScreenSize = HALF * store.viewScale;

    for (const [id, c] of Object.entries(cellDataCache)) {
      const [sx, sy] = proj(c.cx, c.cy, 0);
      if (mx >= sx - cellScreenSize && mx <= sx + cellScreenSize &&
          my >= sy - cellScreenSize && my <= sy + cellScreenSize) {
        if (pm === 'seed') {
          setSeedId(id);
          setPlacementMode('target');
        } else if (pm === 'target') {
          setTargetId(id);
          setPlacementMode('none');
        }
        return;
      }
    }
  }, [setSeedId, setTargetId, setPlacementMode]);

  const pm = useStore(s => s.placementMode);

  return (
    <canvas
      ref={canvasRef}
      onClick={handlePlanClick}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        position: 'absolute',
        top: 0, left: 0, right: 0, bottom: 0,
        width: '100%',
        height: '100%',
        display: 'block',
        cursor: pm !== 'none' ? 'crosshair' : 'grab',
      }}
    />
  );
}
