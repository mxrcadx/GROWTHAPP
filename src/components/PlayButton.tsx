import { useCallback, useRef, useEffect } from 'react';
import { useStore } from '../store';
import { getCellData, getAdjacency, setPhaseBlendDirect } from './MapView';
import type { SimulationResult } from '../types';

// Module-level refs so SimEngine and PlayButton share state
let workerInstance: Worker | null = null;
let playbackTime = 0;
let autoPlayTimer: ReturnType<typeof setTimeout> | null = null;

export function runSimulation() {
  const cells = getCellData();
  const adj = getAdjacency();
  const store = useStore.getState();
  if (!cells || !adj || !store.seedId || !store.targetId || !workerInstance) return;

  // Only stop playback on manual runs, not curve-edit re-runs
  if (store.playing) {
    store.setPlaying(false);
    playbackTime = 0;
  }

  store.setSimulating(true);
  store.clearLog();
  workerInstance.postMessage({
    cells,
    adjacency: adj,
    seedId: store.seedId,
    targetId: store.targetId,
    totalPhases: store.totalPhases,
    landCurve: store.territoryCurve,
    floorCurve: store.computeCurve,
    wSuit: store.wSuit,
    wProx: store.wProx,
    wAdv: store.wAdv,
    maxLevels: store.maxLevels,
    hfStacking: store.hfStacking,
  });
}

/** Always-mounted component that manages the simulation worker and animation loop */
let rerunTimer: ReturnType<typeof setTimeout> | null = null;

export function SimEngine() {
  const { playing, playSpeed, phases } = useStore();
  const seedId = useStore(s => s.seedId);
  const targetId = useStore(s => s.targetId);
  const dataLoaded = useStore(s => s.dataLoaded);
  const territoryCurve = useStore(s => s.territoryCurve);
  const computeCurve = useStore(s => s.computeCurve);
  const animRef = useRef<number | null>(null);
  const hasRunRef = useRef(false);

  // Track whether sim has been run at least once
  useEffect(() => {
    if (phases.length > 0) hasRunRef.current = true;
  }, [phases.length]);

  // Auto-run simulation when both seed and target are placed
  useEffect(() => {
    if (seedId && targetId && dataLoaded && !useStore.getState().simulating && phases.length === 0) {
      // Small delay to let the UI settle after target placement
      const t = setTimeout(() => runSimulation(), 100);
      return () => clearTimeout(t);
    }
  }, [seedId, targetId, dataLoaded]);

  // Re-run simulation when curves change (debounced, only after first run)
  useEffect(() => {
    if (!hasRunRef.current) return;
    const store = useStore.getState();
    if (!store.seedId || !store.targetId || store.simulating) return;
    if (rerunTimer) clearTimeout(rerunTimer);
    rerunTimer = setTimeout(() => {
      runSimulation();
    }, 150);
    return () => { if (rerunTimer) clearTimeout(rerunTimer); };
  }, [territoryCurve, computeCurve]);

  // Create worker once
  useEffect(() => {
    const w = new Worker(
      new URL('../engine/simulation.worker.ts', import.meta.url),
      { type: 'module' }
    );
    w.onmessage = (e) => {
      if (e.data.result) {
        const res = e.data.result as SimulationResult;
        const store = useStore.getState();
        store.setPhases(res.phases);
        // Preserve scrubber position; clamp to new phase count
        const clampedPhase = Math.min(store.currentPhase, res.phases.length - 1);
        store.setCurrentPhase(clampedPhase);
        store.setSimulating(false);
        if (e.data.log) {
          const lines: string[] = [];
          for (const entry of e.data.log) {
            lines.push(`\u2500\u2500 PHASE ${entry.phase} \u2500\u2500`);
            lines.push(...entry.details);
          }
          useStore.getState().appendLog(lines);
        }
        // No autoplay — user scrubs or presses play manually
      }
    };
    workerInstance = w;
    return () => { w.terminate(); workerInstance = null; };
  }, []);

  // Animation loop
  useEffect(() => {
    if (!playing || phases.length === 0) {
      if (animRef.current) {
        cancelAnimationFrame(animRef.current);
        animRef.current = null;
      }
      return;
    }

    let lastTs = performance.now();
    const phasesPerMs = playSpeed / 1000;

    const tick = (ts: number) => {
      const dt = ts - lastTs;
      lastTs = ts;

      playbackTime += dt * phasesPerMs;
      const store = useStore.getState();
      const maxPhase = store.phases.length - 1;

      if (playbackTime >= maxPhase) {
        if (store.looping) {
          playbackTime = 0;
        } else {
          store.setCurrentPhase(maxPhase);
          setPhaseBlendDirect(0);
          store.setPlaying(false);
          return;
        }
      }

      const intPhase = Math.floor(playbackTime);
      const blend = playbackTime - intPhase;
      if (intPhase !== store.currentPhase) {
        store.setCurrentPhase(intPhase);
      }
      setPhaseBlendDirect(blend);

      animRef.current = requestAnimationFrame(tick);
    };

    animRef.current = requestAnimationFrame(tick);
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [playing, playSpeed, phases.length]);

  return null; // no UI
}

/** Inline play/pause button for use inside RightPanel */
export default function PlayButton({ inline }: { inline?: boolean } = {}) {
  const { playing, seedId, targetId, currentPhase, phases, simulating, dataLoaded } = useStore();
  const { setPlaying, setCurrentPhase } = useStore();

  const togglePlay = useCallback(() => {
    if (playing) {
      setPlaying(false);
    } else if (phases.length > 0) {
      if (currentPhase >= phases.length - 1) {
        playbackTime = 0;
        setCurrentPhase(0);
      } else {
        playbackTime = currentPhase;
      }
      setPlaying(true);
    } else if (seedId && targetId && dataLoaded && !simulating) {
      runSimulation();
    }
  }, [playing, phases.length, currentPhase, seedId, targetId, dataLoaded, simulating]);

  if (!seedId) return null;

  return (
    <button
      onClick={togglePlay}
      disabled={simulating}
      title={playing ? 'Pause' : phases.length > 0 ? 'Play' : 'Run Simulation'}
      style={{
        background: 'transparent',
        border: '0.5px solid rgba(255,255,255,0.2)',
        borderRadius: 4,
        color: simulating ? '#555' : '#F5F5F5',
        fontSize: 10,
        width: 28,
        height: 22,
        cursor: simulating ? 'wait' : 'pointer',
        fontFamily: "'ABC Diatype', 'Helvetica Neue', sans-serif",
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {simulating ? '...' : playing ? '\u25AE\u25AE' : '\u25B6'}
    </button>
  );
}
