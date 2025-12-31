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
  screenToWorld(screenX: number, screenY: number, width: number, height: number): Float32Array;
}

export function createCamera(gridSize: number): Camera {
  const halfSize = gridSize / 2;

  // 초기 위치: 2.5D 뷰를 위해 더 낮고 가까운 위치
  // Y는 높이맵이 보이도록 적당히, Z는 경사각이 잘 보이도록
  const position = new Float32Array([halfSize, gridSize * 0.35, halfSize + gridSize * 0.35]);
  const target = new Float32Array([halfSize, 0, halfSize]);
  const up = new Float32Array([0, 1, 0]);

  let zoom = 1.0;
  let rotationX = -0.45;  // 약 26도 각도로 바라봄 (더 완만하게)
  let rotationY = 0;

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

    // 프로젝션 매트릭스 (원근)
    const aspect = width / height;
    const fov = Math.PI / 4 / zoom;  // 줌에 따라 FOV 조정
    const near = 1;
    const far = gridSize * 5;
    mat4.perspective(fov, aspect, near, far, projMatrix);

    // 뷰-프로젝션 매트릭스
    mat4.multiply(projMatrix, viewMatrix, viewProjMatrix);
  }

  function pan(dx: number, dy: number): void {
    // 화면 좌표를 월드 좌표 이동으로 변환
    const panSpeed = 2.0 / zoom;

    // 카메라의 로컬 축 계산
    const forward = vec3.normalize(vec3.subtract(target, position));
    const right = vec3.normalize(vec3.cross(forward, up));
    const localUp = vec3.cross(right, forward);

    // 이동 적용
    const moveX = vec3.scale(right, -dx * panSpeed);
    const moveZ = vec3.scale(localUp, dy * panSpeed);

    targetPosition[0] += moveX[0] + moveZ[0];
    targetPosition[2] += moveX[2] + moveZ[2];
    targetLookAt[0] += moveX[0] + moveZ[0];
    targetLookAt[2] += moveX[2] + moveZ[2];

    followTarget = null;  // 수동 이동 시 추적 해제
  }

  function rotate(dx: number, dy: number): void {
    const rotateSpeed = 0.005;
    rotationY += dx * rotateSpeed;
    rotationX += dy * rotateSpeed;

    // 피치 제한
    rotationX = Math.max(-Math.PI / 2 + 0.1, Math.min(-0.1, rotationX));

    // 새 카메라 위치 계산
    const distance = vec3.length(vec3.subtract(position, target)) / zoom;
    const newX = target[0] + Math.sin(rotationY) * Math.cos(rotationX) * distance;
    const newY = target[1] - Math.sin(rotationX) * distance;
    const newZ = target[2] + Math.cos(rotationY) * Math.cos(rotationX) * distance;

    targetPosition[0] = newX;
    targetPosition[1] = newY;
    targetPosition[2] = newZ;
  }

  function zoomBy(delta: number): void {
    const zoomSpeed = 0.001;
    zoom *= 1 - delta * zoomSpeed;
    zoom = Math.max(0.2, Math.min(5.0, zoom));

    // 카메라 위치 조정
    const direction = vec3.normalize(vec3.subtract(target, position));
    const distance = vec3.length(vec3.subtract(position, target));
    const newDistance = distance / zoom;

    targetPosition[0] = target[0] - direction[0] * newDistance;
    targetPosition[1] = target[1] - direction[1] * newDistance;
    targetPosition[2] = target[2] - direction[2] * newDistance;
  }

  function setFollowTarget(id: number | null): void {
    followTarget = id;
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
