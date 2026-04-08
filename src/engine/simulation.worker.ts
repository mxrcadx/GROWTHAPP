/// <reference lib="webworker" />

interface CellData {
  cx: number; cy: number; cz: number;
  suit: number; hf: number; sl: number;
}

interface CurvePoint {
  phase: number;
  value: number;
}

interface WorkerInput {
  cells: Record<string, CellData>;
  adjacency: Record<string, string[]>;
  seedId: string;
  targetId: string;
  totalPhases: number;
  landCurve: CurvePoint[];   // territory curve (km²)
  floorCurve: CurvePoint[];  // compute curve (km²)
  wSuit: number;
  wProx: number;
  wAdv: number;
  maxLevels: number;
  hfStacking: boolean;
}

interface LogEntry {
  phase: number;
  action: string;
  details: string[];
}

const CELL_AREA_KM2 = 0.25; // 500m grid: 0.5km × 0.5km = 0.25 km²

/** Monotone cubic interpolation (Fritsch-Carlson) for smooth curves through control points */
function interpolateCurve(points: CurvePoint[], phase: number): number {
  if (points.length === 0) return 0;
  if (phase <= points[0].phase) return points[0].value;
  if (phase >= points[points.length - 1].phase) return points[points.length - 1].value;

  let i = 0;
  while (i < points.length - 1 && points[i + 1].phase < phase) i++;

  const p0 = points[i];
  const p1 = points[i + 1];
  const dx = p1.phase - p0.phase;
  if (dx === 0) return p0.value;

  const t = (phase - p0.phase) / dx;

  const m0 = i > 0
    ? 0.5 * (p1.value - points[i - 1].value) / (p1.phase - points[i - 1].phase) * dx
    : (p1.value - p0.value);
  const m1 = i < points.length - 2
    ? 0.5 * (points[i + 2].value - p0.value) / (points[i + 2].phase - p0.phase) * dx
    : (p1.value - p0.value);

  const t2 = t * t;
  const t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;

  return Math.max(0, h00 * p0.value + h10 * m0 + h01 * p1.value + h11 * m1);
}

/** Max stacking levels for a cell based on heat flux */
function hfMaxLevels(hf: number, cap: number): number {
  if (hf >= 100) return Math.min(4, cap);
  if (hf >= 60) return Math.min(3, cap);
  if (hf >= 30) return Math.min(2, cap);
  return Math.min(1, cap);
}

self.onmessage = (e: MessageEvent<WorkerInput>) => {
  const {
    cells, adjacency, seedId, targetId, totalPhases,
    landCurve, floorCurve,
    wSuit, wProx, wAdv, maxLevels, hfStacking,
  } = e.data;

  const targetCell = cells[targetId];
  const seedCell = cells[seedId];

  if (!targetCell || !seedCell) {
    self.postMessage({ error: 'Invalid seed or target' });
    return;
  }

  // Precompute distances
  const distToTarget: Record<string, number> = {};
  const distToSeed: Record<string, number> = {};
  let maxDistTarget = 0;
  let maxDistSeed = 0;

  for (const [id, c] of Object.entries(cells)) {
    const dtx = targetCell.cx - c.cx;
    const dty = targetCell.cy - c.cy;
    const dt = Math.sqrt(dtx * dtx + dty * dty);
    distToTarget[id] = dt;
    if (dt > maxDistTarget) maxDistTarget = dt;

    const dsx = c.cx - seedCell.cx;
    const dsy = c.cy - seedCell.cy;
    const ds = Math.sqrt(dsx * dsx + dsy * dsy);
    distToSeed[id] = ds;
    if (ds > maxDistSeed) maxDistSeed = ds;
  }

  // Seed→target axis vector (normalized)
  const axisX = targetCell.cx - seedCell.cx;
  const axisY = targetCell.cy - seedCell.cy;
  const axisDist = Math.sqrt(axisX * axisX + axisY * axisY);
  const axisNX = axisDist > 0 ? axisX / axisDist : 0;
  const axisNY = axisDist > 0 ? axisY / axisDist : 0;

  // Precompute per-cell scores
  const proximity: Record<string, number> = {};
  const advance: Record<string, number> = {};
  for (const [id, c] of Object.entries(cells)) {
    proximity[id] = maxDistTarget > 0 ? 1 - distToTarget[id] / maxDistTarget : 1;
    const dx = c.cx - seedCell.cx;
    const dy = c.cy - seedCell.cy;
    const proj = dx * axisNX + dy * axisNY;
    advance[id] = axisDist > 0 ? Math.max(0, Math.min(1, proj / axisDist)) : 0;
  }

  // Normalize weights
  const wTotal = wSuit + wProx + wAdv;
  const nSuit = wTotal > 0 ? wSuit / wTotal : 0.33;
  const nProx = wTotal > 0 ? wProx / wTotal : 0.33;
  const nAdv = wTotal > 0 ? wAdv / wTotal : 0.34;

  // Precompute expansion score
  const expansionScore: Record<string, number> = {};
  for (const [id, c] of Object.entries(cells)) {
    expansionScore[id] = c.suit * nSuit + proximity[id] * nProx + advance[id] * nAdv;
  }

  // State
  const occupied = new Map<string, number>(); // cellId -> age
  const cellLevels = new Map<string, number>();
  occupied.set(seedId, 0);

  const phases = [];
  const logEntries: LogEntry[] = [];

  for (let phase = 0; phase < totalPhases; phase++) {
    const targetLandArea = interpolateCurve(landCurve, phase);
    const targetFloorSpace = interpolateCurve(floorCurve, phase);
    const targetCells = Math.max(1, Math.round(targetLandArea / CELL_AREA_KM2));

    const phaseLog: string[] = [];

    // GROW: add frontier cells
    let grew = 0;
    if (targetCells > occupied.size) {
      const needed = targetCells - occupied.size;
      const frontier: string[] = [];
      const frontierSet = new Set<string>();
      for (const occId of occupied.keys()) {
        const nbs = adjacency[occId];
        if (!nbs) continue;
        for (const nb of nbs) {
          if (!occupied.has(nb) && !frontierSet.has(nb) && cells[nb]) {
            frontier.push(nb);
            frontierSet.add(nb);
          }
        }
      }
      frontier.sort((a, b) => expansionScore[b] - expansionScore[a]);
      const toAdd = Math.min(needed, frontier.length);
      for (let i = 0; i < toAdd; i++) {
        occupied.set(frontier[i], 0);
      }
      grew = toAdd;
      if (toAdd > 0) {
        const best = frontier[0];
        const bc = cells[best];
        phaseLog.push(`GROW +${toAdd} cells | frontier: ${frontier.length}`);
        phaseLog.push(`  best: ${best} suit=${bc.suit.toFixed(2)} hf=${bc.hf.toFixed(0)}W/m²`);
        phaseLog.push(`  src: geothermal_suitability_500m, ork_heatflux_2020`);
      }
    }

    // SHED: remove furthest cells from target
    let shedCount = 0;
    if (targetCells < occupied.size) {
      const toRemove = occupied.size - targetCells;
      const sorted = [...occupied.keys()].sort(
        (a, b) => distToTarget[b] - distToTarget[a]
      );
      for (let i = 0; i < toRemove; i++) {
        occupied.delete(sorted[i]);
      }
      shedCount = toRemove;
    }

    if (shedCount > 0) {
      phaseLog.push(`SHED -${shedCount} cells`);
    }

    // AGE all cells
    for (const [id, age] of occupied) {
      occupied.set(id, age + 1);
    }

    // ASSIGN LEVELS
    cellLevels.clear();
    const currentLandArea = occupied.size * CELL_AREA_KM2;

    if (occupied.size > 0) {
      const maxAge = Math.max(1, ...occupied.values());
      const sortedByDevelopment = [...occupied.keys()].sort((a, b) => {
        const scoreA = (occupied.get(a) || 0) / maxAge * 0.6 + cells[a].suit * 0.4;
        const scoreB = (occupied.get(b) || 0) / maxAge * 0.6 + cells[b].suit * 0.4;
        return scoreB - scoreA;
      });

      if (targetFloorSpace >= currentLandArea) {
        for (const id of occupied.keys()) cellLevels.set(id, 1);
        const neededExtra = targetFloorSpace - currentLandArea;
        let added = 0;
        const levelCap = maxLevels - 1;
        for (let extraLevel = 1; extraLevel <= levelCap && added < neededExtra; extraLevel++) {
          for (const id of sortedByDevelopment) {
            if (added >= neededExtra) break;
            const current = cellLevels.get(id) || 1;
            const cellMax = hfStacking ? hfMaxLevels(cells[id].hf, maxLevels) : maxLevels;
            if (current < cellMax && current < extraLevel + 1) {
              cellLevels.set(id, current + 1);
              added += CELL_AREA_KM2;
            }
          }
        }
        if (neededExtra > 0) {
          phaseLog.push(`STACK +${(neededExtra).toFixed(1)}km² compute | src: ork_heatflux_2020`);
        }
      } else {
        const programmedCount = Math.max(1, Math.round(targetFloorSpace / CELL_AREA_KM2));
        for (let i = 0; i < sortedByDevelopment.length; i++) {
          cellLevels.set(sortedByDevelopment[i], i < programmedCount ? 1 : 0);
        }
      }
    }

    // Build snapshot
    const snapshot: Record<string, { age: number; levels: number }> = {};
    let floorSpace = 0;
    for (const [id, age] of occupied) {
      const levels = cellLevels.get(id) || 0;
      snapshot[id] = { age, levels };
      floorSpace += levels * CELL_AREA_KM2;
    }

    phases.push({
      occupied: snapshot,
      landArea: Math.round(currentLandArea * 10) / 10,
      floorSpace: Math.round(floorSpace * 10) / 10,
    });

    if (phaseLog.length > 0) {
      logEntries.push({ phase, action: grew > 0 ? 'GROW' : 'SHED', details: phaseLog });
    }

    if (phase % 10 === 0) {
      self.postMessage({ progress: phase, total: totalPhases });
    }
  }

  self.postMessage({ result: { phases, totalPhases }, log: logEntries });
};
