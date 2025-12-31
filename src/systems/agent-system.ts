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

  update(encoder: GPUCommandEncoder, fieldSystem: FieldSystem, deltaTime: number, time: number): void;
  getBuffer(): GPUBuffer;
  getAgentCount(): number;
  getCountBuffer(): GPUBuffer;
}

export function createAgentSystem(
  device: GPUDevice,
  config: SimulationConfig
): AgentSystem {
  const maxAgents = config.maxAgentCount;
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
    32,
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
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 7, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
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
  const paramsData = new ArrayBuffer(32);
  const paramsView = new DataView(paramsData);

  let currentAgentCount = initialCount;

  // 카운트 읽기용 버퍼
  const readbackBuffer = device.createBuffer({
    size: 4,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });

  let bindGroup: GPUBindGroup | null = null;

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
    paramsView.setFloat32(12, deltaTime * config.timeScale, true);
    paramsView.setFloat32(16, time, true);
    paramsView.setFloat32(20, config.saturationK, true);
    paramsView.setFloat32(24, config.densityPenalty, true);
    paramsView.setFloat32(28, 0, true);  // padding

    device.queue.writeBuffer(paramsBuffer, 0, paramsData);

    // 바인드 그룹 생성
    // 중요: 읽기 버퍼와 쓰기 버퍼가 다른 버퍼를 가리켜야 함
    bindGroup = device.createBindGroup({
      label: 'agentBindGroup',
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: paramsBuffer } },
        { binding: 1, resource: { buffer: buffer } },
        { binding: 2, resource: { buffer: fieldSystem.getResourceBuffer() } },       // 읽기
        { binding: 3, resource: { buffer: fieldSystem.getResourceOutputBuffer() } }, // 쓰기
        { binding: 4, resource: { buffer: fieldSystem.getTerrainBuffer() } },
        { binding: 5, resource: { buffer: fieldSystem.getDangerBuffer() } },
        { binding: 6, resource: { buffer: fieldSystem.getPheromoneOutputBuffer() } }, // 쓰기
        { binding: 7, resource: { buffer: countBuffer } },
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

    // 에이전트 카운트 읽기 (비동기)
    encoder.copyBufferToBuffer(countBuffer, 0, readbackBuffer, 0, 4);
  }

  // 비동기로 에이전트 수 갱신
  async function updateAgentCount(): Promise<void> {
    await readbackBuffer.mapAsync(GPUMapMode.READ);
    const data = new Uint32Array(readbackBuffer.getMappedRange());
    currentAgentCount = Math.min(data[0], maxAgents);
    readbackBuffer.unmap();
  }

  // 주기적으로 에이전트 수 갱신
  setInterval(() => {
    updateAgentCount().catch(console.error);
  }, 500);

  return {
    buffer,
    countBuffer,
    paramsBuffer,
    update,
    getBuffer: () => buffer,
    getAgentCount: () => currentAgentCount,
    getCountBuffer: () => countBuffer,
  };
}
