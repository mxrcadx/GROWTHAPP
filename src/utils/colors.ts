import type { ColorTheme, CellData } from '../types';

// Age: red (young/leading edge) -> orange -> yellow -> blue (old/trailing edge)
export function ageColor(age: number, maxAge: number): [number, number, number, number] {
  const t = maxAge > 0 ? Math.min(1, age / maxAge) : 0;
  let r: number, g: number, b: number;
  if (t < 0.33) {
    const s = t / 0.33;
    r = 255;
    g = Math.round(51 + s * 85);
    b = 0;
  } else if (t < 0.66) {
    const s = (t - 0.33) / 0.33;
    r = 255;
    g = Math.round(136 + s * 68);
    b = 0;
  } else {
    const s = (t - 0.66) / 0.34;
    r = Math.round(255 - s * 204);
    g = Math.round(204 - s * 102);
    b = Math.round(0 + s * 255);
  }
  return [r, g, b, 220];
}

// Suitability: low (dark red) -> mid (yellow) -> high (green)
function suitColor(suit: number): [number, number, number, number] {
  const t = Math.max(0, Math.min(1, suit));
  let r: number, g: number, b: number;
  if (t < 0.5) {
    const s = t / 0.5;
    r = Math.round(180 + s * 75);
    g = Math.round(40 + s * 180);
    b = Math.round(40 - s * 20);
  } else {
    const s = (t - 0.5) / 0.5;
    r = Math.round(255 - s * 200);
    g = Math.round(220 + s * 35);
    b = Math.round(20 + s * 60);
  }
  return [r, g, b, 210];
}

// Heat flux: cold (blue) -> warm (cyan) -> hot (magenta/white)
function heatFluxColor(hf: number): [number, number, number, number] {
  const t = Math.max(0, Math.min(1, hf / 150)); // normalize to 0-150 W/m²
  let r: number, g: number, b: number;
  if (t < 0.33) {
    const s = t / 0.33;
    r = Math.round(20 + s * 20);
    g = Math.round(60 + s * 140);
    b = Math.round(180 + s * 75);
  } else if (t < 0.66) {
    const s = (t - 0.33) / 0.33;
    r = Math.round(40 + s * 180);
    g = Math.round(200 - s * 60);
    b = Math.round(255 - s * 55);
  } else {
    const s = (t - 0.66) / 0.34;
    r = Math.round(220 + s * 35);
    g = Math.round(140 + s * 115);
    b = Math.round(200 + s * 55);
  }
  return [r, g, b, 210];
}

// Levels: monochrome intensity (dim = 1 level, bright = max)
function levelsColor(levels: number, maxLevels: number): [number, number, number, number] {
  const t = maxLevels > 1 ? (levels - 1) / (maxLevels - 1) : 0;
  const v = Math.round(80 + t * 175);
  return [v, v, Math.round(v * 1.1), 210];
}

/** Get color for a cell based on the active theme */
export function themeColor(
  theme: ColorTheme,
  age: number, maxAge: number,
  cell: CellData,
  levels: number, maxLevels: number,
): [number, number, number, number] {
  switch (theme) {
    case 'age': return ageColor(age, maxAge);
    case 'suitability': return suitColor(cell.suit);
    case 'heatflux': return heatFluxColor(cell.hf);
    case 'levels': return levelsColor(levels, maxLevels);
  }
}
