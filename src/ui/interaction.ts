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
    const panSpeed = 20;

    switch (e.key) {
      case 'ArrowUp':
      case 'w':
        camera.pan(0, -panSpeed);
        break;
      case 'ArrowDown':
      case 's':
        camera.pan(0, panSpeed);
        break;
      case 'ArrowLeft':
      case 'a':
        camera.pan(-panSpeed, 0);
        break;
      case 'ArrowRight':
      case 'd':
        camera.pan(panSpeed, 0);
        break;
      case '+':
      case '=':
        camera.zoomBy(-100);
        break;
      case '-':
        camera.zoomBy(100);
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
