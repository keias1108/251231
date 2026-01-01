/**
 * @fileoverview 레전드/설명 패널
 * 화면 요소(필드/개체/모드)의 의미를 UX적으로 설명한다.
 */

import { t, onLanguageChange } from '../i18n';

export interface Legend {
  getProbeElement(): HTMLElement;
  destroy(): void;
}

export function createLegend(panelElement: HTMLElement): Legend {
  let unsubscribe: (() => void) | null = null;

  function render(): void {
    panelElement.innerHTML = `
      <div style="font-weight: 600; margin-bottom: 8px;">${t('legend.title')}</div>
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
    `;
  }

  panelElement.classList.add('visible');
  render();

  // 언어 변경 시 재렌더링
  unsubscribe = onLanguageChange(() => {
    render();
  });

  const probeEl = panelElement.querySelector('#probe') as HTMLElement;

  function destroy(): void {
    if (unsubscribe) {
      unsubscribe();
    }
    panelElement.classList.remove('visible');
    panelElement.innerHTML = '';
  }

  return { getProbeElement: () => probeEl, destroy };
}
