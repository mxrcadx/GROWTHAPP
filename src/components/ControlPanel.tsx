import { useStore } from '../store';
import { getCellData, getAdjacency } from './MapView';
import { exportPhaseDXF, downloadDXF } from '../utils/dxf';
import { exportPythonScript, downloadPythonScript } from '../utils/exportPython';
import { exportFrameSequence, DEFAULT_EXPORT_CONFIG } from '../utils/exportFrames';
import { renderPlanToCanvas } from './MapView';
import { useRef, useEffect, useCallback, useState } from 'react';
import type { SimulationResult } from '../types';

const PHASE_OPTIONS = [40, 100, 150, 200];
const SPEED_OPTIONS = [1, 2, 4, 8];

export default function ControlPanel() {
  const {
    dataLoaded, placementMode, setPlacementMode,
    seedId, targetId,
    landCurve, floorCurve,
    totalPhases, setTotalPhases,
    currentPhase, phases, setPhases, setCurrentPhase,
    simulating, setSimulating,
    playing, setPlaying, looping, setLooping, playSpeed, setPlaySpeed,
  } = useStore();

  const workerRef = useRef<Worker | null>(null);
  const animRef = useRef<number | null>(null);
  const lastTickRef = useRef(0);

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
        setCurrentPhase(Math.min(useStore.getState().currentPhase, res.phases.length - 1));
        setSimulating(false);
      }
    };
    workerRef.current = w;
    return () => w.terminate();
  }, []);

  // Auto-run simulation when seed+target are set, or curves change
  useEffect(() => {
    if (seedId && targetId && dataLoaded && !simulating) {
      runSimulation();
    }
  }, [seedId, targetId, landCurve, floorCurve, totalPhases]);

  const runSimulation = useCallback(() => {
    const cells = getCellData();
    const adj = getAdjacency();
    if (!cells || !adj || !seedId || !targetId || !workerRef.current) return;

    setSimulating(true);
    workerRef.current.postMessage({
      cells,
      adjacency: adj,
      seedId,
      targetId,
      totalPhases,
      landCurve,
      floorCurve,
    });
  }, [seedId, targetId, totalPhases, landCurve, floorCurve]);

  // Animation loop
  useEffect(() => {
    if (!playing || phases.length === 0) {
      if (animRef.current) {
        cancelAnimationFrame(animRef.current);
        animRef.current = null;
      }
      return;
    }

    const interval = 100 / playSpeed;

    const tick = (ts: number) => {
      const elapsed = ts - lastTickRef.current;
      if (elapsed >= interval) {
        lastTickRef.current = ts;
        const store = useStore.getState();
        const next = store.currentPhase + 1;
        if (next >= store.phases.length) {
          if (store.looping) {
            setCurrentPhase(0);
          } else {
            setPlaying(false);
            return;
          }
        } else {
          setCurrentPhase(next);
        }
      }
      animRef.current = requestAnimationFrame(tick);
    };

    lastTickRef.current = performance.now();
    animRef.current = requestAnimationFrame(tick);
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [playing, playSpeed, phases.length]);

  const togglePlay = useCallback(() => {
    if (playing) {
      setPlaying(false);
    } else if (phases.length > 0) {
      if (currentPhase >= phases.length - 1) {
        setCurrentPhase(0);
      }
      setPlaying(true);
    }
  }, [playing, phases.length, currentPhase]);

  const handleExportDXF = useCallback(() => {
    const cells = getCellData();
    if (!cells || phases.length === 0) return;
    const snapshot = phases[currentPhase];
    if (!snapshot) return;
    const dxf = exportPhaseDXF(snapshot, currentPhase, cells);
    const padded = String(currentPhase).padStart(3, '0');
    downloadDXF(dxf, `growth_phase_${padded}.dxf`);
  }, [phases, currentPhase]);

  const handleExportPython = useCallback(() => {
    const cells = getCellData();
    if (!cells || phases.length === 0) return;
    const script = exportPythonScript(phases, cells, seedId, targetId, landCurve, floorCurve);
    downloadPythonScript(script, `growth_sim_4x.py`);
  }, [phases, seedId, targetId, landCurve, floorCurve]);

  const [exportProgress, setExportProgress] = useState<{ pct: number; label: string } | null>(null);

  const handleExportFrames = useCallback(async () => {
    if (phases.length === 0 || !seedId || !targetId) return;
    setPlaying(false);
    try {
      await exportFrameSequence(
        renderPlanToCanvas,
        DEFAULT_EXPORT_CONFIG,
        (p) => {
          if (p.stage === 'rendering') {
            setExportProgress({
              pct: Math.round((p.current / p.total) * 100),
              label: 'RENDERING ' + p.current + '/' + p.total,
            });
          } else if (p.stage === 'packing') {
            setExportProgress({ pct: 100, label: 'PACKING ZIP...' });
          } else {
            setExportProgress(null);
          }
        },
      );
    } catch (err) {
      setExportProgress(null);
      console.error('Export failed:', err);
    }
  }, [phases.length, seedId, targetId]);

  const handleResetPlacement = useCallback(() => {
    setPlaying(false);
    useStore.getState().setSeedId(null);
    useStore.getState().setTargetId(null);
    useStore.getState().setPhases([]);
    useStore.getState().setCurrentPhase(0);
    setPlacementMode('seed');
  }, []);

  return (
    <div style={styles.container}>
      {/* Status */}
      <div style={styles.section}>
        <div style={styles.label}>
          {!dataLoaded ? 'LOADING DATA...' :
           placementMode === 'seed' ? 'CLICK MAP TO PLACE SEED' :
           placementMode === 'target' ? 'CLICK MAP TO PLACE TARGET' :
           simulating ? 'SIMULATING...' :
           `PHASE ${currentPhase} / ${phases.length - 1}`}
        </div>
        {seedId && (
          <button onClick={handleResetPlacement} style={styles.resetBtn}>
            RESET
          </button>
        )}
      </div>

      {/* Phase Slider */}
      {phases.length > 0 && (
        <div style={styles.section}>
          <div style={styles.miniLabel}>PHASE SCRUBBER</div>
          <input
            type="range"
            min={0}
            max={phases.length - 1}
            value={currentPhase}
            onChange={(e) => {
              setPlaying(false);
              setCurrentPhase(Number(e.target.value));
            }}
            style={styles.slider}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: '#555', fontSize: 9 }}>0</span>
            <span style={{ color: '#F5F5F5', fontSize: 10 }}>{currentPhase}</span>
            <span style={{ color: '#555', fontSize: 9 }}>{phases.length - 1}</span>
          </div>
        </div>
      )}

      {/* Growth Profile Info */}
      <div style={{ ...styles.section, borderColor: '#007AFF' }}>
        <div style={{ ...styles.sectionTitle, color: '#007AFF' }}>GROWTH PROFILE</div>
        <div style={styles.grayText}>DRAG POINTS ON GRAPH</div>
        <div style={styles.grayText}>DBL-CLICK = ADD POINT</div>
        <div style={styles.grayText}>RIGHT-CLICK = REMOVE</div>
        <div style={{ ...styles.grayText, marginTop: 4 }}>WHITE = LAND AREA</div>
        <div style={styles.grayText}>BLUE = FLOOR SPACE</div>
        {phases.length > 0 && phases[currentPhase] && (
          <div style={{ marginTop: 6 }}>
            <div style={{ color: '#F5F5F5', fontSize: 10 }}>
              LAND: {phases[currentPhase].landArea.toFixed(1)} km²
            </div>
            <div style={{ color: 'rgba(100,170,255,0.9)', fontSize: 10 }}>
              FLOOR: {phases[currentPhase].floorSpace.toFixed(1)} km²
            </div>
          </div>
        )}
      </div>

      {/* Export */}
      <div style={styles.section}>
        <div style={styles.row}>
          <div>
            <div style={styles.miniLabel}>EXPORT PHASE</div>
            <button
              onClick={handleExportDXF}
              style={styles.exportBtn}
              disabled={phases.length === 0}
            >
              DXF
            </button>
          </div>
          <div>
            <div style={styles.miniLabel}>EXPORT SIM</div>
            <button
              onClick={handleExportPython}
              style={styles.exportBtn}
              disabled={phases.length === 0}
            >
              PY 4x
            </button>
          </div>
          <div>
            <div style={styles.miniLabel}>EXPORT VIDEO</div>
            <button
              onClick={handleExportFrames}
              style={styles.exportBtn}
              disabled={!seedId || !targetId || phases.length === 0 || exportProgress !== null}
            >
              60FPS
            </button>
          </div>
        </div>
        {exportProgress && (
          <div style={{ marginTop: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
              <span style={{ color: '#007AFF', fontSize: 9 }}>{exportProgress.label}</span>
              <span style={{ color: '#007AFF', fontSize: 9 }}>{exportProgress.pct}%</span>
            </div>
            <div style={styles.progressTrack}>
              <div style={{ ...styles.progressBar, width: exportProgress.pct + '%' }} />
            </div>
          </div>
        )}
        {!seedId && phases.length === 0 && (
          <div style={{ marginTop: 6, color: '#555', fontSize: 9 }}>
            PLACE SEED + TARGET TO ENABLE EXPORT
          </div>
        )}
      </div>

      {/* Playback */}
      <div style={styles.section}>
        <div style={styles.sectionTitle}>TOTAL PHASES</div>
        <div style={styles.row}>
          {PHASE_OPTIONS.map((n) => (
            <button
              key={n}
              onClick={() => { setTotalPhases(n); }}
              style={{
                ...styles.phaseBtn,
                color: totalPhases === n ? '#F5F5F5' : '#555',
                borderColor: totalPhases === n ? '#F5F5F5' : '#333',
              }}
            >
              {n}
            </button>
          ))}
        </div>

        {/* Play + Loop */}
        <div style={{ ...styles.row, marginTop: 8 }}>
          <button
            onClick={togglePlay}
            style={{
              ...styles.playBtn,
              flex: 1,
              marginTop: 0,
              color: playing ? '#007AFF' : '#F5F5F5',
              borderColor: playing ? '#007AFF' : '#F5F5F5',
            }}
            disabled={!seedId || !targetId || simulating || phases.length === 0}
          >
            {playing ? 'PAUSE' : 'PLAY'}
          </button>
          <button
            onClick={() => setLooping(!looping)}
            style={{
              ...styles.phaseBtn,
              color: looping ? '#007AFF' : '#555',
              borderColor: looping ? '#007AFF' : '#333',
            }}
          >
            LOOP
          </button>
        </div>

        {/* Speed */}
        <div style={{ ...styles.row, marginTop: 6 }}>
          <span style={{ color: '#555', fontSize: 9, lineHeight: '24px' }}>SPEED</span>
          {SPEED_OPTIONS.map((s) => (
            <button
              key={s}
              onClick={() => setPlaySpeed(s)}
              style={{
                ...styles.phaseBtn,
                color: playSpeed === s ? '#F5F5F5' : '#555',
                borderColor: playSpeed === s ? '#F5F5F5' : '#333',
                padding: '2px 8px',
                fontSize: 9,
              }}
            >
              {s}x
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: 'absolute',
    bottom: 8,
    left: 4,
    width: 'calc(11.76% - 8px)',
    maxHeight: 'calc(100% - 16px)',
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    zIndex: 10,
    fontFamily: "'ABC Diatype Mono', 'Courier New', monospace",
    fontSize: 11,
  },
  section: {
    border: '0.5px solid #333',
    padding: 10,
    background: 'rgba(0,0,0,0.85)',
  },
  sectionTitle: {
    color: '#999',
    fontSize: 11,
    marginBottom: 8,
    letterSpacing: '0.05em',
  },
  label: {
    color: '#F5F5F5',
    fontSize: 11,
    letterSpacing: '0.05em',
  },
  grayText: {
    color: '#555',
    fontSize: 11,
    marginBottom: 2,
  },
  row: {
    display: 'flex',
    gap: 8,
  },
  miniLabel: {
    fontSize: 10,
    color: '#999',
    marginBottom: 4,
  },
  exportBtn: {
    background: 'transparent',
    border: '0.5px solid #F5F5F5',
    color: '#F5F5F5',
    fontSize: 10,
    padding: '4px 12px',
    cursor: 'pointer',
    fontFamily: "'ABC Diatype Mono', 'Courier New', monospace",
  },
  phaseBtn: {
    background: 'transparent',
    border: '0.5px solid #333',
    fontSize: 10,
    padding: '4px 10px',
    cursor: 'pointer',
    fontFamily: "'ABC Diatype Mono', 'Courier New', monospace",
  },
  playBtn: {
    marginTop: 8,
    width: '100%',
    background: 'transparent',
    border: '0.5px solid #F5F5F5',
    color: '#F5F5F5',
    fontSize: 11,
    padding: '6px',
    cursor: 'pointer',
    fontFamily: "'ABC Diatype Mono', 'Courier New', monospace",
    letterSpacing: '0.1em',
  },
  progressTrack: {
    width: '100%',
    height: 4,
    background: '#1a1a1a',
    border: '0.5px solid #333',
  },
  progressBar: {
    height: '100%',
    background: '#007AFF',
    transition: 'width 0.1s linear',
  },
  resetBtn: {
    marginTop: 6,
    background: 'transparent',
    border: '0.5px solid #555',
    color: '#999',
    fontSize: 9,
    padding: '2px 8px',
    cursor: 'pointer',
    fontFamily: "'ABC Diatype Mono', 'Courier New', monospace",
  },
  slider: {
    width: '100%',
    height: 4,
    appearance: 'none' as const,
    background: '#333',
    outline: 'none',
    cursor: 'pointer',
    marginBottom: 4,
    accentColor: '#007AFF',
  },
};
