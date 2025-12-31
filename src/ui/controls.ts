/**
 * @fileoverview lil-gui 기반 파라미터 컨트롤
 */

import GUI from 'lil-gui';
import { Simulation } from '../core/simulation';
import { SimulationConfig, RenderConfig, DEFAULT_CONFIG, DEFAULT_RENDER_CONFIG } from '../types/config';

export interface Controls {
  gui: GUI;
  destroy(): void;
}

export function createControls(simulation: Simulation): Controls {
  const gui = new GUI({ title: 'Ecosystem Simulation' });

  // 시뮬레이션 설정
  const simConfig: Partial<SimulationConfig> = { ...DEFAULT_CONFIG };
  const renderConfigState: RenderConfig = { ...DEFAULT_RENDER_CONFIG };

  // 시뮬레이션 폴더
  const simFolder = gui.addFolder('Simulation');

  simFolder.add({ timeScale: simConfig.timeScale! }, 'timeScale', 0, 5, 0.1)
    .name('Time Scale')
    .onChange((value: number) => simulation.setTimeScale(value));

  simFolder.add({ pause: false }, 'pause')
    .name('Paused')
    .onChange((value: boolean) => {
      if (value) simulation.pause();
      else simulation.resume();
    });

  // 환경 폴더
  const envFolder = gui.addFolder('Environment');

  envFolder.add(simConfig, 'resourceGeneration', 0.01, 0.5, 0.01)
    .name('Resource Gen')
    .onChange(() => simulation.updateConfig(simConfig));

  envFolder.add(simConfig, 'diffusionRate', 0, 0.5, 0.01)
    .name('Diffusion')
    .onChange(() => simulation.updateConfig(simConfig));

  envFolder.add(simConfig, 'decayRate', 0, 0.1, 0.005)
    .name('Decay')
    .onChange(() => simulation.updateConfig(simConfig));

  envFolder.add(simConfig, 'pheromoneDecay', 0, 0.2, 0.01)
    .name('Pheromone Decay')
    .onChange(() => simulation.updateConfig(simConfig));

  // 안정화 폴더
  const stabFolder = gui.addFolder('Stabilizers');

  stabFolder.add(simConfig, 'saturationK', 0.1, 5, 0.1)
    .name('Saturation K')
    .onChange(() => simulation.updateConfig(simConfig));

  stabFolder.add(simConfig, 'densityPenalty', 0, 1, 0.05)
    .name('Density Penalty')
    .onChange(() => simulation.updateConfig(simConfig));

  // 에너지/섭취 스케일 (UX: 먹고/죽는지 체감)
  const dynamicsFolder = gui.addFolder('Dynamics');

  dynamicsFolder.add(simConfig, 'uptakeScale', 0.05, 2.0, 0.05)
    .name('Uptake Scale')
    .onChange(() => simulation.updateConfig(simConfig));

  dynamicsFolder.add(simConfig, 'energyCostScale', 0.5, 20.0, 0.5)
    .name('Energy Cost Scale')
    .onChange(() => simulation.updateConfig(simConfig));

  // 시각화 폴더
  const visualFolder = gui.addFolder('Visualization');

  visualFolder.add(renderConfigState, 'showResource')
    .name('Show Resource')
    .onChange(() => simulation.updateRenderConfig(renderConfigState));

  visualFolder.add(renderConfigState, 'showDanger')
    .name('Show Danger')
    .onChange(() => simulation.updateRenderConfig(renderConfigState));

  visualFolder.add(renderConfigState, 'showPheromone')
    .name('Show Pheromone')
    .onChange(() => simulation.updateRenderConfig(renderConfigState));

  visualFolder.add(renderConfigState, 'showTrails')
    .name('Show Trails')
    .onChange(() => simulation.updateRenderConfig(renderConfigState));

  visualFolder.add(simConfig, 'heightScale', 50, 400, 10)
    .name('Height Scale')
    .onChange(() => simulation.updateConfig(simConfig));

  visualFolder.add(simConfig, 'agentScale', 0.5, 3, 0.1)
    .name('Agent Scale')
    .onChange(() => simulation.updateConfig(simConfig));

  // 카메라 폴더
  const cameraFolder = gui.addFolder('Camera');

  cameraFolder.add({ resetCamera: () => simulation.getCamera().resetToDefault() }, 'resetCamera')
    .name('Reset Camera (Home)');

  // 일부 폴더 닫기
  envFolder.close();
  stabFolder.close();
  dynamicsFolder.close();
  cameraFolder.close();

  function destroy(): void {
    gui.destroy();
  }

  return { gui, destroy };
}
