/**
 * @fileoverview 성능/통계 표시
 */

import { Simulation, SimulationStats } from '../core/simulation';

export interface Stats {
  update(): void;
  destroy(): void;
}

export function createStats(
  simulation: Simulation,
  statsElement: HTMLElement
): Stats {
  let intervalId: number | null = null;

  function formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  function update(): void {
    const stats: SimulationStats = simulation.getStats();

    statsElement.innerHTML = `
      <div>FPS: ${stats.fps}</div>
      <div>Frame: ${stats.frameTime.toFixed(1)}ms</div>
      <div>Agents: ${stats.aliveAgentCount.toLocaleString()} alive / ${stats.allocatedAgentCount.toLocaleString()} slots</div>
      <div>Births (recent): ${stats.births.toLocaleString()}</div>
      <div>Deaths (recent): ${stats.deaths.toLocaleString()}</div>
      <div>Uptake (recent): ${stats.uptake.toFixed(2)}</div>
      <div>Time: ${formatTime(stats.time)}</div>
      ${stats.paused ? '<div style="color: #f39c12;">PAUSED</div>' : ''}
    `;
  }

  // 주기적 업데이트
  intervalId = window.setInterval(update, 100);

  function destroy(): void {
    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
  }

  return { update, destroy };
}
