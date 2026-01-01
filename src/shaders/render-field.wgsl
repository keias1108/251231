/**
 * @fileoverview 2.5D 필드 렌더링 셰이더
 * 자원 밀도를 높이맵으로 표현
 */

struct CameraUniforms {
  viewProj: mat4x4<f32>,
  cameraPos: vec3<f32>,
  _padding: f32,
}

struct RenderParams {
  gridSize: f32,
  heightScale: f32,
  showResource: f32,
  showDanger: f32,
  showPheromone: f32,
  time: f32,
  _padding1: f32,
  _padding2: f32,
}

@group(0) @binding(0) var<uniform> camera: CameraUniforms;
@group(0) @binding(1) var<uniform> params: RenderParams;
@group(0) @binding(2) var<storage, read> resField: array<f32>;
@group(0) @binding(3) var<storage, read> heightField: array<f32>;
@group(0) @binding(4) var<storage, read> terrain: array<f32>;
@group(0) @binding(5) var<storage, read> danger: array<f32>;
@group(0) @binding(6) var<storage, read> pheromoneField: array<f32>;

struct VertexInput {
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32,
}

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) worldPos: vec3<f32>,
  @location(1) uv: vec2<f32>,
  @location(2) height: f32,
  @location(3) normal: vec3<f32>,
}

fn getFieldIndex(x: i32, y: i32) -> u32 {
  let size = i32(params.gridSize);
  let wx = clamp(x, 0, size - 1);
  let wy = clamp(y, 0, size - 1);
  return u32(wy * size + wx);
}

fn getHeight(x: i32, y: i32) -> f32 {
  let idx = getFieldIndex(x, y);
  // 고도는 별도 필드(H(x))로 유지: 자원/저항(Z)은 고도에 섞지 않음
  return heightField[idx] * params.heightScale;
}

fn calculateNormal(x: i32, y: i32) -> vec3<f32> {
  let h = getHeight(x, y);
  let hL = getHeight(x - 1, y);
  let hR = getHeight(x + 1, y);
  let hU = getHeight(x, y - 1);
  let hD = getHeight(x, y + 1);

  // 중앙 차분으로 기울기 계산
  let dx = (hR - hL) * 0.5;
  let dy = (hD - hU) * 0.5;

  return normalize(vec3(-dx, 1.0, -dy));
}

@vertex
fn vertexMain(input: VertexInput) -> VertexOutput {
  var output: VertexOutput;

  let gridSize = u32(params.gridSize);
  let stride = 4u;  // 간격 (성능을 위해 모든 점을 렌더링하지 않음)
  let reducedSize = gridSize / stride;

  // 인스턴스 인덱스에서 그리드 좌표 계산
  let cellX = input.instanceIndex % reducedSize;
  let cellY = input.instanceIndex / reducedSize;

  // 삼각형 내 버텍스 (2개 삼각형 = 6 버텍스로 쿼드 구성)
  let quadVerts = array<vec2<u32>, 6>(
    vec2(0u, 0u), vec2(1u, 0u), vec2(0u, 1u),
    vec2(1u, 0u), vec2(1u, 1u), vec2(0u, 1u)
  );

  let localVert = quadVerts[input.vertexIndex];
  let gridX = i32((cellX + localVert.x) * stride);
  let gridY = i32((cellY + localVert.y) * stride);

  // 월드 좌표
  let worldX = f32(gridX);
  let worldZ = f32(gridY);
  let worldY = getHeight(gridX, gridY);

  output.worldPos = vec3(worldX, worldY, worldZ);
  output.position = camera.viewProj * vec4(output.worldPos, 1.0);
  output.uv = vec2(f32(gridX) / params.gridSize, f32(gridY) / params.gridSize);
  output.height = resField[getFieldIndex(gridX, gridY)];
  output.normal = calculateNormal(gridX, gridY);

  return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
  let gridX = i32(input.uv.x * params.gridSize);
  let gridY = i32(input.uv.y * params.gridSize);
  let idx = getFieldIndex(gridX, gridY);

  // 기본 색상: 자원 기반
  var color = vec3(0.0);

  if (params.showResource > 0.5) {
    let r = resField[idx];
    // 어두운 갈색(0) → 연두(0.5) → 밝은 초록(1.0)
    let lowColor = vec3(0.2, 0.15, 0.1);    // 어두운 갈색
    let midColor = vec3(0.4, 0.6, 0.2);     // 연두
    let highColor = vec3(0.3, 0.8, 0.3);    // 밝은 초록

    if (r < 0.5) {
      color = mix(lowColor, midColor, r * 2.0);
    } else {
      color = mix(midColor, highColor, (r - 0.5) * 2.0);
    }
  }

  // 지형 영향 (저항 높은 곳은 더 어둡게)
  let t = terrain[idx];
  color *= 0.5 + 0.5 * t;

  // 위험 오버레이
  if (params.showDanger > 0.5) {
    let d = danger[idx];
    let dangerColor = vec3(0.8, 0.1, 0.1);
    color = mix(color, dangerColor, d * 0.6);
  }

  // 페로몬 오버레이
  if (params.showPheromone > 0.5) {
    let p = pheromoneField[idx];
    let pherColor = vec3(0.2, 0.6, 0.9);
    // 낮은 값도 보이도록 비선형 증폭(시각화 전용)
    let vis = 1.0 - exp(-8.0 * p);
    color = mix(color, pherColor, vis * 0.75);
  }

  // 간단한 조명
  let lightDir = normalize(vec3(0.5, 1.0, 0.3));
  let ambient = 0.4;
  let diffuse = max(dot(input.normal, lightDir), 0.0) * 0.6;
  let lighting = ambient + diffuse;

  color *= lighting;

  // 거리 기반 안개
  let dist = length(camera.cameraPos - input.worldPos);
  let fogFactor = clamp((dist - 500.0) / 1000.0, 0.0, 0.5);
  let fogColor = vec3(0.1, 0.12, 0.18);
  color = mix(color, fogColor, fogFactor);

  return vec4(color, 1.0);
}
