/**
 * @fileoverview 에이전트 시스템
 * 에이전트 생성, 업데이트, 생명주기 관리
 */

import { createBuffer, createEmptyBuffer, createShaderModule } from '../core/gpu-context';
import { FieldSystem } from './field-system';
import { SimulationConfig } from '../types/config';
import { AGENT_STRUCT_SIZE, createRandomGenetics, GENETIC_RANGES } from '../types/agent';
import agentShaderCode from '../shaders/agents.wgsl?raw';

export interface AgentSystem {
  buffer: GPUBuffer;
  countBuffer: GPUBuffer;
  paramsBuffer: GPUBuffer;
  metricsBuffer: GPUBuffer;
  freeListBuffer: GPUBuffer;

  update(encoder: GPUCommandEncoder, fieldSystem: FieldSystem, deltaTime: number, time: number): void;
  getBuffer(): GPUBuffer;
  getAgentCount(): number;
  getAliveCount(): number;
  getRecentBirths(): number;
  getRecentDeaths(): number;
  getRecentUptake(): number; // energy 단위(약)
  getEvolutionSample(): EvolutionSample;
  getEvolutionBirths(): EvolutionSample;
  getEvolutionDeaths(): EvolutionSample;
  getCountBuffer(): GPUBuffer;
  destroy(): void;
  reset(): void;
}

export interface EvolutionSample {
  count: number;
  efficiency: number;
  metabolism: number;
  activity: number;
  senseRange: number;
  evasion: number;
  sociality: number;
}

export function createAgentSystem(
  device: GPUDevice,
  config: SimulationConfig
): AgentSystem {
  const deviceCap = Math.floor(device.limits.maxStorageBufferBindingSize / AGENT_STRUCT_SIZE);
  const maxAgents = Math.max(1, Math.min(config.maxAgentCount, deviceCap));
  config.maxAgentCount = maxAgents;
  const initialCount = config.initialAgentCount;

  // 에이전트 버퍼 크기 (96 bytes per agent)
  const bufferSize = maxAgents * AGENT_STRUCT_SIZE;

  // 초기 에이전트 데이터 생성
  const agentData = new Float32Array(bufferSize / 4);
  const agentView = new DataView(agentData.buffer);

  for (let i = 0; i < initialCount; i++) {
    const offset = i * AGENT_STRUCT_SIZE;

    // 위치 (랜덤)
    const posX = Math.random() * config.gridSize;
    const posY = Math.random() * config.gridSize;
    const velX = (Math.random() - 0.5) * 2;
    const velY = (Math.random() - 0.5) * 2;

    agentView.setFloat32(offset + 0, posX, true);
    agentView.setFloat32(offset + 4, posY, true);
    agentView.setFloat32(offset + 8, velX, true);
    agentView.setFloat32(offset + 12, velY, true);

    // 상태
    const energy = 50 + Math.random() * 50;
    agentView.setFloat32(offset + 16, energy, true);
    agentView.setUint32(offset + 20, 0, true);  // mode = EXPLORE
    agentView.setFloat32(offset + 24, 0, true); // stress
    agentView.setFloat32(offset + 28, 0, true); // cooldown

    // 유전 파라미터
    const genetics = createRandomGenetics();
    agentView.setFloat32(offset + 32, genetics.efficiency ?? GENETIC_RANGES.efficiency.default, true);
    agentView.setFloat32(offset + 36, genetics.absorption ?? GENETIC_RANGES.absorption.default, true);
    agentView.setFloat32(offset + 40, genetics.metabolism ?? GENETIC_RANGES.metabolism.default, true);
    agentView.setFloat32(offset + 44, genetics.moveCost ?? GENETIC_RANGES.moveCost.default, true);
    agentView.setFloat32(offset + 48, genetics.activity ?? GENETIC_RANGES.activity.default, true);
    agentView.setFloat32(offset + 52, genetics.agility ?? GENETIC_RANGES.agility.default, true);
    agentView.setFloat32(offset + 56, genetics.senseRange ?? GENETIC_RANGES.senseRange.default, true);
    agentView.setFloat32(offset + 60, genetics.aggression ?? GENETIC_RANGES.aggression.default, true);
    agentView.setFloat32(offset + 64, genetics.evasion ?? GENETIC_RANGES.evasion.default, true);
    agentView.setFloat32(offset + 68, genetics.sociality ?? GENETIC_RANGES.sociality.default, true);
    agentView.setFloat32(offset + 72, genetics.reproThreshold ?? GENETIC_RANGES.reproThreshold.default, true);
    agentView.setFloat32(offset + 76, genetics.reproCooldown ?? GENETIC_RANGES.reproCooldown.default, true);

    // 플래그
    agentView.setUint32(offset + 80, 1, true);  // alive = true
    agentView.setFloat32(offset + 84, 0, true); // age
    agentView.setUint32(offset + 88, 0, true);  // generation
    agentView.setUint32(offset + 92, 0, true);  // padding
  }

  // 버퍼 생성
  const buffer = createBuffer(
    device,
    agentData,
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    'agents'
  );

  // 에이전트 카운트 버퍼 (atomic)
  const countData = new Uint32Array([initialCount]);
  const countBuffer = createBuffer(
    device,
    countData,
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    'agentCount'
  );

  // 파라미터 버퍼
  const paramsBuffer = createEmptyBuffer(
    device,
    48,
    GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    'agentParams'
  );

  // 셰이더 모듈
  const shaderModule = createShaderModule(device, agentShaderCode, 'agentShader');

  // 바인드 그룹 레이아웃
  const bindGroupLayout = device.createBindGroupLayout({
    label: 'agentBindGroupLayout',
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 7, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 8, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 9, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 10, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    ],
  });

  // 파이프라인
  const updatePipeline = device.createComputePipeline({
    label: 'agentUpdatePipeline',
    layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
    compute: {
      module: shaderModule,
      entryPoint: 'updateAgents',
    },
  });

  const reproductionPipeline = device.createComputePipeline({
    label: 'agentReproductionPipeline',
    layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
    compute: {
      module: shaderModule,
      entryPoint: 'processReproduction',
    },
  });

  // 파라미터 데이터
  const paramsData = new ArrayBuffer(48);
  const paramsView = new DataView(paramsData);

  let currentAgentCount = initialCount;
  let currentAliveCount = initialCount;
  let recentBirths = 0;
  let recentDeaths = 0;
  let recentUptake = 0;

  // 메트릭 버퍼 (alive/births/deaths/uptake)
  const METRICS_U32_COUNT = 23;
  const metricsInit = new Uint32Array(METRICS_U32_COUNT);
  metricsInit[0] = initialCount;
  const metricsBuffer = createBuffer(
    device,
    metricsInit,
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    'agentMetrics'
  );

  // Free-list (dead slot reuse): [freeCount, pad*3, indices...]
  const freeListInit = new Uint32Array(4 + maxAgents);
  const freeListBuffer = createBuffer(
    device,
    freeListInit,
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    'agentFreeList'
  );

  // 카운트/메트릭 읽기용 버퍼
  const readbackBuffer = device.createBuffer({
    label: 'agentCountersReadback',
    size: 4 + METRICS_U32_COUNT * 4,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });

  let bindGroup: GPUBindGroup | null = null;
  let isReadbackMapped = false;

  let evolutionSample: EvolutionSample = { count: 0, efficiency: 0, metabolism: 0, activity: 0, senseRange: 0, evasion: 0, sociality: 0 };
  // 출생/사망 형질은 짧은 창(window) 평균이 노이즈가 커서, 장기 EMA로 노출
  const EMA_TAU_SECONDS = 60;
  let evolutionBirths: EvolutionSample = { count: 0, efficiency: 0, metabolism: 0, activity: 0, senseRange: 0, evasion: 0, sociality: 0 };
  let evolutionDeaths: EvolutionSample = { count: 0, efficiency: 0, metabolism: 0, activity: 0, senseRange: 0, evasion: 0, sociality: 0 };
  let lastEmaUpdateMs = performance.now();

  function alphaForEma(dtSeconds: number): number {
    const dt = Math.max(0, dtSeconds);
    return 1 - Math.exp(-dt / EMA_TAU_SECONDS);
  }

  function emaUpdate(prev: number, next: number, alpha: number): number {
    return prev * (1 - alpha) + next * alpha;
  }

  function update(
    encoder: GPUCommandEncoder,
    fieldSystem: FieldSystem,
    deltaTime: number,
    time: number
  ): void {
    // 파라미터 업데이트
    paramsView.setUint32(0, config.gridSize, true);
    paramsView.setUint32(4, currentAgentCount, true);
    paramsView.setUint32(8, maxAgents, true);
    paramsView.setUint32(12, 0, true); // padding
    paramsView.setFloat32(16, deltaTime * config.timeScale, true);
    paramsView.setFloat32(20, time, true);
    paramsView.setFloat32(24, config.saturationK, true);
    paramsView.setFloat32(28, config.densityPenalty, true);
    paramsView.setFloat32(32, config.uptakeScale, true);
    paramsView.setFloat32(36, config.energyCostScale, true);
    paramsView.setFloat32(40, 0, true);  // padding
    paramsView.setFloat32(44, 0, true);  // padding

    device.queue.writeBuffer(paramsBuffer, 0, paramsData);

    // 바인드 그룹 생성
    bindGroup = device.createBindGroup({
      label: 'agentBindGroup',
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: paramsBuffer } },
        { binding: 1, resource: { buffer: buffer } },
        { binding: 2, resource: { buffer: fieldSystem.getResourceBuffer() } },
        { binding: 3, resource: { buffer: fieldSystem.getTerrainBuffer() } },
        { binding: 4, resource: { buffer: fieldSystem.getDangerBuffer() } },
        { binding: 5, resource: { buffer: fieldSystem.getPheromoneBuffer() } },
        { binding: 6, resource: { buffer: countBuffer } },
        { binding: 7, resource: { buffer: metricsBuffer } },
        { binding: 8, resource: { buffer: freeListBuffer } },
        { binding: 9, resource: { buffer: fieldSystem.getResourceConsumeMicroBuffer() } },
        { binding: 10, resource: { buffer: fieldSystem.getPheromoneDepositMicroBuffer() } },
      ],
    });

    // 에이전트 업데이트
    const workgroups = Math.ceil(currentAgentCount / 64);

    const updatePass = encoder.beginComputePass({ label: 'agentUpdate' });
    updatePass.setPipeline(updatePipeline);
    updatePass.setBindGroup(0, bindGroup);
    updatePass.dispatchWorkgroups(workgroups);
    updatePass.end();

    // 번식 처리
    const reproPass = encoder.beginComputePass({ label: 'agentReproduction' });
    reproPass.setPipeline(reproductionPipeline);
    reproPass.setBindGroup(0, bindGroup);
    reproPass.dispatchWorkgroups(workgroups);
    reproPass.end();

    // 에이전트 카운트 읽기 (비동기) - 매핑 중이 아닐 때만 복사
    if (!isReadbackMapped) {
      encoder.copyBufferToBuffer(countBuffer, 0, readbackBuffer, 0, 4);
      encoder.copyBufferToBuffer(metricsBuffer, 0, readbackBuffer, 4, METRICS_U32_COUNT * 4);
    }
  }

  // 비동기로 카운터 갱신
  async function updateCounters(): Promise<void> {
    if (isReadbackMapped) return; // 이미 매핑 중이면 스킵

    isReadbackMapped = true;
    try {
      await readbackBuffer.mapAsync(GPUMapMode.READ);
      const data = new Uint32Array(readbackBuffer.getMappedRange());
      currentAgentCount = Math.min(data[0], maxAgents);
      currentAliveCount = Math.min(data[1], maxAgents);
      recentBirths = data[2];
      recentDeaths = data[3];
      recentUptake = data[4];

      const sampleCount = data[5];
      const sumEffMilli = data[6];
      const sumMetabMilli = data[7];
      const sumActMilli = data[8];
      const sumSenseDeci = data[9];
      const sumEvasionMilli = data[10];
      const sumSocialMilli = data[11];

      const birthsEffMilli = data[12];
      const birthsMetabMilli = data[13];
      const birthsActMilli = data[14];
      const birthsSenseDeci = data[15];
      const birthsEvasionMilli = data[16];
      const birthsSocialMilli = data[17];

      const deathsEffMilli = data[18];
      const deathsMetabMilli = data[19];
      const deathsActMilli = data[20];
      const deathsSenseDeci = data[21];
      const deathsEvasionMilli = data[22];
      const deathsSocialMilli = data[23];

      evolutionSample = {
        count: sampleCount,
        efficiency: sampleCount ? sumEffMilli / 1000 / sampleCount : 0,
        metabolism: sampleCount ? sumMetabMilli / 1000 / sampleCount : 0,
        activity: sampleCount ? sumActMilli / 1000 / sampleCount : 0,
        senseRange: sampleCount ? sumSenseDeci / 10 / sampleCount : 0,
        evasion: sampleCount ? sumEvasionMilli / 1000 / sampleCount : 0,
        sociality: sampleCount ? sumSocialMilli / 1000 / sampleCount : 0,
      };

      const nowMs = performance.now();
      const dtSeconds = (nowMs - lastEmaUpdateMs) / 1000;
      lastEmaUpdateMs = nowMs;
      const alpha = alphaForEma(dtSeconds);

      if (recentBirths > 0) {
        const birthsBatch: EvolutionSample = {
          count: recentBirths,
          efficiency: birthsEffMilli / 1000 / recentBirths,
          metabolism: birthsMetabMilli / 1000 / recentBirths,
          activity: birthsActMilli / 1000 / recentBirths,
          senseRange: birthsSenseDeci / 10 / recentBirths,
          evasion: birthsEvasionMilli / 1000 / recentBirths,
          sociality: birthsSocialMilli / 1000 / recentBirths,
        };
        evolutionBirths = {
          count: evolutionBirths.count + recentBirths,
          efficiency: emaUpdate(evolutionBirths.efficiency, birthsBatch.efficiency, alpha),
          metabolism: emaUpdate(evolutionBirths.metabolism, birthsBatch.metabolism, alpha),
          activity: emaUpdate(evolutionBirths.activity, birthsBatch.activity, alpha),
          senseRange: emaUpdate(evolutionBirths.senseRange, birthsBatch.senseRange, alpha),
          evasion: emaUpdate(evolutionBirths.evasion, birthsBatch.evasion, alpha),
          sociality: emaUpdate(evolutionBirths.sociality, birthsBatch.sociality, alpha),
        };
      }

      if (recentDeaths > 0) {
        const deathsBatch: EvolutionSample = {
          count: recentDeaths,
          efficiency: deathsEffMilli / 1000 / recentDeaths,
          metabolism: deathsMetabMilli / 1000 / recentDeaths,
          activity: deathsActMilli / 1000 / recentDeaths,
          senseRange: deathsSenseDeci / 10 / recentDeaths,
          evasion: deathsEvasionMilli / 1000 / recentDeaths,
          sociality: deathsSocialMilli / 1000 / recentDeaths,
        };
        evolutionDeaths = {
          count: evolutionDeaths.count + recentDeaths,
          efficiency: emaUpdate(evolutionDeaths.efficiency, deathsBatch.efficiency, alpha),
          metabolism: emaUpdate(evolutionDeaths.metabolism, deathsBatch.metabolism, alpha),
          activity: emaUpdate(evolutionDeaths.activity, deathsBatch.activity, alpha),
          senseRange: emaUpdate(evolutionDeaths.senseRange, deathsBatch.senseRange, alpha),
          evasion: emaUpdate(evolutionDeaths.evasion, deathsBatch.evasion, alpha),
          sociality: emaUpdate(evolutionDeaths.sociality, deathsBatch.sociality, alpha),
        };
      }
      readbackBuffer.unmap();

      // 최근값(누적)을 리셋 (alive는 유지)
      device.queue.writeBuffer(metricsBuffer, 4, new Uint32Array(METRICS_U32_COUNT - 1));
    } finally {
      isReadbackMapped = false;
    }
  }

  // 주기적으로 카운터 갱신
  const intervalId = setInterval(() => {
    updateCounters().catch(console.error);
  }, 500);

  function destroy(): void {
    clearInterval(intervalId);
  }

  function reset(): void {
    const initialCount = config.initialAgentCount;

    // 에이전트 데이터 재생성
    const bufferSize = maxAgents * AGENT_STRUCT_SIZE;
    const agentData = new Float32Array(bufferSize / 4);
    const agentView = new DataView(agentData.buffer);

    for (let i = 0; i < initialCount; i++) {
      const offset = i * AGENT_STRUCT_SIZE;

      // 위치 (랜덤)
      const posX = Math.random() * config.gridSize;
      const posY = Math.random() * config.gridSize;
      const velX = (Math.random() - 0.5) * 2;
      const velY = (Math.random() - 0.5) * 2;

      agentView.setFloat32(offset + 0, posX, true);
      agentView.setFloat32(offset + 4, posY, true);
      agentView.setFloat32(offset + 8, velX, true);
      agentView.setFloat32(offset + 12, velY, true);

      // 상태
      const energy = 50 + Math.random() * 50;
      agentView.setFloat32(offset + 16, energy, true);
      agentView.setUint32(offset + 20, 0, true);  // mode = EXPLORE
      agentView.setFloat32(offset + 24, 0, true); // stress
      agentView.setFloat32(offset + 28, 0, true); // cooldown

      // 유전 파라미터
      const genetics = createRandomGenetics();
      agentView.setFloat32(offset + 32, genetics.efficiency ?? GENETIC_RANGES.efficiency.default, true);
      agentView.setFloat32(offset + 36, genetics.absorption ?? GENETIC_RANGES.absorption.default, true);
      agentView.setFloat32(offset + 40, genetics.metabolism ?? GENETIC_RANGES.metabolism.default, true);
      agentView.setFloat32(offset + 44, genetics.moveCost ?? GENETIC_RANGES.moveCost.default, true);
      agentView.setFloat32(offset + 48, genetics.activity ?? GENETIC_RANGES.activity.default, true);
      agentView.setFloat32(offset + 52, genetics.agility ?? GENETIC_RANGES.agility.default, true);
      agentView.setFloat32(offset + 56, genetics.senseRange ?? GENETIC_RANGES.senseRange.default, true);
      agentView.setFloat32(offset + 60, genetics.aggression ?? GENETIC_RANGES.aggression.default, true);
      agentView.setFloat32(offset + 64, genetics.evasion ?? GENETIC_RANGES.evasion.default, true);
      agentView.setFloat32(offset + 68, genetics.sociality ?? GENETIC_RANGES.sociality.default, true);
      agentView.setFloat32(offset + 72, genetics.reproThreshold ?? GENETIC_RANGES.reproThreshold.default, true);
      agentView.setFloat32(offset + 76, genetics.reproCooldown ?? GENETIC_RANGES.reproCooldown.default, true);

      // 플래그
      agentView.setUint32(offset + 80, 1, true);  // alive = true
      agentView.setFloat32(offset + 84, 0, true); // age
      agentView.setUint32(offset + 88, 0, true);  // generation
      agentView.setUint32(offset + 92, 0, true);  // padding
    }

    // 버퍼에 데이터 쓰기
    device.queue.writeBuffer(buffer, 0, agentData);

    // 카운트 리셋
    device.queue.writeBuffer(countBuffer, 0, new Uint32Array([initialCount]));

    // 메트릭 리셋
    const resetMetrics = new Uint32Array(METRICS_U32_COUNT);
    resetMetrics[0] = initialCount;
    device.queue.writeBuffer(metricsBuffer, 0, resetMetrics);

    // 프리리스트 리셋
    device.queue.writeBuffer(freeListBuffer, 0, new Uint32Array(4 + maxAgents));

    // 로컬 상태 리셋
    currentAgentCount = initialCount;
    currentAliveCount = initialCount;
    recentBirths = 0;
    recentDeaths = 0;
    recentUptake = 0;
    evolutionSample = { count: 0, efficiency: 0, metabolism: 0, activity: 0, senseRange: 0, evasion: 0, sociality: 0 };
    evolutionBirths = { count: 0, efficiency: 0, metabolism: 0, activity: 0, senseRange: 0, evasion: 0, sociality: 0 };
    evolutionDeaths = { count: 0, efficiency: 0, metabolism: 0, activity: 0, senseRange: 0, evasion: 0, sociality: 0 };
    lastEmaUpdateMs = performance.now();
  }

  return {
    buffer,
    countBuffer,
    paramsBuffer,
    metricsBuffer,
    freeListBuffer,
    update,
    getBuffer: () => buffer,
    getAgentCount: () => currentAgentCount,
    getAliveCount: () => currentAliveCount,
    getRecentBirths: () => recentBirths,
    getRecentDeaths: () => recentDeaths,
    getRecentUptake: () => recentUptake / 1_000_000, // micro -> energy
    getEvolutionSample: () => evolutionSample,
    getEvolutionBirths: () => evolutionBirths,
    getEvolutionDeaths: () => evolutionDeaths,
    getCountBuffer: () => countBuffer,
    destroy,
    reset,
  };
}
