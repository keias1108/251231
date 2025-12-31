/**
 * @fileoverview 2.5D 필드 렌더러
 * 자원 밀도를 높이맵으로 시각화
 */

import { createShaderModule, createEmptyBuffer } from '../core/gpu-context';
import { FieldSystem } from '../systems/field-system';
import { Camera, getCameraUniforms } from './camera';
import { SimulationConfig, RenderConfig } from '../types/config';
import renderFieldShaderCode from '../shaders/render-field.wgsl?raw';

export interface FieldRenderer {
  render(
    encoder: GPUCommandEncoder,
    view: GPUTextureView,
    depthView: GPUTextureView,
    camera: Camera,
    fieldSystem: FieldSystem,
    time: number
  ): void;
  updateConfig(renderConfig: RenderConfig): void;
}

export function createFieldRenderer(
  device: GPUDevice,
  format: GPUTextureFormat,
  config: SimulationConfig
): FieldRenderer {
  const gridSize = config.gridSize;

  // 셰이더 모듈
  const shaderModule = createShaderModule(device, renderFieldShaderCode, 'renderFieldShader');

  // 유니폼 버퍼
  const cameraBuffer = createEmptyBuffer(
    device,
    256,  // 정렬된 크기
    GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    'cameraUniforms'
  );

  const paramsBuffer = createEmptyBuffer(
    device,
    32,
    GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    'renderParams'
  );

  // 렌더 파라미터 데이터
  const paramsData = new Float32Array(8);
  paramsData[0] = gridSize;           // gridSize
  paramsData[1] = config.heightScale; // heightScale
  paramsData[2] = 1.0;                // showResource
  paramsData[3] = 1.0;                // showDanger
  paramsData[4] = 1.0;                // showPheromone
  paramsData[5] = 0.0;                // time
  paramsData[6] = 0.0;                // padding
  paramsData[7] = 0.0;                // padding

  // 바인드 그룹 레이아웃
  const bindGroupLayout = device.createBindGroupLayout({
    label: 'fieldRenderBindGroupLayout',
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 2, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      { binding: 3, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      { binding: 4, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      { binding: 5, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      { binding: 6, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
    ],
  });

  // 렌더 파이프라인
  const pipeline = device.createRenderPipeline({
    label: 'fieldRenderPipeline',
    layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
    vertex: {
      module: shaderModule,
      entryPoint: 'vertexMain',
    },
    fragment: {
      module: shaderModule,
      entryPoint: 'fragmentMain',
      targets: [{ format }],
    },
    primitive: {
      topology: 'triangle-list',
      cullMode: 'none',  // 양면 렌더링 (위에서도 보이게)
    },
    depthStencil: {
      format: 'depth24plus',
      depthWriteEnabled: true,
      depthCompare: 'less',
    },
  });

  // 인스턴스 수 (간소화된 그리드)
  const stride = 4;
  const reducedSize = gridSize / stride;
  const instanceCount = reducedSize * reducedSize;
  const verticesPerQuad = 6;

  let currentBindGroup: GPUBindGroup | null = null;
  let lastResourceBuffer: GPUBuffer | null = null;

  function updateConfig(renderConfig: RenderConfig): void {
    paramsData[2] = renderConfig.showResource ? 1.0 : 0.0;
    paramsData[3] = renderConfig.showDanger ? 1.0 : 0.0;
    paramsData[4] = renderConfig.showPheromone ? 1.0 : 0.0;
  }

  function render(
    encoder: GPUCommandEncoder,
    view: GPUTextureView,
    depthView: GPUTextureView,
    camera: Camera,
    fieldSystem: FieldSystem,
    time: number
  ): void {
    // 카메라 유니폼 업데이트
    const cameraData = getCameraUniforms(camera);
    device.queue.writeBuffer(cameraBuffer, 0, cameraData.buffer);

    // 파라미터 업데이트
    paramsData[1] = config.heightScale;
    paramsData[5] = time;
    device.queue.writeBuffer(paramsBuffer, 0, paramsData.buffer);

    // 바인드 그룹 생성/갱신 (버퍼가 바뀔 때만)
    const resourceBuffer = fieldSystem.getResourceBuffer();
    if (resourceBuffer !== lastResourceBuffer) {
      currentBindGroup = device.createBindGroup({
        label: 'fieldRenderBindGroup',
        layout: bindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: cameraBuffer } },
          { binding: 1, resource: { buffer: paramsBuffer } },
          { binding: 2, resource: { buffer: resourceBuffer } },
          { binding: 3, resource: { buffer: fieldSystem.getHeightBuffer() } },
          { binding: 4, resource: { buffer: fieldSystem.getTerrainBuffer() } },
          { binding: 5, resource: { buffer: fieldSystem.getDangerBuffer() } },
          { binding: 6, resource: { buffer: fieldSystem.getPheromoneBuffer() } },
        ],
      });
      lastResourceBuffer = resourceBuffer;
    }

    // 렌더 패스
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view,
        clearValue: { r: 0.1, g: 0.12, b: 0.18, a: 1.0 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
      depthStencilAttachment: {
        view: depthView,
        depthClearValue: 1.0,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    });

    pass.setPipeline(pipeline);
    pass.setBindGroup(0, currentBindGroup!);
    pass.draw(verticesPerQuad, instanceCount);
    pass.end();
  }

  return {
    render,
    updateConfig,
  };
}
