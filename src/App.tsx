import MapView from './components/MapView';
import ControlPanel from './components/ControlPanel';
import TimelineGraph from './components/TimelineGraph';
import { useStore } from './store';

export default function App() {
  const placementMode = useStore(s => s.placementMode);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', background: '#000' }}>
      <MapView />
      <ControlPanel />
      <TimelineGraph />

      {placementMode !== 'none' && (
        <div style={styles.cursorLabel}>
          {placementMode === 'seed' ? '(PLACE SEED)' : '(PLACE TARGET)'}
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  cursorLabel: {
    position: 'absolute',
    top: 12,
    left: 12,
    zIndex: 10,
    color: '#FF0000',
    fontSize: 11,
    fontFamily: "'ABC Diatype Mono', 'Courier New', monospace",
    letterSpacing: '0.05em',
    background: 'rgba(0,0,0,0.7)',
    padding: '4px 8px',
    border: '0.5px solid #FF0000',
  },
};
