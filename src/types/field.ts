/**
 * @fileoverview 환경 필드 타입 정의
 */

export enum FieldType {
  RESOURCE = 0,    // F(x) - 자원 필드
  TERRAIN = 1,     // Z(x) - 지형/저항
  DANGER = 2,      // R(x) - 위험 필드
  PHEROMONE = 3,   // P(x) - 신호 필드
}

export interface FieldConfig {
  type: FieldType;
  size: number;         // 그리드 크기 (1024)
  initialValue: number; // 초기값
  minValue: number;     // 최소값 (클램프)
  maxValue: number;     // 최대값 (클램프)
}

export const FIELD_CONFIGS: Record<FieldType, Omit<FieldConfig, 'size'>> = {
  [FieldType.RESOURCE]: {
    type: FieldType.RESOURCE,
    initialValue: 0.5,
    minValue: 0.0,
    maxValue: 1.0,
  },
  [FieldType.TERRAIN]: {
    type: FieldType.TERRAIN,
    initialValue: 1.0,  // 1.0 = 이동 용이, 0.0 = 이동 불가
    minValue: 0.0,
    maxValue: 1.0,
  },
  [FieldType.DANGER]: {
    type: FieldType.DANGER,
    initialValue: 0.0,
    minValue: 0.0,
    maxValue: 1.0,
  },
  [FieldType.PHEROMONE]: {
    type: FieldType.PHEROMONE,
    initialValue: 0.0,
    minValue: 0.0,
    maxValue: 1.0,
  },
};

/**
 * 필드 시뮬레이션 파라미터
 */
export interface FieldParams {
  // 자원 생성 (패치 기반)
  resourceSpawnRate: number;    // 생성 속도
  resourceSpawnRadius: number;  // 패치 반경
  resourceSpawnCount: number;   // 패치 수

  // 확산
  diffusionCoeff: number;       // D - 확산 계수

  // 소산
  resourceDecay: number;        // λ - 자원 감쇠
  pheromoneDecay: number;       // 페로몬 감쇠 (더 빠름)

  // 위험 지역
  dangerZones: DangerZone[];
}

export interface DangerZone {
  x: number;
  y: number;
  radius: number;
  intensity: number;
}

export const DEFAULT_FIELD_PARAMS: FieldParams = {
  resourceSpawnRate: 0.001,
  resourceSpawnRadius: 50,
  resourceSpawnCount: 8,
  diffusionCoeff: 0.1,
  resourceDecay: 0.001,
  pheromoneDecay: 0.02,
  dangerZones: [
    { x: 256, y: 256, radius: 100, intensity: 0.8 },
    { x: 768, y: 768, radius: 80, intensity: 0.6 },
  ],
};

/**
 * 필드 초기화 함수들
 */
export function createResourceField(size: number): Float32Array {
  const data = new Float32Array(size * size);
  // 노이즈 기반 초기 자원 분포
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = y * size + x;
      // 간단한 펄린 노이즈 대체: 여러 사인파 조합
      const nx = x / size;
      const ny = y / size;
      const value = 0.5 +
        0.2 * Math.sin(nx * 10 + ny * 10) +
        0.1 * Math.sin(nx * 20 - ny * 15) +
        0.1 * Math.cos(nx * 5 + ny * 25);
      data[idx] = Math.max(0, Math.min(1, value));
    }
  }
  return data;
}

export function createTerrainField(size: number): Float32Array {
  const data = new Float32Array(size * size);
  data.fill(1.0); // 기본적으로 모든 곳 이동 가능

  // 일부 장애물 영역 추가
  const obstacleCount = 5;
  for (let i = 0; i < obstacleCount; i++) {
    const cx = Math.random() * size;
    const cy = Math.random() * size;
    const radius = 30 + Math.random() * 50;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = x - cx;
        const dy = y - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < radius) {
          const idx = y * size + x;
          const factor = 1 - (radius - dist) / radius;
          data[idx] = Math.min(data[idx], 0.3 + 0.7 * factor);
        }
      }
    }
  }
  return data;
}

export function createDangerField(size: number, zones: DangerZone[]): Float32Array {
  const data = new Float32Array(size * size);

  for (const zone of zones) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = x - zone.x;
        const dy = y - zone.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < zone.radius) {
          const idx = y * size + x;
          const intensity = zone.intensity * (1 - dist / zone.radius);
          data[idx] = Math.max(data[idx], intensity);
        }
      }
    }
  }
  return data;
}

export function createEmptyField(size: number): Float32Array {
  return new Float32Array(size * size);
}
