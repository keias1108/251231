/**
 * @fileoverview 환경 필드 시스템
 * 자원, 지형, 위험, 페로몬 필드 관리
 */

import { createBuffer, createEmptyBuffer, createShaderModule } from '../core/gpu-context';
import {
  createResourceField,
  createTerrainField,
  createDangerField,
  createEmptyField,
  DEFAULT_FIELD_PARAMS,
} from '../types/field';
import { SimulationConfig } from '../types/config';
import fieldShaderCode from '../shaders/fields.wgsl?raw';

export interface FieldBuffers {
  resource: [GPUBuffer, GPUBuffer];  // 더블 버퍼링
  terrain: GPUBuffer;
  danger: GPUBuffer;
  pheromone: [GPUBuffer, GPUBuffer]; // 더블 버퍼링
  params: GPUBuffer;
}

export interface FieldSystem {
  buffers: FieldBuffers;
  pipeline: GPUComputePipeline;
  bindGroups: [GPUBindGroup, GPUBindGroup]; // 핑퐁용
  currentBuffer: number; // 0 또는 1

  update(encoder: GPUCommandEncoder, deltaTime: number, time: number): void;
  getResourceBuffer(): GPUBuffer;         // 읽기용 (현재 프레임 데이터)
  getResourceOutputBuffer(): GPUBuffer;   // 쓰기용 (에이전트가 자원 소비할 때)
  getTerrainBuffer(): GPUBuffer;
  getDangerBuffer(): GPUBuffer;
  getPheromoneBuffer(): GPUBuffer;
  getPheromoneOutputBuffer(): GPUBuffer;  // 쓰기용 (페로몬 방출)
}

export function createFieldSystem(
  device: GPUDevice,
  config: SimulationConfig
): FieldSystem {
  const gridSize = config.gridSize;

  // 초기 필드 데이터 생성
  const resourceData = createResourceField(gridSize);
  const terrainData = createTerrainField(gridSize);
  const dangerData = createDangerField(gridSize, DEFAULT_FIELD_PARAMS.dangerZones);
  const pheromoneData = createEmptyField(gridSize);

  // 버퍼 생성 (더블 버퍼링)
  const buffers: FieldBuffers = {
    resource: [
      createBuffer(device, resourceData, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC, 'resource0'),
      createBuffer(device, resourceData, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC, 'resource1'),
    ],
    terrain: createBuffer(device, terrainData, GPUBufferUsage.STORAGE, 'terrain'),
    danger: createBuffer(device, dangerData, GPUBufferUsage.STORAGE, 'danger'),
    pheromone: [
      createBuffer(device, pheromoneData, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC, 'pheromone0'),
      createBuffer(device, pheromoneData, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC, 'pheromone1'),
    ],
    params: createEmptyBuffer(device, 32, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, 'fieldParams'),
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
      { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
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
        { binding: 4, resource: { buffer: buffers.danger } },
        { binding: 5, resource: { buffer: buffers.pheromone[0] } },
        { binding: 6, resource: { buffer: buffers.pheromone[1] } },
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
        { binding: 4, resource: { buffer: buffers.danger } },
        { binding: 5, resource: { buffer: buffers.pheromone[1] } },
        { binding: 6, resource: { buffer: buffers.pheromone[0] } },
      ],
    }),
  ];

  let currentBuffer = 0;

  // 파라미터 데이터
  const paramsData = new Float32Array(8);

  function update(encoder: GPUCommandEncoder, deltaTime: number, time: number): void {
    // 파라미터 업데이트
    paramsData[0] = gridSize;                    // gridSize (as float, but used as u32)
    paramsData[1] = config.diffusionRate;        // diffusionCoeff
    paramsData[2] = config.decayRate;            // resourceDecay
    paramsData[3] = config.pheromoneDecay;       // pheromoneDecay
    paramsData[4] = deltaTime * config.timeScale; // deltaTime
    paramsData[5] = time;                        // time
    paramsData[6] = 0;                           // padding
    paramsData[7] = 0;                           // padding

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

  return {
    buffers,
    pipeline,
    bindGroups,
    get currentBuffer() { return currentBuffer; },
    update,
    getResourceBuffer: () => buffers.resource[1 - currentBuffer],
    getResourceOutputBuffer: () => buffers.resource[currentBuffer],
    getTerrainBuffer: () => buffers.terrain,
    getDangerBuffer: () => buffers.danger,
    getPheromoneBuffer: () => buffers.pheromone[1 - currentBuffer],
    getPheromoneOutputBuffer: () => buffers.pheromone[currentBuffer],
  };
}
