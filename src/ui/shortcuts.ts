/**
 * @fileoverview 키보드 단축키 모듈
 * Alt+Z: 시뮬레이션 리셋
 * Alt+S: 설정 저장
 * Space: 재생/일시정지 토글
 */

import { Simulation } from '../core/simulation';

export interface ShortcutsConfig {
  onSaveConfig: () => void;
}

export interface Shortcuts {
  destroy(): void;
}

export function createShortcuts(
  simulation: Simulation,
  config: ShortcutsConfig
): Shortcuts {
  function onKeyDown(e: KeyboardEvent): void {
    // 입력 필드에서는 단축키 무시
    if (
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLTextAreaElement
    ) {
      return;
    }

    // Alt+Z: 시뮬레이션 리셋
    if (e.altKey && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      simulation.resetSimulation();
      console.log('Simulation reset');
      return;
    }

    // Alt+S: 설정 저장
    if (e.altKey && e.key.toLowerCase() === 's') {
      e.preventDefault();
      config.onSaveConfig();
      return;
    }

    // Space: 재생/일시정지 토글
    if (e.code === 'Space') {
      e.preventDefault();
      const stats = simulation.getStats();
      if (stats.paused) {
        simulation.resume();
      } else {
        simulation.pause();
      }
      return;
    }
  }

  window.addEventListener('keydown', onKeyDown);

  function destroy(): void {
    window.removeEventListener('keydown', onKeyDown);
  }

  return { destroy };
}
