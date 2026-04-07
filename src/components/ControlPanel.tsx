import { useStore } from '../store';
import { getCellData, getAdjacency, setPhaseBlendDirect } from './MapView';
import { useRef, useEffect, useCallback } from 'react';
import type { SimulationResult } from '../types';

export default function ControlPanel() {
  const {
    dataLoaded,
    seedId, targetId,
    territoryCurve, computeCurve,
    totalPhases,
    currentPhase, phases, setPhases, setCurrentPhase,
    simulating, setSimulating,
    playing, setPlaying,
    playSpeed,
    wSuit, wProx, wAdv, maxLevels, hfStacking,
    viewScale,
  } = useStore();

  const workerRef = useRef<Worker | null>(null);
  const animRef = useRef<number | null>(null);
  const playbackTimeRef = useRef(0);
  const autoPlayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Create worker
  useEffect(() => {
    const w = new Worker(
      new URL('../engine/simulation.worker.ts', import.meta.url),
      { type: 'module' }
    );
    w.onmessage = (e) => {
      if (e.data.result) {
        const res = e.data.result as SimulationResult;
        setPhases(res.phases);
        setCurrentPhase(0);
        setSimulating(false);
        // Store log entries
        if (e.data.log) {
          const lines: string[] = [];
          for (const entry of e.data.log) {
            lines.push(`── PHASE ${entry.phase} ──`);
            lines.push(...entry.details);
          }
          useStore.getState().appendLog(lines);
        }
        // Auto-play after 1s delay
        if (autoPlayTimerRef.current) clearTimeout(autoPlayTimerRef.current);
        autoPlayTimerRef.current = setTimeout(() => {
          playbackTimeRef.current = 0;
          useStore.getState().setCurrentPhase(0);
          setPhaseBlendDirect(0);
          useStore.getState().setPlaying(true);
        }, 1000);
      }
    };
    workerRef.current = w;
    return () => w.terminate();
  }, []);

  // Smooth animation loop — float-based phase tracking at 60fps
  useEffect(() => {
    if (!playing || phases.length === 0) {
      if (animRef.current) {
        cancelAnimationFrame(animRef.current);
        animRef.current = null;
      }
      return;
    }

    let lastTs = performance.now();
    const phasesPerMs = playSpeed / 1000; // e.g. 15 phases/sec = 0.015 phases/ms

    const tick = (ts: number) => {
      const dt = ts - lastTs;
      lastTs = ts;

      playbackTimeRef.current += dt * phasesPerMs;
      const store = useStore.getState();
      const maxPhase = store.phases.length - 1;

      if (playbackTimeRef.current >= maxPhase) {
        if (store.looping) {
          playbackTimeRef.current = 0;
        } else {
          setCurrentPhase(maxPhase);
          setPhaseBlendDirect(0);
          setPlaying(false);
          return;
        }
      }

      const intPhase = Math.floor(playbackTimeRef.current);
      const blend = playbackTimeRef.current - intPhase;
      // Only update currentPhase when the integer changes (avoids unnecessary React re-renders)
      if (intPhase !== store.currentPhase) {
        setCurrentPhase(intPhase);
      }
      // Write blend directly to module variable (avoids 60 Zustand updates/sec)
      setPhaseBlendDirect(blend);

      animRef.current = requestAnimationFrame(tick);
    };

    animRef.current = requestAnimationFrame(tick);
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [playing, playSpeed, phases.length]);

  // Auto-run simulation
  useEffect(() => {
    if (seedId && targetId && dataLoaded && !simulating) {
      runSimulation();
    }
  }, [seedId, targetId, territoryCurve, computeCurve, totalPhases, wSuit, wProx, wAdv, maxLevels, hfStacking]);

  const runSimulation = useCallback(() => {
    const cells = getCellData();
    const adj = getAdjacency();
    if (!cells || !adj || !seedId || !targetId || !workerRef.current) return;

    // Stop playback and clear auto-play timer
    setPlaying(false);
    if (autoPlayTimerRef.current) clearTimeout(autoPlayTimerRef.current);
    playbackTimeRef.current = 0;

    setSimulating(true);
    useStore.getState().clearLog();
    const store = useStore.getState();
    workerRef.current.postMessage({
      cells,
      adjacency: adj,
      seedId,
      targetId,
      totalPhases,
      landCurve: territoryCurve,
      floorCurve: computeCurve,
      wSuit: store.wSuit,
      wProx: store.wProx,
      wAdv: store.wAdv,
      maxLevels: store.maxLevels,
      hfStacking: store.hfStacking,
    });
  }, [seedId, targetId, totalPhases, territoryCurve, computeCurve, wSuit, wProx, wAdv, maxLevels, hfStacking]);

  const togglePlay = useCallback(() => {
    if (playing) {
      setPlaying(false);
    } else if (phases.length > 0) {
      if (currentPhase >= phases.length - 1) {
        playbackTimeRef.current = 0;
        setCurrentPhase(0);
      } else {
        playbackTimeRef.current = currentPhase;
      }
      setPlaying(true);
    }
  }, [playing, phases.length, currentPhase]);

  // Scale bar
  const s = viewScale;
  const sbCandidates = [500, 1000, 2000, 5000, 10000, 20000, 50000];
  let sbDist = 5000;
  for (const c of sbCandidates) {
    if (c * s > 40 && c * s < 200) { sbDist = c; break; }
  }
  const kmLabel = sbDist >= 1000 ? `${sbDist / 1000} km` : `${sbDist} m`;
  const miLabel = sbDist >= 1000 ? `${(sbDist / 1609.34).toFixed(1)} mi` : `${Math.round(sbDist * 3.28084)} ft`;

  // Seed/target cell info
  const cellData = getCellData();
  const seedCell = seedId && cellData ? cellData[seedId] : null;
  const targetCell = targetId && cellData ? cellData[targetId] : null;

  return (
    <div style={styles.container}>
      {/* Title + play/pause */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <div style={styles.title}>Fieldwork</div>
        {seedId && (
          <button
            onClick={togglePlay}
            style={styles.playBtn}
            disabled={simulating || phases.length === 0}
            title={playing ? 'Pause' : 'Play'}
          >
            {playing ? '▮▮' : '▶'}
          </button>
        )}
      </div>

      {/* Map info */}
      <div style={styles.section}>
        <div style={styles.label}>ISN93 / LAMBERT 1993</div>
        <div style={styles.sublabel}>EPSG:3057</div>
      </div>

      {/* Scale */}
      <div style={styles.section}>
        <div style={styles.sectionTitle}>SCALE</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: Math.max(20, sbDist * s), height: 2, background: '#F5F5F5' }} />
          <span style={styles.value}>{kmLabel}</span>
        </div>
        <div style={styles.sublabel}>{miLabel}</div>
      </div>

      {/* Seed / Target coordinates */}
      <div style={styles.section}>
        <div style={styles.sectionTitle}>SEED</div>
        {seedCell ? (
          <div style={styles.value}>
            E {(seedCell.cx / 1000).toFixed(1)} N {(seedCell.cy / 1000).toFixed(1)}
          </div>
        ) : (
          <div style={styles.sublabel}>not placed</div>
        )}
        <div style={{ ...styles.sectionTitle, marginTop: 6 }}>TARGET</div>
        {targetCell ? (
          <div style={styles.value}>
            E {(targetCell.cx / 1000).toFixed(1)} N {(targetCell.cy / 1000).toFixed(1)}
          </div>
        ) : (
          <div style={styles.sublabel}>not placed</div>
        )}
      </div>

      {/* Grid info */}
      <div style={styles.section}>
        <div style={styles.sectionTitle}>GRID</div>
        <div style={styles.value}>500m CELLS — {cellData ? Object.keys(cellData).length.toLocaleString() : '—'}</div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 300,
    maxHeight: '100%',
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 0,
    zIndex: 10,
    fontFamily: "'ABC Diatype', 'Helvetica Neue', sans-serif",
    fontSize: 11,
    padding: '16px 16px',
  },
  title: {
    fontSize: 28,
    fontWeight: 400,
    color: '#F5F5F5',
    marginBottom: 16,
    letterSpacing: '-0.02em',
    fontFamily: "'ABC Diatype', 'Helvetica Neue', sans-serif",
  },
  section: {
    marginBottom: 12,
  },
  sectionTitle: {
    color: '#555',
    fontSize: 9,
    letterSpacing: '0.1em',
    marginBottom: 3,
    fontFamily: "'ABC Diatype', 'Helvetica Neue', sans-serif",
  },
  label: {
    color: '#999',
    fontSize: 11,
    lineHeight: '15px',
  },
  sublabel: {
    color: '#555',
    fontSize: 10,
    lineHeight: '14px',
  },
  value: {
    color: '#ccc',
    fontSize: 11,
    lineHeight: '16px',
  },
  playBtn: {
    background: 'transparent',
    border: '0.5px solid rgba(255,255,255,0.2)',
    borderRadius: 4,
    color: '#F5F5F5',
    fontSize: 11,
    width: 32,
    height: 28,
    cursor: 'pointer',
    fontFamily: "'ABC Diatype', 'Helvetica Neue', sans-serif",
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
};
