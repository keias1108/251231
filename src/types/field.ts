/**
 * @fileoverview 환경 필드 타입 정의
 */

export enum FieldType {
  RESOURCE = 0,    // F(x) - 자원 필드
  HEIGHT = 1,      // H(x) - 고도(렌더링용, 느리게/정적으로)
  TERRAIN = 2,     // Z(x) - 지형/저항
  DANGER = 3,      // R(x) - 위험 필드
  PHEROMONE = 4,   // P(x) - 신호 필드
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
  [FieldType.HEIGHT]: {
    type: FieldType.HEIGHT,
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

export function createHeightField(size: number): Float32Array {
  const data = new Float32Array(size * size);

  const TAU = Math.PI * 2;
  const cx = size * 0.5;
  const cy = size * 0.5;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = y * size + x;
      const nx = x / size;
      const ny = y / size;

      // 대략적인 fBm 느낌(렌더링용): 부드러운 산맥 + 완만한 기복
      const base =
        0.55 +
        0.18 * Math.sin(nx * TAU * 2.0) * Math.cos(ny * TAU * 2.0) +
        0.12 * Math.sin((nx + ny) * TAU * 3.0) +
        0.08 * Math.cos((nx * 4.0 - ny * 3.0) * TAU);

      // 중앙이 조금 높고 외곽이 낮아지는 형태(아이소메트릭에서 보기 좋게)
      const dx = (x - cx) / size;
      const dy = (y - cy) / size;
      const radial = Math.sqrt(dx * dx + dy * dy);
      const dome = 1.0 - Math.min(1.0, radial * 1.6);

      const height = base * 0.7 + dome * 0.3;
      data[idx] = Math.max(0, Math.min(1, height));
    }
  }

  return data;
}

export function createTerrainField(size: number, heightField: Float32Array): Float32Array {
  const data = new Float32Array(size * size);

  // 업계에서 흔한 방식: 고도(또는 경사) 기반으로 "거칠기/저항"을 만들고,
  // 약간의 노이즈로 다양성만 추가(의미는 Z(x)=저항 유지).
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = y * size + x;

      const xL = Math.max(0, x - 1);
      const xR = Math.min(size - 1, x + 1);
      const yU = Math.max(0, y - 1);
      const yD = Math.min(size - 1, y + 1);

      const hL = heightField[y * size + xL];
      const hR = heightField[y * size + xR];
      const hU = heightField[yU * size + x];
      const hD = heightField[yD * size + x];

      const slope = Math.abs(hR - hL) + Math.abs(hD - hU); // 0~2 대략
      const roughness = Math.min(1, slope * 2.2);

      const noise =
        0.5 +
        0.25 * Math.sin((x / size) * Math.PI * 10 + (y / size) * Math.PI * 7) +
        0.25 * Math.cos((x / size) * Math.PI * 6 - (y / size) * Math.PI * 9);

      // 1.0=이동 쉬움, 0.0=이동 불가에 가까움
      const resistance = 1.0 - roughness * 0.6;
      const withNoise = resistance * (0.85 + 0.15 * noise);
      data[idx] = Math.max(0.2, Math.min(1.0, withNoise));
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
