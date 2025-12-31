/**
 * @fileoverview 에이전트 타입 정의
 * GPU 버퍼 레이아웃과 일치하도록 구조화
 */

// 에이전트 모드 (행동 상태)
export const AgentMode = {
  EXPLORE: 0,    // 탐색
  INTAKE: 1,     // 섭취
  EVADE: 2,      // 회피
  REPRODUCE: 3,  // 번식
} as const;

export type AgentModeType = typeof AgentMode[keyof typeof AgentMode];

/**
 * GPU 버퍼와 일치하는 에이전트 구조
 * Total: 96 bytes (aligned)
 */
export interface AgentData {
  // 위치/속도 (16 bytes)
  posX: number;
  posY: number;
  velX: number;
  velY: number;

  // 내부 상태 (16 bytes)
  energy: number;
  mode: AgentModeType;
  stress: number;
  cooldown: number;

  // 유전 파라미터 1 (32 bytes)
  efficiency: number;     // η - 섭취 효율
  absorption: number;     // u - 흡수 속도
  metabolism: number;     // m₀ - 기초대사
  moveCost: number;       // c_move - 이동 비용
  activity: number;       // a - 활동성
  agility: number;        // τ - 민첩성
  senseRange: number;     // r - 센싱 범위
  aggression: number;     // α - 공격성

  // 유전 파라미터 2 (16 bytes)
  evasion: number;        // β - 회피성
  sociality: number;      // σ - 사회성
  reproThreshold: number; // T_b - 번식 임계
  reproCooldown: number;  // C_b - 번식 쿨다운

  // 플래그 (4 bytes + 12 bytes padding)
  alive: number;
}

// 에이전트 버퍼 크기 (bytes)
export const AGENT_STRUCT_SIZE = 96;

// Float32 단위 크기
export const AGENT_FLOAT_COUNT = AGENT_STRUCT_SIZE / 4;

/**
 * 유전 파라미터 범위 정의
 */
export interface GeneticRange {
  min: number;
  max: number;
  default: number;
  mutationRate: number;
}

export const GENETIC_RANGES: Record<string, GeneticRange> = {
  efficiency:     { min: 0.1, max: 2.0,  default: 1.0, mutationRate: 0.1 },
  absorption:     { min: 0.1, max: 2.0,  default: 1.0, mutationRate: 0.1 },
  metabolism:     { min: 0.01, max: 0.2, default: 0.05, mutationRate: 0.05 },
  moveCost:       { min: 0.001, max: 0.05, default: 0.01, mutationRate: 0.02 },
  activity:       { min: 0.5, max: 3.0,  default: 1.0, mutationRate: 0.2 },
  agility:        { min: 0.5, max: 2.0,  default: 1.0, mutationRate: 0.1 },
  senseRange:     { min: 5.0, max: 50.0, default: 20.0, mutationRate: 5.0 },
  aggression:     { min: 0.0, max: 1.0,  default: 0.3, mutationRate: 0.1 },
  evasion:        { min: 0.0, max: 1.0,  default: 0.5, mutationRate: 0.1 },
  sociality:      { min: 0.0, max: 1.0,  default: 0.5, mutationRate: 0.1 },
  reproThreshold: { min: 50.0, max: 200.0, default: 100.0, mutationRate: 10.0 },
  reproCooldown:  { min: 10.0, max: 100.0, default: 30.0, mutationRate: 5.0 },
};

/**
 * 랜덤 유전자 생성
 */
export function createRandomGenetics(): Partial<AgentData> {
  const result: Partial<AgentData> = {};
  for (const [key, range] of Object.entries(GENETIC_RANGES)) {
    const value = range.min + Math.random() * (range.max - range.min);
    (result as Record<string, number>)[key] = value;
  }
  return result;
}

/**
 * 유전자 변이
 */
export function mutateGenetics(parent: Partial<AgentData>): Partial<AgentData> {
  const result: Partial<AgentData> = { ...parent };
  for (const [key, range] of Object.entries(GENETIC_RANGES)) {
    const parentValue = (parent as Record<string, number>)[key] ?? range.default;
    const mutation = (Math.random() - 0.5) * 2 * range.mutationRate;
    let newValue = parentValue + mutation;
    newValue = Math.max(range.min, Math.min(range.max, newValue));
    (result as Record<string, number>)[key] = newValue;
  }
  return result;
}
