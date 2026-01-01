/**
 * @fileoverview WebGPU 컨텍스트 초기화 및 관리
 */

export interface GPUContext {
  device: GPUDevice;
  context: GPUCanvasContext;
  format: GPUTextureFormat;
  canvas: HTMLCanvasElement;
}

export async function initWebGPU(canvas: HTMLCanvasElement): Promise<GPUContext> {
  // WebGPU 지원 확인
  if (!navigator.gpu) {
    throw new Error('WebGPU is not supported in this browser');
  }

  // 어댑터 요청
  const adapter = await navigator.gpu.requestAdapter({
    powerPreference: 'high-performance',
  });

  if (!adapter) {
    throw new Error('Failed to get GPU adapter');
  }

  // 어댑터 정보 로깅
  const adapterInfo = adapter.info;
  console.log('GPU Adapter:', adapterInfo.vendor, adapterInfo.architecture);

  // 디바이스 요청
  const device = await adapter.requestDevice({
    requiredFeatures: [],
    requiredLimits: {
      maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
      maxStorageBuffersPerShaderStage: adapter.limits.maxStorageBuffersPerShaderStage,
      maxComputeWorkgroupStorageSize: adapter.limits.maxComputeWorkgroupStorageSize,
      maxComputeInvocationsPerWorkgroup: adapter.limits.maxComputeInvocationsPerWorkgroup,
    },
  });

  // 디바이스 손실 처리
  device.lost.then((info) => {
    console.error('WebGPU device lost:', info.message);
    if (info.reason !== 'destroyed') {
      // 재초기화 시도 가능
      window.location.reload();
    }
  });

  // 캔버스 컨텍스트 설정
  const context = canvas.getContext('webgpu');
  if (!context) {
    throw new Error('Failed to get WebGPU context');
  }

  const format = navigator.gpu.getPreferredCanvasFormat();

  context.configure({
    device,
    format,
    alphaMode: 'premultiplied',
  });

  // 캔버스 크기 설정
  resizeCanvas(canvas);

  return { device, context, format, canvas };
}

export function resizeCanvas(canvas: HTMLCanvasElement): void {
  const dpr = window.devicePixelRatio || 1;
  const width = window.innerWidth;
  const height = window.innerHeight;

  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
}

/**
 * 버퍼 생성 유틸리티
 */
export function createBuffer(
  device: GPUDevice,
  data: Float32Array | Uint32Array,
  usage: GPUBufferUsageFlags,
  label?: string
): GPUBuffer {
  const buffer = device.createBuffer({
    label,
    size: data.byteLength,
    usage: usage | GPUBufferUsage.COPY_DST,
    mappedAtCreation: true,
  });

  if (data instanceof Float32Array) {
    new Float32Array(buffer.getMappedRange()).set(data);
  } else {
    new Uint32Array(buffer.getMappedRange()).set(data);
  }

  buffer.unmap();
  return buffer;
}

/**
 * 빈 버퍼 생성
 */
export function createEmptyBuffer(
  device: GPUDevice,
  size: number,
  usage: GPUBufferUsageFlags,
  label?: string
): GPUBuffer {
  return device.createBuffer({
    label,
    size,
    usage,
  });
}

/**
 * 균일 버퍼 생성 (uniforms)
 */
export function createUniformBuffer(
  device: GPUDevice,
  size: number,
  label?: string
): GPUBuffer {
  // 256 바이트 정렬
  const alignedSize = Math.ceil(size / 256) * 256;
  return device.createBuffer({
    label,
    size: alignedSize,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
}

/**
 * 텍스처 생성
 */
export function createTexture2D(
  device: GPUDevice,
  width: number,
  height: number,
  format: GPUTextureFormat = 'rgba8unorm',
  usage: GPUTextureUsageFlags = GPUTextureUsage.TEXTURE_BINDING |
    GPUTextureUsage.COPY_DST |
    GPUTextureUsage.RENDER_ATTACHMENT,
  label?: string
): GPUTexture {
  return device.createTexture({
    label,
    size: { width, height },
    format,
    usage,
  });
}

/**
 * 샘플러 생성
 */
export function createSampler(
  device: GPUDevice,
  filter: GPUFilterMode = 'linear',
  addressMode: GPUAddressMode = 'clamp-to-edge'
): GPUSampler {
  return device.createSampler({
    magFilter: filter,
    minFilter: filter,
    addressModeU: addressMode,
    addressModeV: addressMode,
  });
}

/**
 * 셰이더 모듈 생성
 */
export function createShaderModule(
  device: GPUDevice,
  code: string,
  label?: string
): GPUShaderModule {
  return device.createShaderModule({
    label,
    code,
  });
}

/**
 * Compute 파이프라인 생성
 */
export function createComputePipeline(
  device: GPUDevice,
  shader: GPUShaderModule,
  entryPoint: string,
  bindGroupLayout: GPUBindGroupLayout,
  label?: string
): GPUComputePipeline {
  return device.createComputePipeline({
    label,
    layout: device.createPipelineLayout({
      bindGroupLayouts: [bindGroupLayout],
    }),
    compute: {
      module: shader,
      entryPoint,
    },
  });
}
