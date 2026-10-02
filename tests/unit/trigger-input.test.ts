import { afterEach, describe, expect, it, vi } from "vitest";
import { Game } from "../../src/game/Game";

afterEach(() => vi.unstubAllGlobals());

function pointer(type: string, button = 0): Event {
  const event = new Event(type);
  Object.defineProperty(event, "button", { value: button });
  return event;
}

function harness(active: boolean) {
  const canvas = new EventTarget();
  const windowTarget = new EventTarget();
  vi.stubGlobal("window", windowTarget);
  const game = Object.create(Game.prototype);
  const fire = vi.fn();
  Object.assign(game, { canvas, fire, mouseHeld: false, canAct: () => active });
  game.bindInput();
  return { canvas, windowTarget, game, fire };
}

describe("pointer trigger input", () => {
  it("fires once on primary pointer down and stops a held burst on release or cancellation", () => {
    const { canvas, windowTarget, game, fire } = harness(true);
    canvas.dispatchEvent(pointer("pointerdown"));
    expect(fire).toHaveBeenCalledTimes(1);
    expect(game.mouseHeld).toBe(true);
    windowTarget.dispatchEvent(pointer("pointerup"));
    expect(game.mouseHeld).toBe(false);
    canvas.dispatchEvent(pointer("pointerdown"));
    windowTarget.dispatchEvent(pointer("pointercancel"));
    expect(game.mouseHeld).toBe(false);
  });

  it("does not latch the trigger in menus or for secondary pointer buttons", () => {
    const paused = harness(false);
    paused.canvas.dispatchEvent(pointer("pointerdown"));
    expect(paused.fire).not.toHaveBeenCalled();
    expect(paused.game.mouseHeld).toBe(false);
    const active = harness(true);
    active.canvas.dispatchEvent(pointer("pointerdown", 2));
    expect(active.fire).not.toHaveBeenCalled();
    expect(active.game.mouseHeld).toBe(false);
  });
});
