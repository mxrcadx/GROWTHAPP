import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';

const DRIP_MS = 600;
const MAX_VISIBLE = 60;

// Pre-written algorithm simulation lines organized by context
const BOOT_LINES = [
  'sys::init epsg=3057 lambert_1993',
  'sys::load geothermal_suitability_500m.tif',
  'sys::load ork_heatflux_2020.tif',
  'sys::load terrain_hillshade_500m.tif',
  'sys::load iceland_coastline_clip.geojson',
  'sys::build cell_adjacency_graph edges=11145',
  'sys::index spatial_rtree cells=3096 t=0.4ms',
  'sys::cache normalize suitability range=[0.0,1.0]',
  'sys::cache normalize heatflux range=[0.0,287.3] mW/m²',
  'sys::ready grid=3096 adj=11145 epsg=3057',
];

const IDLE_LINES = [
  'sys::idle awaiting seed placement',
  'sys::scan adjacency integrity ok edges=11145',
  'sys::mem viewport alloc 12.4MB',
  'sys::idle grid cells=3096 resolution=500m',
  'sys::verify coastline_clip bounds=[285000,348000,405000,440000]',
  'sys::idle suitability cache valid',
  'sys::gc collect unreferenced phase_buffers',
  'sys::idle heatflux interpolation ready',
  'sys::ping worker thread alive t=0ms',
  'sys::idle awaiting user input',
];

const SEED_PLACED_LINES = [
  'algo::seed_placed evaluating neighborhood',
  'algo::read suitability(seed) → s=0.847',
  'algo::read heatflux(seed) → hf=142.3 mW/m²',
  'algo::adjacency(seed) → 6 neighbors',
  'algo::rank neighbors by w_suit*s + w_prox*d⁻¹',
  'algo::candidate n0 s=0.812 d=500m score=0.731',
  'algo::candidate n1 s=0.793 d=500m score=0.714',
  'algo::candidate n2 s=0.656 d=707m score=0.589',
  'algo::candidate n3 s=0.901 d=500m score=0.811',
  'algo::awaiting target for pathfinding',
];

const SIMULATING_LINES = [
  'sim::begin totalPhases=${totalPhases} seed=${seedId}',
  'sim::target=${targetId} computing optimal path',
  'sim::dijkstra init priority_queue cells=3096',
  'sim::dijkstra relax edge cost=w_suit*0.4 + w_prox*0.6',
  'sim::dijkstra visited=48 frontier=127 t=1.2ms',
  'sim::dijkstra visited=203 frontier=84 t=2.8ms',
  'sim::dijkstra path_found length=34 cost=12.47',
  'sim::allocate phase_buffer phases=${totalPhases}',
  'sim::phase_0 evaluate 6 candidates',
  'sim::score cell_2847 s=0.812 prox=0.94 → 0.731',
  'sim::score cell_1203 s=0.901 prox=0.88 → 0.811',
  'sim::score cell_0944 s=0.656 prox=0.71 → 0.589',
  'sim::select cell_1203 score=0.811 levels=1',
  'sim::territory += 0.25 km² total=0.25 km²',
  'sim::compute += 0.0625 km² total=0.0625 km²',
  'sim::phase_1 expand from 2 occupied cells',
  'sim::adjacency scan neighbors=11 unique=9',
  'sim::score cell_2201 s=0.878 prox=0.96 hf=168.2 → 0.843',
  'sim::score cell_3004 s=0.734 prox=0.82 hf=94.1 → 0.691',
  'sim::score cell_1588 s=0.921 prox=0.91 hf=201.4 → 0.872',
  'sim::select cell_1588 score=0.872 levels=2',
  'sim::hf_stack cell_1588 hf=201.4 > threshold → levels+=1',
  'sim::territory += 0.25 km² total=0.75 km²',
  'sim::advance_weight bias=0.0 direction=neutral',
  'sim::phase_2 expand from 3 occupied cells',
  'sim::frontier=14 candidates after dedup',
  'sim::hermite interpolate target_area(phase=2) → 2.1 km²',
  'sim::cells_needed=ceil(2.1/0.25)=9 allocated=3 deficit=6',
  'sim::batch_select top 6 by score',
  'sim::select cell_2847 score=0.731',
  'sim::select cell_0771 score=0.804',
  'sim::select cell_1922 score=0.768',
  'sim::select cell_3011 score=0.692',
  'sim::select cell_0483 score=0.745',
  'sim::select cell_2156 score=0.719',
  'sim::territory=2.25 km² compute=0.875 km²',
  'sim::phase_3 frontier=31 candidates',
  'sim::suitability range [0.412, 0.934] mean=0.721',
  'sim::proximity range [0.31, 0.99] mean=0.74',
  'sim::composite score range [0.389, 0.891]',
  'sim::target_area(3)=4.8 km² deficit=10 cells',
  'sim::smart_shed check: no cells below threshold',
  'sim::allocating levels: hf>150 → 3lvl, hf>100 → 2lvl',
  'sim::phase_3 complete occ=19 territory=4.75 km²',
];

const PLAYBACK_LINES = [
  'play::phase=${phase} blend=${blend} t=${t}s',
  'play::territory=${territory} km² compute=${compute} km²',
  'play::cells_occupied=${cells} levels_max=${maxLevels}',
  'play::interpolate phase ${phase}→${nextPhase} blend=${blend}',
  'play::render occupied cells=${cells} draw_calls=${draws}',
  'play::color_map theme=${theme} range=[0,${maxPhase}]',
  'play::viewport cx=${cx} cy=${cy} scale=${scale}',
  'play::frame dt=16.7ms fps=60',
  'play::advance phase=${phase} territory_delta=+${delta} km²',
  'play::suitability heatmap active cells=${cells}',
];

const IDLE_POST_SIM_LINES = [
  'sys::ready phases=${totalPhases} scrub=enabled',
  'sys::phase ${phase} occ=${cells} territory=${territory} km²',
  'sys::mem phase_buffer ${totalPhases}×3096 = ${mem}KB',
  'sys::idle heatflux range [14.2, 287.3] mW/m²',
  'sys::idle suitability mean=0.614 σ=0.187',
  'sys::viewport cx=${cx} cy=${cy} s=${scale}',
  'sys::curve territory_target(${phase})=${target} km²',
  'sys::curve compute_target(${phase})=${ctarget} km²',
  'sys::idle phase=${phase} awaiting input',
  'sys::gc phase_buffer refcount=1 retained',
];

function fillTemplate(line: string, vars: Record<string, string | number>): string {
  return line.replace(/\$\{(\w+)\}/g, (_, key) => String(vars[key] ?? '?'));
}

function getContextLines(store: ReturnType<typeof useStore.getState>): string[] {
  if (!store.dataLoaded) return BOOT_LINES;
  if (!store.seedId && !store.targetId && store.phases.length === 0) return IDLE_LINES;
  if (store.seedId && !store.targetId) return SEED_PLACED_LINES;
  if (store.simulating) return SIMULATING_LINES;
  if (store.playing) return PLAYBACK_LINES;
  if (store.phases.length > 0) return IDLE_POST_SIM_LINES;
  return IDLE_LINES;
}

function getTemplateVars(store: ReturnType<typeof useStore.getState>, tick: number): Record<string, string | number> {
  const t = (tick * DRIP_MS / 1000).toFixed(1);
  const p = store.phases[store.currentPhase];
  return {
    t,
    totalPhases: store.totalPhases,
    seedId: store.seedId ?? '—',
    targetId: store.targetId ?? '—',
    phase: store.currentPhase,
    nextPhase: Math.min(store.currentPhase + 1, store.totalPhases - 1),
    blend: store.phaseBlend.toFixed(2),
    territory: p ? p.landArea.toFixed(1) : '0.0',
    compute: p ? p.floorSpace.toFixed(1) : '0.0',
    cells: p ? Object.keys(p.occupied).length : 0,
    maxLevels: store.maxLevels,
    draws: p ? Object.keys(p.occupied).length * 2 : 0,
    theme: store.colorTheme,
    maxPhase: store.phases.length > 0 ? store.phases.length - 1 : store.totalPhases - 1,
    cx: store.viewCenterX.toFixed(0),
    cy: store.viewCenterY.toFixed(0),
    scale: store.viewScale.toFixed(4),
    delta: p ? (p.landArea / Math.max(store.currentPhase, 1) * 0.25).toFixed(2) : '0.00',
    mem: (store.totalPhases * 3096 * 4 / 1024).toFixed(0),
    target: p ? p.landArea.toFixed(1) : '0.0',
    ctarget: p ? p.floorSpace.toFixed(1) : '0.0',
  };
}

export default function AlgorithmLog() {
  const containerRef = useRef<HTMLDivElement>(null);
  const algorithmLog = useStore(s => s.algorithmLog);
  const [lines, setLines] = useState<string[]>([]);
  const logIndexRef = useRef(0);
  const tickRef = useRef(0);
  const contextIndexRef = useRef(0);

  // Single continuous timer — NEVER stops
  useEffect(() => {
    const interval = setInterval(() => {
      tickRef.current++;
      const store = useStore.getState();
      const log = store.algorithmLog;

      // If there are sim log lines we haven't shown yet, drip one
      if (log.length > 0 && logIndexRef.current < log.length) {
        let targetIdx = log.length;
        for (let i = 0; i < log.length; i++) {
          if (log[i].startsWith('\u2500\u2500 PHASE ')) {
            const pNum = parseInt(log[i].replace('\u2500\u2500 PHASE ', ''));
            if (pNum > store.currentPhase) {
              targetIdx = i;
              break;
            }
          }
        }

        if (logIndexRef.current < targetIdx) {
          logIndexRef.current++;
          const line = log[logIndexRef.current - 1];
          setLines(prev => [...prev, line].slice(-MAX_VISIBLE));
          return;
        }
      }

      // Cycle through context-appropriate pre-written lines
      const contextLines = getContextLines(store);
      const vars = getTemplateVars(store, tickRef.current);
      const idx = contextIndexRef.current % contextLines.length;
      const line = fillTemplate(contextLines[idx], vars);
      contextIndexRef.current++;

      setLines(prev => [...prev, line].slice(-MAX_VISIBLE));
    }, DRIP_MS);

    return () => clearInterval(interval);
  }, []);

  // Reset when sim log clears (new simulation)
  useEffect(() => {
    if (algorithmLog.length === 0) {
      logIndexRef.current = 0;
    }
  }, [algorithmLog.length]);

  // Auto-scroll
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [lines]);

  return (
    <div style={styles.container} ref={containerRef}>
      {lines.map((line, i) => (
        <div key={i} style={styles.line}>{line}</div>
      ))}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    width: 340,
    maxHeight: 'calc(100% - 280px)',
    overflowY: 'auto',
    overflowX: 'hidden',
    zIndex: 10,
    padding: '8px 16px',
    background: 'transparent',
    fontFamily: "'ABC Diatype Mono', 'Courier New', monospace",
    fontSize: 7,
    lineHeight: '11px',
  },
  line: {
    color: '#666',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all' as const,
    fontFamily: "'ABC Diatype Mono', 'Courier New', monospace",
    fontSize: 7,
  },
};
