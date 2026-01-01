/**
 * @fileoverview 에이전트 렌더러
 * Instanced rendering + Trail
 */

import { createShaderModule, createEmptyBuffer } from '../core/gpu-context';
import { AgentSystem } from '../systems/agent-system';
import { FieldSystem } from '../systems/field-system';
import { Camera, getCameraUniforms } from './camera';
import { SimulationConfig, RenderConfig } from '../types/config';
import renderAgentsShaderCode from '../shaders/render-agents.wgsl?raw';

export interface AgentRenderer {
  render(
    encoder: GPUCommandEncoder,
    view: GPUTextureView,
    depthView: GPUTextureView,
    camera: Camera,
    agentSystem: AgentSystem,
    fieldSystem: FieldSystem,
    time: number
  ): void;
  updateConfig(renderConfig: RenderConfig): void;
}

export function createAgentRenderer(
  device: GPUDevice,
  format: GPUTextureFormat,
  config: SimulationConfig
): AgentRenderer {
  // 셰이더 모듈
  const shaderModule = createShaderModule(device, renderAgentsShaderCode, 'renderAgentsShader');

  // 유니폼 버퍼
  const cameraBuffer = createEmptyBuffer(
    device,
    256,
    GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    'agentCameraUniforms'
  );

  const paramsBuffer = createEmptyBuffer(
    device,
    32,
    GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    'agentRenderParams'
  );

  // 렌더 파라미터 데이터
  const paramsData = new Float32Array(8);
  paramsData[0] = config.gridSize;
  paramsData[1] = config.heightScale;
  paramsData[2] = config.agentScale;
  paramsData[3] = 0.0;  // time
  paramsData[4] = 1.0;  // showTrails
  paramsData[5] = 0.0;
  paramsData[6] = 0.0;
  paramsData[7] = 0.0;

  // 바인드 그룹 레이아웃
  const bindGroupLayout = device.createBindGroupLayout({
    label: 'agentRenderBindGroupLayout',
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 2, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      { binding: 3, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      { binding: 4, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      { binding: 5, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
    ],
  });

  // 에이전트 렌더 파이프라인
  const agentPipeline = device.createRenderPipeline({
    label: 'agentRenderPipeline',
    layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
    vertex: {
      module: shaderModule,
      entryPoint: 'vertexMain',
    },
    fragment: {
      module: shaderModule,
      entryPoint: 'fragmentMain',
      targets: [{
        format,
        blend: {
          color: {
            srcFactor: 'src-alpha',
            dstFactor: 'one-minus-src-alpha',
            operation: 'add',
          },
          alpha: {
            srcFactor: 'one',
            dstFactor: 'one-minus-src-alpha',
            operation: 'add',
          },
        },
      }],
    },
    primitive: {
      topology: 'triangle-list',
      cullMode: 'none',
    },
    depthStencil: {
      format: 'depth24plus',
      depthWriteEnabled: true,  // depth 기록 활성화
      depthCompare: 'less',
    },
  });

  // Trail 렌더 파이프라인
  const trailPipeline = device.createRenderPipeline({
    label: 'trailRenderPipeline',
    layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
    vertex: {
      module: shaderModule,
      entryPoint: 'trailVertexMain',
    },
    fragment: {
      module: shaderModule,
      entryPoint: 'trailFragmentMain',
      targets: [{
        format,
        blend: {
          color: {
            srcFactor: 'src-alpha',
            dstFactor: 'one-minus-src-alpha',
            operation: 'add',
          },
          alpha: {
            srcFactor: 'one',
            dstFactor: 'one-minus-src-alpha',
            operation: 'add',
          },
        },
      }],
    },
    primitive: {
      topology: 'triangle-list',
      cullMode: 'none',
    },
    depthStencil: {
      format: 'depth24plus',
      depthWriteEnabled: true,  // depth 기록 활성화
      depthCompare: 'less',
    },
  });

  let showTrails = true;
  let showAgents = true;
  let currentBindGroup: GPUBindGroup | null = null;
  let lastAgentBuffer: GPUBuffer | null = null;

  function updateConfig(renderConfig: RenderConfig): void {
    showTrails = renderConfig.showTrails;
    showAgents = renderConfig.showAgents;
    paramsData[4] = showTrails ? 1.0 : 0.0;
  }

  function render(
    encoder: GPUCommandEncoder,
    view: GPUTextureView,
    depthView: GPUTextureView,
    camera: Camera,
    agentSystem: AgentSystem,
    fieldSystem: FieldSystem,
    time: number
  ): void {
    const agentCount = agentSystem.getAgentCount();
    if (agentCount === 0) return;

    // 카메라 유니폼 업데이트
    const cameraData = getCameraUniforms(camera);
    device.queue.writeBuffer(cameraBuffer, 0, cameraData.buffer);

    // 파라미터 업데이트
    paramsData[1] = config.heightScale;
    paramsData[2] = config.agentScale;
    paramsData[3] = time;
    device.queue.writeBuffer(paramsBuffer, 0, paramsData.buffer);

    // 바인드 그룹 생성/갱신
    const agentBuffer = agentSystem.getBuffer();
    if (agentBuffer !== lastAgentBuffer) {
      currentBindGroup = device.createBindGroup({
        label: 'agentRenderBindGroup',
        layout: bindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: cameraBuffer } },
          { binding: 1, resource: { buffer: paramsBuffer } },
          { binding: 2, resource: { buffer: agentBuffer } },
          { binding: 3, resource: { buffer: fieldSystem.getResourceBuffer() } },
          { binding: 4, resource: { buffer: fieldSystem.getTerrainBuffer() } },
          { binding: 5, resource: { buffer: fieldSystem.getHeightBuffer() } },
        ],
      });
      lastAgentBuffer = agentBuffer;
    }

    // 렌더 패스 (필드 렌더 후 이어서)
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view,
        loadOp: 'load',  // 필드 위에 그리기
        storeOp: 'store',
      }],
      depthStencilAttachment: {
        view: depthView,
        depthLoadOp: 'load',
        depthStoreOp: 'store',
      },
    });

    // Trail 먼저 렌더링 (뒤에)
    if (showTrails) {
      pass.setPipeline(trailPipeline);
      pass.setBindGroup(0, currentBindGroup!);
      pass.draw(6, agentCount);  // 6 vertices per trail quad
    }

    // 에이전트 렌더링
    if (showAgents) {
      pass.setPipeline(agentPipeline);
      pass.setBindGroup(0, currentBindGroup!);
      pass.draw(6, agentCount);  // 6 vertices per agent quad
    }

    pass.end();
  }

  return {
    render,
    updateConfig,
  };
}
