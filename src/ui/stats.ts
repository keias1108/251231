/**
 * @fileoverview 성능/통계 표시
 */

import { Simulation, SimulationStats } from '../core/simulation';
import { t, onLanguageChange } from '../i18n';

export interface Stats {
  update(): void;
  destroy(): void;
}

export function createStats(
  simulation: Simulation,
  statsElement: HTMLElement
): Stats {
  let intervalId: number | null = null;
  let unsubscribe: (() => void) | null = null;

  function formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  function update(): void {
    const stats: SimulationStats = simulation.getStats();

    statsElement.innerHTML = `
      <div>${t('stats.fps')}: ${stats.fps}</div>
      <div>${t('stats.frame')}: ${stats.frameTime.toFixed(1)}ms</div>
      <div>${t('stats.agents')}: ${stats.aliveAgentCount.toLocaleString()} ${t('stats.alive')} / ${stats.allocatedAgentCount.toLocaleString()} ${t('stats.slots')} (${t('stats.cap')}: ${simulation.getConfig().maxAgentCount.toLocaleString()})</div>
      <div>${t('stats.birthsRecent')}: ${stats.births.toLocaleString()}</div>
      <div>${t('stats.deathsRecent')}: ${stats.deaths.toLocaleString()}</div>
      <div>${t('stats.uptakeRecent')}: ${stats.uptake.toFixed(2)}</div>
      <div>${t('stats.time')}: ${formatTime(stats.time)}</div>
      ${stats.paused ? `<div style="color: #f39c12;">${t('stats.paused')}</div>` : ''}
    `;
  }

  // 주기적 업데이트
  intervalId = window.setInterval(update, 100);

  // 언어 변경 시 즉시 업데이트
  unsubscribe = onLanguageChange(() => {
    update();
  });

  function destroy(): void {
    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
    if (unsubscribe) {
      unsubscribe();
    }
  }

  return { update, destroy };
}
