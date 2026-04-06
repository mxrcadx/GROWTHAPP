import { create } from 'zustand';
import type { PlacementMode, PhaseSnapshot, CurvePoint } from './types';

function defaultLandCurve(totalPhases: number): CurvePoint[] {
  return [
    { phase: 0, value: 0 },
    { phase: Math.round(totalPhases * 0.1), value: 20 },
    { phase: Math.round(totalPhases * 0.25), value: 80 },
    { phase: Math.round(totalPhases * 0.5), value: 200 },
    { phase: Math.round(totalPhases * 0.75), value: 300 },
    { phase: Math.round(totalPhases * 0.85), value: 250 },
    { phase: Math.round(totalPhases * 0.95), value: 120 },
    { phase: totalPhases - 1, value: 80 },
  ];
}

function defaultFloorCurve(totalPhases: number): CurvePoint[] {
  return [
    { phase: 0, value: 0 },
    { phase: Math.round(totalPhases * 0.1), value: 10 },
    { phase: Math.round(totalPhases * 0.25), value: 50 },
    { phase: Math.round(totalPhases * 0.5), value: 180 },
    { phase: Math.round(totalPhases * 0.75), value: 450 },
    { phase: Math.round(totalPhases * 0.85), value: 380 },
    { phase: Math.round(totalPhases * 0.95), value: 200 },
    { phase: totalPhases - 1, value: 120 },
  ];
}

interface AppState {
  // Data loading
  dataLoaded: boolean;
  setDataLoaded: (v: boolean) => void;

  // Placement
  placementMode: PlacementMode;
  setPlacementMode: (m: PlacementMode) => void;
  seedId: string | null;
  targetId: string | null;
  setSeedId: (id: string | null) => void;
  setTargetId: (id: string | null) => void;

  // Curve control points
  landCurve: CurvePoint[];
  floorCurve: CurvePoint[];
  setLandCurve: (pts: CurvePoint[]) => void;
  setFloorCurve: (pts: CurvePoint[]) => void;

  // Simulation
  totalPhases: number;
  setTotalPhases: (v: number) => void;
  currentPhase: number;
  setCurrentPhase: (v: number) => void;
  simulating: boolean;
  setSimulating: (v: boolean) => void;
  phases: PhaseSnapshot[];
  setPhases: (p: PhaseSnapshot[]) => void;

  // Playback
  playing: boolean;
  setPlaying: (v: boolean) => void;
  looping: boolean;
  setLooping: (v: boolean) => void;
  playSpeed: number; // 1, 2, 4, 8
  setPlaySpeed: (v: number) => void;

  // Growth parameters
  wSuit: number;    // suitability weight
  wProx: number;    // proximity-to-target weight
  wAdv: number;     // advance (seed→target direction) weight
  maxLevels: number; // max stacking levels
  hfStacking: boolean; // cap levels by heat flux
  setWSuit: (v: number) => void;
  setWProx: (v: number) => void;
  setWAdv: (v: number) => void;
  setMaxLevels: (v: number) => void;
  setHfStacking: (v: boolean) => void;

  // Shared view state (world coords)
  viewCenterX: number;
  viewCenterY: number;
  viewScale: number;
  setView: (cx: number, cy: number, scale: number) => void;
}

const INITIAL_PHASES = 200;

export const useStore = create<AppState>((set) => ({
  dataLoaded: false,
  setDataLoaded: (v) => set({ dataLoaded: v }),

  placementMode: 'seed',
  setPlacementMode: (m) => set({ placementMode: m }),
  seedId: null,
  targetId: null,
  setSeedId: (id) => set({ seedId: id }),
  setTargetId: (id) => set({ targetId: id }),

  landCurve: defaultLandCurve(INITIAL_PHASES),
  floorCurve: defaultFloorCurve(INITIAL_PHASES),
  setLandCurve: (pts) => set({ landCurve: pts }),
  setFloorCurve: (pts) => set({ floorCurve: pts }),

  totalPhases: INITIAL_PHASES,
  setTotalPhases: (v) => set((s) => ({
    totalPhases: v,
    landCurve: defaultLandCurve(v),
    floorCurve: defaultFloorCurve(v),
    phases: [],
    currentPhase: 0,
  })),
  currentPhase: 0,
  setCurrentPhase: (v) => set({ currentPhase: v }),
  simulating: false,
  setSimulating: (v) => set({ simulating: v }),
  phases: [],
  setPhases: (p) => set({ phases: p }),

  playing: false,
  setPlaying: (v) => set({ playing: v }),
  looping: false,
  setLooping: (v) => set({ looping: v }),
  playSpeed: 1,
  setPlaySpeed: (v) => set({ playSpeed: v }),

  wSuit: 0.4,
  wProx: 0.6,
  wAdv: 0.0,
  maxLevels: 4,
  hfStacking: false,
  setWSuit: (v) => set({ wSuit: v }),
  setWProx: (v) => set({ wProx: v }),
  setWAdv: (v) => set({ wAdv: v }),
  setMaxLevels: (v) => set({ maxLevels: v }),
  setHfStacking: (v) => set({ hfStacking: v }),

  viewCenterX: 370000,
  viewCenterY: 400000,
  viewScale: 1,
  setView: (cx, cy, scale) => set({ viewCenterX: cx, viewCenterY: cy, viewScale: scale }),
}));
