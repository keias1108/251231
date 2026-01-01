/**
 * @fileoverview 레전드/설명 패널
 * 화면 요소(필드/개체/모드)의 의미를 UX적으로 설명한다.
 */

import { t, onLanguageChange } from '../i18n';

const STORAGE_KEY_LEGEND = 'ecosystem_legend_collapsed';

export interface Legend {
  getProbeElement(): HTMLElement;
  destroy(): void;
}

export function createLegend(panelElement: HTMLElement): Legend {
  let unsubscribe: (() => void) | null = null;
  let isCollapsed = localStorage.getItem(STORAGE_KEY_LEGEND) === 'true';

  function updateCollapseState(): void {
    if (isCollapsed) {
      panelElement.classList.add('collapsed');
    } else {
      panelElement.classList.remove('collapsed');
    }
    // 아이콘 업데이트
    const collapseBtn = panelElement.querySelector('.collapse-btn');
    if (collapseBtn) {
      collapseBtn.textContent = isCollapsed ? '▲' : '▼';
    }
    localStorage.setItem(STORAGE_KEY_LEGEND, String(isCollapsed));
  }

  function toggleCollapse(): void {
    isCollapsed = !isCollapsed;
    updateCollapseState();
  }

  function render(): void {
    const collapseIcon = isCollapsed ? '▲' : '▼';
    panelElement.innerHTML = `
      <div class="legend-header">
        <span style="font-weight: 600;">${t('legend.title')}</span>
        <span class="collapse-btn">${collapseIcon}</span>
      </div>
      <div class="legend-content" style="margin-top: 8px;">
        <div style="line-height: 1.45; margin-bottom: 10px;">
          <div><span style="color:#4cc34c;">${t('legend.resource')}</span>: ${t('legend.resourceDesc')} (${t('legend.keyF')})</div>
          <div><span style="color:#d9534f;">${t('legend.danger')}</span>: ${t('legend.dangerDesc')} (${t('legend.keyR')})</div>
          <div><span style="color:#4aa3ff;">${t('legend.pheromone')}</span>: ${t('legend.pheromoneDesc')} (${t('legend.keyP')})</div>
          <div><span style="color:#cccccc;">${t('legend.terrain')}</span>: ${t('legend.terrainDesc')}</div>
          <div><span style="color:#cccccc;">${t('legend.height')}</span>: ${t('legend.heightDesc')}</div>
          <div style="margin-top:6px;">${t('legend.agentColor')}</div>
          <div>${t('legend.modes')}: <span style="color:#6dff6d;">${t('legend.intake')}</span> / <span style="color:#ff6d6d;">${t('legend.evade')}</span> / <span style="color:#ffd36d;">${t('legend.reproduce')}</span></div>
          <div>${t('legend.death')}</div>
        </div>
        <div id="probe" style="background: rgba(255,255,255,0.06); padding: 8px; border-radius: 6px; line-height: 1.45;">
          <div style="opacity:0.85;">${t('probe.title')}: ${t('probe.hint')}</div>
        </div>
      </div>
    `;

    // 헤더 클릭 이벤트 추가
    const header = panelElement.querySelector('.legend-header');
    if (header) {
      header.addEventListener('click', toggleCollapse);
    }

    updateCollapseState();
  }

  panelElement.classList.add('visible');
  render();

  // 언어 변경 시 재렌더링
  unsubscribe = onLanguageChange(() => {
    render();
  });

  function getProbeElement(): HTMLElement {
    return panelElement.querySelector('#probe') as HTMLElement;
  }

  function destroy(): void {
    if (unsubscribe) {
      unsubscribe();
    }
    panelElement.classList.remove('visible');
    panelElement.innerHTML = '';
  }

  return { getProbeElement, destroy };
}
