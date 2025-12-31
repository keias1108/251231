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
  initialAgentCount: 1000,
  maxAgentCount: 5000,
  resourceGeneration: 0.1,
  diffusionRate: 0.1,
  decayRate: 0.02,
  pheromoneDecay: 0.05,
  saturationK: 1.0,
  densityPenalty: 0.1,
  heightScale: 50.0,  // 높이맵이 잘 보이도록 (그리드 대비 약 5%)
  agentScale: 1.0,
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
