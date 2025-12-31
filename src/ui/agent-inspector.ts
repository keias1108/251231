/**
 * @fileoverview 에이전트 선택/검사 UI
 * 클릭으로 에이전트를 선택하고 드래그 가능한 모달과 연결선을 표시한다.
 */

import { Camera } from '../render/camera';
import { Simulation, PickedAgent, ProbeData } from '../core/simulation';

export interface AgentInspector {
  destroy(): void;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function modeLabel(mode: number): string {
  switch (mode) {
    case 0: return 'EXPLORE';
    case 1: return 'INTAKE';
    case 2: return 'EVADE';
    case 3: return 'REPRODUCE';
    default: return `MODE(${mode})`;
  }
}

function projectWorldToClient(
  camera: Camera,
  worldX: number,
  worldY: number,
  worldZ: number,
  canvas: HTMLCanvasElement
): { x: number; y: number; visible: boolean } {
  const m = camera.viewProjMatrix;
  const cx = m[0] * worldX + m[4] * worldY + m[8] * worldZ + m[12];
  const cy = m[1] * worldX + m[5] * worldY + m[9] * worldZ + m[13];
  const cw = m[3] * worldX + m[7] * worldY + m[11] * worldZ + m[15];

  if (cw <= 0.00001) return { x: -1, y: -1, visible: false };

  const ndcX = cx / cw;
  const ndcY = cy / cw;

  // NDC -> canvas pixel
  const px = (ndcX * 0.5 + 0.5) * canvas.width;
  const py = (1.0 - (ndcY * 0.5 + 0.5)) * canvas.height;

  const rect = canvas.getBoundingClientRect();
  const clientX = rect.left + (px / canvas.width) * rect.width;
  const clientY = rect.top + (py / canvas.height) * rect.height;

  const visible = ndcX >= -1.1 && ndcX <= 1.1 && ndcY >= -1.1 && ndcY <= 1.1;
  return { x: clientX, y: clientY, visible };
}

function formatProbe(probe: ProbeData | null): string {
  if (!probe) return 'Field: (loading...)';
  return `H ${probe.height.toFixed(3)} | Z ${probe.terrain.toFixed(3)} | F ${probe.resource.toFixed(3)} | R ${probe.danger.toFixed(3)} | P ${probe.pheromone.toFixed(3)}`;
}

export function createAgentInspector(
  canvas: HTMLCanvasElement,
  camera: Camera,
  simulation: Simulation
): AgentInspector {
  const overlay = document.createElement('div');
  overlay.style.position = 'fixed';
  overlay.style.left = '0';
  overlay.style.top = '0';
  overlay.style.width = '100vw';
  overlay.style.height = '100vh';
  overlay.style.zIndex = '150';
  overlay.style.pointerEvents = 'none';

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', '100%');
  svg.style.position = 'absolute';
  svg.style.left = '0';
  svg.style.top = '0';
  svg.style.pointerEvents = 'none';

  const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  line.setAttribute('stroke', 'rgba(255,255,255,0.85)');
  line.setAttribute('stroke-width', '2');
  line.setAttribute('stroke-linecap', 'round');
  line.style.filter = 'drop-shadow(0 1px 2px rgba(0,0,0,0.6))';
  svg.appendChild(line);

  const panel = document.createElement('div');
  panel.style.position = 'absolute';
  panel.style.width = '320px';
  panel.style.maxWidth = 'calc(100vw - 24px)';
  panel.style.background = 'rgba(0, 0, 0, 0.82)';
  panel.style.backdropFilter = 'blur(6px)';
  panel.style.border = '1px solid rgba(255,255,255,0.15)';
  panel.style.borderRadius = '10px';
  panel.style.color = '#fff';
  panel.style.fontSize = '13px';
  panel.style.pointerEvents = 'auto';
  panel.style.display = 'none';

  const header = document.createElement('div');
  header.style.display = 'flex';
  header.style.alignItems = 'center';
  header.style.justifyContent = 'space-between';
  header.style.padding = '10px 10px 8px 10px';
  header.style.cursor = 'move';
  header.style.userSelect = 'none';
  header.style.borderBottom = '1px solid rgba(255,255,255,0.12)';

  const title = document.createElement('div');
  title.style.fontWeight = '600';
  title.textContent = 'Agent';

  const closeBtn = document.createElement('button');
  closeBtn.textContent = '×';
  closeBtn.style.width = '28px';
  closeBtn.style.height = '28px';
  closeBtn.style.borderRadius = '8px';
  closeBtn.style.border = '1px solid rgba(255,255,255,0.18)';
  closeBtn.style.background = 'rgba(255,255,255,0.08)';
  closeBtn.style.color = '#fff';
  closeBtn.style.cursor = 'pointer';
  closeBtn.style.lineHeight = '1';

  header.appendChild(title);
  header.appendChild(closeBtn);

  const body = document.createElement('div');
  body.style.padding = '10px';
  body.style.lineHeight = '1.45';
  body.innerHTML = `<div style="opacity:0.85;">캔버스를 클릭해 에이전트를 선택하세요.</div>`;

  panel.appendChild(header);
  panel.appendChild(body);

  overlay.appendChild(svg);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  let selected: PickedAgent | null = null;
  let selectedField: ProbeData | null = null;
  let rafId: number | null = null;
  let pollingId: number | null = null;

  let panelX = 20;
  let panelY = 20;
  let dragging = false;
  let dragOffX = 0;
  let dragOffY = 0;

  function layoutPanel(): void {
    const rect = panel.getBoundingClientRect();
    const maxX = window.innerWidth - rect.width - 10;
    const maxY = window.innerHeight - rect.height - 10;
    panelX = clamp(panelX, 10, Math.max(10, maxX));
    panelY = clamp(panelY, 10, Math.max(10, maxY));
    panel.style.left = `${panelX}px`;
    panel.style.top = `${panelY}px`;
  }

  function setVisible(visible: boolean): void {
    panel.style.display = visible ? 'block' : 'none';
    line.style.display = visible ? 'block' : 'none';
    if (visible) layoutPanel();
  }

  async function refreshSelectedField(): Promise<void> {
    if (!selected) return;
    selectedField = await simulation.readFieldCell(Math.floor(selected.posX), Math.floor(selected.posY));
  }

  async function refreshSelectedAgent(): Promise<void> {
    if (!selected) return;
    const updated = await simulation.readAgent(selected.index);
    if (!updated) return;
    selected = updated;
  }

  function renderPanel(): void {
    if (!selected) return;
    const speed = Math.hypot(selected.velX, selected.velY);
    const geneticsSpeedHint = selected.activity;
    body.innerHTML = `
      <div style="display:flex; gap:10px; flex-wrap:wrap;">
        <div><span style="opacity:0.8;">ID</span> ${selected.index}</div>
        <div><span style="opacity:0.8;">Mode</span> ${modeLabel(selected.mode)}</div>
        <div><span style="opacity:0.8;">Gen</span> ${selected.generation}</div>
      </div>
      <div style="margin-top:6px;">${formatProbe(selectedField)}</div>
      <hr style="border:0;border-top:1px solid rgba(255,255,255,0.12); margin:8px 0;" />
      <div><span style="opacity:0.8;">Energy</span> ${selected.energy.toFixed(2)}</div>
      <div><span style="opacity:0.8;">Speed</span> ${speed.toFixed(2)} <span style="opacity:0.7;">(actual)</span></div>
      <div><span style="opacity:0.8;">Activity</span> ${geneticsSpeedHint.toFixed(2)} <span style="opacity:0.7;">(genetic)</span></div>
      <div><span style="opacity:0.8;">Stress</span> ${selected.stress.toFixed(3)}</div>
      <div><span style="opacity:0.8;">Cooldown</span> ${selected.cooldown.toFixed(2)}</div>
      <div><span style="opacity:0.8;">Age</span> ${selected.age.toFixed(1)}</div>
      <hr style="border:0;border-top:1px solid rgba(255,255,255,0.12); margin:8px 0;" />
      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:6px 10px;">
        <div><span style="opacity:0.8;">eff</span> ${selected.efficiency.toFixed(2)}</div>
        <div><span style="opacity:0.8;">abs</span> ${selected.absorption.toFixed(2)}</div>
        <div><span style="opacity:0.8;">meta</span> ${selected.metabolism.toFixed(3)}</div>
        <div><span style="opacity:0.8;">move</span> ${selected.moveCost.toFixed(3)}</div>
        <div><span style="opacity:0.8;">agil</span> ${selected.agility.toFixed(2)}</div>
        <div><span style="opacity:0.8;">sense</span> ${selected.senseRange.toFixed(1)}</div>
        <div><span style="opacity:0.8;">aggr</span> ${selected.aggression.toFixed(2)}</div>
        <div><span style="opacity:0.8;">evad</span> ${selected.evasion.toFixed(2)}</div>
        <div><span style="opacity:0.8;">soc</span> ${selected.sociality.toFixed(2)}</div>
        <div><span style="opacity:0.8;">T_b</span> ${selected.reproThreshold.toFixed(0)}</div>
        <div><span style="opacity:0.8;">C_b</span> ${selected.reproCooldown.toFixed(0)}</div>
      </div>
    `;
  }

  function updateLine(): void {
    if (!selected) return;
    const cfg = simulation.getConfig();
    const height = selectedField ? selectedField.height * cfg.heightScale : 0;
    const worldY = height + 2.0;
    const p = projectWorldToClient(camera, selected.posX, worldY, selected.posY, canvas);

    const rect = panel.getBoundingClientRect();
    const anchorX = rect.left + rect.width * 0.5;
    const anchorY = rect.top + 16;

    line.setAttribute('x1', `${anchorX}`);
    line.setAttribute('y1', `${anchorY}`);
    line.setAttribute('x2', `${p.x}`);
    line.setAttribute('y2', `${p.y}`);
    line.style.opacity = p.visible ? '1' : '0.2';
  }

  function tick(): void {
    if (selected) {
      updateLine();
    }
    rafId = requestAnimationFrame(tick);
  }

  async function handlePick(e: MouseEvent): Promise<void> {
    const picked = await simulation.pickNearestAgentAtClient(e.clientX, e.clientY, 24);
    if (!picked) return;

    selected = picked;
    selectedField = await simulation.readFieldCell(Math.floor(selected.posX), Math.floor(selected.posY));

    title.textContent = `Agent #${selected.index}`;
    panelX = e.clientX + 14;
    panelY = e.clientY + 14;
    setVisible(true);
    renderPanel();
    layoutPanel();
  }

  function onCanvasClick(e: MouseEvent): void {
    if (e.button !== 0) return;
    handlePick(e).catch(console.error);
  }

  function onHeaderMouseDown(e: MouseEvent): void {
    dragging = true;
    const rect = panel.getBoundingClientRect();
    dragOffX = e.clientX - rect.left;
    dragOffY = e.clientY - rect.top;
    e.preventDefault();
  }

  function onWindowMouseMove(e: MouseEvent): void {
    if (!dragging) return;
    panelX = e.clientX - dragOffX;
    panelY = e.clientY - dragOffY;
    layoutPanel();
  }

  function onWindowMouseUp(): void {
    dragging = false;
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      selected = null;
      selectedField = null;
      setVisible(false);
    }
  }

  function onClose(): void {
    selected = null;
    selectedField = null;
    setVisible(false);
  }

  closeBtn.addEventListener('click', onClose);
  header.addEventListener('mousedown', onHeaderMouseDown);
  window.addEventListener('mousemove', onWindowMouseMove);
  window.addEventListener('mouseup', onWindowMouseUp);
  window.addEventListener('keydown', onKeyDown);
  canvas.addEventListener('click', onCanvasClick);

  pollingId = window.setInterval(() => {
    if (!selected) return;
    Promise.all([refreshSelectedAgent(), refreshSelectedField()])
      .then(() => {
        if (!selected) return;
        renderPanel();
      })
      .catch(console.error);
  }, 250);

  rafId = requestAnimationFrame(tick);

  function destroy(): void {
    if (rafId !== null) cancelAnimationFrame(rafId);
    if (pollingId !== null) clearInterval(pollingId);
    closeBtn.removeEventListener('click', onClose);
    header.removeEventListener('mousedown', onHeaderMouseDown);
    window.removeEventListener('mousemove', onWindowMouseMove);
    window.removeEventListener('mouseup', onWindowMouseUp);
    window.removeEventListener('keydown', onKeyDown);
    canvas.removeEventListener('click', onCanvasClick);
    overlay.remove();
  }

  return { destroy };
}
