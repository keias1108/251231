/**
 * @fileoverview 에이전트 렌더링 셰이더
 * Instanced rendering + 종 분화 색상 + Trail
 */

struct Agent {
  pos: vec2<f32>,
  vel: vec2<f32>,
  energy: f32,
  mode: u32,
  stress: f32,
  cooldown: f32,
  efficiency: f32,
  absorption: f32,
  metabolism: f32,
  moveCost: f32,
  activity: f32,
  agility: f32,
  senseRange: f32,
  aggression: f32,
  evasion: f32,
  sociality: f32,
  reproThreshold: f32,
  reproCooldown: f32,
  alive: u32,
  age: f32,
  generation: u32,
  _padding: u32,
}

struct CameraUniforms {
  viewProj: mat4x4<f32>,
  cameraPos: vec3<f32>,
  _padding: f32,
}

struct RenderParams {
  gridSize: f32,
  heightScale: f32,
  agentScale: f32,
  time: f32,
  showTrails: f32,
  _padding1: f32,
  _padding2: f32,
  _padding3: f32,
}

@group(0) @binding(0) var<uniform> camera: CameraUniforms;
@group(0) @binding(1) var<uniform> params: RenderParams;
@group(0) @binding(2) var<storage, read> agents: array<Agent>;
@group(0) @binding(3) var<storage, read> resField: array<f32>;

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec3<f32>,
  @location(1) alpha: f32,
  @location(2) uv: vec2<f32>,
}

// 해시 함수 (종 분화 색상용)
fn hash3(seed: vec3<f32>) -> f32 {
  var p = fract(seed * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

// 유전자 → HSL → RGB 변환
fn geneticsToColor(agent: Agent) -> vec3<f32> {
  // 주요 유전 파라미터를 사용하여 색상 결정
  // efficiency, metabolism, senseRange를 조합

  // Hue: 유전적 특성 조합
  let hue = fract(
    agent.efficiency * 0.3 +
    agent.metabolism * 5.0 +
    agent.senseRange * 0.02 +
    agent.activity * 0.2
  );

  // Saturation: 에너지 기반
  let saturation = clamp(agent.energy / 100.0, 0.3, 1.0);

  // Lightness: 활동 레벨
  let lightness = 0.4 + agent.activity * 0.15;

  // HSL → RGB
  return hslToRgb(hue, saturation, lightness);
}

fn hslToRgb(h: f32, s: f32, l: f32) -> vec3<f32> {
  let c = (1.0 - abs(2.0 * l - 1.0)) * s;
  let x = c * (1.0 - abs((h * 6.0) % 2.0 - 1.0));
  let m = l - c / 2.0;

  var rgb = vec3(0.0);
  let h6 = h * 6.0;

  if (h6 < 1.0) {
    rgb = vec3(c, x, 0.0);
  } else if (h6 < 2.0) {
    rgb = vec3(x, c, 0.0);
  } else if (h6 < 3.0) {
    rgb = vec3(0.0, c, x);
  } else if (h6 < 4.0) {
    rgb = vec3(0.0, x, c);
  } else if (h6 < 5.0) {
    rgb = vec3(x, 0.0, c);
  } else {
    rgb = vec3(c, 0.0, x);
  }

  return rgb + vec3(m);
}

fn getFieldIndex(x: f32, y: f32) -> u32 {
  let size = u32(params.gridSize);
  let ix = clamp(u32(x), 0u, size - 1u);
  let iy = clamp(u32(y), 0u, size - 1u);
  return iy * size + ix;
}

@vertex
fn vertexMain(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32
) -> VertexOutput {
  var output: VertexOutput;

  let agent = agents[instanceIndex];

  // 죽은 에이전트는 화면 밖으로
  if (agent.alive == 0u) {
    output.position = vec4(-10.0, -10.0, -10.0, 1.0);
    output.alpha = 0.0;
    return output;
  }

  // 에이전트 크기 (에너지 기반)
  let baseSize = params.agentScale * 3.0;
  let energyScale = 0.5 + clamp(agent.energy / 100.0, 0.0, 1.0) * 0.5;
  let size = baseSize * energyScale;

  // 쿼드 버텍스 (삼각형 2개)
  let quadVerts = array<vec2<f32>, 6>(
    vec2(-1.0, -1.0), vec2(1.0, -1.0), vec2(-1.0, 1.0),
    vec2(1.0, -1.0), vec2(1.0, 1.0), vec2(-1.0, 1.0)
  );

  let localPos = quadVerts[vertexIndex] * size;

  // 월드 위치 (필드 높이 위)
  let fIdx = getFieldIndex(agent.pos.x, agent.pos.y);
  let fieldHeight = resField[fIdx] * params.heightScale;
  let worldPos = vec3(
    agent.pos.x + localPos.x,
    fieldHeight + size * 0.5,  // 필드 위에 떠있게
    agent.pos.y + localPos.y
  );

  output.position = camera.viewProj * vec4(worldPos, 1.0);

  // 색상 (종 분화)
  output.color = geneticsToColor(agent);

  // 모드에 따른 색상 변조
  switch (agent.mode) {
    case 0u: {  // EXPLORE
      // 기본 색상
    }
    case 1u: {  // INTAKE
      output.color = mix(output.color, vec3(0.3, 0.9, 0.3), 0.3);  // 초록 틴트
    }
    case 2u: {  // EVADE
      output.color = mix(output.color, vec3(0.9, 0.3, 0.3), 0.5);  // 빨강 틴트
    }
    case 3u: {  // REPRODUCE
      output.color = mix(output.color, vec3(0.9, 0.7, 0.3), 0.5);  // 노랑 틴트
    }
    default: {}
  }

  output.alpha = 1.0;
  output.uv = quadVerts[vertexIndex] * 0.5 + 0.5;

  return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
  if (input.alpha < 0.01) {
    discard;
  }

  // 원형 마스크
  let dist = length(input.uv - vec2(0.5));
  if (dist > 0.5) {
    discard;
  }

  // 부드러운 엣지
  let edge = smoothstep(0.5, 0.4, dist);

  // 간단한 하이라이트
  let highlight = 1.0 - smoothstep(0.0, 0.3, dist);
  let finalColor = input.color + vec3(highlight * 0.2);

  return vec4(finalColor, edge * input.alpha);
}

// Trail 렌더링용 버텍스 셰이더
@vertex
fn trailVertexMain(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32
) -> VertexOutput {
  var output: VertexOutput;

  let agent = agents[instanceIndex];

  if (agent.alive == 0u) {
    output.position = vec4(-10.0, -10.0, -10.0, 1.0);
    output.alpha = 0.0;
    return output;
  }

  // Trail은 에이전트 뒤에 속도 반대 방향으로
  let speed = length(agent.vel);
  if (speed < 0.1) {
    output.position = vec4(-10.0, -10.0, -10.0, 1.0);
    output.alpha = 0.0;
    return output;
  }

  let trailDir = -normalize(agent.vel);
  let trailLength = speed * 20.0;

  // 선분 형태 (2 삼각형)
  let lineVerts = array<vec2<f32>, 6>(
    vec2(0.0, -0.5), vec2(1.0, -0.5), vec2(0.0, 0.5),
    vec2(1.0, -0.5), vec2(1.0, 0.5), vec2(0.0, 0.5)
  );

  let localPos = lineVerts[vertexIndex];
  let perpendicular = vec2(-trailDir.y, trailDir.x);

  // Trail 위치
  let trailPos = agent.pos + trailDir * localPos.x * trailLength;
  let offset = perpendicular * localPos.y * 1.5;

  let fIdx = getFieldIndex(trailPos.x, trailPos.y);
  let fieldHeight = resField[fIdx] * params.heightScale;

  let worldPos = vec3(
    trailPos.x + offset.x,
    fieldHeight + 1.0,
    trailPos.y + offset.y
  );

  output.position = camera.viewProj * vec4(worldPos, 1.0);
  output.color = geneticsToColor(agent) * 0.5;  // 어둡게
  output.alpha = (1.0 - localPos.x) * 0.5;  // 뒤로 갈수록 투명
  output.uv = localPos;

  return output;
}

@fragment
fn trailFragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
  if (input.alpha < 0.01) {
    discard;
  }

  return vec4(input.color, input.alpha);
}
