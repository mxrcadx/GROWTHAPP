import { useStore } from '../store';

export default function ParameterPanel() {
  const {
    wSuit, wProx, wAdv, maxLevels, hfStacking,
    setWSuit, setWProx, setWAdv, setMaxLevels, setHfStacking,
  } = useStore();

  return (
    <div style={styles.container}>
      <div style={styles.section}>
        <div style={styles.title}>GROWTH WEIGHTS</div>

        <div style={styles.row}>
          <span style={styles.label}>SUIT</span>
          <input
            type="range" min={0} max={1} step={0.05}
            value={wSuit}
            onChange={(e) => setWSuit(Number(e.target.value))}
            style={styles.slider}
          />
          <span style={styles.value}>{wSuit.toFixed(2)}</span>
        </div>

        <div style={styles.row}>
          <span style={styles.label}>PROX</span>
          <input
            type="range" min={0} max={1} step={0.05}
            value={wProx}
            onChange={(e) => setWProx(Number(e.target.value))}
            style={styles.slider}
          />
          <span style={styles.value}>{wProx.toFixed(2)}</span>
        </div>

        <div style={styles.row}>
          <span style={styles.label}>ADV</span>
          <input
            type="range" min={0} max={1} step={0.05}
            value={wAdv}
            onChange={(e) => setWAdv(Number(e.target.value))}
            style={styles.slider}
          />
          <span style={styles.value}>{wAdv.toFixed(2)}</span>
        </div>
      </div>

      <div style={styles.section}>
        <div style={styles.title}>STACKING</div>

        <div style={styles.row}>
          <span style={styles.label}>MAX</span>
          <input
            type="range" min={1} max={8} step={1}
            value={maxLevels}
            onChange={(e) => setMaxLevels(Number(e.target.value))}
            style={styles.slider}
          />
          <span style={styles.value}>{maxLevels}</span>
        </div>

        <div style={styles.row}>
          <span style={styles.label}>HF CAP</span>
          <button
            onClick={() => setHfStacking(!hfStacking)}
            style={{
              ...styles.toggle,
              color: hfStacking ? '#007AFF' : '#555',
              borderColor: hfStacking ? '#007AFF' : '#333',
            }}
          >
            {hfStacking ? 'ON' : 'OFF'}
          </button>
        </div>
      </div>

      <div style={styles.help}>
        <div style={styles.helpText}>SUIT = GEOTHERMAL SUITABILITY</div>
        <div style={styles.helpText}>PROX = PROXIMITY TO TARGET</div>
        <div style={styles.helpText}>ADV = SEED→TARGET DIRECTION</div>
        <div style={{ ...styles.helpText, marginTop: 4 }}>HF CAP = LIMIT LEVELS BY HEAT FLUX</div>
      </div>
    </div>
  );
}

const FONT = "'ABC Diatype Mono', 'Courier New', monospace";

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: 'absolute',
    top: 8,
    right: 4,
    width: 'calc(11.76% - 8px)',
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    zIndex: 10,
    fontFamily: FONT,
    fontSize: 10,
  },
  section: {
    border: '0.5px solid #333',
    padding: 10,
    background: 'rgba(0,0,0,0.85)',
  },
  title: {
    color: '#999',
    fontSize: 10,
    letterSpacing: '0.05em',
    marginBottom: 8,
    fontFamily: FONT,
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    marginBottom: 6,
  },
  label: {
    color: '#666',
    fontSize: 9,
    width: 32,
    flexShrink: 0,
    fontFamily: FONT,
  },
  slider: {
    flex: 1,
    height: 3,
    appearance: 'none' as const,
    background: '#333',
    outline: 'none',
    cursor: 'pointer',
    accentColor: '#007AFF',
  },
  value: {
    color: '#F5F5F5',
    fontSize: 9,
    width: 28,
    textAlign: 'right' as const,
    fontFamily: FONT,
  },
  toggle: {
    background: 'transparent',
    border: '0.5px solid #333',
    fontSize: 9,
    padding: '2px 8px',
    cursor: 'pointer',
    fontFamily: FONT,
  },
  help: {
    padding: '6px 10px',
    background: 'rgba(0,0,0,0.6)',
    border: '0.5px solid #222',
  },
  helpText: {
    color: '#444',
    fontSize: 8,
    lineHeight: '12px',
    fontFamily: FONT,
  },
};
