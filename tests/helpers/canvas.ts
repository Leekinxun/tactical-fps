export function ensureCanvasGlobals(): void {
  if (!globalThis.ImageData) {
    globalThis.ImageData = class ImageData {
      data: Uint8ClampedArray;
      width: number;
      height: number;

      constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
        this.data = new Uint8ClampedArray(width * height * 4);
      }
    } as unknown as typeof ImageData;
  }
  if (!globalThis.OffscreenCanvas) {
    globalThis.OffscreenCanvas = class OffscreenCanvas {
      width: number;
      height: number;

      constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
      }

      getContext(): OffscreenCanvasRenderingContext2D {
        return {
          fillStyle: "#000000",
          font: "12px Arial",
          globalAlpha: 1,
          lineWidth: 1,
          strokeStyle: "#000000",
          beginPath: () => undefined,
          clearRect: () => undefined,
          createRadialGradient: () => ({ addColorStop: () => undefined }),
          fillRect: () => undefined,
          fillText: () => undefined,
          lineTo: () => undefined,
          moveTo: () => undefined,
          putImageData: () => undefined,
          setLineDash: () => undefined,
          stroke: () => undefined,
          strokeRect: () => undefined,
        } as unknown as OffscreenCanvasRenderingContext2D;
      }
    } as unknown as typeof OffscreenCanvas;
  }
}
