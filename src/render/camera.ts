/**
 * @fileoverview 카메라 시스템
 * 줌, 패닝, 회전, 에이전트 추적 지원
 */

import { mat4, vec3 } from 'wgpu-matrix';

export interface Camera {
  position: Float32Array;   // 카메라 위치
  target: Float32Array;     // 바라보는 지점
  up: Float32Array;         // 업 벡터

  zoom: number;             // 줌 레벨 (1.0 = 기본)
  rotationX: number;        // X축 회전 (피치)
  rotationY: number;        // Y축 회전 (요)

  followTarget: number | null;  // 추적 중인 에이전트 ID

  viewMatrix: Float32Array;
  projMatrix: Float32Array;
  viewProjMatrix: Float32Array;

  update(width: number, height: number): void;
  pan(dx: number, dy: number): void;
  rotate(dx: number, dy: number): void;
  zoomBy(delta: number): void;
  setFollowTarget(id: number | null): void;
  resetToDefault(): void;
  screenToWorld(screenX: number, screenY: number, width: number, height: number): Float32Array;
}

export function createCamera(gridSize: number): Camera {
  const halfSize = gridSize / 2;

  // 초기 위치: 2.5D 아이소메트릭 스타일 뷰
  // 구면 좌표 기반으로 카메라 위치 계산
  const defaultDistance = gridSize * 0.7;
  const defaultPitch = -0.75;  // 약 43도 각도 (제대로 된 2.5D 느낌)
  const defaultYaw = Math.PI / 6;  // 약간의 회전으로 입체감 부여

  // 초기 위치 계산
  const initialX = halfSize + Math.sin(defaultYaw) * Math.cos(defaultPitch) * defaultDistance;
  const initialY = -Math.sin(defaultPitch) * defaultDistance;
  const initialZ = halfSize + Math.cos(defaultYaw) * Math.cos(defaultPitch) * defaultDistance;

  const position = new Float32Array([initialX, initialY, initialZ]);
  const target = new Float32Array([halfSize, 0, halfSize]);
  const up = new Float32Array([0, 1, 0]);

  let zoom = 1.0;
  let rotationX = defaultPitch;
  let rotationY = defaultYaw;

  let followTarget: number | null = null;

  const viewMatrix = mat4.create();
  const projMatrix = mat4.create();
  const viewProjMatrix = mat4.create();

  // 부드러운 카메라 이동을 위한 보간 타겟
  const targetPosition = new Float32Array([...position]);
  const targetLookAt = new Float32Array([...target]);

  function update(width: number, height: number): void {
    // 부드러운 보간
    const lerpFactor = 0.1;
    for (let i = 0; i < 3; i++) {
      position[i] += (targetPosition[i] - position[i]) * lerpFactor;
      target[i] += (targetLookAt[i] - target[i]) * lerpFactor;
    }

    // 뷰 매트릭스 계산
    mat4.lookAt(position, target, up, viewMatrix);

    // 프로젝션 매트릭스 (원근) - FOV 고정
    const aspect = width / height;
    const fov = Math.PI / 4;  // 45도 FOV 고정
    const near = 1;
    const far = gridSize * 5;
    mat4.perspective(fov, aspect, near, far, projMatrix);

    // 뷰-프로젝션 매트릭스
    mat4.multiply(projMatrix, viewMatrix, viewProjMatrix);
  }

  function pan(dx: number, dy: number): void {
    // 현재 카메라 yaw 각도 기준으로 XZ 평면에서 이동
    const panSpeed = (gridSize / 400) / zoom;

    // rotationY(yaw)를 기준으로 right/forward 벡터 계산
    // 카메라가 타겟을 바라보는 방향이 forward
    const forwardX = -Math.sin(rotationY);
    const forwardZ = -Math.cos(rotationY);

    // right 벡터: forward를 90도 회전
    const rightX = -forwardZ;
    const rightZ = forwardX;

    // 드래그/키보드 입력을 월드 이동으로 변환
    const deltaX = (dx * rightX + dy * forwardX) * panSpeed;
    const deltaZ = (dx * rightZ + dy * forwardZ) * panSpeed;

    targetPosition[0] += deltaX;
    targetPosition[2] += deltaZ;
    targetLookAt[0] += deltaX;
    targetLookAt[2] += deltaZ;

    followTarget = null;  // 수동 이동 시 추적 해제
  }

  function rotate(dx: number, dy: number): void {
    const rotateSpeed = 0.01;  // 감도 2배 증가
    rotationY += dx * rotateSpeed;
    rotationX -= dy * rotateSpeed;  // 반전 (자연스러운 느낌)

    // 피치 제한 (-85° ~ -11° 범위)
    rotationX = Math.max(-Math.PI / 2 + 0.05, Math.min(-0.2, rotationX));

    // 오빗 스타일: look-at 중심으로 회전
    updateOrbitPosition();
  }

  function updateOrbitPosition(): void {
    // zoom을 거리에 반영 (zoom이 크면 가깝게, 작으면 멀게)
    const baseDistance = defaultDistance;
    const distance = baseDistance / zoom;

    const newX = targetLookAt[0] + Math.sin(rotationY) * Math.cos(rotationX) * distance;
    const newY = targetLookAt[1] - Math.sin(rotationX) * distance;
    const newZ = targetLookAt[2] + Math.cos(rotationY) * Math.cos(rotationX) * distance;

    targetPosition[0] = newX;
    targetPosition[1] = newY;
    targetPosition[2] = newZ;
  }

  function zoomBy(delta: number): void {
    const zoomSpeed = 0.002;  // 감도 증가
    zoom *= 1 - delta * zoomSpeed;
    zoom = Math.max(0.3, Math.min(3.0, zoom));  // 범위 조정

    // 거리 기반 줌 (FOV 고정)
    updateOrbitPosition();
  }

  function setFollowTarget(id: number | null): void {
    followTarget = id;
  }

  function resetToDefault(): void {
    // 기본값으로 리셋
    zoom = 1.0;
    rotationX = defaultPitch;
    rotationY = defaultYaw;

    // 그리드 중앙을 바라보도록
    targetLookAt[0] = halfSize;
    targetLookAt[1] = 0;
    targetLookAt[2] = halfSize;

    // 카메라 위치 재계산
    updateOrbitPosition();

    followTarget = null;
  }

  function screenToWorld(
    screenX: number,
    screenY: number,
    width: number,
    height: number
  ): Float32Array {
    // 정규화된 장치 좌표로 변환
    const ndcX = (screenX / width) * 2 - 1;
    const ndcY = 1 - (screenY / height) * 2;

    // 뷰-프로젝션 역행렬
    const invViewProj = mat4.inverse(viewProjMatrix);

    // 레이 시작점 (near plane)
    const nearPoint = vec3.transformMat4([ndcX, ndcY, 0], invViewProj);
    // 레이 끝점 (far plane)
    const farPoint = vec3.transformMat4([ndcX, ndcY, 1], invViewProj);

    // y=0 평면과의 교차점 계산
    const direction = vec3.subtract(farPoint, nearPoint);
    if (Math.abs(direction[1]) < 0.0001) {
      return new Float32Array([nearPoint[0], 0, nearPoint[2]]);
    }

    const t = -nearPoint[1] / direction[1];
    return new Float32Array([
      nearPoint[0] + direction[0] * t,
      0,
      nearPoint[2] + direction[2] * t,
    ]);
  }

  return {
    position,
    target,
    up,
    zoom,
    rotationX,
    rotationY,
    followTarget,
    viewMatrix,
    projMatrix,
    viewProjMatrix,
    update,
    pan,
    rotate,
    zoomBy,
    setFollowTarget,
    resetToDefault,
    screenToWorld,
  };
}

/**
 * 카메라 유니폼 데이터 생성
 */
export function getCameraUniforms(camera: Camera): Float32Array {
  // viewProj (64 bytes) + cameraPos (12 bytes) + padding (4 bytes)
  const data = new Float32Array(20);
  data.set(camera.viewProjMatrix, 0);
  data.set(camera.position, 16);
  return data;
}
