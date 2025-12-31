/**
 * @fileoverview 메인 엔트리포인트
 * WebGPU 생태계 시뮬레이션
 */

import { initWebGPU } from './core/gpu-context';
import { createSimulation } from './core/simulation';
import { createControls } from './ui/controls';
import { createInteraction } from './ui/interaction';
import { createStats } from './ui/stats';

async function main(): Promise<void> {
  const canvas = document.getElementById('canvas') as HTMLCanvasElement;
  const statsElement = document.getElementById('stats') as HTMLElement;
  const errorElement = document.getElementById('error') as HTMLElement;

  try {
    // WebGPU 초기화
    console.log('Initializing WebGPU...');
    const gpuContext = await initWebGPU(canvas);
    console.log('WebGPU initialized successfully');

    // 시뮬레이션 생성
    console.log('Creating simulation...');
    const simulation = createSimulation(gpuContext);

    // UI 초기화
    const controls = createControls(simulation);
    const interaction = createInteraction(canvas, simulation.getCamera());
    const stats = createStats(simulation, statsElement);

    // 시뮬레이션 시작
    console.log('Starting simulation...');
    simulation.start();

    // 디버그 정보
    console.log('Simulation running');
    console.log('Controls:');
    console.log('  - Left drag: Pan');
    console.log('  - Right drag: Rotate');
    console.log('  - Scroll: Zoom');
    console.log('  - WASD/Arrows: Move');

    // 정리 (페이지 이탈 시)
    window.addEventListener('beforeunload', () => {
      simulation.stop();
      controls.destroy();
      interaction.destroy();
      stats.destroy();
    });

  } catch (error) {
    console.error('Failed to initialize:', error);

    // 에러 표시
    if (error instanceof Error && error.message.includes('WebGPU')) {
      errorElement.classList.add('visible');
    } else {
      errorElement.innerHTML = `
        <h3>Initialization Error</h3>
        <p>${error instanceof Error ? error.message : 'Unknown error'}</p>
      `;
      errorElement.classList.add('visible');
    }
  }
}

// 시작
main().catch(console.error);
