import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';

const INIT_LINES = [
  'loading geothermal_suitability_500m...',
  'loading ork_heatflux_2020...',
  'loading terrain_hillshade...',
  'loading iceland_coastline...',
  'loading cell adjacency graph...',
  'datasets ready. awaiting seed placement.',
];

export default function AlgorithmLog() {
  const containerRef = useRef<HTMLDivElement>(null);
  const { algorithmLog, currentPhase, phases, dataLoaded, playing } = useStore();
  const [visibleLines, setVisibleLines] = useState<string[]>([]);
  const animRef = useRef<number>(0);
  const lineIndexRef = useRef(0);
  const initIndexRef = useRef(0);
  const [initLines, setInitLines] = useState<string[]>([]);

  // Animate init lines on mount
  useEffect(() => {
    if (algorithmLog.length > 0) return; // simulation started, skip init
    initIndexRef.current = 0;
    setInitLines([]);
    const interval = setInterval(() => {
      initIndexRef.current++;
      const idx = initIndexRef.current;
      if (idx > INIT_LINES.length) {
        clearInterval(interval);
        return;
      }
      setInitLines(INIT_LINES.slice(0, idx));
    }, 400);
    return () => clearInterval(interval);
  }, [algorithmLog.length > 0]);

  // Animate lines appearing at ~1-2 per second
  useEffect(() => {
    if (algorithmLog.length === 0) {
      setVisibleLines([]);
      lineIndexRef.current = 0;
      return;
    }

    // Show lines up to current phase context
    const phaseMarker = `── PHASE ${currentPhase}`;
    let targetIndex = algorithmLog.length;
    for (let i = 0; i < algorithmLog.length; i++) {
      if (algorithmLog[i].startsWith('── PHASE ')) {
        const pNum = parseInt(algorithmLog[i].replace('── PHASE ', ''));
        if (pNum > currentPhase) {
          targetIndex = i;
          break;
        }
      }
    }

    // During playback, show lines instantly to keep up with animation
    if (playing) {
      setVisibleLines(algorithmLog.slice(Math.max(0, targetIndex - 30), targetIndex));
      lineIndexRef.current = targetIndex;
      return;
    }

    // Gradually reveal lines when paused/scrubbing
    const currentVisible = lineIndexRef.current;
    if (currentVisible >= targetIndex) {
      setVisibleLines(algorithmLog.slice(Math.max(0, targetIndex - 30), targetIndex));
      lineIndexRef.current = targetIndex;
      return;
    }

    const interval = setInterval(() => {
      lineIndexRef.current++;
      const idx = lineIndexRef.current;
      if (idx >= targetIndex) {
        clearInterval(interval);
      }
      setVisibleLines(algorithmLog.slice(Math.max(0, idx - 30), idx));
    }, 600); // ~1.5 lines per second

    return () => clearInterval(interval);
  }, [algorithmLog, currentPhase, playing]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [visibleLines]);

  return (
    <div style={styles.container} ref={containerRef}>
      <div style={styles.header}>ALGORITHM LOG</div>
      {visibleLines.length === 0 && initLines.length === 0 && (
        <div style={styles.empty}>
          initializing...
        </div>
      )}
      {visibleLines.length === 0 && initLines.map((line, i) => (
        <div key={`init-${i}`} style={{ ...styles.line, color: '#555' }}>{line}</div>
      ))}
      {visibleLines.map((line, i) => (
        <div
          key={i}
          style={{
            ...styles.line,
            color: line.startsWith('──') ? '#555' :
                   line.includes('GROW') ? '#8BF58B' :
                   line.includes('SHED') ? '#FF6B6B' :
                   line.includes('STACK') ? 'rgba(100,170,255,0.8)' :
                   line.includes('src:') ? '#777' :
                   '#999',
            fontWeight: line.startsWith('──') ? 400 : 400,
          }}
        >
          {line}
        </div>
      ))}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    width: 300,
    maxHeight: 'calc(100% - 300px)',
    overflowY: 'auto',
    overflowX: 'hidden',
    zIndex: 10,
    padding: '8px 16px',
    background: 'rgba(0,0,0,0.8)',
    fontFamily: "'ABC Diatype Mono', 'Courier New', monospace",
    fontSize: 9,
    lineHeight: '14px',
  },
  header: {
    display: 'none',
  },
  empty: {
    color: '#333',
    fontSize: 9,
    fontStyle: 'italic',
  },
  line: {
    color: '#999',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all' as const,
    fontFamily: "'ABC Diatype Mono', 'Courier New', monospace",
    fontSize: 9,
  },
};
