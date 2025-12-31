/**
 * @fileoverview 시뮬레이션 설정 타입 정의
 */

export interface SimulationConfig {
  // 그리드 설정
  gridSize: number;           // 필드 해상도 (1024)

  // 에이전트 설정
  initialAgentCount: number;  // 초기 에이전트 수
  maxAgentCount: number;      // 최대 에이전트 수

  // 환경 파라미터
  resourceGeneration: number; // 자원 생성률
  diffusionRate: number;      // 확산 계수
  decayRate: number;          // 소산 계수
  pheromoneDecay: number;     // 페로몬 감쇠율

  // 안정화 파라미터
  saturationK: number;        // Michaelis-Menten K값
  densityPenalty: number;     // 밀도 페널티 계수
  uptakeScale: number;        // 섭취 스케일(에너지 단위)
  energyCostScale: number;    // 에너지 소비 스케일

  // 시각화 설정
  heightScale: number;        // 높이맵 스케일
  agentScale: number;         // 에이전트 크기
  trailLength: number;        // 궤적 길이 (프레임)

  // 시간 설정
  timeScale: number;          // 시간 배율 (1.0 = 기본)
}

export interface RenderConfig {
  showResource: boolean;
  showDanger: boolean;
  showPheromone: boolean;
  showTrails: boolean;
  showDensityHeatmap: boolean;
}

export const DEFAULT_CONFIG: SimulationConfig = {
  gridSize: 1024,
  initialAgentCount: 500,      // 적당한 시작 수 (감소)
  maxAgentCount: 20000,        // 기본 capacity (RTX2070급에서 여유)
  resourceGeneration: 0.02,    // 자원 생성률 (패치당)
  diffusionRate: 0.15,         // 확산 빠르게
  decayRate: 0.01,             // 소산 느리게 (자원 유지)
  pheromoneDecay: 0.1,         // 페로몬 빠르게 소산
  saturationK: 0.5,            // 섭취 포화점 낮춤
  densityPenalty: 0.2,         // 밀집 페널티 증가
  uptakeScale: 0.5,            // 섭취량 줄여서(과다 증식/불사 방지)
  energyCostScale: 8.0,        // 에너지 소비를 현실감 있게
  heightScale: 200.0,          // 높이맵 스케일
  agentScale: 1.2,             // 에이전트 약간 크게
  trailLength: 16,
  timeScale: 1.0,
};

export const DEFAULT_RENDER_CONFIG: RenderConfig = {
  showResource: true,
  showDanger: true,
  showPheromone: true,
  showTrails: true,
  showDensityHeatmap: false,
};
