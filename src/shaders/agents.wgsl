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
  _pad0: u32,
  deltaTime: f32,
  time: f32,
  saturationK: f32,
  densityPenalty: f32,
  uptakeScale: f32,
  energyCostScale: f32,
  _pad1: vec2<f32>,
}

struct Metrics {
  alive: atomic<u32>,
  births: atomic<u32>,
  deaths: atomic<u32>,
  uptakeMicro: atomic<u32>,
}

struct FreeList {
  count: atomic<u32>,
  _pad0: vec3<u32>,
  indices: array<u32>,
}

// 모드 상수
const MODE_EXPLORE: u32 = 0u;
const MODE_INTAKE: u32 = 1u;
const MODE_EVADE: u32 = 2u;
const MODE_REPRODUCE: u32 = 3u;

@group(0) @binding(0) var<uniform> params: SimParams;
@group(0) @binding(1) var<storage, read_write> agents: array<Agent>;
@group(0) @binding(2) var<storage, read> resField: array<f32>;
@group(0) @binding(3) var<storage, read> terrain: array<f32>;
@group(0) @binding(4) var<storage, read> danger: array<f32>;
@group(0) @binding(5) var<storage, read> pheromoneField: array<f32>;
@group(0) @binding(6) var<storage, read_write> agentCount: atomic<u32>;
@group(0) @binding(7) var<storage, read_write> metrics: Metrics;
@group(0) @binding(8) var<storage, read_write> freeList: FreeList;
@group(0) @binding(9) var<storage, read_write> resConsumeMicro: array<atomic<u32>>;
@group(0) @binding(10) var<storage, read_write> pheromoneDepositMicro: array<atomic<u32>>;

fn freeListPush(index: u32) {
  let slot = atomicAdd(&freeList.count, 1u);
  if (slot < params.maxAgents) {
    freeList.indices[slot] = index;
  } else {
    // overflow protection
    atomicSub(&freeList.count, 1u);
  }
}

fn freeListPop() -> i32 {
  loop {
    let count = atomicLoad(&freeList.count);
    if (count == 0u) {
      return -1;
    }
    let res = atomicCompareExchangeWeak(&freeList.count, count, count - 1u);
    if (res.exchanged) {
      return i32(freeList.indices[count - 1u]);
    }
  }
}

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

// 센싱: 주변 환경 탐색 (가중 평균 방향)
fn sense(agent: Agent, agentIdx: u32) -> vec4<f32> {
  // 반환: (가중 방향 x, 가중 방향 y, 최대 자원, 위험도+밀도)
  let sampleCount = 8u;
  var weightedDir = vec2(0.0);
  var totalWeight = 0.0;
  var maxRes = 0.0;
  var totalDanger = 0.0;
  var totalPheromone = 0.0;

  for (var i = 0u; i < sampleCount; i++) {
    let angle = f32(i) * 0.785398;  // 45도 간격
    let dir = vec2(cos(angle), sin(angle));
    let samplePos = agent.pos + dir * agent.senseRange;

    let r = sampleRes(samplePos);
    let d = sampleDanger(samplePos);
    let t = sampleTerrain(samplePos);
    let p = samplePheromone(samplePos);

    // 자원 가중치 (지형과 위험 고려)
    var weight = r * t * (1.0 - d * agent.evasion);

    // 페로몬 영향: sociality 높으면 끌림, 낮으면 회피 (분산)
    let pheromoneInfluence = (agent.sociality - 0.5) * 2.0;  // -1 ~ +1
    weight *= (1.0 + p * pheromoneInfluence * 0.5);

    // 가중 평균 방향 (winner-takes-all이 아닌 부드러운 방향)
    weightedDir += dir * weight;
    totalWeight += weight;

    if (r > maxRes) {
      maxRes = r;
    }
    totalDanger += d;
    totalPheromone += p;
  }

  // 정규화
  if (totalWeight > 0.001) {
    weightedDir = weightedDir / totalWeight;
  }

  // 밀도 정보 포함 (위험 + 페로몬 밀도)
  let crowding = totalDanger / f32(sampleCount) + totalPheromone / f32(sampleCount) * 0.5;

  return vec4(weightedDir.x, weightedDir.y, maxRes, crowding);
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
  let sensedDir = vec2(senseResult.x, senseResult.y);
  let nearbyResource = senseResult.z;
  let crowding = senseResult.w;  // 위험 + 밀도

  // 현재 위치의 필드 값
  let currentRes = sampleRes(agent.pos);
  let currentTerrain = sampleTerrain(agent.pos);
  let currentDanger = sampleDanger(agent.pos);
  let currentPheromone = samplePheromone(agent.pos);

  // === 2. 모드 결정 ===
  var newMode = agent.mode;

  // 업계에서 흔한 패턴: 위험(오염)은 "벽"이 아니라 비용/효율로 모델링.
  // => 하드 스위치(위험이면 무조건 회피) 대신, 극단적인 경우만 패닉(EVADE)로 처리.
  let panic = currentDanger > 0.9;

  // 번식은 안전한 곳에서만 선호
  if (!panic && agent.energy >= agent.reproThreshold && agent.cooldown <= 0.0 && currentDanger < 0.6) {
    newMode = MODE_REPRODUCE;
  } else {
    // 섭취는 "순이익"이 있을 때만 선택: 오염이 높으면 섭취 효율이 깎여서 손해일 수 있음
    let baseUptake = uptake(currentRes, agent.absorption) * agent.efficiency * params.uptakeScale;
    let uptakePenalty = clamp(1.0 - currentDanger * 0.9, 0.0, 1.0);
    let expectedGain = baseUptake * uptakePenalty;

    // 위험이 극단적으로 높으면 우선 이탈
    if (panic) {
      newMode = MODE_EVADE;
    } else if (currentRes > 0.12 && expectedGain > 0.01) {
      newMode = MODE_INTAKE;
    } else {
      newMode = MODE_EXPLORE;
    }
  }

  agent.mode = newMode;

  // === 3. 행동 실행 ===
  var targetVel = vec2(0.0);

  // 유전적 다양성 기반 랜덤성 (activity가 높을수록 더 탐험적)
  let explorationFactor = 0.5 + agent.activity * 0.3;
  let randomVec = randomDir(seed) * explorationFactor;

  switch (newMode) {
    case MODE_EXPLORE: {
      // 탐색: 감지 방향 + 강한 랜덤성 + 밀도 회피
      var exploreDir = sensedDir + randomVec;

      // 밀도가 높으면 반대로 이동 (분산 유도)
      if (crowding > 0.3 && agent.sociality < 0.5) {
        exploreDir = -sensedDir * 0.5 + randomVec * 1.5;
      }

      // 자원이 적으면 완전 랜덤 탐색
      if (nearbyResource < 0.1) {
        exploreDir = randomVec * 2.0 + agent.vel * 0.3;  // 관성 유지
      }

      targetVel = normalize(exploreDir + vec2(0.001)) * agent.activity;
    }
    case MODE_INTAKE: {
      // 섭취: 느리게 움직이며 자원 흡수, 약간의 이동
      let driftDir = randomDir(seed + 1u) * 0.2;
      targetVel = driftDir * agent.activity * 0.3;
    }
    case MODE_EVADE: {
      // 회피: 센싱 결과(안전/자원 가중)를 따라 빠르게 이동 + 랜덤
      let escapeDir = normalize(sensedDir + vec2(0.001));
      targetVel = (escapeDir + randomVec * 0.3) * agent.activity * 1.8;
    }
    case MODE_REPRODUCE: {
      // 번식: 거의 정지
      targetVel = randomDir(seed + 2u) * 0.1;
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
  agent.pos += agent.vel * (currentTerrain * dt * 20.0);

  // 경계 클램핑 (센싱과 동일하게)
  let size = f32(params.gridSize) - 1.0;
  agent.pos.x = clamp(agent.pos.x, 0.0, size);
  agent.pos.y = clamp(agent.pos.y, 0.0, size);

  // === 4. 자원 상호작용 ===
  if (newMode == MODE_INTAKE) {
    // 섭취
    // 오염이 높을수록 "오염된 먹이"처럼 순이익이 줄어듦 (C: 보상↓ + 비용↑)
    let uptakePenalty = clamp(1.0 - currentDanger * 0.9, 0.0, 1.0);
    let uptakeAmount = uptake(currentRes, agent.absorption) * agent.efficiency * params.uptakeScale * uptakePenalty * dt;
    agent.energy += uptakeAmount;

    let fieldI = fieldIdx(agent.pos.x, agent.pos.y);
    atomicAdd(&resConsumeMicro[fieldI], u32(uptakeAmount * 1000000.0));

    atomicAdd(&metrics.uptakeMicro, u32(uptakeAmount * 1000000.0));
  }

  // 페로몬 방출 (이동 중) - 포화 방지를 위해 방출량 감소
  if (speed > 0.1) {
    let fieldI = fieldIdx(agent.pos.x, agent.pos.y);
    atomicAdd(&pheromoneDepositMicro[fieldI], u32(0.03 * dt * 1000000.0));
  }

  // === 5. 에너지 소비 ===
  // 기초 대사
  var energyCost = agent.metabolism * dt * params.energyCostScale;

  // 이동 비용
  energyCost += agent.moveCost * speed * dt * params.energyCostScale;

  // 밀도 페널티 (페로몬으로 간접 측정)
  let localPheromone = samplePheromone(agent.pos);
  energyCost += params.densityPenalty * localPheromone * dt;

  // 위험 지역 스트레스
  agent.stress = mix(agent.stress, currentDanger, 0.1);
  // 오염은 이동을 "막기"보단 생존 비용을 올리는 쪽이 자연스러움
  energyCost += agent.stress * 0.15 * dt * params.energyCostScale;

  agent.energy = max(0.0, agent.energy - energyCost);  // 음수 방지
  agent.cooldown = max(0.0, agent.cooldown - dt);
  agent.age += dt;

  // === 6. 생명주기 ===
  if (agent.energy <= 0.0) {
    // 사망
    agent.alive = 0u;
    atomicAdd(&metrics.deaths, 1u);
    atomicSub(&metrics.alive, 1u);
    freeListPush(idx);
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

  // 새 에이전트 슬롯 찾기 (dead slot 재사용 우선)
  var newIdx: u32 = 0u;
  let reused = freeListPop();
  if (reused >= 0) {
    newIdx = u32(reused);
  } else {
    newIdx = atomicAdd(&agentCount, 1u);
    if (newIdx >= params.maxAgents) {
      atomicSub(&agentCount, 1u);
      return;
    }
  }

  let seed = idx * 7919u + u32(params.time * 1000.0);

  // 자식 에이전트 생성
  var child: Agent;

  // 위치 (부모 근처)
  let offset = randomDir(seed) * 5.0;
  child.pos = parent.pos + offset;
  child.vel = randomDir(seed + 1u) * 0.5;

  // 상태 초기화
  child.energy = parent.energy * 0.8;  // 부모 에너지의 80% (에너지 보존: 부모50% + 자식40% = 90%)
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
  atomicAdd(&metrics.births, 1u);
  atomicAdd(&metrics.alive, 1u);
}
