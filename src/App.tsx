import MapView from './components/MapView';
import ControlPanel from './components/ControlPanel';
import TimelineGraph from './components/TimelineGraph';
import AlgorithmLog from './components/AlgorithmLog';
import RightPanel from './components/RightPanel';

export default function App() {
  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', background: '#000', overflow: 'hidden' }}>
      <MapView />
      <ControlPanel />
      <AlgorithmLog />
      <RightPanel />
      <TimelineGraph />
    </div>
  );
}
