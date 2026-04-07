export interface CellData {
  cx: number;
  cy: number;
  cz: number;
  suit: number;
  hf: number;
  sl: number;
}

export interface GrowthCellDataFile {
  count: number;
  seed: number;
  target: number;
  cells: Record<string, CellData>;
}

export type GrowthAdjacencyFile = Record<string, string[]>;

/** A control point on any growth curve */
export interface CurvePoint {
  phase: number;  // x: 0..totalPhases
  value: number;  // y: km² (territory/compute) or 0-1 (decay)
}

export interface PhaseSnapshot {
  occupied: Record<string, { age: number; levels: number }>;
  landArea: number;
  floorSpace: number;
}

export interface SimulationResult {
  phases: PhaseSnapshot[];
  totalPhases: number;
}

export type PlacementMode = 'none' | 'seed' | 'target';

export type ColorTheme = 'age' | 'suitability' | 'heatflux' | 'levels';
