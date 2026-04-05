import type { CellData, PhaseSnapshot, CurvePoint } from '../types';

/**
 * Export all simulation phases as a standalone Python script.
 * Each 1km occupied cell is subdivided into a 4×4 grid of 250m subcells.
 * The script generates Rhino box geometry when run inside Rhino,
 * or prints a summary when run standalone.
 * Embeds seed/target, growth curves, and all phase data.
 */
export function exportPythonScript(
  phases: PhaseSnapshot[],
  allCells: Record<string, CellData>,
  seedId?: string | null,
  targetId?: string | null,
  landCurve?: CurvePoint[],
  floorCurve?: CurvePoint[],
): string {
  // Serialize cell data (only occupied cells across all phases)
  const usedIds = new Set<string>();
  for (const phase of phases) {
    for (const id of Object.keys(phase.occupied)) {
      usedIds.add(id);
    }
  }

  // Build compact cell lookup: { id: [cx, cy, cz] }
  const cellEntries: string[] = [];
  for (const id of usedIds) {
    const c = allCells[id];
    if (!c) continue;
    cellEntries.push(`    "${id}": [${c.cx}, ${c.cy}, ${c.cz}]`);
  }

  // Build phase data: list of { id: levels } dicts
  const phaseEntries: string[] = [];
  for (let i = 0; i < phases.length; i++) {
    const entries: string[] = [];
    for (const [id, data] of Object.entries(phases[i].occupied)) {
      if (data.levels > 0) {
        entries.push(`"${id}": ${data.levels}`);
      }
    }
    phaseEntries.push(`    {${entries.join(', ')}}`);
  }

  // Serialize curve data
  const landCurveStr = landCurve
    ? `[${landCurve.map(p => `(${p.phase}, ${p.value})`).join(', ')}]`
    : '[]';
  const floorCurveStr = floorCurve
    ? `[${floorCurve.map(p => `(${p.phase}, ${p.value})`).join(', ')}]`
    : '[]';

  // Seed/target cell info
  const seedInfo = seedId && allCells[seedId]
    ? `"${seedId}"  # cx=${allCells[seedId].cx}, cy=${allCells[seedId].cy}`
    : 'None';
  const targetInfo = targetId && allCells[targetId]
    ? `"${targetId}"  # cx=${allCells[targetId].cx}, cy=${allCells[targetId].cy}`
    : 'None';

  return `#!/usr/bin/env python3
"""
TERRITORIAL GROWTH SIMULATOR — 4x Resolution Export
====================================================
Generated: ${new Date().toISOString().slice(0, 19)}
Total phases: ${phases.length}
1km cells used: ${usedIds.size}
250m subcells per occupied cell: 16 (4x4)

Each 1km cell is subdivided into a 4x4 grid of 250m cells.
Levels stack as 250m-tall boxes on each subcell.

Coordinate system: EPSG:3057 (ISN93/Lambert)
Units: meters

Run in Rhino 8 Python editor or standalone.
"""

import json
import os

# ====================== SIMULATION CONFIG ======================

SEED_ID = ${seedInfo}
TARGET_ID = ${targetInfo}

# Growth profile curves: list of (phase, value_km2) control points
LAND_CURVE = ${landCurveStr}
FLOOR_CURVE = ${floorCurveStr}

# ====================== EMBEDDED DATA ======================

# Cell centroids: { id: [cx, cy, cz] }
CELLS = {
${cellEntries.join(',\n')}
}

# Phase data: list of { cell_id: levels }
PHASES = [
${phaseEntries.join(',\n')}
]

# Grid parameters
CELL_SIZE_1KM = 1000.0   # original cell size
HALF_1KM = 500.0
SUB_SIZE = 250.0          # 4x resolution subcell
HALF_SUB = 125.0
LEVEL_HEIGHT = 250.0      # meters per level
SUBDIVISIONS = 4          # 4x4 per 1km cell

# ====================== SUBDIVISION ======================

def subdivide_cell(cx, cy, cz, levels):
    """Subdivide a 1km cell into 4x4 = 16 subcells of 250m each.
    Returns list of (x, y, z_base, levels, width) tuples."""
    subcells = []
    for row in range(SUBDIVISIONS):
        for col in range(SUBDIVISIONS):
            sx = cx - HALF_1KM + HALF_SUB + col * SUB_SIZE
            sy = cy - HALF_1KM + HALF_SUB + row * SUB_SIZE
            subcells.append((sx, sy, cz, levels, SUB_SIZE))
    return subcells


def get_phase_subcells(phase_index):
    """Get all 250m subcells for a given phase.
    Returns list of (x, y, z_base, levels, width) tuples."""
    if phase_index < 0 or phase_index >= len(PHASES):
        raise ValueError(f"Phase {phase_index} out of range [0, {len(PHASES)-1}]")

    phase = PHASES[phase_index]
    all_subcells = []
    for cell_id, levels in phase.items():
        if cell_id not in CELLS:
            continue
        cx, cy, cz = CELLS[cell_id]
        all_subcells.extend(subdivide_cell(cx, cy, cz, levels))
    return all_subcells


def get_all_grid_subcells():
    """Get all 250m subcells for the full grid (no levels, just base)."""
    all_subcells = []
    for cell_id, (cx, cy, cz) in CELLS.items():
        for row in range(SUBDIVISIONS):
            for col in range(SUBDIVISIONS):
                sx = cx - HALF_1KM + HALF_SUB + col * SUB_SIZE
                sy = cy - HALF_1KM + HALF_SUB + row * SUB_SIZE
                all_subcells.append((sx, sy, cz, 0, SUB_SIZE))
    return all_subcells

# ====================== RHINO GEOMETRY ======================

def create_rhino_boxes(phase_index):
    """Create Rhino box geometry for a phase. Run inside Rhino 8 Python editor."""
    try:
        import Rhino.Geometry as rg
        import scriptcontext as sc
        import System.Drawing as sd
    except ImportError:
        print("Not running inside Rhino. Use standalone mode instead.")
        return

    subcells = get_phase_subcells(phase_index)
    print(f"Phase {phase_index}: {len(subcells)} subcells at 250m resolution")

    # Color per level
    level_colors = [
        sd.Color.FromArgb(180, 60, 60, 80),    # L0 (shouldn't appear)
        sd.Color.FromArgb(220, 80, 120, 200),   # L1
        sd.Color.FromArgb(220, 120, 160, 230),  # L2
        sd.Color.FromArgb(220, 180, 200, 240),  # L3
        sd.Color.FromArgb(220, 220, 230, 255),  # L4
    ]

    for sx, sy, sz, levels, w in subcells:
        half = w / 2.0
        for lev in range(levels):
            z0 = sz + lev * LEVEL_HEIGHT
            z1 = z0 + LEVEL_HEIGHT

            corner = rg.Point3d(sx - half, sy - half, z0)
            box = rg.Box(
                rg.Plane.WorldXY,
                rg.Interval(sx - half, sx + half),
                rg.Interval(sy - half, sy + half),
                rg.Interval(z0, z1),
            )
            brep = box.ToBrep()
            if brep:
                attr = Rhino.DocObjects.ObjectAttributes()
                attr.LayerIndex = sc.doc.Layers.CurrentLayerIndex
                color_idx = min(lev + 1, len(level_colors) - 1)
                attr.ObjectColor = level_colors[color_idx]
                attr.ColorSource = Rhino.DocObjects.ObjectColorSource.ColorFromObject
                sc.doc.Objects.AddBrep(brep, attr)

    sc.doc.Views.Redraw()
    print(f"Added {sum(s[3] for s in subcells)} boxes to Rhino")

# ====================== STANDALONE / JSON EXPORT ======================

def export_phase_json(phase_index, output_path=None):
    """Export a phase as JSON with 250m subcell data."""
    subcells = get_phase_subcells(phase_index)

    data = {
        "phase": phase_index,
        "resolution_m": 250,
        "level_height_m": LEVEL_HEIGHT,
        "subcell_count": len(subcells),
        "total_boxes": sum(s[3] for s in subcells),
        "subcells": [
            {"x": s[0], "y": s[1], "z": s[2], "levels": s[3], "width": s[4]}
            for s in subcells
        ],
    }

    if output_path is None:
        output_path = f"growth_phase_{phase_index:03d}_250m.json"

    with open(output_path, "w") as f:
        json.dump(data, f, indent=2)

    print(f"Exported {len(subcells)} subcells to {output_path}")
    return output_path


def export_all_phases_json(output_dir="."):
    """Export all phases as individual JSON files."""
    os.makedirs(output_dir, exist_ok=True)
    for i in range(len(PHASES)):
        path = os.path.join(output_dir, f"growth_phase_{i:03d}_250m.json")
        export_phase_json(i, path)
    print(f"\\nExported {len(PHASES)} phases to {output_dir}/")

# ====================== MAIN ======================

if __name__ == "__main__":
    print(f"Territorial Growth Simulator — 4x Resolution Export")
    print(f"Phases: {len(PHASES)}")
    print(f"Grid cells (1km): {len(CELLS)}")
    print(f"Subdivision: {SUBDIVISIONS}x{SUBDIVISIONS} = {SUBDIVISIONS**2} subcells per cell")
    print(f"Subcell size: {SUB_SIZE}m")
    print(f"Level height: {LEVEL_HEIGHT}m")
    print()

    # Summary per phase
    for i, phase in enumerate(PHASES):
        n_cells = len(phase)
        n_subcells = n_cells * SUBDIVISIONS ** 2
        total_levels = sum(phase.values())
        total_boxes = total_levels * SUBDIVISIONS ** 2
        if i % 20 == 0 or i == len(PHASES) - 1:
            print(f"  Phase {i:3d}: {n_cells:4d} cells -> {n_subcells:6d} subcells, {total_boxes:6d} boxes")

    print()
    print("Usage:")
    print("  In Rhino:    create_rhino_boxes(phase_index)")
    print("  Standalone:  export_phase_json(phase_index)")
    print("  All phases:  export_all_phases_json('./output')")
`;
}

export function downloadPythonScript(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/x-python' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
