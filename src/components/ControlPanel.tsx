import { useStore } from '../store';
import { getCellData } from './MapView';

export default function ControlPanel() {
  const {
    seedId, targetId,
    viewScale,
  } = useStore();

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
      {/* Title */}
      <div style={{ marginBottom: 16 }}>
        <div style={styles.title}>Fieldwork</div>
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
};
