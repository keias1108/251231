/**
 * @fileoverview 필드 프로브(마우스 위치의 필드 값 표시)
 * WebGPU 버퍼에서 단일 셀 값을 읽어 UI에 노출한다.
 */

import { Camera } from '../render/camera';
import { Simulation } from '../core/simulation';
import { t } from '../i18n';

export interface ProbeUI {
  destroy(): void;
}

export function createProbeUI(
  canvas: HTMLCanvasElement,
  camera: Camera,
  simulation: Simulation,
  probeElement: HTMLElement
): ProbeUI {
  let lastCellX = -1;
  let lastCellY = -1;

  function onMouseMove(e: MouseEvent): void {
    const rect = canvas.getBoundingClientRect();
    const dprX = canvas.width / Math.max(1, rect.width);
    const dprY = canvas.height / Math.max(1, rect.height);
    const sx = (e.clientX - rect.left) * dprX;
    const sy = (e.clientY - rect.top) * dprY;

    const world = camera.screenToWorld(sx, sy, canvas.width, canvas.height);
    const x = Math.floor(world[0]);
    const y = Math.floor(world[2]);

    if (x === lastCellX && y === lastCellY) return;
    lastCellX = x;
    lastCellY = y;
    simulation.setProbeCell(x, y);
  }

  const uiInterval = window.setInterval(() => {
    const probe = simulation.getProbeData();
    if (!probe) return;
    probeElement.innerHTML = `
      <div style="font-weight: 600; margin-bottom: 4px;">${t('probe.title')}</div>
      <div>${t('probe.cell')}: (${probe.x}, ${probe.y})</div>
      <div>${t('probe.height')}: ${probe.height.toFixed(3)}</div>
      <div>${t('probe.terrain')}: ${probe.terrain.toFixed(3)}</div>
      <div>${t('probe.resource')}: ${probe.resource.toFixed(3)}</div>
      <div>${t('probe.danger')}: ${probe.danger.toFixed(3)}</div>
      <div>${t('probe.pheromone')}: ${probe.pheromone.toFixed(3)}</div>
    `;
  }, 200);

  canvas.addEventListener('mousemove', onMouseMove);

  function destroy(): void {
    clearInterval(uiInterval);
    canvas.removeEventListener('mousemove', onMouseMove);
  }

  return { destroy };
}
