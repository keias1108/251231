/**
 * @fileoverview lil-gui 기반 파라미터 컨트롤
 */

import GUI from 'lil-gui';
import { Simulation } from '../core/simulation';
import { SimulationConfig, RenderConfig, DEFAULT_CONFIG, DEFAULT_RENDER_CONFIG } from '../types/config';
import { t, onLanguageChange, setLanguage, getLanguage, Language } from '../i18n';

const STORAGE_KEY_FOLDERS = 'ecosystem_folder_states';

export interface Controls {
  gui: GUI;
  destroy(): void;
  saveConfig(): void;
  loadConfig(): void;
}

// 폴더 상태 저장/불러오기
function loadFolderStates(): Record<string, boolean> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_FOLDERS);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

function saveFolderStates(states: Record<string, boolean>): void {
  localStorage.setItem(STORAGE_KEY_FOLDERS, JSON.stringify(states));
}

function setupFolderPersistence(folder: GUI, key: string, defaultClosed: boolean = false): void {
  const states = loadFolderStates();

  // 저장된 상태가 있으면 적용, 없으면 기본값 사용
  if (key in states) {
    if (states[key]) {
      folder.close();
    } else {
      folder.open();
    }
  } else if (defaultClosed) {
    folder.close();
  }

  // lil-gui의 onOpenClose 콜백 사용
  folder.onOpenClose((gui: GUI) => {
    const states = loadFolderStates();
    states[key] = !gui._closed ? false : true;
    saveFolderStates(states);
  });
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

// 슬라이더 휠 감도 조정을 위한 함수
function setupWheelSensitivity(gui: GUI): void {
  const controllers: any[] = typeof (gui as any).controllersRecursive === 'function'
    ? (gui as any).controllersRecursive()
    : (() => {
      const collected: any[] = [];

      function collect(obj: any) {
        if (obj.controllers) {
          collected.push(...obj.controllers);
        }
        if (obj.folders) {
          obj.folders.forEach((folder: any) => collect(folder));
        }
      }

      collect(gui);
      return collected;
    })();

  const wheelRemainderByController = new WeakMap<object, number>();

  controllers.forEach((controller: any) => {
    if (!controller?._normalizeMouseWheel) return;
    if (controller.__ecosystemWheelPatched) return;
    controller.__ecosystemWheelPatched = true;

    controller._normalizeMouseWheel = function (e: WheelEvent) {
      const anyEvent = e as any;

      let notchUnits = 0;

      if (Math.floor(e.deltaY) !== e.deltaY && anyEvent.wheelDelta) {
        notchUnits = -(anyEvent.wheelDelta / 120);
      } else {
        const combined = e.deltaX + -e.deltaY;

        if (e.deltaMode === 1) {
          notchUnits = combined;
        } else if (e.deltaMode === 2) {
          notchUnits = combined * 3;
        } else {
          const approxNotches = combined / 100;

          if (Math.abs(approxNotches) >= 0.75) {
            notchUnits = Math.sign(approxNotches) * Math.max(1, Math.round(Math.abs(approxNotches)));
          } else {
            notchUnits = approxNotches;
          }
        }
      }

      if (e.shiftKey) notchUnits *= 10;
      if (e.altKey) notchUnits /= 10;

      if (Number.isInteger(notchUnits) && Math.abs(notchUnits) >= 1) {
        wheelRemainderByController.set(this as object, 0);
        return notchUnits;
      }

      const prev = wheelRemainderByController.get(this as object) ?? 0;
      const next = prev + notchUnits;
      const whole = next >= 0 ? Math.floor(next) : Math.ceil(next);
      wheelRemainderByController.set(this as object, next - whole);
      return whole;
    };
  });
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

    // 현재 시뮬레이션 설정과 동기화 (GUI 재생성/로드 후 값 불일치 방지)
    Object.assign(simConfig, simulation.getConfig());
    Object.assign(renderConfigState, simulation.getRenderConfig());

    gui = new GUI({ title: t('gui.title') });

    // 시뮬레이션 폴더
    const simFolder = gui.addFolder(t('gui.simulation'));
    setupFolderPersistence(simFolder, 'simulation', false);

    simFolder.add(simConfig, 'timeScale', 0, 5, 0.02)
      .name(t('gui.timeScale'))
      .onChange((value: number) => {
        simConfig.timeScale = value;
        simulation.updateConfig({ timeScale: value });
      });

    simFolder.add(simConfig, 'stepScale', 0, 10, 0.1)
      .name(t('gui.stepScale'))
      .onChange((value: number) => {
        simConfig.stepScale = value;
        simulation.updateConfig({ stepScale: value });
      });

    simFolder.add({ pause: false }, 'pause')
      .name(t('gui.paused'))
      .onChange((value: boolean) => {
        if (value) simulation.pause();
        else simulation.resume();
      });

    // 환경 폴더
    const envFolder = gui.addFolder(t('gui.environment'));
    setupFolderPersistence(envFolder, 'environment', true);

    envFolder.add(simConfig, 'resourceGeneration', 0.01, 0.5, 0.002)
      .name(t('gui.resourceGen'))
      .onChange(() => simulation.updateConfig(simConfig));

    envFolder.add(simConfig, 'resourcePatchDriftSpeed', 0, 0.05, 0.001)
      .name(t('gui.resourcePatchDrift'))
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

    envFolder.add(simConfig, 'dangerFromConsumption', 0, 2.0, 0.02)
      .name(t('gui.dangerFromConsumption'))
      .onChange(() => simulation.updateConfig(simConfig));

    envFolder.add(simConfig, 'dangerDiffusionScale', 0, 3.0, 0.02)
      .name(t('gui.dangerDiffusionScale'))
      .onChange(() => simulation.updateConfig(simConfig));

    envFolder.add(simConfig, 'dangerDecay', 0, 0.5, 0.005)
      .name(t('gui.dangerDecay'))
      .onChange(() => simulation.updateConfig(simConfig));

    // 안정화 폴더
    const stabFolder = gui.addFolder(t('gui.stabilizers'));
    setupFolderPersistence(stabFolder, 'stabilizers', true);

    stabFolder.add(simConfig, 'saturationK', 0.05, 20, 0.01)
      .name(t('gui.saturationK'))
      .onChange(() => simulation.updateConfig(simConfig));

    stabFolder.add(simConfig, 'densityPenalty', 0, 5, 0.01)
      .name(t('gui.densityPenalty'))
      .onChange(() => simulation.updateConfig(simConfig));

    // 에너지/섭취 스케일 (UX: 먹고/죽는지 체감)
    const dynamicsFolder = gui.addFolder(t('gui.dynamics'));
    setupFolderPersistence(dynamicsFolder, 'dynamics', true);

    dynamicsFolder.add(simConfig, 'uptakeScale', 0.01, 10.0, 0.01)
      .name(t('gui.uptakeScale'))
      .onChange(() => simulation.updateConfig(simConfig));

    dynamicsFolder.add(simConfig, 'energyCostScale', 0.1, 100.0, 0.1)
      .name(t('gui.energyCostScale'))
      .onChange(() => simulation.updateConfig(simConfig));

    // 시각화 폴더
    const visualFolder = gui.addFolder(t('gui.visualization'));
    setupFolderPersistence(visualFolder, 'visualization', false);

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

    visualFolder.add(renderConfigState, 'showAgents')
      .name(t('gui.showAgents'))
      .onChange(() => simulation.updateRenderConfig(renderConfigState));

    visualFolder.add(simConfig, 'heightScale', 50, 400, 2)
      .name(t('gui.heightScale'))
      .onChange(() => simulation.updateConfig(simConfig));

    visualFolder.add(simConfig, 'agentScale', 0.5, 3, 0.02)
      .name(t('gui.agentScale'))
      .onChange(() => simulation.updateConfig(simConfig));

    // 카메라 폴더
    const cameraFolder = gui.addFolder(t('gui.camera'));
    setupFolderPersistence(cameraFolder, 'camera', true);

    cameraFolder.add({ resetCamera: () => simulation.getCamera().resetToDefault() }, 'resetCamera')
      .name(t('gui.resetCamera'));

    // 설정 폴더
    const settingsFolder = gui.addFolder(t('gui.settings'));
    setupFolderPersistence(settingsFolder, 'settings', false);

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

    // 언어 변경 리스너
    unsubscribe = onLanguageChange(() => {
      buildGUI();
    });

    // 슬라이더 휠 감도 설정 (DOM이 생성된 후 적용)
    requestAnimationFrame(() => {
      setupWheelSensitivity(gui);
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
