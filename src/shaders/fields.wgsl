/**
 * @fileoverview 필드 업데이트 Compute Shader
 * 확산, 소산, 생성을 처리
 */

struct FieldParams {
  gridSize: u32,
  diffusionCoeff: f32,
  resourceDecay: f32,
  pheromoneDecay: f32,
  deltaTime: f32,
  time: f32,
  resourceGenRate: f32,  // 자원 생성률 (config에서 전달)
  _padding: f32,
}

@group(0) @binding(0) var<uniform> params: FieldParams;
@group(0) @binding(1) var<storage, read> resIn: array<f32>;
@group(0) @binding(2) var<storage, read_write> resOut: array<f32>;
@group(0) @binding(3) var<storage, read> terrain: array<f32>;
@group(0) @binding(4) var<storage, read> danger: array<f32>;
@group(0) @binding(5) var<storage, read> pheromoneIn: array<f32>;
@group(0) @binding(6) var<storage, read_write> pheromoneOut: array<f32>;

fn idx(x: i32, y: i32) -> u32 {
  let size = i32(params.gridSize);
  let wx = ((x % size) + size) % size;  // wrap around
  let wy = ((y % size) + size) % size;
  return u32(wy * size + wx);
}

fn laplacianRes(x: i32, y: i32) -> f32 {
  let c = resIn[idx(x, y)];
  let l = resIn[idx(x - 1, y)];
  let r = resIn[idx(x + 1, y)];
  let u = resIn[idx(x, y - 1)];
  let d = resIn[idx(x, y + 1)];
  return l + r + u + d - 4.0 * c;
}

fn laplacianPher(x: i32, y: i32) -> f32 {
  let c = pheromoneIn[idx(x, y)];
  let l = pheromoneIn[idx(x - 1, y)];
  let r = pheromoneIn[idx(x + 1, y)];
  let u = pheromoneIn[idx(x, y - 1)];
  let d = pheromoneIn[idx(x, y + 1)];
  return l + r + u + d - 4.0 * c;
}

// 자원 생성 패턴 (여러 패치)
fn resourceGeneration(x: i32, y: i32, time: f32) -> f32 {
  let fx = f32(x);
  let fy = f32(y);
  let size = f32(params.gridSize);

  var spawn = 0.0;

  // 여러 자원 패치 (시간에 따라 천천히 이동)
  let patchCount = 8;
  for (var i = 0; i < patchCount; i++) {
    let fi = f32(i);
    let angle = fi * 0.785398 + time * 0.01;  // 각 패치마다 다른 각도

    // 패치 중심
    let cx = size * 0.5 + cos(angle + fi) * size * 0.3;
    let cy = size * 0.5 + sin(angle * 1.3 + fi * 0.5) * size * 0.3;

    let dx = fx - cx;
    let dy = fy - cy;
    let dist = sqrt(dx * dx + dy * dy);

    let radius = 80.0 + sin(fi * 2.0) * 30.0;  // 패치 크기 증가
    if (dist < radius) {
      // config에서 전달된 생성률 사용
      spawn += params.resourceGenRate * (1.0 - dist / radius);
    }
  }

  // 전역 기본 생성 (어디서든 약간의 자원 생성)
  spawn += params.resourceGenRate * 0.1;

  return spawn;
}

@compute @workgroup_size(16, 16)
fn updateFields(@builtin(global_invocation_id) id: vec3<u32>) {
  let x = i32(id.x);
  let y = i32(id.y);
  let size = i32(params.gridSize);

  if (x >= size || y >= size) {
    return;
  }

  let i = idx(x, y);
  let dt = params.deltaTime;

  // 지형 저항 계수
  let terrainFactor = terrain[i];

  // === 자원 필드 업데이트 ===
  var res = resIn[i];

  // 확산 (지형에 따라 조절)
  let diffusion = laplacianRes(x, y) * params.diffusionCoeff * terrainFactor;
  res += diffusion * dt;

  // 소산
  res *= (1.0 - params.resourceDecay * dt);

  // 생성
  res += resourceGeneration(x, y, params.time) * dt;

  // 클램프
  resOut[i] = clamp(res, 0.0, 1.0);

  // === 페로몬 필드 업데이트 ===
  var pher = pheromoneIn[i];

  // 확산 (페로몬은 더 빠르게 퍼짐)
  let pheromoneDiffusion = laplacianPher(x, y) * params.diffusionCoeff * 2.0;
  pher += pheromoneDiffusion * dt;

  // 감쇠 (페로몬은 더 빠르게 사라짐)
  pher *= (1.0 - params.pheromoneDecay * dt);

  // 클램프
  pheromoneOut[i] = clamp(pher, 0.0, 1.0);
}

// 필드 스왑용 복사 커널
@compute @workgroup_size(16, 16)
fn copyField(@builtin(global_invocation_id) id: vec3<u32>) {
  let x = i32(id.x);
  let y = i32(id.y);
  let size = i32(params.gridSize);

  if (x >= size || y >= size) {
    return;
  }

  let i = idx(x, y);
  resOut[i] = resIn[i];
  pheromoneOut[i] = pheromoneIn[i];
}
