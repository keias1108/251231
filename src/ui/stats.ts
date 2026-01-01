/**
 * @fileoverview 성능/통계 표시
 */

import { Simulation, SimulationStats } from '../core/simulation';
import { t, onLanguageChange } from '../i18n';

const STORAGE_KEY_STATS = 'ecosystem_stats_collapsed';

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
  let isCollapsed = localStorage.getItem(STORAGE_KEY_STATS) === 'true';

  function updateCollapseState(): void {
    if (isCollapsed) {
      statsElement.classList.add('collapsed');
    } else {
      statsElement.classList.remove('collapsed');
    }
    // 아이콘 업데이트
    const collapseBtn = statsElement.querySelector('.collapse-btn');
    if (collapseBtn) {
      collapseBtn.textContent = isCollapsed ? '◀' : '▶';
    }
    localStorage.setItem(STORAGE_KEY_STATS, String(isCollapsed));
  }

  function toggleCollapse(): void {
    isCollapsed = !isCollapsed;
    updateCollapseState();
  }

  function formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  function initStructure(): void {
    const collapseIcon = isCollapsed ? '◀' : '▶';
    statsElement.innerHTML = `
      <div class="stats-header">
        <span class="collapse-btn">${collapseIcon}</span>
        <span style="font-weight: 600;">${t('stats.title')}</span>
      </div>
      <div class="stats-content" style="margin-top: 4px;"></div>
    `;

    // 헤더 클릭 이벤트 추가 (한 번만)
    const header = statsElement.querySelector('.stats-header');
    if (header) {
      (header as HTMLElement).onclick = toggleCollapse;
    }

    updateCollapseState();
  }

  function update(): void {
    const stats: SimulationStats = simulation.getStats();
    const contentEl = statsElement.querySelector('.stats-content');
    if (!contentEl) return;

    const s = stats.evolutionSample;
    const b = stats.evolutionBirths;
    const d = stats.evolutionDeaths;

    const fmt = (value: number, digits: number) => Number.isFinite(value) ? value.toFixed(digits) : '0';

    const lblEff = t('agent.eff');
    const lblMeta = t('agent.meta');
    const lblAct = t('agent.activity');
    const lblSense = t('agent.sense');
    const lblToxRes = t('stats.toxinRes');
    const lblSoc = t('agent.soc');

    const evoLineWithCount = (e: { count: number; efficiency: number; metabolism: number; activity: number; senseRange: number; evasion: number; sociality: number }) =>
      `n=${e.count} ${lblEff}=${fmt(e.efficiency, 2)} ${lblMeta}=${fmt(e.metabolism, 3)} ${lblAct}=${fmt(e.activity, 2)} ${lblSense}=${fmt(e.senseRange, 1)} ${lblToxRes}=${fmt(e.evasion, 2)} ${lblSoc}=${fmt(e.sociality, 2)}`;

    const evoLine = (e: { efficiency: number; metabolism: number; activity: number; senseRange: number; evasion: number; sociality: number }) =>
      `${lblEff}=${fmt(e.efficiency, 2)} ${lblMeta}=${fmt(e.metabolism, 3)} ${lblAct}=${fmt(e.activity, 2)} ${lblSense}=${fmt(e.senseRange, 1)} ${lblToxRes}=${fmt(e.evasion, 2)} ${lblSoc}=${fmt(e.sociality, 2)}`;

    contentEl.innerHTML = `
      <div>${t('stats.fps')}: ${stats.fps}</div>
      <div>${t('stats.frame')}: ${stats.frameTime.toFixed(1)}ms</div>
      <div>${t('stats.agents')}: ${stats.aliveAgentCount.toLocaleString()} ${t('stats.alive')} / ${stats.allocatedAgentCount.toLocaleString()} ${t('stats.slots')} (${t('stats.cap')}: ${simulation.getConfig().maxAgentCount.toLocaleString()})</div>
      <div>${t('stats.birthsRecent')}: ${stats.births.toLocaleString()}</div>
      <div>${t('stats.deathsRecent')}: ${stats.deaths.toLocaleString()}</div>
      <div>${t('stats.uptakeRecent')}: ${stats.uptake.toFixed(2)}</div>
      <div>${t('stats.time')}: ${formatTime(stats.time)}</div>
      <div style="margin-top: 6px;">${t('stats.evoSample')}: ${evoLineWithCount(s)}</div>
      <div>${t('stats.evoBirths')}: ${evoLine(b)}</div>
      <div>${t('stats.evoDeaths')}: ${evoLine(d)}</div>
      ${stats.paused ? `<div style="color: #f39c12;">${t('stats.paused')}</div>` : ''}
    `;
  }

  // 초기 구조 설정
  initStructure();

  // 초기 업데이트
  update();

  // 주기적 업데이트
  intervalId = window.setInterval(update, 100);

  // 언어 변경 시 구조 재초기화
  unsubscribe = onLanguageChange(() => {
    initStructure();
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
