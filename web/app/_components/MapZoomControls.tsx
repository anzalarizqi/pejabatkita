'use client'

interface Props {
  onZoomIn: () => void
  onZoomOut: () => void
  onRecenter: () => void
}

export default function MapZoomControls({ onZoomIn, onZoomOut, onRecenter }: Props) {
  return (
    <div className="map-zoom-controls">
      <style>{styles}</style>
      <button type="button" aria-label="Perbesar" onClick={onZoomIn}>+</button>
      <button type="button" aria-label="Perkecil" onClick={onZoomOut}>−</button>
      <button type="button" aria-label="Atur ulang tampilan" onClick={onRecenter}>⌖</button>
    </div>
  )
}

const styles = `
  .map-zoom-controls {
    position: absolute;
    top: 12px;
    right: 12px;
    z-index: 11;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .map-zoom-controls button {
    width: 30px;
    height: 30px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #f5f1ea;
    color: #0f1117;
    border: 1px solid #d4cfc5;
    border-left: 2px solid transparent;
    font-family: 'DM Mono', monospace;
    font-size: 15px;
    line-height: 1;
    cursor: pointer;
    padding: 0;
    transition: border-left-color 0.15s, background 0.15s;
  }
  .map-zoom-controls button:hover {
    background: #ece7dc;
    border-left-color: #c0392b;
  }
  .map-zoom-controls button:active { background: #e2dccf; }
  .map-zoom-controls button:focus-visible { outline: 2px solid #c0392b; outline-offset: 1px; }
`
