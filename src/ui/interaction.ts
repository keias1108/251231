/**
 * @fileoverview 마우스/키보드 인터랙션 처리
 */

import { Camera } from '../render/camera';

export interface Interaction {
  destroy(): void;
}

export function createInteraction(
  canvas: HTMLCanvasElement,
  camera: Camera
): Interaction {
  let isDragging = false;
  let isRotating = false;
  let lastMouseX = 0;
  let lastMouseY = 0;

  // 마우스 다운
  function onMouseDown(e: MouseEvent): void {
    if (e.button === 0) {
      // 좌클릭: 패닝
      isDragging = true;
    } else if (e.button === 2) {
      // 우클릭: 회전
      isRotating = true;
    }
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
  }

  // 마우스 이동
  function onMouseMove(e: MouseEvent): void {
    const dx = e.clientX - lastMouseX;
    const dy = e.clientY - lastMouseY;
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;

    if (isDragging) {
      camera.pan(dx, dy);
    } else if (isRotating) {
      camera.rotate(dx, dy);
    }
  }

  // 마우스 업
  function onMouseUp(): void {
    isDragging = false;
    isRotating = false;
  }

  // 마우스 휠 (줌)
  function onWheel(e: WheelEvent): void {
    e.preventDefault();
    camera.zoomBy(e.deltaY);
  }

  // 컨텍스트 메뉴 방지
  function onContextMenu(e: MouseEvent): void {
    e.preventDefault();
  }

  // 키보드
  function onKeyDown(e: KeyboardEvent): void {
    const panSpeed = 30;
    const rotateSpeed = 50;
    const pitchSpeed = 30;

    switch (e.key.toLowerCase()) {
      // 이동 (WASD / 화살표)
      case 'arrowup':
      case 'w':
        camera.pan(0, -panSpeed);
        break;
      case 'arrowdown':
      case 's':
        camera.pan(0, panSpeed);
        break;
      case 'arrowleft':
      case 'a':
        camera.pan(-panSpeed, 0);
        break;
      case 'arrowright':
      case 'd':
        camera.pan(panSpeed, 0);
        break;

      // 회전 (Q/E)
      case 'q':
        camera.rotate(-rotateSpeed, 0);
        break;
      case 'e':
        camera.rotate(rotateSpeed, 0);
        break;

      // 피치 (R/F)
      case 'r':
        camera.rotate(0, -pitchSpeed);
        break;
      case 'f':
        camera.rotate(0, pitchSpeed);
        break;

      // 줌 (+/-)
      case '+':
      case '=':
        camera.zoomBy(-100);
        break;
      case '-':
        camera.zoomBy(100);
        break;

      // 리셋 (Home)
      case 'home':
        camera.resetToDefault();
        break;
    }
  }

  // 이벤트 리스너 등록
  canvas.addEventListener('mousedown', onMouseDown);
  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mouseup', onMouseUp);
  canvas.addEventListener('mouseleave', onMouseUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', onContextMenu);
  window.addEventListener('keydown', onKeyDown);

  function destroy(): void {
    canvas.removeEventListener('mousedown', onMouseDown);
    canvas.removeEventListener('mousemove', onMouseMove);
    canvas.removeEventListener('mouseup', onMouseUp);
    canvas.removeEventListener('mouseleave', onMouseUp);
    canvas.removeEventListener('wheel', onWheel);
    canvas.removeEventListener('contextmenu', onContextMenu);
    window.removeEventListener('keydown', onKeyDown);
  }

  return { destroy };
}
