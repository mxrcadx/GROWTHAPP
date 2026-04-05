import type { CellData, PhaseSnapshot } from '../types';

function dxfHeader(): string {
  return `0\nSECTION\n2\nHEADER\n0\nENDSEC\n`;
}

function dxfTables(layers: string[]): string {
  let s = `0\nSECTION\n2\nTABLES\n0\nTABLE\n2\nLAYER\n`;
  for (const name of layers) {
    s += `0\nLAYER\n2\n${name}\n70\n0\n62\n7\n6\nCONTINUOUS\n`;
  }
  s += `0\nENDTAB\n0\nENDSEC\n`;
  return s;
}

function dxf3DFace(layer: string, pts: [number, number, number][]): string {
  let s = `0\n3DFACE\n8\n${layer}\n`;
  for (let i = 0; i < 4; i++) {
    const p = pts[Math.min(i, pts.length - 1)];
    s += `${10 + i}\n${p[0].toFixed(3)}\n${20 + i}\n${p[1].toFixed(3)}\n${30 + i}\n${p[2].toFixed(3)}\n`;
  }
  return s;
}

function boxFaces(
  layer: string,
  x0: number, y0: number, z0: number,
  x1: number, y1: number, z1: number
): string {
  let s = '';
  // Bottom
  s += dxf3DFace(layer, [[x0,y0,z0],[x1,y0,z0],[x1,y1,z0],[x0,y1,z0]]);
  // Top
  s += dxf3DFace(layer, [[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1]]);
  // Front
  s += dxf3DFace(layer, [[x0,y0,z0],[x1,y0,z0],[x1,y0,z1],[x0,y0,z1]]);
  // Back
  s += dxf3DFace(layer, [[x0,y1,z0],[x1,y1,z0],[x1,y1,z1],[x0,y1,z1]]);
  // Left
  s += dxf3DFace(layer, [[x0,y0,z0],[x0,y1,z0],[x0,y1,z1],[x0,y0,z1]]);
  // Right
  s += dxf3DFace(layer, [[x1,y0,z0],[x1,y1,z0],[x1,y1,z1],[x1,y0,z1]]);
  return s;
}

export function exportPhaseDXF(
  phase: PhaseSnapshot,
  phaseIndex: number,
  allCells: Record<string, CellData>,
): string {
  const HALF = 250; // 500m / 2
  const LEVEL_H = 125; // per level for legibility
  const layers = ['GRID_CELLS', 'LEVEL_1', 'LEVEL_2', 'LEVEL_3', 'LEVEL_4'];

  let dxf = dxfHeader();
  dxf += dxfTables(layers);
  dxf += `0\nSECTION\n2\nENTITIES\n`;

  // All grid cells as flat rectangles
  for (const [id, c] of Object.entries(allCells)) {
    const x0 = c.cx - HALF, x1 = c.cx + HALF;
    const y0 = c.cy - HALF, y1 = c.cy + HALF;
    const z = c.cz;
    dxf += dxf3DFace('GRID_CELLS', [[x0,y0,z],[x1,y0,z],[x1,y1,z],[x0,y1,z]]);
  }

  // Occupied cells as stacked boxes
  for (const [id, data] of Object.entries(phase.occupied)) {
    const c = allCells[id];
    if (!c) continue;
    const x0 = c.cx - HALF, x1 = c.cx + HALF;
    const y0 = c.cy - HALF, y1 = c.cy + HALF;

    for (let lev = 0; lev < data.levels; lev++) {
      const layerName = `LEVEL_${lev + 1}`;
      const z0 = c.cz + lev * LEVEL_H;
      const z1 = z0 + LEVEL_H;
      dxf += boxFaces(layerName, x0, y0, z0, x1, y1, z1);
    }
  }

  dxf += `0\nENDSEC\n0\nEOF\n`;
  return dxf;
}

export function downloadDXF(content: string, filename: string) {
  const blob = new Blob([content], { type: 'application/dxf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
