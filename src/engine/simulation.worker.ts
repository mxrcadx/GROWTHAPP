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
  landCurve: CurvePoint[];
  floorCurve: CurvePoint[];
}

const CELL_AREA_KM2 = 1.0;

/** Monotone cubic interpolation (Fritsch-Carlson) for smooth curves through control points */
function interpolateCurve(points: CurvePoint[], phase: number): number {
  if (points.length === 0) return 0;
  if (phase <= points[0].phase) return points[0].value;
  if (phase >= points[points.length - 1].phase) return points[points.length - 1].value;

  // Find segment
  let i = 0;
  while (i < points.length - 1 && points[i + 1].phase < phase) i++;

  const p0 = points[i];
  const p1 = points[i + 1];
  const dx = p1.phase - p0.phase;
  if (dx === 0) return p0.value;

  const t = (phase - p0.phase) / dx;

  // Compute tangents using Catmull-Rom style
  const m0 = i > 0
    ? 0.5 * (p1.value - points[i - 1].value) / (p1.phase - points[i - 1].phase) * dx
    : (p1.value - p0.value);
  const m1 = i < points.length - 2
    ? 0.5 * (points[i + 2].value - p0.value) / (points[i + 2].phase - p0.phase) * dx
    : (p1.value - p0.value);

  // Hermite basis
  const t2 = t * t;
  const t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;

  return Math.max(0, h00 * p0.value + h10 * m0 + h01 * p1.value + h11 * m1);
}

self.onmessage = (e: MessageEvent<WorkerInput>) => {
  const { cells, adjacency, seedId, targetId, totalPhases, landCurve, floorCurve } = e.data;

  const cellIds = Object.keys(cells);
  const targetCell = cells[targetId];
  const seedCell = cells[seedId];

  if (!targetCell || !seedCell) {
    self.postMessage({ error: 'Invalid seed or target' });
    return;
  }

  // Precompute distance from every cell to target
  const distToTarget: Record<string, number> = {};
  let maxDist = 0;
  for (const [id, c] of Object.entries(cells)) {
    const dx = targetCell.cx - c.cx;
    const dy = targetCell.cy - c.cy;
    const d = Math.sqrt(dx * dx + dy * dy);
    distToTarget[id] = d;
    if (d > maxDist) maxDist = d;
  }

  // Precompute proximity (0 = furthest, 1 = at target) and expansion score
  const proximity: Record<string, number> = {};
  const expansionScore: Record<string, number> = {};
  for (const [id, c] of Object.entries(cells)) {
    proximity[id] = maxDist > 0 ? 1 - distToTarget[id] / maxDist : 1;
    expansionScore[id] = c.suit * 0.4 + proximity[id] * 0.6;
  }

  // State: occupied cells with age
  const occupied = new Map<string, number>(); // cellId -> age
  const cellLevels = new Map<string, number>(); // cellId -> level

  // Start with seed
  occupied.set(seedId, 0);

  const phases = [];

  for (let phase = 0; phase < totalPhases; phase++) {
    const targetLandArea = interpolateCurve(landCurve, phase);
    const targetFloorSpace = interpolateCurve(floorCurve, phase);
    const targetCells = Math.max(1, Math.round(targetLandArea / CELL_AREA_KM2));

    // GROW: add frontier cells
    if (targetCells > occupied.size) {
      const needed = targetCells - occupied.size;
      // Build frontier: unoccupied neighbors of occupied cells
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
      // Sort by expansion score descending
      frontier.sort((a, b) => expansionScore[b] - expansionScore[a]);
      // Add top N
      const toAdd = Math.min(needed, frontier.length);
      for (let i = 0; i < toAdd; i++) {
        occupied.set(frontier[i], 0);
      }
    }

    // SHED: remove furthest cells
    if (targetCells < occupied.size) {
      const toRemove = occupied.size - targetCells;
      // Sort occupied by distance from target descending (furthest first)
      const sorted = [...occupied.keys()].sort(
        (a, b) => distToTarget[b] - distToTarget[a]
      );
      for (let i = 0; i < toRemove; i++) {
        occupied.delete(sorted[i]);
      }
    }

    // AGE all cells
    for (const [id, age] of occupied) {
      occupied.set(id, age + 1);
    }

    // ASSIGN LEVELS to meet floor space target
    cellLevels.clear();
    const currentLandArea = occupied.size * CELL_AREA_KM2;

    if (occupied.size > 0) {
      // Sort by proximity to target (closest first)
      const sortedByProximity = [...occupied.keys()].sort(
        (a, b) => distToTarget[a] - distToTarget[b]
      );

      if (targetFloorSpace >= currentLandArea) {
        // STACKING: floor >= land, all cells get at least level 1, extras near target
        for (const id of occupied.keys()) cellLevels.set(id, 1);
        const neededExtra = targetFloorSpace - currentLandArea;
        let added = 0;
        for (let extraLevel = 1; extraLevel <= 3 && added < neededExtra; extraLevel++) {
          for (const id of sortedByProximity) {
            if (added >= neededExtra) break;
            const current = cellLevels.get(id) || 1;
            if (current < extraLevel + 1) {
              cellLevels.set(id, current + 1);
              added += CELL_AREA_KM2;
            }
          }
        }
      } else {
        // SPARSE: floor < land, only some cells are "programmed" (level 1)
        // Assign level 1 to cells closest to target until floor space met
        const programmedCount = Math.max(1, Math.round(targetFloorSpace / CELL_AREA_KM2));
        for (let i = 0; i < sortedByProximity.length; i++) {
          cellLevels.set(sortedByProximity[i], i < programmedCount ? 1 : 0);
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

    if (phase % 10 === 0) {
      self.postMessage({ progress: phase, total: totalPhases });
    }
  }

  self.postMessage({ result: { phases, totalPhases } });
};
