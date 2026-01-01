/**
 * @fileoverview 메인 시뮬레이션 루프
 * 6단계 업데이트 사이클 관리
 */

import { GPUContext, resizeCanvas } from './gpu-context';
import { createFieldSystem, FieldSystem } from '../systems/field-system';
import { createAgentSystem, AgentSystem, EvolutionSample } from '../systems/agent-system';
import { createFieldRenderer, FieldRenderer } from '../render/field-renderer';
import { createAgentRenderer, AgentRenderer } from '../render/agent-renderer';
import { createCamera, Camera } from '../render/camera';
import { SimulationConfig, RenderConfig, DEFAULT_CONFIG, DEFAULT_RENDER_CONFIG } from '../types/config';

export interface Simulation {
  start(): void;
  stop(): void;
  pause(): void;
  resume(): void;
  setTimeScale(scale: number): void;
  getStats(): SimulationStats;
  updateConfig(config: Partial<SimulationConfig>): void;
  updateRenderConfig(config: Partial<RenderConfig>): void;
  getCamera(): Camera;
  setProbeCell(x: number, y: number): void;
  getProbeData(): ProbeData | null;
  readFieldCell(x: number, y: number): Promise<ProbeData | null>;
  pickNearestAgentAtClient(clientX: number, clientY: number, maxPixels: number): Promise<PickedAgent | null>;
  readAgent(index: number): Promise<PickedAgent | null>;
  getConfig(): SimulationConfig;
  getRenderConfig(): RenderConfig;
  resetSimulation(): void;
}

export interface SimulationStats {
  fps: number;
  frameTime: number;
  aliveAgentCount: number;
  allocatedAgentCount: number;
  births: number;
  deaths: number;
  uptake: number;
  time: number;
  paused: boolean;
  evolutionSample: EvolutionSample;
  evolutionBirths: EvolutionSample;
  evolutionDeaths: EvolutionSample;
}

export interface ProbeData {
  x: number;
  y: number;
  height: number;
  terrain: number;
  resource: number;
  danger: number;
  pheromone: number;
}

export interface PickedAgent {
  index: number;
  posX: number;
  posY: number;
  velX: number;
  velY: number;
  energy: number;
  mode: number;
  stress: number;
  cooldown: number;
  efficiency: number;
  absorption: number;
  metabolism: number;
  moveCost: number;
  activity: number;
  agility: number;
  senseRange: number;
  aggression: number;
  evasion: number;
  sociality: number;
  reproThreshold: number;
  reproCooldown: number;
  alive: number;
  age: number;
  generation: number;
}

export function createSimulation(gpuContext: GPUContext): Simulation {
  const { device, context, format, canvas } = gpuContext;

  // 설정
  let config: SimulationConfig = { ...DEFAULT_CONFIG };
  let renderConfig: RenderConfig = { ...DEFAULT_RENDER_CONFIG };

  // 시스템 초기화
  const fieldSystem: FieldSystem = createFieldSystem(device, config);
  const agentSystem: AgentSystem = createAgentSystem(device, config);

  // 렌더러 초기화
  const fieldRenderer: FieldRenderer = createFieldRenderer(device, format, config);
  const agentRenderer: AgentRenderer = createAgentRenderer(device, format, config);

  // 카메라
  const camera: Camera = createCamera(config.gridSize);

  // 깊이 텍스처
  let depthTexture: GPUTexture = createDepthTexture();

  function createDepthTexture(): GPUTexture {
    return device.createTexture({
      size: { width: canvas.width, height: canvas.height },
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
  }

  // 상태
  let running = false;
  let paused = false;
  let simulationTime = 0;
  let lastFrameTime = 0;
  let frameCount = 0;
  let fps = 0;
  let frameTime = 0;
  let animationId: number | null = null;

  // FPS 계산
  let fpsAccumulator = 0;
  let fpsFrameCount = 0;
  const FPS_UPDATE_INTERVAL = 500;  // ms

  // 탭 전환/백그라운드에서 dt 폭주 방지
  const MAX_DELTA_TIME = 0.05; // seconds (20 FPS equivalent)
  const FIXED_STEP_DT = 1 / 60; // seconds

  let stepAccumulator = 0;

  // 리사이즈 핸들러
  function handleResize(): void {
    resizeCanvas(canvas);
    depthTexture.destroy();
    depthTexture = createDepthTexture();
  }

  window.addEventListener('resize', handleResize);

  function handleVisibilityChange(): void {
    if (!document.hidden) {
      // 복귀 시 첫 프레임 dt가 과도하게 커지는 걸 방지
      lastFrameTime = 0;
    }
  }

  document.addEventListener('visibilitychange', handleVisibilityChange);

  // ===== Probe (필드 값 읽기) =====
  const probeReadbackBuffer = device.createBuffer({
    label: 'probeReadback',
    size: 20,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  let probeCellX = -1;
  let probeCellY = -1;
  let probeDirty = false;
  let probeMapping = false;
  let lastProbeData: ProbeData | null = null;
  let probeIntervalId: number | null = null;

  const fieldCellReadbackBuffer = device.createBuffer({
    label: 'fieldCellReadback',
    size: 20,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  let fieldCellMapping = false;

  function clampCell(v: number): number {
    return Math.max(0, Math.min(config.gridSize - 1, v | 0));
  }

  function setProbeCell(x: number, y: number): void {
    const nx = clampCell(x);
    const ny = clampCell(y);
    if (nx === probeCellX && ny === probeCellY) return;
    probeCellX = nx;
    probeCellY = ny;
    probeDirty = true;
  }

  function getProbeData(): ProbeData | null {
    return lastProbeData;
  }

  async function readFieldCell(x: number, y: number): Promise<ProbeData | null> {
    if (fieldCellMapping) return null;
    const cx = clampCell(x);
    const cy = clampCell(y);

    fieldCellMapping = true;
    try {
      const idx = cy * config.gridSize + cx;
      const byteOffset = idx * 4;

      const encoder = device.createCommandEncoder({ label: 'fieldCellRead' });
      encoder.copyBufferToBuffer(fieldSystem.getHeightBuffer(), byteOffset, fieldCellReadbackBuffer, 0, 4);
      encoder.copyBufferToBuffer(fieldSystem.getTerrainBuffer(), byteOffset, fieldCellReadbackBuffer, 4, 4);
      encoder.copyBufferToBuffer(fieldSystem.getResourceBuffer(), byteOffset, fieldCellReadbackBuffer, 8, 4);
      encoder.copyBufferToBuffer(fieldSystem.getDangerBuffer(), byteOffset, fieldCellReadbackBuffer, 12, 4);
      encoder.copyBufferToBuffer(fieldSystem.getPheromoneBuffer(), byteOffset, fieldCellReadbackBuffer, 16, 4);
      device.queue.submit([encoder.finish()]);

      await fieldCellReadbackBuffer.mapAsync(GPUMapMode.READ);
      const values = new Float32Array(fieldCellReadbackBuffer.getMappedRange());
      const result: ProbeData = {
        x: cx,
        y: cy,
        height: values[0],
        terrain: values[1],
        resource: values[2],
        danger: values[3],
        pheromone: values[4],
      };
      fieldCellReadbackBuffer.unmap();
      return result;
    } finally {
      fieldCellMapping = false;
    }
  }

  async function updateProbe(): Promise<void> {
    if (!probeDirty) return;
    if (probeMapping) return;
    if (probeCellX < 0 || probeCellY < 0) return;

    probeMapping = true;
    probeDirty = false;
    try {
      const idx = probeCellY * config.gridSize + probeCellX;
      const byteOffset = idx * 4;

      const encoder = device.createCommandEncoder({ label: 'probe' });
      // height, terrain, resource, danger, pheromone 순서
      encoder.copyBufferToBuffer(fieldSystem.getHeightBuffer(), byteOffset, probeReadbackBuffer, 0, 4);
      encoder.copyBufferToBuffer(fieldSystem.getTerrainBuffer(), byteOffset, probeReadbackBuffer, 4, 4);
      encoder.copyBufferToBuffer(fieldSystem.getResourceBuffer(), byteOffset, probeReadbackBuffer, 8, 4);
      encoder.copyBufferToBuffer(fieldSystem.getDangerBuffer(), byteOffset, probeReadbackBuffer, 12, 4);
      encoder.copyBufferToBuffer(fieldSystem.getPheromoneBuffer(), byteOffset, probeReadbackBuffer, 16, 4);
      device.queue.submit([encoder.finish()]);

      await probeReadbackBuffer.mapAsync(GPUMapMode.READ);
      const values = new Float32Array(probeReadbackBuffer.getMappedRange());
      lastProbeData = {
        x: probeCellX,
        y: probeCellY,
        height: values[0],
        terrain: values[1],
        resource: values[2],
        danger: values[3],
        pheromone: values[4],
      };
      probeReadbackBuffer.unmap();
    } finally {
      probeMapping = false;
    }
  }

  function ensureProbeInterval(): void {
    if (probeIntervalId !== null) return;
    probeIntervalId = window.setInterval(() => {
      updateProbe().catch(console.error);
    }, 200);
  }

  // ===== Agent readback (선택/검사) =====
  const agentReadbackBuffer = device.createBuffer({
    label: 'agentReadback',
    size: config.maxAgentCount * 96,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const agentSingleReadbackBuffer = device.createBuffer({
    label: 'agentSingleReadback',
    size: 96,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  let agentReadbackMapping = false;
  let agentSingleReadbackMapping = false;

  function parseAgent(view: DataView, base: number, index: number): PickedAgent {
    return {
      index,
      posX: view.getFloat32(base + 0, true),
      posY: view.getFloat32(base + 4, true),
      velX: view.getFloat32(base + 8, true),
      velY: view.getFloat32(base + 12, true),
      energy: view.getFloat32(base + 16, true),
      mode: view.getUint32(base + 20, true),
      stress: view.getFloat32(base + 24, true),
      cooldown: view.getFloat32(base + 28, true),
      efficiency: view.getFloat32(base + 32, true),
      absorption: view.getFloat32(base + 36, true),
      metabolism: view.getFloat32(base + 40, true),
      moveCost: view.getFloat32(base + 44, true),
      activity: view.getFloat32(base + 48, true),
      agility: view.getFloat32(base + 52, true),
      senseRange: view.getFloat32(base + 56, true),
      aggression: view.getFloat32(base + 60, true),
      evasion: view.getFloat32(base + 64, true),
      sociality: view.getFloat32(base + 68, true),
      reproThreshold: view.getFloat32(base + 72, true),
      reproCooldown: view.getFloat32(base + 76, true),
      alive: view.getUint32(base + 80, true),
      age: view.getFloat32(base + 84, true),
      generation: view.getUint32(base + 88, true),
    };
  }

  async function readAgent(index: number): Promise<PickedAgent | null> {
    if (agentSingleReadbackMapping) return null;
    const count = agentSystem.getAgentCount();
    if (index < 0 || index >= count) return null;

    agentSingleReadbackMapping = true;
    try {
      const offset = index * 96;
      const encoder = device.createCommandEncoder({ label: 'readAgentSingle' });
      encoder.copyBufferToBuffer(agentSystem.getBuffer(), offset, agentSingleReadbackBuffer, 0, 96);
      device.queue.submit([encoder.finish()]);

      await agentSingleReadbackBuffer.mapAsync(GPUMapMode.READ);
      const view = new DataView(agentSingleReadbackBuffer.getMappedRange());
      const agent = parseAgent(view, 0, index);
      agentSingleReadbackBuffer.unmap();
      return agent.alive === 0 ? null : agent;
    } finally {
      agentSingleReadbackMapping = false;
    }
  }

  async function pickNearestAgentAtClient(clientX: number, clientY: number, maxPixels: number): Promise<PickedAgent | null> {
    if (agentReadbackMapping) return null;
    const count = agentSystem.getAgentCount();
    if (count === 0) return null;

    agentReadbackMapping = true;
    try {
      const byteCount = count * 96;
      const encoder = device.createCommandEncoder({ label: 'pickAgentSnapshot' });
      encoder.copyBufferToBuffer(agentSystem.getBuffer(), 0, agentReadbackBuffer, 0, byteCount);
      device.queue.submit([encoder.finish()]);

      await agentReadbackBuffer.mapAsync(GPUMapMode.READ);
      const view = new DataView(agentReadbackBuffer.getMappedRange());

      let best: PickedAgent | null = null;
      let bestDist2 = maxPixels * maxPixels;

      const rect = canvas.getBoundingClientRect();
      const heightScale = config.heightScale;
      const agentScale = config.agentScale;
      const baseSize = agentScale * 3.0;
      const m = camera.viewProjMatrix;

      function project(ax: number, ay: number, az: number): { x: number; y: number; visible: boolean } {
        const cx = m[0] * ax + m[4] * ay + m[8] * az + m[12];
        const cy = m[1] * ax + m[5] * ay + m[9] * az + m[13];
        const cw = m[3] * ax + m[7] * ay + m[11] * az + m[15];
        if (cw <= 0.00001) return { x: -1, y: -1, visible: false };
        const ndcX = cx / cw;
        const ndcY = cy / cw;
        const px = (ndcX * 0.5 + 0.5) * canvas.width;
        const py = (1.0 - (ndcY * 0.5 + 0.5)) * canvas.height;
        const x = rect.left + (px / canvas.width) * rect.width;
        const y = rect.top + (py / canvas.height) * rect.height;
        const visible = ndcX >= -1.2 && ndcX <= 1.2 && ndcY >= -1.2 && ndcY <= 1.2;
        return { x, y, visible };
      }

      for (let i = 0; i < count; i++) {
        const base = i * 96;
        const alive = view.getUint32(base + 80, true);
        if (alive === 0) continue;

        const ax = view.getFloat32(base + 0, true);
        const az = view.getFloat32(base + 4, true);
        const energy = view.getFloat32(base + 16, true);
        const energyScale = 0.5 + Math.max(0, Math.min(1, energy / 100.0)) * 0.5;
        const size = baseSize * energyScale;

        const hNorm = fieldSystem.sampleHeightNormalizedAt(ax, az);
        const terrainY = hNorm * heightScale;
        const worldY = terrainY + size * 0.5;

        const p = project(ax, worldY, az);
        if (!p.visible) continue;
        const dx = p.x - clientX;
        const dy = p.y - clientY;
        const dist2 = dx * dx + dy * dy;
        if (dist2 < bestDist2) {
          bestDist2 = dist2;
          best = parseAgent(view, base, i);
        }
      }

      agentReadbackBuffer.unmap();
      return best;
    } finally {
      agentReadbackMapping = false;
    }
  }

  // 메인 루프
  function frame(timestamp: number): void {
    if (!running) return;

    // 델타 타임 계산
    let deltaTime = lastFrameTime ? (timestamp - lastFrameTime) / 1000 : 0.016;
    lastFrameTime = timestamp;
    deltaTime = Math.max(0, Math.min(MAX_DELTA_TIME, deltaTime));

    // FPS 계산
    fpsAccumulator += deltaTime * 1000;
    fpsFrameCount++;
    if (fpsAccumulator >= FPS_UPDATE_INTERVAL) {
      fps = Math.round(fpsFrameCount / (fpsAccumulator / 1000));
      frameTime = fpsAccumulator / fpsFrameCount;
      fpsAccumulator = 0;
      fpsFrameCount = 0;
    }

    // 일시정지가 아니면 시뮬레이션 업데이트
    if (!paused) {
      const stepScale = Number.isFinite(config.stepScale) ? config.stepScale : 1;
      stepAccumulator += deltaTime * Math.max(0, stepScale);

      // 과도한 루프 방지 (저사양/탭 복귀 등)
      const maxStepsThisFrame = 240;
      let steps = 0;

      while (stepAccumulator >= FIXED_STEP_DT && steps < maxStepsThisFrame) {
        simulationTime += FIXED_STEP_DT * config.timeScale;
        update(FIXED_STEP_DT);
        stepAccumulator -= FIXED_STEP_DT;
        steps++;
      }

      // 누적이 너무 쌓이면 드롭 (spiral of death 방지)
      stepAccumulator = Math.min(stepAccumulator, FIXED_STEP_DT);
    }

    // 렌더링 (항상)
    render();

    frameCount++;
    animationId = requestAnimationFrame(frame);
  }

  function update(deltaTime: number): void {
    // 필드 업데이트와 에이전트 업데이트를 별도 커맨드로 분리
    // (같은 인코더에서 같은 버퍼를 여러 번 쓰기로 바인딩할 수 없음)

    // 1. 필드 업데이트 (확산, 소산, 생성)
    const fieldEncoder = device.createCommandEncoder({ label: 'fieldUpdate' });
    fieldSystem.update(fieldEncoder, deltaTime, simulationTime);
    device.queue.submit([fieldEncoder.finish()]);

    // 2-5. 에이전트 업데이트 (센싱, 결정, 행동, 안정화, 생명주기)
    const agentEncoder = device.createCommandEncoder({ label: 'agentUpdate' });
    agentSystem.update(agentEncoder, fieldSystem, deltaTime, simulationTime);
    device.queue.submit([agentEncoder.finish()]);
  }

  function render(): void {
    // 카메라 업데이트
    camera.update(canvas.width, canvas.height);

    const encoder = device.createCommandEncoder({ label: 'render' });
    const textureView = context.getCurrentTexture().createView();
    const depthView = depthTexture.createView();

    // 필드 렌더링
    fieldRenderer.render(encoder, textureView, depthView, camera, fieldSystem, simulationTime);

    // 에이전트 렌더링
    agentRenderer.render(encoder, textureView, depthView, camera, agentSystem, fieldSystem, simulationTime);

    device.queue.submit([encoder.finish()]);
  }

  function start(): void {
    if (running) return;
    running = true;
    lastFrameTime = 0;
    stepAccumulator = 0;
    ensureProbeInterval();
    animationId = requestAnimationFrame(frame);
  }

  function stop(): void {
    running = false;
    if (animationId !== null) {
      cancelAnimationFrame(animationId);
      animationId = null;
    }
    stepAccumulator = 0;
    if (probeIntervalId !== null) {
      clearInterval(probeIntervalId);
      probeIntervalId = null;
    }
  }

  function pause(): void {
    paused = true;
  }

  function resume(): void {
    paused = false;
    stepAccumulator = 0;
  }

  function setTimeScale(scale: number): void {
    config.timeScale = Math.max(0, Math.min(10, scale));
  }

  function getStats(): SimulationStats {
    return {
      fps,
      frameTime,
      aliveAgentCount: agentSystem.getAliveCount(),
      allocatedAgentCount: agentSystem.getAgentCount(),
      births: agentSystem.getRecentBirths(),
      deaths: agentSystem.getRecentDeaths(),
      uptake: agentSystem.getRecentUptake(),
      time: simulationTime,
      paused,
      evolutionSample: agentSystem.getEvolutionSample(),
      evolutionBirths: agentSystem.getEvolutionBirths(),
      evolutionDeaths: agentSystem.getEvolutionDeaths(),
    };
  }

  function updateConfig(newConfig: Partial<SimulationConfig>): void {
    Object.assign(config, newConfig);
  }

  function updateRenderConfig(newConfig: Partial<RenderConfig>): void {
    Object.assign(renderConfig, newConfig);
    fieldRenderer.updateConfig(renderConfig);
    agentRenderer.updateConfig(renderConfig);
  }

  function getCamera(): Camera {
    return camera;
  }

  function getRenderConfig(): RenderConfig {
    return { ...renderConfig };
  }

  function resetSimulation(): void {
    // 설정을 기본값으로 리셋
    config = { ...DEFAULT_CONFIG };
    renderConfig = { ...DEFAULT_RENDER_CONFIG };
    simulationTime = 0;

    // 에이전트 시스템 리셋 (초기 에이전트 재생성)
    agentSystem.reset();

    // 필드 시스템 리셋
    fieldSystem.reset();

    // 렌더러 설정 업데이트
    fieldRenderer.updateConfig(renderConfig);
    agentRenderer.updateConfig(renderConfig);
  }

  return {
    start,
    stop,
    pause,
    resume,
    setTimeScale,
    getStats,
    updateConfig,
    updateRenderConfig,
    getCamera,
    setProbeCell,
    getProbeData,
    readFieldCell,
    pickNearestAgentAtClient,
    readAgent,
    getConfig: () => ({ ...config }),
    getRenderConfig,
    resetSimulation,
  };
}
