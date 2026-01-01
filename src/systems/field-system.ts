/**
 * @fileoverview 환경 필드 시스템
 * 자원, 지형, 위험, 페로몬 필드 관리
 */

import { createBuffer, createEmptyBuffer, createShaderModule } from '../core/gpu-context';
import {
  createResourceField,
  createHeightField,
  createTerrainField,
  createDangerField,
  createEmptyField,
  DEFAULT_FIELD_PARAMS,
} from '../types/field';
import { SimulationConfig } from '../types/config';
import fieldShaderCode from '../shaders/fields.wgsl?raw';

export interface FieldBuffers {
  resource: [GPUBuffer, GPUBuffer];  // 더블 버퍼링
  height: GPUBuffer;
  terrain: GPUBuffer;
  danger: [GPUBuffer, GPUBuffer];    // 더블 버퍼링 (동적 위험/오염)
  pheromone: [GPUBuffer, GPUBuffer]; // 더블 버퍼링
  resourceConsumeMicro: GPUBuffer;   // 에이전트가 섭취한 양 누적 (u32, micro 단위)
  pheromoneDepositMicro: GPUBuffer;  // 에이전트가 방출한 페로몬 누적 (u32, micro 단위)
  params: GPUBuffer;
}

export interface FieldSystem {
  buffers: FieldBuffers;
  pipeline: GPUComputePipeline;
  bindGroups: [GPUBindGroup, GPUBindGroup]; // 핑퐁용
  currentBuffer: number; // 0 또는 1

  update(encoder: GPUCommandEncoder, deltaTime: number, time: number): void;
  getResourceBuffer(): GPUBuffer;         // 현재 상태(읽기/렌더용)
  getHeightBuffer(): GPUBuffer;           // 고도(렌더/샘플링용)
  getTerrainBuffer(): GPUBuffer;
  getDangerBuffer(): GPUBuffer;
  getPheromoneBuffer(): GPUBuffer;        // 현재 상태(읽기/렌더용)
  getResourceConsumeMicroBuffer(): GPUBuffer;
  getPheromoneDepositMicroBuffer(): GPUBuffer;
  sampleHeightNormalizedAt(x: number, y: number): number;
  reset(): void;
}

export function createFieldSystem(
  device: GPUDevice,
  config: SimulationConfig
): FieldSystem {
  const gridSize = config.gridSize;

  // 초기 필드 데이터 생성
  const resourceData = createResourceField(gridSize);
  const heightData = createHeightField(gridSize);
  const terrainData = createTerrainField(gridSize, heightData);
  const dangerData = createDangerField(gridSize, DEFAULT_FIELD_PARAMS.dangerZones);
  const pheromoneData = createEmptyField(gridSize);

  // 버퍼 생성 (더블 버퍼링)
  const buffers: FieldBuffers = {
    resource: [
      createBuffer(device, resourceData, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC, 'resource0'),
      createBuffer(device, resourceData, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC, 'resource1'),
    ],
    height: createBuffer(device, heightData, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC, 'height'),
    terrain: createBuffer(device, terrainData, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC, 'terrain'),
    danger: [
      createBuffer(device, dangerData, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC, 'danger0'),
      createBuffer(device, dangerData, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC, 'danger1'),
    ],
    pheromone: [
      createBuffer(device, pheromoneData, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC, 'pheromone0'),
      createBuffer(device, pheromoneData, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC, 'pheromone1'),
    ],
    resourceConsumeMicro: createEmptyBuffer(
      device,
      gridSize * gridSize * 4,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      'resourceConsumeMicro'
    ),
    pheromoneDepositMicro: createEmptyBuffer(
      device,
      gridSize * gridSize * 4,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      'pheromoneDepositMicro'
    ),
    params: createEmptyBuffer(device, 64, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, 'fieldParams'),
  };

  // 셰이더 모듈
  const shaderModule = createShaderModule(device, fieldShaderCode, 'fieldShader');

  // 바인드 그룹 레이아웃
  const bindGroupLayout = device.createBindGroupLayout({
    label: 'fieldBindGroupLayout',
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } }, // dangerIn
      { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } }, // dangerOut
      { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } }, // pheromoneIn
      { binding: 7, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } }, // pheromoneOut
      { binding: 8, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } }, // consume
      { binding: 9, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } }, // deposit
    ],
  });

  // 파이프라인
  const pipeline = device.createComputePipeline({
    label: 'fieldPipeline',
    layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
    compute: {
      module: shaderModule,
      entryPoint: 'updateFields',
    },
  });

  // 바인드 그룹 (핑퐁)
  const bindGroups: [GPUBindGroup, GPUBindGroup] = [
    device.createBindGroup({
      label: 'fieldBindGroup0',
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: buffers.params } },
        { binding: 1, resource: { buffer: buffers.resource[0] } },
        { binding: 2, resource: { buffer: buffers.resource[1] } },
        { binding: 3, resource: { buffer: buffers.terrain } },
        { binding: 4, resource: { buffer: buffers.danger[0] } },
        { binding: 5, resource: { buffer: buffers.danger[1] } },
        { binding: 6, resource: { buffer: buffers.pheromone[0] } },
        { binding: 7, resource: { buffer: buffers.pheromone[1] } },
        { binding: 8, resource: { buffer: buffers.resourceConsumeMicro } },
        { binding: 9, resource: { buffer: buffers.pheromoneDepositMicro } },
      ],
    }),
    device.createBindGroup({
      label: 'fieldBindGroup1',
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: buffers.params } },
        { binding: 1, resource: { buffer: buffers.resource[1] } },
        { binding: 2, resource: { buffer: buffers.resource[0] } },
        { binding: 3, resource: { buffer: buffers.terrain } },
        { binding: 4, resource: { buffer: buffers.danger[1] } },
        { binding: 5, resource: { buffer: buffers.danger[0] } },
        { binding: 6, resource: { buffer: buffers.pheromone[1] } },
        { binding: 7, resource: { buffer: buffers.pheromone[0] } },
        { binding: 8, resource: { buffer: buffers.resourceConsumeMicro } },
        { binding: 9, resource: { buffer: buffers.pheromoneDepositMicro } },
      ],
    }),
  ];

  let currentBuffer = 0;

  // 파라미터 데이터
  const paramsData = new Float32Array(16);

  function clampIndex(v: number): number {
    return Math.max(0, Math.min(gridSize - 1, v | 0));
  }

  function heightAt(ix: number, iy: number): number {
    const x = clampIndex(ix);
    const y = clampIndex(iy);
    return heightData[y * gridSize + x];
  }

  function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
  }

  function sampleHeightNormalizedAt(x: number, y: number): number {
    const stride = 4;
    const sx = Math.floor(x / stride) * stride;
    const sy = Math.floor(y / stride) * stride;

    const h00 = heightAt(sx, sy);
    const h10 = heightAt(sx + stride, sy);
    const h01 = heightAt(sx, sy + stride);
    const h11 = heightAt(sx + stride, sy + stride);

    const fx = x / stride - Math.floor(x / stride);
    const fy = y / stride - Math.floor(y / stride);

    const h0 = lerp(h00, h10, fx);
    const h1 = lerp(h01, h11, fx);
    return lerp(h0, h1, fy);
  }

  function update(encoder: GPUCommandEncoder, deltaTime: number, time: number): void {
    // 파라미터 업데이트
    paramsData[0] = gridSize;                    // gridSize (as float, but used as u32)
    paramsData[1] = config.diffusionRate;        // diffusionCoeff
    paramsData[2] = config.decayRate;            // resourceDecay
    paramsData[3] = config.pheromoneDecay;       // pheromoneDecay
    paramsData[4] = deltaTime * config.timeScale; // deltaTime
    paramsData[5] = time;                        // time
    paramsData[6] = config.resourceGeneration;   // resourceGeneration
    paramsData[7] = config.dangerDecay;          // dangerDecay
    paramsData[8] = config.dangerDiffusionScale; // dangerDiffusionScale
    paramsData[9] = config.dangerFromConsumption; // dangerFromConsumption
    paramsData[10] = config.resourcePatchDriftSpeed; // resourcePatchDriftSpeed
    paramsData[11] = 0;                          // padding
    paramsData[12] = 0;                          // padding
    paramsData[13] = 0;                          // padding
    paramsData[14] = 0;                          // padding
    paramsData[15] = 0;                          // padding

    // u32로 gridSize 설정
    const paramsView = new DataView(paramsData.buffer);
    paramsView.setUint32(0, gridSize, true);

    device.queue.writeBuffer(buffers.params, 0, paramsData);

    // Compute pass
    const pass = encoder.beginComputePass({ label: 'fieldUpdate' });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroups[currentBuffer]);

    const workgroupsX = Math.ceil(gridSize / 16);
    const workgroupsY = Math.ceil(gridSize / 16);
    pass.dispatchWorkgroups(workgroupsX, workgroupsY);
    pass.end();

    // 버퍼 스왑
    currentBuffer = 1 - currentBuffer;
  }

  function reset(): void {
    // 자원 필드 리셋
    const newResourceData = createResourceField(gridSize);
    device.queue.writeBuffer(buffers.resource[0], 0, newResourceData.buffer);
    device.queue.writeBuffer(buffers.resource[1], 0, newResourceData.buffer);

    // 페로몬 필드 리셋
    const newPheromoneData = createEmptyField(gridSize);
    device.queue.writeBuffer(buffers.pheromone[0], 0, newPheromoneData.buffer);
    device.queue.writeBuffer(buffers.pheromone[1], 0, newPheromoneData.buffer);

    // 위험(오염) 필드 리셋 (기본 위험 지형으로)
    device.queue.writeBuffer(buffers.danger[0], 0, dangerData.buffer);
    device.queue.writeBuffer(buffers.danger[1], 0, dangerData.buffer);

    // 누적 버퍼 리셋
    device.queue.writeBuffer(buffers.resourceConsumeMicro, 0, new Uint32Array(gridSize * gridSize));
    device.queue.writeBuffer(buffers.pheromoneDepositMicro, 0, new Uint32Array(gridSize * gridSize));

    // 버퍼 인덱스 리셋
    currentBuffer = 0;
  }

  return {
    buffers,
    pipeline,
    bindGroups,
    get currentBuffer() { return currentBuffer; },
    update,
    getResourceBuffer: () => buffers.resource[currentBuffer],
    getHeightBuffer: () => buffers.height,
    getTerrainBuffer: () => buffers.terrain,
    getDangerBuffer: () => buffers.danger[currentBuffer],
    getPheromoneBuffer: () => buffers.pheromone[currentBuffer],
    getResourceConsumeMicroBuffer: () => buffers.resourceConsumeMicro,
    getPheromoneDepositMicroBuffer: () => buffers.pheromoneDepositMicro,
    sampleHeightNormalizedAt,
    reset,
  };
}
