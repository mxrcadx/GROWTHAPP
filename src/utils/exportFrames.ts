/**
 * PNG frame sequence exporter with auto-render batch script.
 * Outputs a ZIP containing:
 *   - frames/frame_0000.png .. frame_NNNN.png (transparent 1920x1080)
 *   - render.bat (double-click to convert to MP4 via FFmpeg)
 */

import { useStore } from '../store';

interface ExportConfig {
  fps: number;
  duration: number;
  width: number;
  height: number;
  viewport: 'plan' | 'iso' | 'elev';
}

export const DEFAULT_EXPORT_CONFIG: ExportConfig = {
  fps: 60,
  duration: 10,
  width: 3840,
  height: 2160,
  viewport: 'plan',
};

export type ExportProgress = {
  current: number;
  total: number;
  stage: 'rendering' | 'packing' | 'done';
};

export async function exportFrameSequence(
  renderFrame: (canvas: HTMLCanvasElement, phase: number) => void,
  config: ExportConfig = DEFAULT_EXPORT_CONFIG,
  onProgress?: (p: ExportProgress) => void,
): Promise<void> {
  const totalFrames = config.fps * config.duration;
  const store = useStore.getState();
  const totalPhases = store.phases.length;

  if (totalPhases === 0) {
    throw new Error('No simulation phases to export');
  }

  const canvas = document.createElement('canvas');
  canvas.width = config.width;
  canvas.height = config.height;

  const JSZip = await loadJSZip();
  const zip = new JSZip();
  const folder = zip.folder('frames')!;

  onProgress?.({ current: 0, total: totalFrames, stage: 'rendering' });

  for (let frame = 0; frame < totalFrames; frame++) {
    const t = frame / (totalFrames - 1);
    const fractionalPhase = t * (totalPhases - 1);
    const phaseIndex = Math.min(Math.floor(fractionalPhase), totalPhases - 1);

    store.setCurrentPhase(phaseIndex);
    renderFrame(canvas, phaseIndex);

    const dataUrl = canvas.toDataURL('image/png');
    const base64 = dataUrl.split(',')[1];
    folder.file(`frame_${String(frame).padStart(4, '0')}.png`, base64, { base64: true });

    onProgress?.({ current: frame + 1, total: totalFrames, stage: 'rendering' });

    if (frame % 5 === 0) {
      await new Promise(r => setTimeout(r, 1));
    }
  }

  // Add render scripts
  const batScript = `@echo off
echo.
echo  GROWTH SIMULATOR - Video Render
echo  ================================
echo.
echo  Checking for FFmpeg...
where ffmpeg >nul 2>&1
if %errorlevel% neq 0 (
    echo  FFmpeg not found. Installing via winget...
    echo.
    winget install --id Gyan.FFmpeg -e --source winget
    echo.
    echo  Refreshing PATH...
    set "PATH=%PATH%;%LOCALAPPDATA%\\Microsoft\\WinGet\\Links"
    where ffmpeg >nul 2>&1
    if %errorlevel% neq 0 (
        echo  Install failed. Please install FFmpeg manually and re-run.
        pause
        exit /b 1
    )
)
echo  FFmpeg found. Rendering...
echo.
echo  [1/2] Rendering MP4 (opaque, black background)...
ffmpeg -y -r ${config.fps} -i frames\\frame_%%04d.png -c:v libx264 -pix_fmt yuv420p -crf 18 -preset slow growth_sim.mp4
echo.
echo  [2/2] Rendering MOV (transparent, ProRes 4444)...
ffmpeg -y -r ${config.fps} -i frames\\frame_%%04d.png -c:v prores_ks -pix_fmt yuva444p10le -profile:v 4444 growth_sim_alpha.mov
echo.
echo  Done! Output files:
echo    growth_sim.mp4         (for playback)
echo    growth_sim_alpha.mov   (for compositing, transparent bg)
echo.
pause
`;

  const shScript = `#!/bin/bash
echo ""
echo "  GROWTH SIMULATOR - Video Render"
echo "  ================================"
echo ""
if ! command -v ffmpeg &> /dev/null; then
    echo "  FFmpeg not found. Install with: brew install ffmpeg"
    exit 1
fi
echo "  [1/2] Rendering MP4 (opaque, black background)..."
ffmpeg -y -r ${config.fps} -i frames/frame_%04d.png -c:v libx264 -pix_fmt yuv420p -crf 18 -preset slow growth_sim.mp4
echo ""
echo "  [2/2] Rendering MOV (transparent, ProRes 4444)..."
ffmpeg -y -r ${config.fps} -i frames/frame_%04d.png -c:v prores_ks -pix_fmt yuva444p10le -profile:v 4444 growth_sim_alpha.mov
echo ""
echo "  Done!"
echo "    growth_sim.mp4         (for playback)"
echo "    growth_sim_alpha.mov   (for compositing, transparent bg)"
`;

  zip.file('render.bat', batScript);
  zip.file('render.sh', shScript);

  onProgress?.({ current: totalFrames, total: totalFrames, stage: 'packing' });
  const zipBlob = await zip.generateAsync({ type: 'blob' });

  const url = URL.createObjectURL(zipBlob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `growth_export_${config.fps}fps.zip`;
  a.click();
  URL.revokeObjectURL(url);

  onProgress?.({ current: totalFrames, total: totalFrames, stage: 'done' });
}

async function loadJSZip(): Promise<any> {
  if ((window as any).JSZip) return (window as any).JSZip;
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
    script.onload = () => resolve((window as any).JSZip);
    script.onerror = () => reject(new Error('Failed to load JSZip'));
    document.head.appendChild(script);
  });
}
