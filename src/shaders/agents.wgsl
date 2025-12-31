/**
 * @fileoverview 에이전트 로직 Compute Shader
 * 센싱, 행동 결정, 상호작용, 생명주기 처리
 */

// 에이전트 구조체 (96 bytes aligned)
struct Agent {
  // 위치/속도 (16 bytes)
  pos: vec2<f32>,
  vel: vec2<f32>,

  // 내부 상태 (16 bytes)
  energy: f32,
  mode: u32,        // 0=탐색, 1=섭취, 2=회피, 3=번식
  stress: f32,
  cooldown: f32,

  // 유전 파라미터 1 (32 bytes)
  efficiency: f32,
  absorption: f32,
  metabolism: f32,
  moveCost: f32,
  activity: f32,
  agility: f32,
  senseRange: f32,
  aggression: f32,

  // 유전 파라미터 2 (16 bytes)
  evasion: f32,
  sociality: f32,
  reproThreshold: f32,
  reproCooldown: f32,

  // 플래그 (16 bytes with padding)
  alive: u32,
  age: f32,
  generation: u32,
  _padding: u32,
}

struct SimParams {
  gridSize: u32,
  agentCount: u32,
  maxAgents: u32,
  deltaTime: f32,
  time: f32,
  saturationK: f32,
  densityPenalty: f32,
  _padding: f32,
}

// 모드 상수
const MODE_EXPLORE: u32 = 0u;
const MODE_INTAKE: u32 = 1u;
const MODE_EVADE: u32 = 2u;
const MODE_REPRODUCE: u32 = 3u;

@group(0) @binding(0) var<uniform> params: SimParams;
@group(0) @binding(1) var<storage, read_write> agents: array<Agent>;
@group(0) @binding(2) var<storage, read> resField: array<f32>;
@group(0) @binding(3) var<storage, read_write> resFieldOut: array<f32>;
@group(0) @binding(4) var<storage, read> terrain: array<f32>;
@group(0) @binding(5) var<storage, read> danger: array<f32>;
@group(0) @binding(6) var<storage, read_write> pheromoneField: array<f32>;
@group(0) @binding(7) var<storage, read_write> agentCount: atomic<u32>;

fn fieldIdx(x: f32, y: f32) -> u32 {
  let size = f32(params.gridSize);
  let ix = u32(clamp(x, 0.0, size - 1.0));
  let iy = u32(clamp(y, 0.0, size - 1.0));
  return iy * params.gridSize + ix;
}

fn sampleRes(pos: vec2<f32>) -> f32 {
  return resField[fieldIdx(pos.x, pos.y)];
}

fn sampleTerrain(pos: vec2<f32>) -> f32 {
  return terrain[fieldIdx(pos.x, pos.y)];
}

fn sampleDanger(pos: vec2<f32>) -> f32 {
  return danger[fieldIdx(pos.x, pos.y)];
}

fn samplePheromone(pos: vec2<f32>) -> f32 {
  return pheromoneField[fieldIdx(pos.x, pos.y)];
}

// Michaelis-Menten 섭취 함수
fn uptake(fieldValue: f32, absorption: f32) -> f32 {
  return absorption * fieldValue / (params.saturationK + fieldValue);
}

// 해시 함수 (난수 생성용)
fn hash(seed: u32) -> f32 {
  var x = seed;
  x = x ^ (x >> 16u);
  x = x * 0x7feb352du;
  x = x ^ (x >> 15u);
  x = x * 0x846ca68bu;
  x = x ^ (x >> 16u);
  return f32(x) / 4294967295.0;
}

fn randomDir(seed: u32) -> vec2<f32> {
  let angle = hash(seed) * 6.28318;
  return vec2(cos(angle), sin(angle));
}

// 센싱: 주변 환경 탐색
fn sense(agent: Agent, agentIdx: u32) -> vec4<f32> {
  // 반환: (최적 방향 x, 최적 방향 y, 최대 자원, 위험도)
  let sampleCount = 8u;
  var bestDir = vec2(0.0);
  var maxRes = 0.0;
  var totalDanger = 0.0;

  for (var i = 0u; i < sampleCount; i++) {
    let angle = f32(i) * 0.785398;  // 45도 간격
    let dir = vec2(cos(angle), sin(angle));
    let samplePos = agent.pos + dir * agent.senseRange;

    let r = sampleRes(samplePos);
    let d = sampleDanger(samplePos);
    let t = sampleTerrain(samplePos);

    // 자원 가중 방향 (지형과 위험 고려)
    let weight = r * t * (1.0 - d * agent.evasion);
    if (weight > maxRes) {
      maxRes = weight;
      bestDir = dir;
    }

    totalDanger += d;
  }

  return vec4(bestDir.x, bestDir.y, maxRes, totalDanger / f32(sampleCount));
}

@compute @workgroup_size(64)
fn updateAgents(@builtin(global_invocation_id) id: vec3<u32>) {
  let idx = id.x;
  if (idx >= params.agentCount) {
    return;
  }

  var agent = agents[idx];

  if (agent.alive == 0u) {
    return;
  }

  let dt = params.deltaTime;
  let seed = idx * 1000u + u32(params.time * 1000.0);

  // === 1. 센싱 ===
  let senseResult = sense(agent, idx);
  let bestDir = vec2(senseResult.x, senseResult.y);
  let nearbyResource = senseResult.z;
  let dangerLevel = senseResult.w;

  // 현재 위치의 필드 값
  let currentRes = sampleRes(agent.pos);
  let currentTerrain = sampleTerrain(agent.pos);
  let currentDanger = sampleDanger(agent.pos);

  // === 2. 모드 결정 ===
  var newMode = agent.mode;

  // 위험 회피 우선
  if (dangerLevel > 0.5 || currentDanger > 0.3) {
    newMode = MODE_EVADE;
  }
  // 번식 조건
  else if (agent.energy >= agent.reproThreshold && agent.cooldown <= 0.0) {
    newMode = MODE_REPRODUCE;
  }
  // 자원이 충분하면 섭취
  else if (currentRes > 0.2) {
    newMode = MODE_INTAKE;
  }
  // 그 외 탐색
  else {
    newMode = MODE_EXPLORE;
  }

  agent.mode = newMode;

  // === 3. 행동 실행 ===
  var targetVel = vec2(0.0);

  switch (newMode) {
    case MODE_EXPLORE: {
      // 탐색: 최적 방향 + 랜덤성
      let randomness = randomDir(seed) * 0.3;
      targetVel = normalize(bestDir + randomness) * agent.activity;
    }
    case MODE_INTAKE: {
      // 섭취: 느리게 움직이며 자원 흡수
      targetVel = agent.vel * 0.5;
    }
    case MODE_EVADE: {
      // 회피: 위험 반대 방향으로 빠르게
      let escapeDir = -normalize(bestDir + vec2(0.001));
      targetVel = escapeDir * agent.activity * 1.5;
    }
    case MODE_REPRODUCE: {
      // 번식: 움직임 정지
      targetVel = vec2(0.0);
    }
    default: {
      targetVel = randomDir(seed) * agent.activity;
    }
  }

  // 속도 보간 (관성)
  agent.vel = mix(agent.vel, targetVel, agent.agility * dt * 5.0);

  // 지형 저항 적용
  let speed = length(agent.vel) * currentTerrain;

  // 위치 업데이트
  agent.pos += agent.vel * dt * 20.0;

  // 경계 래핑
  let size = f32(params.gridSize);
  agent.pos.x = ((agent.pos.x % size) + size) % size;
  agent.pos.y = ((agent.pos.y % size) + size) % size;

  // === 4. 자원 상호작용 ===
  if (newMode == MODE_INTAKE) {
    // 섭취
    let uptakeAmount = uptake(currentRes, agent.absorption) * agent.efficiency * dt;
    agent.energy += uptakeAmount;

    // 자원 감소 (atomic operation 시뮬레이션)
    let fieldI = fieldIdx(agent.pos.x, agent.pos.y);
    resFieldOut[fieldI] = max(0.0, resField[fieldI] - uptakeAmount);
  }

  // 페로몬 방출 (이동 중)
  if (speed > 0.1) {
    let fieldI = fieldIdx(agent.pos.x, agent.pos.y);
    pheromoneField[fieldI] = min(1.0, pheromoneField[fieldI] + 0.01 * dt);
  }

  // === 5. 에너지 소비 ===
  // 기초 대사
  var energyCost = agent.metabolism * dt;

  // 이동 비용
  energyCost += agent.moveCost * speed * dt;

  // 밀도 페널티 (페로몬으로 간접 측정)
  let localPheromone = samplePheromone(agent.pos);
  energyCost += params.densityPenalty * localPheromone * dt;

  // 위험 지역 스트레스
  agent.stress = mix(agent.stress, currentDanger, 0.1);
  energyCost += agent.stress * 0.02 * dt;

  agent.energy -= energyCost;
  agent.cooldown = max(0.0, agent.cooldown - dt);
  agent.age += dt;

  // === 6. 생명주기 ===
  if (agent.energy <= 0.0) {
    // 사망
    agent.alive = 0u;
  } else if (newMode == MODE_REPRODUCE && agent.cooldown <= 0.0) {
    // 번식 시도 (실제 번식은 별도 커널에서 처리)
    agent.energy *= 0.5;  // 에너지 분할
    agent.cooldown = agent.reproCooldown;
  }

  agents[idx] = agent;
}

// 번식 처리 (별도 커널)
@compute @workgroup_size(64)
fn processReproduction(@builtin(global_invocation_id) id: vec3<u32>) {
  let idx = id.x;
  if (idx >= params.agentCount) {
    return;
  }

  let parent = agents[idx];

  if (parent.alive == 0u || parent.mode != MODE_REPRODUCE) {
    return;
  }

  // 새 에이전트 슬롯 찾기
  let newIdx = atomicAdd(&agentCount, 1u);
  if (newIdx >= params.maxAgents) {
    atomicSub(&agentCount, 1u);
    return;
  }

  let seed = idx * 7919u + u32(params.time * 1000.0);

  // 자식 에이전트 생성
  var child: Agent;

  // 위치 (부모 근처)
  let offset = randomDir(seed) * 5.0;
  child.pos = parent.pos + offset;
  child.vel = randomDir(seed + 1u) * 0.5;

  // 상태 초기화
  child.energy = parent.energy * 0.4;  // 부모 에너지의 일부
  child.mode = MODE_EXPLORE;
  child.stress = 0.0;
  child.cooldown = parent.reproCooldown;

  // 유전자 (변이 적용)
  let mutationRate = 0.1;
  child.efficiency = parent.efficiency + (hash(seed + 10u) - 0.5) * mutationRate;
  child.absorption = parent.absorption + (hash(seed + 11u) - 0.5) * mutationRate;
  child.metabolism = parent.metabolism + (hash(seed + 12u) - 0.5) * mutationRate * 0.5;
  child.moveCost = parent.moveCost + (hash(seed + 13u) - 0.5) * mutationRate * 0.2;
  child.activity = parent.activity + (hash(seed + 14u) - 0.5) * mutationRate;
  child.agility = parent.agility + (hash(seed + 15u) - 0.5) * mutationRate;
  child.senseRange = parent.senseRange + (hash(seed + 16u) - 0.5) * mutationRate * 10.0;
  child.aggression = parent.aggression + (hash(seed + 17u) - 0.5) * mutationRate;
  child.evasion = parent.evasion + (hash(seed + 18u) - 0.5) * mutationRate;
  child.sociality = parent.sociality + (hash(seed + 19u) - 0.5) * mutationRate;
  child.reproThreshold = parent.reproThreshold + (hash(seed + 20u) - 0.5) * mutationRate * 10.0;
  child.reproCooldown = parent.reproCooldown + (hash(seed + 21u) - 0.5) * mutationRate * 5.0;

  // 유전자 클램프
  child.efficiency = clamp(child.efficiency, 0.1, 2.0);
  child.absorption = clamp(child.absorption, 0.1, 2.0);
  child.metabolism = clamp(child.metabolism, 0.01, 0.2);
  child.moveCost = clamp(child.moveCost, 0.001, 0.05);
  child.activity = clamp(child.activity, 0.5, 3.0);
  child.agility = clamp(child.agility, 0.5, 2.0);
  child.senseRange = clamp(child.senseRange, 5.0, 50.0);
  child.aggression = clamp(child.aggression, 0.0, 1.0);
  child.evasion = clamp(child.evasion, 0.0, 1.0);
  child.sociality = clamp(child.sociality, 0.0, 1.0);
  child.reproThreshold = clamp(child.reproThreshold, 50.0, 200.0);
  child.reproCooldown = clamp(child.reproCooldown, 10.0, 100.0);

  child.alive = 1u;
  child.age = 0.0;
  child.generation = parent.generation + 1u;
  child._padding = 0u;

  agents[newIdx] = child;
}
