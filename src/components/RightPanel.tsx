import { useCallback, useState } from 'react';
import { useStore } from '../store';
import { getCellData } from './MapView';
import { exportPhaseDXF, downloadDXF } from '../utils/dxf';
import { exportPythonScript, downloadPythonScript } from '../utils/exportPython';
import { exportFrameSequence, DEFAULT_EXPORT_CONFIG } from '../utils/exportFrames';
import { renderPlanToCanvas } from './MapView';
import type { ColorTheme } from '../types';

const COLOR_THEMES: { key: ColorTheme; label: string; desc: string }[] = [
  { key: 'age', label: 'AGE', desc: 'colonization sequence' },
  { key: 'suitability', label: 'SUIT', desc: 'geothermal suitability' },
  { key: 'heatflux', label: 'HF', desc: 'heat flux intensity' },
  { key: 'levels', label: 'LVL', desc: 'stacking density' },
];

export default function RightPanel() {
  const {
    rightPanelOpen, setRightPanelOpen,
    colorTheme, setColorTheme,
    playing, setPlaying,
    seedId, targetId,
    currentPhase, phases,
    simulating, dataLoaded, placementMode,
    totalPhases,
    territoryCurve, computeCurve,
  } = useStore();

  const [exportProgress, setExportProgress] = useState<{ pct: number; label: string } | null>(null);

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
    const script = exportPythonScript(phases, cells, seedId, targetId, territoryCurve, computeCurve);
    downloadPythonScript(script, `growth_sim_4x.py`);
  }, [phases, seedId, targetId, territoryCurve, computeCurve]);

  const handleResetPlacement = useCallback(() => {
    useStore.getState().setPlaying(false);
    useStore.getState().setSeedId(null);
    useStore.getState().setTargetId(null);
    useStore.getState().setPhases([]);
    useStore.getState().setCurrentPhase(0);
    useStore.getState().clearLog();
    useStore.getState().setPlacementMode('seed');
  }, []);

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
              label: `exporting phases ${p.current}/${p.total}...`,
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

  // Collapsed state — just show toggle button
  if (!rightPanelOpen) {
    return (
      <button onClick={() => setRightPanelOpen(true)} style={styles.toggleBtn}>
        ◂
      </button>
    );
  }

  return (
    <div style={styles.container}>
      {/* Hide button */}
      <button onClick={() => setRightPanelOpen(false)} style={styles.hideBtn}>
        ▸
      </button>

      {/* Growth Profile */}
      <div style={styles.section}>
        <div style={styles.sectionTitle}>GROWTH PROFILE</div>
        <div style={styles.statusText}>
          {!dataLoaded ? 'LOADING DATA...' :
           placementMode === 'seed' ? 'CLICK MAP TO PLACE SEED' :
           placementMode === 'target' ? 'CLICK MAP TO PLACE TARGET' :
           simulating ? 'SIMULATING...' :
           phases.length > 0 ? `PHASE ${currentPhase} / ${totalPhases - 1}` : 'READY'}
        </div>
        {phases.length > 0 && phases[currentPhase] && (
          <div style={{ marginTop: 6 }}>
            <div style={styles.statValue}>
              TERRITORY: {phases[currentPhase].landArea.toFixed(1)} km²
            </div>
            <div style={{ ...styles.statValue, color: 'rgba(100,170,255,0.9)' }}>
              COMPUTE: {phases[currentPhase].floorSpace.toFixed(1)} km²
            </div>
          </div>
        )}
        {seedId && (
          <button onClick={handleResetPlacement} style={styles.resetBtn}>
            RESET
          </button>
        )}
      </div>

      {/* Color Picker */}
      <div style={styles.section}>
        <div style={styles.sectionTitle}>COLOR PICKER</div>
        <div style={styles.themeGrid}>
          {COLOR_THEMES.map(({ key, label, desc }) => (
            <button
              key={key}
              onClick={() => setColorTheme(key)}
              style={{
                ...styles.themeBtn,
                borderColor: colorTheme === key ? '#F5F5F5' : 'rgba(255,255,255,0.1)',
                color: colorTheme === key ? '#F5F5F5' : '#666',
              }}
              title={desc}
            >
              {label}
            </button>
          ))}
        </div>
        <div style={styles.themeDesc}>
          {COLOR_THEMES.find(t => t.key === colorTheme)?.desc}
        </div>
      </div>

      {/* Exporter */}
      <div style={styles.section}>
        <div style={styles.sectionTitle}>EXPORTER</div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={handleExportDXF} style={styles.exportBtn} disabled={phases.length === 0}>DXF</button>
          <button onClick={handleExportPython} style={styles.exportBtn} disabled={phases.length === 0}>PY SCRIPT</button>
          <button onClick={handleExportFrames} style={styles.exportBtn} disabled={!seedId || !targetId || phases.length === 0 || exportProgress !== null}>60FPS</button>
        </div>
        {exportProgress && (
          <div style={{ marginTop: 8 }}>
            <div style={styles.progressTrack}>
              <div style={{ ...styles.progressBar, width: exportProgress.pct + '%' }} />
            </div>
            <div style={{ color: '#777', fontSize: 8, marginTop: 2 }}>{exportProgress.label}</div>
          </div>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    width: 260,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    zIndex: 10,
    fontFamily: "'ABC Diatype', 'Helvetica Neue', sans-serif",
    fontSize: 11,
  },
  toggleBtn: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    width: 24,
    height: 24,
    background: 'rgba(13,13,13,0.9)',
    border: '0.5px solid rgba(255,255,255,0.1)',
    borderRadius: 4,
    color: '#999',
    fontSize: 12,
    cursor: 'pointer',
    zIndex: 10,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  hideBtn: {
    alignSelf: 'flex-end',
    width: 24,
    height: 24,
    background: 'rgba(13,13,13,0.9)',
    border: '0.5px solid rgba(255,255,255,0.1)',
    borderRadius: 4,
    color: '#999',
    fontSize: 12,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  section: {
    background: 'rgba(13,13,13,0.95)',
    border: '0.5px solid rgba(255,255,255,0.1)',
    borderRadius: 6,
    padding: 12,
  },
  sectionTitle: {
    color: '#777',
    fontSize: 10,
    letterSpacing: '0.06em',
    marginBottom: 8,
    fontFamily: "'ABC Diatype', 'Helvetica Neue', sans-serif",
  },
  themeGrid: {
    display: 'flex',
    gap: 6,
  },
  themeBtn: {
    flex: 1,
    background: 'transparent',
    border: '0.5px solid rgba(255,255,255,0.1)',
    borderRadius: 4,
    fontSize: 9,
    padding: '6px 4px',
    cursor: 'pointer',
    fontFamily: "'ABC Diatype', 'Helvetica Neue', sans-serif",
    letterSpacing: '0.05em',
  },
  themeDesc: {
    color: '#555',
    fontSize: 9,
    marginTop: 6,
    textAlign: 'center' as const,
  },
  resetBtn: {
    marginTop: 8,
    background: 'transparent',
    border: '0.5px solid rgba(255,255,255,0.15)',
    borderRadius: 4,
    color: '#999',
    fontSize: 9,
    padding: '4px 10px',
    cursor: 'pointer',
    fontFamily: "'ABC Diatype', 'Helvetica Neue', sans-serif",
    letterSpacing: '0.06em',
  },
  exportBtn: {
    flex: 1,
    background: 'transparent',
    border: '0.5px solid rgba(255,255,255,0.15)',
    borderRadius: 4,
    color: '#999',
    fontSize: 9,
    padding: '6px 4px',
    cursor: 'pointer',
    fontFamily: "'ABC Diatype', 'Helvetica Neue', sans-serif",
  },
  progressTrack: {
    width: '100%',
    height: 3,
    background: '#1a1a1a',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    background: 'linear-gradient(90deg, #FF00FF, #FF6B6B)',
    transition: 'width 0.1s linear',
  },
  statusText: {
    color: '#F5F5F5',
    fontSize: 10,
    letterSpacing: '0.05em',
    marginTop: 4,
    fontFamily: "'ABC Diatype', 'Helvetica Neue', sans-serif",
  },
  statValue: {
    color: '#ccc',
    fontSize: 11,
    lineHeight: '16px',
    fontFamily: "'ABC Diatype', 'Helvetica Neue', sans-serif",
  },
};
