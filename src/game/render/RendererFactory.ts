import { Engine } from "@babylonjs/core/Engines/engine";
import { WebGPUEngine } from "@babylonjs/core/Engines/webgpuEngine";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";

export type RendererBackend = "WebGPU" | "WebGL2";

export interface RendererResult {
  engine: AbstractEngine;
  backend: RendererBackend;
  fallbackReason?: string;
}

export async function createRenderer(canvas: HTMLCanvasElement): Promise<RendererResult> {
  if (await WebGPUEngine.IsSupportedAsync) {
    try {
      const engine = new WebGPUEngine(canvas, {
        antialias: true,
        adaptToDeviceRatio: true,
      });
      await engine.initAsync();
      return { engine, backend: "WebGPU" };
    } catch (error) {
      const fallbackReason = error instanceof Error ? error.message : "WebGPU initialization failed";
      return {
        engine: createWebGlEngine(canvas),
        backend: "WebGL2",
        fallbackReason,
      };
    }
  }

  return {
    engine: createWebGlEngine(canvas),
    backend: "WebGL2",
    fallbackReason: "WebGPU is not available in this browser.",
  };
}

function createWebGlEngine(canvas: HTMLCanvasElement): Engine {
  const engine = new Engine(canvas, true, {
    preserveDrawingBuffer: false,
    stencil: true,
    disableWebGL2Support: false,
    powerPreference: "high-performance",
  });

  if (engine.webGLVersion < 2) {
    engine.dispose();
    throw new Error("需要支持 WebGL2 或 WebGPU 的现代浏览器。");
  }

  return engine;
}
