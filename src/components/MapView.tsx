import { useEffect, useRef, useCallback, useState } from 'react';
import { useStore } from '../store';
import { ageColor } from '../utils/colors';
import type { CellData, GrowthCellDataFile, GrowthAdjacencyFile } from '../types';

// Module-level data cache
let cellDataCache: Record<string, CellData> | null = null;
let adjacencyCache: Record<string, string[]> | null = null;
let coastlineData: { lines: [number, number][][] } | null = null;
let terrainImage: HTMLImageElement | null = null;
let terrainMeta: { left: number; bottom: number; right: number; top: number } | null = null;
let clippedTerrainCanvas: HTMLCanvasElement | null = null; // ocean-clipped terrain

export function getCellData() { return cellDataCache; }
export function getAdjacency() { return adjacencyCache; }

// Coordinate bounds
let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

// Projection types
type ProjectFn = (wx: number, wy: number, wz: number) => [number, number];

const HALF = 250; // half cell size in world units (500m grid)
const GAP = 10; // 10m inset per side = 20m gap between cells
const DRAW_HALF = HALF - GAP; // rendered half-size with gap
const LEVEL_H = 1000; // extrusion height per level in world units

// ====================== COASTLINE CLIP ======================

/** Pre-render terrain clipped to coastline boundary (removes grey ocean) */
function buildClippedTerrain() {
  if (!terrainImage || !terrainMeta || !coastlineData) return;
  const cw = terrainImage.width;
  const ch = terrainImage.height;
  const offCanvas = document.createElement('canvas');
  offCanvas.width = cw;
  offCanvas.height = ch;
  const ctx = offCanvas.getContext('2d')!;

  // Map world coords to pixel coords in the terrain image
  const m = terrainMeta;
  const toPixX = (wx: number) => ((wx - m.left) / (m.right - m.left)) * cw;
  const toPixY = (wy: number) => ((m.top - wy) / (m.top - m.bottom)) * ch;

  // Build clip path from coastline polygons
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

// ====================== PROJECTION FUNCTIONS ======================

function makePlanProject(vw: number, vh: number, cx: number, cy: number, scale: number): ProjectFn {
  const ox = vw / 2 - cx * scale;
  const oy = vh / 2 + cy * scale;
  return (wx, wy, _wz) => [wx * scale + ox, -wy * scale + oy];
}

function makeIsoProject(
  vw: number, vh: number, cx: number, cy: number, scale: number,
  rotZDeg: number, rotXDeg: number,
): ProjectFn {
  const rotZ = rotZDeg * Math.PI / 180;
  const rotX = rotXDeg * Math.PI / 180;
  const cosZ = Math.cos(rotZ), sinZ = Math.sin(rotZ);
  const cosX = Math.cos(rotX), sinX = Math.sin(rotX);
  const screenCX = vw / 2;
  const screenCY = vh / 2;
  return (wx, wy, wz) => {
    const x = wx - cx;
    const y = wy - cy;
    const x1 = x * cosZ - y * sinZ;
    const y1 = x * sinZ + y * cosZ;
    const y2 = y1 * cosX - wz * sinX;
    return [x1 * scale + screenCX, -y2 * scale + screenCY];
  };
}

function makeElevProject(vw: number, vh: number, cx: number, cy: number, scale: number): ProjectFn {
  const screenCX = vw / 2;
  const screenCY = vh * 0.8;
  return (wx, _wy, wz) => {
    const x = wx - cx;
    return [x * scale + screenCX, -wz * scale + screenCY];
  };
}

// ====================== RENDER ENGINE ======================

function renderViewport(
  ctx: CanvasRenderingContext2D,
  vw: number, vh: number,
  project: ProjectFn,
  mode: 'plan' | 'iso' | 'elev',
  showTerrain: boolean,
  transparentBg: boolean = false,
  showLabels: boolean = true,
) {
  if (!cellDataCache) return;

  const store = useStore.getState();
  const snapshot = store.phases.length > 0 && store.currentPhase < store.phases.length
    ? store.phases[store.currentPhase] : null;
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

  // Terrain (plan only) — use clipped version to remove ocean
  if (showTerrain && terrainMeta && mode === 'plan') {
    const src = clippedTerrainCanvas || terrainImage;
    if (src) {
      const [tlx, tly] = project(terrainMeta.left, terrainMeta.top, 0);
      const [brx, bry] = project(terrainMeta.right, terrainMeta.bottom, 0);
      ctx.drawImage(src, tlx, tly, brx - tlx, bry - tly);
    }
  }

  // Coastline
  if (coastlineData && mode !== 'elev') {
    ctx.strokeStyle = mode === 'plan' ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.12)';
    ctx.lineWidth = mode === 'plan' ? 1.2 : 0.8;
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

  // Coordinate grid (plan view) — grid lines move with map, labels pinned to viewport edges
  if (mode === 'plan') {
    // Choose grid step based on zoom: pick the largest step that gives ≥80px spacing
    const stepCandidates = [1000, 2000, 5000, 10000, 20000, 50000];
    let gridStep = stepCandidates[stepCandidates.length - 1];
    for (const s of stepCandidates) {
      if (s * scale >= 80) { gridStep = s; break; }
    }

    // Determine visible world extent from viewport edges
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

    const RULER_W = 50; // left ruler width for northing labels
    const RULER_H = 16; // bottom ruler height for easting labels

    // Draw grid lines (move with map)
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 0.5;
    ctx.setLineDash([4, 8]);
    for (let x = gridStartX; x <= gridEndX; x += gridStep) {
      const [sx] = project(x, 0, 0);
      ctx.beginPath();
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, vh - RULER_H);
      ctx.stroke();
    }
    for (let y = gridStartY; y <= gridEndY; y += gridStep) {
      const [, sy] = project(0, y, 0);
      ctx.beginPath();
      ctx.moveTo(RULER_W, sy);
      ctx.lineTo(vw, sy);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Draw ruler backgrounds (fixed at viewport edges)
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(0, vh - RULER_H, vw, RULER_H); // bottom ruler
    ctx.fillRect(0, 0, RULER_W, vh - RULER_H);  // left ruler

    // Easting tick labels — pinned to bottom edge of viewport
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.font = '10px "ABC Diatype Mono", "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let x = gridStartX; x <= gridEndX; x += gridStep) {
      const [sx] = project(x, 0, 0);
      if (sx > RULER_W + 10 && sx < vw - 20) {
        ctx.fillText(`${(x / 1000).toFixed(0)}`, sx, vh - RULER_H + 3);
      }
    }

    // Northing tick labels — pinned to left edge of viewport
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let y = gridStartY; y <= gridEndY; y += gridStep) {
      const [, sy] = project(0, y, 0);
      if (sy > 10 && sy < vh - RULER_H - 10) {
        ctx.fillText(`${(y / 1000).toFixed(0)}`, RULER_W - 4, sy);
      }
    }

    // Corner unit label
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.font = '8px "ABC Diatype Mono", "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('km', RULER_W / 2, vh - RULER_H / 2);
  }

  // Elevation ground line
  if (mode === 'elev') {
    const [glx] = project(minX - 5000, 0, 0);
    const [grx, gry] = project(maxX + 5000, 0, 0);
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(glx, gry);
    ctx.lineTo(grx, gry);
    ctx.stroke();
  }

  // Base grid cells — transparent fill, visible outline
  const cache = cellDataCache;
  if (mode === 'plan') {
    for (const [, c] of Object.entries(cache)) {
      const [sx, sy] = project(c.cx, c.cy, 0);
      if (sx + cellPx < 0 || sx - cellPx > vw || sy + cellPx < 0 || sy - cellPx > vh) continue;
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 0.5;
      ctx.strokeRect(sx - cellPx, sy - cellPx, cellPx * 2, cellPx * 2);
    }
  } else if (mode === 'iso') {
    for (const [, c] of Object.entries(cache)) {
      drawQuad(ctx, project, c.cx, c.cy, 0, 'transparent', 'rgba(255,255,255,0.06)');
    }
  }

  // Occupied cells
  if (snapshot) {
    let entries = Object.entries(snapshot.occupied);
    if (mode === 'iso') {
      entries = entries
        .filter(([id]) => cache[id])
        .sort(([aId], [bId]) => {
          const ca = cache[aId], cb = cache[bId];
          return (ca.cy - cb.cy) || (ca.cx - cb.cx);
        });
    } else if (mode === 'elev') {
      entries = entries
        .filter(([id]) => cache[id])
        .sort(([aId], [bId]) => cache[bId].cy - cache[aId].cy);
    }

    for (const [id, data] of entries) {
      const c = cache[id];
      if (!c) continue;

      if (data.levels === 0) {
        if (mode === 'plan') {
          const [sx, sy] = project(c.cx, c.cy, 0);
          ctx.strokeStyle = 'rgba(255,255,255,0.06)';
          ctx.lineWidth = 0.5;
          ctx.strokeRect(sx - cellPx, sy - cellPx, cellPx * 2, cellPx * 2);
        }
        continue;
      }

      const [r, g, b, a] = ageColor(data.age, maxAge);
      const baseAlpha = a / 255;

      if (mode === 'plan') {
        const [sx, sy] = project(c.cx, c.cy, 0);
        if (sx + cellPx * 2 < 0 || sx - cellPx * 2 > vw || sy + cellPx * 2 < 0 || sy - cellPx * 2 > vh) continue;
        ctx.shadowColor = `rgb(${r},${g},${b})`;
        ctx.shadowBlur = 6;
        ctx.fillStyle = `rgba(${r},${g},${b},${baseAlpha.toFixed(2)})`;
        ctx.fillRect(sx - cellPx, sy - cellPx, cellPx * 2, cellPx * 2);
        ctx.shadowBlur = 0;
        ctx.strokeStyle = `rgba(${Math.min(255, r + 60)},${Math.min(255, g + 60)},${Math.min(255, b + 60)},0.5)`;
        ctx.lineWidth = 0.5;
        ctx.strokeRect(sx - cellPx, sy - cellPx, cellPx * 2, cellPx * 2);
        if (data.levels > 1) {
          ctx.fillStyle = '#fff';
          ctx.font = `${Math.max(7, cellPx * 0.8)}px "ABC Diatype Mono", monospace`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(`${data.levels}`, sx, sy);
        }
      } else if (mode === 'iso') {
        drawIsoCube(ctx, project, c.cx, c.cy, data.levels, r, g, b, baseAlpha);
      } else if (mode === 'elev') {
        drawElevCube(ctx, project, c.cx, c.cy, data.levels, r, g, b, baseAlpha);
      }
    }
  }

  // Seed/target markers (plan only, not in export)
  if (mode === 'plan' && showLabels) {
    if (store.seedId && cache[store.seedId]) {
      const c = cache[store.seedId];
      const [sx, sy] = project(c.cx, c.cy, 0);
      ctx.fillStyle = '#FF0000';
      ctx.fillRect(sx - 5, sy - 5, 10, 10);
      ctx.font = '11px "ABC Diatype Mono", "Courier New", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText('SEED', sx, sy - 12);
    }
    if (store.targetId && cache[store.targetId]) {
      const c = cache[store.targetId];
      const [sx, sy] = project(c.cx, c.cy, 0);
      ctx.fillStyle = '#FF0000';
      ctx.fillRect(sx - 5, sy - 5, 10, 10);
      ctx.font = '11px "ABC Diatype Mono", "Courier New", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText('TARGET', sx, sy - 12);
    }
    if (store.seedId && store.targetId && cache[store.seedId] && cache[store.targetId]) {
      const s = cache[store.seedId], t = cache[store.targetId];
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

  // View label
  if (showLabels) {
    ctx.fillStyle = '#555';
    ctx.font = '11px "ABC Diatype Mono", "Courier New", monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    const labels: Record<string, string> = {
      plan: 'PLAN VIEW — ISN93 / EPSG:3057',
      iso: 'ISOMETRIC NW',
      elev: 'ELEVATION FROM SOUTH',
    };
    ctx.fillText(labels[mode] || mode.toUpperCase(), vw - 10, vh - 10);
  }
}

// ====================== DRAWING HELPERS ======================

function drawQuad(
  ctx: CanvasRenderingContext2D, project: ProjectFn,
  cx: number, cy: number, z: number,
  fill: string, stroke?: string,
) {
  const H = DRAW_HALF;
  const pts = [
    project(cx - H, cy - H, z),
    project(cx + H, cy - H, z),
    project(cx + H, cy + H, z),
    project(cx - H, cy + H, z),
  ];
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < 4; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 0.5;
    ctx.stroke();
  }
}

function drawIsoCube(
  ctx: CanvasRenderingContext2D, project: ProjectFn,
  cx: number, cy: number, levels: number,
  r: number, g: number, b: number, alpha: number,
) {
  for (let lev = 0; lev < levels; lev++) {
    const zBot = lev * LEVEL_H;
    const zTop = (lev + 1) * LEVEL_H;
    const a = alpha * (0.6 + 0.4 * ((lev + 1) / levels));
    const fill = `rgba(${r},${g},${b},${a.toFixed(2)})`;
    const dark1 = `rgba(${Math.round(r * 0.5)},${Math.round(g * 0.5)},${Math.round(b * 0.5)},${(a * 0.9).toFixed(2)})`;
    const dark2 = `rgba(${Math.round(r * 0.65)},${Math.round(g * 0.65)},${Math.round(b * 0.65)},${(a * 0.9).toFixed(2)})`;
    const stroke = `rgba(${Math.min(255, r + 40)},${Math.min(255, g + 40)},${Math.min(255, b + 40)},0.4)`;

    const H = DRAW_HALF;
    // Right face
    const rf = [
      project(cx - H, cy - H, zBot), project(cx + H, cy - H, zBot),
      project(cx + H, cy - H, zTop), project(cx - H, cy - H, zTop),
    ];
    ctx.beginPath();
    ctx.moveTo(rf[0][0], rf[0][1]);
    for (let i = 1; i < 4; i++) ctx.lineTo(rf[i][0], rf[i][1]);
    ctx.closePath();
    ctx.fillStyle = dark1;
    ctx.fill();
    ctx.strokeStyle = stroke; ctx.lineWidth = 0.5; ctx.stroke();

    // Left face
    const lf = [
      project(cx - H, cy + H, zBot), project(cx - H, cy - H, zBot),
      project(cx - H, cy - H, zTop), project(cx - H, cy + H, zTop),
    ];
    ctx.beginPath();
    ctx.moveTo(lf[0][0], lf[0][1]);
    for (let i = 1; i < 4; i++) ctx.lineTo(lf[i][0], lf[i][1]);
    ctx.closePath();
    ctx.fillStyle = dark2;
    ctx.fill();
    ctx.strokeStyle = stroke; ctx.lineWidth = 0.5; ctx.stroke();

    // Top face
    drawQuad(ctx, project, cx, cy, zTop, fill, stroke);
  }
}

function drawElevCube(
  ctx: CanvasRenderingContext2D, project: ProjectFn,
  cx: number, _cy: number, levels: number,
  r: number, g: number, b: number, alpha: number,
) {
  for (let lev = 0; lev < levels; lev++) {
    const zBot = lev * LEVEL_H;
    const zTop = (lev + 1) * LEVEL_H;
    const a = alpha * (0.6 + 0.4 * ((lev + 1) / levels));
    const fill = `rgba(${r},${g},${b},${a.toFixed(2)})`;
    const stroke = `rgba(${Math.min(255, r + 40)},${Math.min(255, g + 40)},${Math.min(255, b + 40)},0.4)`;

    const [x0, y0] = project(cx - DRAW_HALF, 0, zBot);
    const [x1, y1] = project(cx + DRAW_HALF, 0, zTop);
    const w = x1 - x0;
    const h = y1 - y0;
    ctx.fillStyle = fill;
    ctx.fillRect(x0, y1, w, -h);
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 0.5;
    ctx.strokeRect(x0, y1, w, -h);
  }
}

// ====================== PUBLIC RENDER API ======================

/** Render the plan viewport to an arbitrary canvas at the current store state. */
export function renderPlanToCanvas(canvas: HTMLCanvasElement, _phaseIndex: number) {
  if (!cellDataCache) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  // Clear to transparent
  ctx.clearRect(0, 0, w, h);
  // Scale to fit the export canvas
  const dataW = maxX - minX + 4000;
  const dataH = maxY - minY + 4000;
  const fitScale = Math.min(w / dataW, h / dataH);
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const proj = makePlanProject(w, h, centerX, centerY, fitScale);
  renderViewport(ctx, w, h, proj, 'plan', false, true, false); // no terrain, transparent bg, no labels
}

// ====================== MAIN COMPONENT ======================

export default function MapView() {
  const planRef = useRef<HTMLCanvasElement>(null);
  const isoNwRef = useRef<HTMLCanvasElement>(null);
  const renderRef = useRef<(() => void) | null>(null);

  const dragRef = useRef<{ dragging: boolean; lastX: number; lastY: number }>({
    dragging: false, lastX: 0, lastY: 0,
  });

  const {
    setDataLoaded, placementMode, setPlacementMode,
    seedId, targetId, setSeedId, setTargetId,
    currentPhase, phases,
    viewCenterX, viewCenterY, viewScale, setView,
  } = useStore();

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
    ]).then(([cellFile, adjFile, coast, tMeta]) => {
      cellDataCache = cellFile.cells;
      adjacencyCache = adjFile;
      coastlineData = coast;
      terrainMeta = tMeta;

      if (tMeta) {
        const img = new Image();
        img.onload = () => {
          terrainImage = img;
          buildClippedTerrain();
          renderRef.current?.();
        };
        img.src = '/data/terrain_hillshade.png';
      }

      for (const c of Object.values(cellFile.cells)) {
        if (c.cx < minX) minX = c.cx;
        if (c.cx > maxX) maxX = c.cx;
        if (c.cy < minY) minY = c.cy;
        if (c.cy > maxY) maxY = c.cy;
      }

      // Set initial view to center on grid — fit to plan viewport
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      const dataW = maxX - minX + 4000;
      const dataH = maxY - minY + 4000;
      const fitScale = Math.min(800 / dataW, 500 / dataH);
      useStore.getState().setView(cx, cy, fitScale);

      setGridInfo({
        cellCount: Object.keys(cellFile.cells).length,
        eMin: minX, eMax: maxX, nMin: minY, nMax: maxY,
      });
      setDataLoaded(true);
      setReady(true);
    });
  }, []);

  // Render all viewports
  useEffect(() => {
    if (!ready) return;

    const render = () => {
      const store = useStore.getState();
      const { viewCenterX: cx, viewCenterY: cy, viewScale: scale } = store;

      // Helper to render a canvas
      const renderCanvas = (
        canvasEl: HTMLCanvasElement | null,
        projFn: (w: number, h: number) => ProjectFn,
        mode: 'plan' | 'iso' | 'elev',
        terrain: boolean,
      ) => {
        if (!canvasEl || !cellDataCache) return;
        const rect = canvasEl.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        const dpr = devicePixelRatio;
        canvasEl.width = rect.width * dpr;
        canvasEl.height = rect.height * dpr;
        const ctx = canvasEl.getContext('2d')!;
        ctx.scale(dpr, dpr);
        const proj = projFn(rect.width, rect.height);
        renderViewport(ctx, rect.width, rect.height, proj, mode, terrain);
      };

      // PLAN (main)
      renderCanvas(planRef.current, (w, h) => makePlanProject(w, h, cx, cy, scale), 'plan', true);

      // ISO from NW (45° Z, 35° X)
      renderCanvas(isoNwRef.current, (w, h) => makeIsoProject(w, h, cx, cy, scale * 0.55, 45, 35), 'iso', false);

    };

    render();
    renderRef.current = render;
    return () => { renderRef.current = null; };
  }, [ready, currentPhase, phases, seedId, targetId, viewCenterX, viewCenterY, viewScale]);

  // Mouse: zoom
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const store = useStore.getState();
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    const newScale = store.viewScale * factor;

    const planCanvas = planRef.current;
    if (planCanvas) {
      const rect = planCanvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      if (mx >= 0 && mx <= rect.width && my >= 0 && my <= rect.height) {
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
    }
    store.setView(store.viewCenterX, store.viewCenterY, newScale);
    renderRef.current?.();
  }, []);

  // Mouse: pan
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

  // Click to place seed/target (plan viewport only)
  const handlePlanClick = useCallback((e: React.MouseEvent) => {
    if (!cellDataCache) return;
    const pm = useStore.getState().placementMode;
    if (pm === 'none') return;

    const canvas = planRef.current;
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

  // Shared event handlers for secondary viewports
  const secondaryHandlers = {
    onWheel: handleWheel,
    onMouseDown: handleMouseDown,
    onMouseMove: handleMouseMove,
    onMouseUp: handleMouseUp,
    onMouseLeave: handleMouseUp,
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  };

  // Compute scale bar for info panel
  const scaleBarInfo = useCallback(() => {
    const store = useStore.getState();
    const s = store.viewScale;
    // Approximate: 1 world unit = s pixels. Find a nice round distance.
    const candidates = [500, 1000, 2000, 5000, 10000, 20000, 50000];
    let dist = 5000;
    for (const c of candidates) {
      if (c * s > 40 && c * s < 200) { dist = c; break; }
    }
    return { dist, px: dist * s, label: dist >= 1000 ? `${dist / 1000} km` : `${dist} m` };
  }, []);

  const sb = scaleBarInfo();

  return (
    <div style={styles.grid}>
      {/* Row 1: ISO NW + Plan + Info */}
      <div style={styles.cell}>
        <canvas ref={isoNwRef} {...secondaryHandlers} style={styles.canvas} />
        <div style={styles.viewLabel}>ISO NW</div>
      </div>
      <div style={styles.planCell}>
        <canvas
          ref={planRef}
          onClick={handlePlanClick}
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onContextMenu={(e) => e.preventDefault()}
          style={{ ...styles.canvas, cursor: pm !== 'none' ? 'crosshair' : 'grab' }}
        />
      </div>
      <div style={styles.sideCell} />

      {/* Row 2: Empty + Timeline (via overlay) + Info */}
      <div style={styles.sideCell} />
      <div style={styles.cell} id="timeline-cell" />
      <div style={styles.infoCell}>
        <div style={styles.infoContent}>
          <div style={styles.infoSection}>PROJECTION</div>
          <div style={styles.infoValue}>ISN93 / LAMBERT 1993</div>
          <div style={styles.infoValue}>EPSG:3057</div>
          <div style={styles.infoSpacer} />

          <div style={styles.infoSection}>EXTENT (km)</div>
          <div style={styles.infoValue}>
            E {gridInfo ? `${(gridInfo.eMin / 1000).toFixed(1)} — ${(gridInfo.eMax / 1000).toFixed(1)}` : '—'}
          </div>
          <div style={styles.infoValue}>
            N {gridInfo ? `${(gridInfo.nMin / 1000).toFixed(1)} — ${(gridInfo.nMax / 1000).toFixed(1)}` : '—'}
          </div>
          <div style={styles.infoSpacer} />

          <div style={styles.infoSection}>GRID</div>
          <div style={styles.infoValue}>500m CELLS — {gridInfo ? gridInfo.cellCount.toLocaleString() : '—'}</div>
          <div style={styles.infoSpacer} />

          <div style={styles.infoSection}>SCALE</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
            <div style={{ width: Math.max(20, sb.px), height: 2, background: '#F5F5F5' }} />
            <span style={styles.infoValue}>{sb.label}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  grid: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    display: 'grid',
    gridTemplateColumns: '2fr 13fr 2fr',
    gridTemplateRows: '3fr 1fr',
    gap: 2,
  },
  cell: {
    position: 'relative',
    border: '0.5px solid #333',
    overflow: 'hidden',
    minHeight: 0,
  },
  infoCell: {
    position: 'relative',
    border: '0.5px solid #333',
    overflow: 'hidden',
    minHeight: 0,
    background: 'rgba(0,0,0,0.95)',
  },
  infoContent: {
    padding: '10px 12px',
    fontFamily: "'ABC Diatype Mono', 'Courier New', monospace",
    height: '100%',
    overflowY: 'auto',
  },
  infoTitle: {
    color: '#F5F5F5',
    fontSize: 12,
    fontWeight: 600,
    letterSpacing: '0.1em',
    lineHeight: '16px',
    fontFamily: "'ABC Diatype Mono', 'Courier New', monospace",
  },
  infoSection: {
    color: '#666',
    fontSize: 10,
    letterSpacing: '0.08em',
    marginBottom: 2,
    fontFamily: "'ABC Diatype Mono', 'Courier New', monospace",
  },
  infoValue: {
    color: '#aaa',
    fontSize: 11,
    lineHeight: '15px',
    fontFamily: "'ABC Diatype Mono', 'Courier New', monospace",
  },
  infoSpacer: {
    height: 8,
  },
  sideCell: {
    position: 'relative',
    border: '0.5px solid #333',
    overflow: 'hidden',
    minHeight: 0,
    background: 'rgba(0,0,0,0.95)',
  },
  elevCell: {
    position: 'relative',
    border: '0.5px solid #333',
    overflow: 'hidden',
    minHeight: 0,
  },
  planCell: {
    position: 'relative',
    border: '0.5px solid #333',
    overflow: 'hidden',
    minHeight: 0,
  },
  canvas: {
    width: '100%',
    height: '100%',
    display: 'block',
    cursor: 'grab',
  },
  viewLabel: {
    position: 'absolute',
    bottom: 6,
    right: 8,
    color: '#555',
    fontSize: 11,
    fontFamily: "'ABC Diatype Mono', 'Courier New', monospace",
    letterSpacing: '0.08em',
    pointerEvents: 'none',
  },
};
