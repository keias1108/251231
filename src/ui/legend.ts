/**
 * @fileoverview 레전드/설명 패널
 * 화면 요소(필드/개체/모드)의 의미를 UX적으로 설명한다.
 */

export interface Legend {
  getProbeElement(): HTMLElement;
  destroy(): void;
}

export function createLegend(panelElement: HTMLElement): Legend {
  panelElement.classList.add('visible');
  panelElement.innerHTML = `
    <div style="font-weight: 600; margin-bottom: 8px;">Legend</div>
    <div style="line-height: 1.45; margin-bottom: 10px;">
      <div><span style="color:#4cc34c;">Resource</span>: 먹이/에너지 원천(F)</div>
      <div><span style="color:#d9534f;">Danger</span>: 위험/스트레스(R)</div>
      <div><span style="color:#4aa3ff;">Pheromone</span>: 신호/흔적(P)</div>
      <div><span style="color:#cccccc;">Terrain</span>: 이동 저항(Z, 어두울수록 불리)</div>
      <div><span style="color:#cccccc;">Height</span>: 고도(H, 지형 모양만 담당)</div>
      <div style="margin-top:6px;">에이전트 색: 유전 특성(종 분화)</div>
      <div>모드: <span style="color:#6dff6d;">섭취</span> / <span style="color:#ff6d6d;">회피</span> / <span style="color:#ffd36d;">번식</span></div>
      <div>죽음: 에너지(E) ≤ 0</div>
    </div>
    <div id="probe" style="background: rgba(255,255,255,0.06); padding: 8px; border-radius: 6px; line-height: 1.45;">
      <div style="opacity:0.85;">Probe: 마우스를 지형 위로 올리세요</div>
    </div>
  `;

  const probeEl = panelElement.querySelector('#probe') as HTMLElement;

  function destroy(): void {
    panelElement.classList.remove('visible');
    panelElement.innerHTML = '';
  }

  return { getProbeElement: () => probeEl, destroy };
}
