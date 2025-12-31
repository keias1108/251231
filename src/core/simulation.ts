/**
 * @fileoverview 메인 시뮬레이션 루프
 * 6단계 업데이트 사이클 관리
 */

import { GPUContext, resizeCanvas } from './gpu-context';
import { createFieldSystem, FieldSystem } from '../systems/field-system';
import { createAgentSystem, AgentSystem } from '../systems/agent-system';
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
}

export interface SimulationStats {
  fps: number;
  frameTime: number;
  agentCount: number;
  time: number;
  paused: boolean;
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

  // 리사이즈 핸들러
  function handleResize(): void {
    resizeCanvas(canvas);
    depthTexture.destroy();
    depthTexture = createDepthTexture();
  }

  window.addEventListener('resize', handleResize);

  // 메인 루프
  function frame(timestamp: number): void {
    if (!running) return;

    // 델타 타임 계산
    const deltaTime = lastFrameTime ? (timestamp - lastFrameTime) / 1000 : 0.016;
    lastFrameTime = timestamp;

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
      simulationTime += deltaTime * config.timeScale;
      update(deltaTime);
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
    animationId = requestAnimationFrame(frame);
  }

  function stop(): void {
    running = false;
    if (animationId !== null) {
      cancelAnimationFrame(animationId);
      animationId = null;
    }
  }

  function pause(): void {
    paused = true;
  }

  function resume(): void {
    paused = false;
  }

  function setTimeScale(scale: number): void {
    config.timeScale = Math.max(0, Math.min(10, scale));
  }

  function getStats(): SimulationStats {
    return {
      fps,
      frameTime,
      agentCount: agentSystem.getAgentCount(),
      time: simulationTime,
      paused,
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
  };
}
