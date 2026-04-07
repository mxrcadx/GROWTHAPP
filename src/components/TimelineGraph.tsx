import { useRef, useEffect, useCallback, useState } from 'react';
import { useStore } from '../store';
import type { CurvePoint } from '../types';

const PAD_LEFT = 90;
const PAD_RIGHT = 20;
const PAD_TOP = 30;
const PAD_BOTTOM = 40;
const MAX_Y = 500; // km² max on Y axis
const HANDLE_RADIUS = 6;
const SNAP_RADIUS = 12;

type DragTarget =
  | { type: 'scrubber' }
  | { type: 'territory'; index: number }
  | { type: 'compute'; index: number }
  | null;

function interpolateCurve(points: CurvePoint[], phase: number): number {
  if (points.length === 0) return 0;
  if (phase <= points[0].phase) return points[0].value;
  if (phase >= points[points.length - 1].phase) return points[points.length - 1].value;

  let i = 0;
  while (i < points.length - 1 && points[i + 1].phase < phase) i++;

  const p0 = points[i];
  const p1 = points[i + 1];
  const dx = p1.phase - p0.phase;
  if (dx === 0) return p0.value;

  const t = (phase - p0.phase) / dx;

  const m0 = i > 0
    ? 0.5 * (p1.value - points[i - 1].value) / (p1.phase - points[i - 1].phase) * dx
    : (p1.value - p0.value);
  const m1 = i < points.length - 2
    ? 0.5 * (points[i + 2].value - p0.value) / (points[i + 2].phase - p0.phase) * dx
    : (p1.value - p0.value);

  const t2 = t * t;
  const t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;

  return Math.max(0, h00 * p0.value + h10 * m0 + h01 * p1.value + h11 * m1);
}

export default function TimelineGraph() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragTarget = useRef<DragTarget>(null);
  const [collapsed, setCollapsed] = useState(true);

  const phases = useStore(s => s.phases);
  const currentPhase = useStore(s => s.currentPhase);
  const setCurrentPhase = useStore(s => s.setCurrentPhase);
  const totalPhases = useStore(s => s.totalPhases);
  const territoryCurve = useStore(s => s.territoryCurve);
  const computeCurve = useStore(s => s.computeCurve);
  const setTerritoryCurve = useStore(s => s.setTerritoryCurve);
  const setComputeCurve = useStore(s => s.setComputeCurve);

  const getPlotMetrics = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const W = rect.width;
    const H = rect.height;
    const plotW = W - PAD_LEFT - PAD_RIGHT;
    const plotH = H - PAD_TOP - PAD_BOTTOM;
    const xPos = (phase: number) => PAD_LEFT + (phase / Math.max(totalPhases - 1, 1)) * plotW;
    const yPos = (v: number) => PAD_TOP + plotH - (v / MAX_Y) * plotH;
    const phaseFromX = (x: number) => Math.round(Math.max(0, Math.min(totalPhases - 1, ((x - PAD_LEFT) / plotW) * (totalPhases - 1))));
    const valueFromY = (y: number) => Math.max(0, Math.min(MAX_Y, ((PAD_TOP + plotH - y) / plotH) * MAX_Y));
    return { W, plotW, plotH, xPos, yPos, phaseFromX, valueFromY, rect };
  }, [totalPhases]);

  // Draw
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * devicePixelRatio;
    canvas.height = rect.height * devicePixelRatio;
    ctx.scale(devicePixelRatio, devicePixelRatio);

    const W = rect.width;
    const H = rect.height;
    const plotW = W - PAD_LEFT - PAD_RIGHT;
    const plotH = H - PAD_TOP - PAD_BOTTOM;

    const xPos = (phase: number) => PAD_LEFT + (phase / Math.max(totalPhases - 1, 1)) * plotW;
    const yPos = (v: number) => PAD_TOP + plotH - (v / MAX_Y) * plotH;

    // Background — transparent so backdrop-filter inversion shows through
    ctx.clearRect(0, 0, W, H);
    const br = 8;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath();
    ctx.roundRect(0, 0, W, H, br);
    ctx.fill();

    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.roundRect(0, 0, W, H, br);
    ctx.stroke();

    ctx.font = '10px "ABC Diatype Mono", "Courier New", monospace';

    // Y axis grid lines + labels
    ctx.fillStyle = '#555';
    ctx.textAlign = 'right';
    for (let v = 0; v <= MAX_Y; v += 100) {
      const y = yPos(v);
      ctx.strokeStyle = '#1a1a1a';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(PAD_LEFT, y);
      ctx.lineTo(W - PAD_RIGHT, y);
      ctx.stroke();
      if (v > 0) {
        ctx.fillText(`${v}`, PAD_LEFT - 8, y + 3);
      }
    }

    // Axis lines
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(PAD_LEFT, PAD_TOP);
    ctx.lineTo(PAD_LEFT, H - PAD_BOTTOM);
    ctx.lineTo(W - PAD_RIGHT, H - PAD_BOTTOM);
    ctx.stroke();

    // Labels
    ctx.fillStyle = '#999';
    ctx.font = '9px "ABC Diatype Mono", "Courier New", monospace';
    ctx.textAlign = 'right';
    ctx.fillText('km\u00B2', PAD_LEFT - 8, PAD_TOP - 4);
    ctx.textAlign = 'center';
    ctx.fillText('PHASES', (PAD_LEFT + W - PAD_RIGHT) / 2, H - 6);

    // X axis ticks
    ctx.font = '8px "ABC Diatype Mono", "Courier New", monospace';
    ctx.fillStyle = '#555';
    const tickInterval = Math.max(1, Math.floor(totalPhases / 10));
    for (let i = 0; i <= totalPhases; i += tickInterval) {
      const x = xPos(i);
      ctx.strokeStyle = '#333';
      ctx.beginPath();
      ctx.moveTo(x, H - PAD_BOTTOM);
      ctx.lineTo(x, H - PAD_BOTTOM + 4);
      ctx.stroke();
      ctx.textAlign = 'center';
      ctx.fillText(`${i}`, x, H - PAD_BOTTOM + 14);
    }

    // Sample curves at pixel resolution
    const sampleStep = Math.max(1, Math.floor(totalPhases / plotW * 2));

    // Filled area between compute and territory curves (stacking region)
    ctx.beginPath();
    for (let px = 0; px <= totalPhases - 1; px += sampleStep) {
      const x = xPos(px);
      const y = yPos(interpolateCurve(computeCurve, px));
      if (px === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    { const x = xPos(totalPhases - 1); ctx.lineTo(x, yPos(interpolateCurve(computeCurve, totalPhases - 1))); }
    for (let px = totalPhases - 1; px >= 0; px -= sampleStep) {
      const x = xPos(px);
      const y = yPos(interpolateCurve(territoryCurve, px));
      ctx.lineTo(x, y);
    }
    { const x = xPos(0); ctx.lineTo(x, yPos(interpolateCurve(territoryCurve, 0))); }
    ctx.closePath();
    ctx.fillStyle = 'rgba(57, 255, 20, 0.06)';
    ctx.fill();

    // Draw COMPUTE interpolated curve
    ctx.strokeStyle = '#F5F5F5';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let px = 0; px <= totalPhases - 1; px += sampleStep) {
      const x = xPos(px);
      const y = yPos(interpolateCurve(computeCurve, px));
      if (px === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    { const x = xPos(totalPhases - 1); ctx.lineTo(x, yPos(interpolateCurve(computeCurve, totalPhases - 1))); }
    ctx.stroke();

    // Draw TERRITORY interpolated curve
    ctx.strokeStyle = '#39FF14';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let px = 0; px <= totalPhases - 1; px += sampleStep) {
      const x = xPos(px);
      const y = yPos(interpolateCurve(territoryCurve, px));
      if (px === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    { const x = xPos(totalPhases - 1); ctx.lineTo(x, yPos(interpolateCurve(territoryCurve, totalPhases - 1))); }
    ctx.stroke();

    // Actual simulation results — thin dotted lines
    if (phases.length > 0) {
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      for (let i = 0; i < phases.length; i++) {
        const x = xPos(i);
        const y = yPos(phases[i].landArea);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.beginPath();
      for (let i = 0; i < phases.length; i++) {
        const x = xPos(i);
        const y = yPos(phases[i].floorSpace);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Compute control point handles
    for (const pt of computeCurve) {
      const x = xPos(pt.phase);
      const y = yPos(pt.value);
      ctx.fillStyle = '#F5F5F5';
      ctx.strokeStyle = '#999';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x, y, HANDLE_RADIUS - 1, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // Territory control point handles
    for (const pt of territoryCurve) {
      const x = xPos(pt.phase);
      const y = yPos(pt.value);
      ctx.fillStyle = '#39FF14';
      ctx.strokeStyle = '#2bcc10';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x, y, HANDLE_RADIUS, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // Scrubber line — always visible for previewing position
    {
      const scrubX = xPos(currentPhase);
      ctx.strokeStyle = phases.length > 0 ? '#F5F5F5' : 'rgba(255,255,255,0.3)';
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(scrubX, PAD_TOP);
      ctx.lineTo(scrubX, H - PAD_BOTTOM);
      ctx.stroke();

      ctx.fillStyle = phases.length > 0 ? '#F5F5F5' : 'rgba(255,255,255,0.3)';
      ctx.fillRect(scrubX - 4, H - PAD_BOTTOM - 2, 8, 6);

      ctx.fillStyle = phases.length > 0 ? '#F5F5F5' : 'rgba(255,255,255,0.4)';
      ctx.textAlign = 'left';
      ctx.font = '9px "ABC Diatype Mono", "Courier New", monospace';
      if (phases.length > 0 && phases[currentPhase]) {
        const p = phases[currentPhase];
        ctx.fillText(
          `P${currentPhase}  TERRITORY: ${p.landArea.toFixed(1)} km\u00B2  COMPUTE: ${p.floorSpace.toFixed(1)} km\u00B2`,
          PAD_LEFT + 4, PAD_TOP - 8
        );
      } else {
        ctx.fillText(`P${currentPhase}`, PAD_LEFT + 4, PAD_TOP - 8);
      }
    }

    // Legend — top left (ABC Diatype Regular, not Mono)
    ctx.font = '9px "ABC Diatype", "Helvetica Neue", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#39FF14';
    ctx.fillText('TERRITORY', 12, 14);
    ctx.fillStyle = '#F5F5F5';
    ctx.fillText('COMPUTE', 12, 26);

  }, [phases, currentPhase, totalPhases, territoryCurve, computeCurve, collapsed]);

  // Mouse interaction
  const handleMouse = useCallback((e: React.MouseEvent, down?: boolean) => {
    const m = getPlotMetrics();
    if (!m) return;

    const x = e.clientX - m.rect.left;
    const y = e.clientY - m.rect.top;

    if (down === false) {
      dragTarget.current = null;
      return;
    }

    if (down === true) {
      let best: DragTarget = null;
      let bestDist = SNAP_RADIUS;

      for (let i = 0; i < territoryCurve.length; i++) {
        const hx = m.xPos(territoryCurve[i].phase);
        const hy = m.yPos(territoryCurve[i].value);
        const d = Math.sqrt((x - hx) ** 2 + (y - hy) ** 2);
        if (d < bestDist) { bestDist = d; best = { type: 'territory', index: i }; }
      }

      for (let i = 0; i < computeCurve.length; i++) {
        const hx = m.xPos(computeCurve[i].phase);
        const hy = m.yPos(computeCurve[i].value);
        const d = Math.sqrt((x - hx) ** 2 + (y - hy) ** 2);
        if (d < bestDist) { bestDist = d; best = { type: 'compute', index: i }; }
      }

      if (!best) {
        best = { type: 'scrubber' };
      }

      dragTarget.current = best;
    }

    const target = dragTarget.current;
    if (!target) return;

    if (target.type === 'scrubber') {
      const store = useStore.getState();
      if (store.playing) store.setPlaying(false);
      const ratio = Math.max(0, Math.min(1, (x - PAD_LEFT) / m.plotW));
      const maxPhase = phases.length > 0 ? phases.length - 1 : totalPhases - 1;
      setCurrentPhase(Math.round(ratio * maxPhase));
      return;
    }

    const newValue = Math.round(m.valueFromY(y));

    if (target.type === 'territory') {
      const pts = [...territoryCurve];
      const i = target.index;
      if (i === 0 || i === pts.length - 1) {
        pts[i] = { ...pts[i], value: newValue };
      } else {
        const newPhase = m.phaseFromX(x);
        const minPhase = pts[i - 1].phase + 1;
        const maxPhase = pts[i + 1].phase - 1;
        pts[i] = { phase: Math.max(minPhase, Math.min(maxPhase, newPhase)), value: newValue };
      }
      setTerritoryCurve(pts);
      return;
    }

    if (target.type === 'compute') {
      const pts = [...computeCurve];
      const i = target.index;
      if (i === 0 || i === pts.length - 1) {
        pts[i] = { ...pts[i], value: newValue };
      } else {
        const newPhase = m.phaseFromX(x);
        const minPhase = pts[i - 1].phase + 1;
        const maxPhase = pts[i + 1].phase - 1;
        pts[i] = { phase: Math.max(minPhase, Math.min(maxPhase, newPhase)), value: newValue };
      }
      setComputeCurve(pts);
    }
  }, [phases, totalPhases, territoryCurve, computeCurve, setTerritoryCurve, setComputeCurve, setCurrentPhase, getPlotMetrics]);

  // Double-click to add a control point
  const handleDblClick = useCallback((e: React.MouseEvent) => {
    const m = getPlotMetrics();
    if (!m) return;
    const x = e.clientX - m.rect.left;
    const y = e.clientY - m.rect.top;
    const phase = m.phaseFromX(x);
    const value = Math.round(m.valueFromY(y));

    const territoryY = m.yPos(interpolateCurve(territoryCurve, phase));
    const computeY = m.yPos(interpolateCurve(computeCurve, phase));
    const territoryDist = Math.abs(y - territoryY);
    const computeDist = Math.abs(y - computeY);

    if (territoryDist <= computeDist) {
      const pts = [...territoryCurve, { phase, value }].sort((a, b) => a.phase - b.phase);
      setTerritoryCurve(pts);
    } else {
      const pts = [...computeCurve, { phase, value }].sort((a, b) => a.phase - b.phase);
      setComputeCurve(pts);
    }
  }, [territoryCurve, computeCurve, setTerritoryCurve, setComputeCurve, getPlotMetrics]);

  // Right-click to remove a control point (not first/last)
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const m = getPlotMetrics();
    if (!m) return;
    const x = e.clientX - m.rect.left;
    const y = e.clientY - m.rect.top;

    let bestDist = SNAP_RADIUS * 2;
    let bestCurve: 'territory' | 'compute' | null = null;
    let bestIdx = -1;

    for (let i = 1; i < territoryCurve.length - 1; i++) {
      const d = Math.sqrt((x - m.xPos(territoryCurve[i].phase)) ** 2 + (y - m.yPos(territoryCurve[i].value)) ** 2);
      if (d < bestDist) { bestDist = d; bestCurve = 'territory'; bestIdx = i; }
    }
    for (let i = 1; i < computeCurve.length - 1; i++) {
      const d = Math.sqrt((x - m.xPos(computeCurve[i].phase)) ** 2 + (y - m.yPos(computeCurve[i].value)) ** 2);
      if (d < bestDist) { bestDist = d; bestCurve = 'compute'; bestIdx = i; }
    }

    if (bestCurve === 'territory' && bestIdx > 0) {
      setTerritoryCurve(territoryCurve.filter((_, i) => i !== bestIdx));
    } else if (bestCurve === 'compute' && bestIdx > 0) {
      setComputeCurve(computeCurve.filter((_, i) => i !== bestIdx));
    }
  }, [territoryCurve, computeCurve, setTerritoryCurve, setComputeCurve, getPlotMetrics]);

  if (collapsed) {
    return (
      <button onClick={() => setCollapsed(false)} style={styles.collapseBtn}>
        {'\u25B4'} CURVES
      </button>
    );
  }

  return (
    <div style={styles.wrapper}>
      {/* Backdrop invert layer — only inverts map behind, not content */}
      <div style={styles.backdrop} />
      <button onClick={() => setCollapsed(true)} style={styles.hideBtn}>{'\u25BE'}</button>
      <canvas
        ref={canvasRef}
        style={styles.canvas}
        onMouseDown={(e) => handleMouse(e, true)}
        onMouseMove={(e) => handleMouse(e)}
        onMouseUp={(e) => handleMouse(e, false)}
        onMouseLeave={(e) => handleMouse(e, false)}
        onDoubleClick={handleDblClick}
        onContextMenu={handleContextMenu}
      />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    position: 'absolute',
    bottom: 8,
    left: 360,
    right: 320,
    height: 300,
    zIndex: 10,
  },
  backdrop: {
    position: 'absolute',
    inset: 0,
    borderRadius: 8,
    backdropFilter: 'invert(0.12) brightness(0.4)',
    WebkitBackdropFilter: 'invert(0.12) brightness(0.4)',
    pointerEvents: 'none',
    zIndex: 0,
  } as React.CSSProperties,
  canvas: {
    position: 'relative',
    width: '100%',
    height: '100%',
    display: 'block',
    cursor: 'crosshair',
    zIndex: 1,
  },
  collapseBtn: {
    position: 'absolute',
    bottom: 8,
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: 10,
    background: 'rgba(13,13,13,0.95)',
    border: '0.5px solid rgba(255,255,255,0.1)',
    borderRadius: 4,
    color: '#777',
    fontSize: 9,
    padding: '4px 16px',
    cursor: 'pointer',
    fontFamily: "'ABC Diatype', sans-serif",
    letterSpacing: '0.08em',
  },
  hideBtn: {
    position: 'absolute',
    top: 4,
    right: 8,
    zIndex: 11,
    background: 'rgba(0,0,0,0.5)',
    border: '0.5px solid rgba(255,255,255,0.15)',
    borderRadius: 3,
    color: '#999',
    fontSize: 12,
    cursor: 'pointer',
    padding: '2px 6px',
  },
};
