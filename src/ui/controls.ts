/**
 * @fileoverview lil-gui 기반 파라미터 컨트롤
 */

import GUI from 'lil-gui';
import { Simulation } from '../core/simulation';
import { SimulationConfig, RenderConfig, DEFAULT_CONFIG, DEFAULT_RENDER_CONFIG } from '../types/config';
import { t, onLanguageChange, setLanguage, getLanguage, Language } from '../i18n';

export interface Controls {
  gui: GUI;
  destroy(): void;
  saveConfig(): void;
  loadConfig(): void;
}

function saveConfigToFile(simulation: Simulation): void {
  const config = {
    version: '1.0',
    timestamp: new Date().toISOString(),
    simulation: simulation.getConfig(),
    render: simulation.getRenderConfig(),
  };

  const json = JSON.stringify(config, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `ecosystem-config-${Date.now()}.json`;
  a.click();

  URL.revokeObjectURL(url);
}

function triggerFileLoad(simulation: Simulation, onLoad?: () => void): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';

  input.onchange = async (e: Event) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const config = JSON.parse(text);

      if (config.simulation) {
        simulation.updateConfig(config.simulation);
      }
      if (config.render) {
        simulation.updateRenderConfig(config.render);
      }

      console.log('Config loaded successfully');
      onLoad?.();
    } catch (err) {
      console.error('Failed to load config:', err);
      alert('Failed to load config file');
    }
  };

  input.click();
}

export function createControls(simulation: Simulation): Controls {
  let gui: GUI;
  let unsubscribe: (() => void) | null = null;

  // 시뮬레이션 설정
  const simConfig: Partial<SimulationConfig> = { ...DEFAULT_CONFIG };
  const renderConfigState: RenderConfig = { ...DEFAULT_RENDER_CONFIG };

  function buildGUI(): void {
    // 기존 GUI 제거
    if (gui) {
      gui.destroy();
    }
    if (unsubscribe) {
      unsubscribe();
    }

    gui = new GUI({ title: t('gui.title') });

    // 시뮬레이션 폴더
    const simFolder = gui.addFolder(t('gui.simulation'));

    simFolder.add({ timeScale: simConfig.timeScale! }, 'timeScale', 0, 5, 0.02)
      .name(t('gui.timeScale'))
      .onChange((value: number) => simulation.setTimeScale(value));

    simFolder.add({ pause: false }, 'pause')
      .name(t('gui.paused'))
      .onChange((value: boolean) => {
        if (value) simulation.pause();
        else simulation.resume();
      });

    // 환경 폴더
    const envFolder = gui.addFolder(t('gui.environment'));

    envFolder.add(simConfig, 'resourceGeneration', 0.01, 0.5, 0.002)
      .name(t('gui.resourceGen'))
      .onChange(() => simulation.updateConfig(simConfig));

    envFolder.add(simConfig, 'diffusionRate', 0, 0.5, 0.002)
      .name(t('gui.diffusion'))
      .onChange(() => simulation.updateConfig(simConfig));

    envFolder.add(simConfig, 'decayRate', 0, 0.1, 0.001)
      .name(t('gui.decay'))
      .onChange(() => simulation.updateConfig(simConfig));

    envFolder.add(simConfig, 'pheromoneDecay', 0, 0.2, 0.002)
      .name(t('gui.pheromoneDecay'))
      .onChange(() => simulation.updateConfig(simConfig));

    // 안정화 폴더
    const stabFolder = gui.addFolder(t('gui.stabilizers'));

    stabFolder.add(simConfig, 'saturationK', 0.05, 20, 0.01)
      .name(t('gui.saturationK'))
      .onChange(() => simulation.updateConfig(simConfig));

    stabFolder.add(simConfig, 'densityPenalty', 0, 5, 0.01)
      .name(t('gui.densityPenalty'))
      .onChange(() => simulation.updateConfig(simConfig));

    // 에너지/섭취 스케일 (UX: 먹고/죽는지 체감)
    const dynamicsFolder = gui.addFolder(t('gui.dynamics'));

    dynamicsFolder.add(simConfig, 'uptakeScale', 0.01, 10.0, 0.01)
      .name(t('gui.uptakeScale'))
      .onChange(() => simulation.updateConfig(simConfig));

    dynamicsFolder.add(simConfig, 'energyCostScale', 0.1, 100.0, 0.1)
      .name(t('gui.energyCostScale'))
      .onChange(() => simulation.updateConfig(simConfig));

    // 시각화 폴더
    const visualFolder = gui.addFolder(t('gui.visualization'));

    visualFolder.add(renderConfigState, 'showResource')
      .name(t('gui.showResource'))
      .onChange(() => simulation.updateRenderConfig(renderConfigState));

    visualFolder.add(renderConfigState, 'showDanger')
      .name(t('gui.showDanger'))
      .onChange(() => simulation.updateRenderConfig(renderConfigState));

    visualFolder.add(renderConfigState, 'showPheromone')
      .name(t('gui.showPheromone'))
      .onChange(() => simulation.updateRenderConfig(renderConfigState));

    visualFolder.add(renderConfigState, 'showTrails')
      .name(t('gui.showTrails'))
      .onChange(() => simulation.updateRenderConfig(renderConfigState));

    visualFolder.add(simConfig, 'heightScale', 50, 400, 2)
      .name(t('gui.heightScale'))
      .onChange(() => simulation.updateConfig(simConfig));

    visualFolder.add(simConfig, 'agentScale', 0.5, 3, 0.02)
      .name(t('gui.agentScale'))
      .onChange(() => simulation.updateConfig(simConfig));

    // 카메라 폴더
    const cameraFolder = gui.addFolder(t('gui.camera'));

    cameraFolder.add({ resetCamera: () => simulation.getCamera().resetToDefault() }, 'resetCamera')
      .name(t('gui.resetCamera'));

    // 설정 폴더
    const settingsFolder = gui.addFolder(t('gui.settings'));

    // 언어 선택
    const langOptions = { 'English': 'en', '한국어': 'ko' };
    const currentLangLabel = getLanguage() === 'en' ? 'English' : '한국어';
    settingsFolder.add({ language: currentLangLabel }, 'language', Object.keys(langOptions))
      .name(t('gui.language'))
      .onChange((label: string) => {
        const lang = langOptions[label as keyof typeof langOptions] as Language;
        setLanguage(lang);
      });

    // 저장/로드 버튼
    settingsFolder.add({ save: () => saveConfigToFile(simulation) }, 'save')
      .name(t('gui.saveConfig'));

    settingsFolder.add({ load: () => triggerFileLoad(simulation, buildGUI) }, 'load')
      .name(t('gui.loadConfig'));

    // 리셋 버튼
    settingsFolder.add({ reset: () => simulation.resetSimulation() }, 'reset')
      .name(t('gui.resetSim'));

    // 일부 폴더 닫기
    envFolder.close();
    stabFolder.close();
    dynamicsFolder.close();
    cameraFolder.close();

    // 언어 변경 리스너
    unsubscribe = onLanguageChange(() => {
      buildGUI();
    });
  }

  buildGUI();

  function destroy(): void {
    if (unsubscribe) {
      unsubscribe();
    }
    gui.destroy();
  }

  function saveConfig(): void {
    saveConfigToFile(simulation);
  }

  function loadConfig(): void {
    triggerFileLoad(simulation, buildGUI);
  }

  return {
    get gui() { return gui; },
    destroy,
    saveConfig,
    loadConfig,
  };
}
