import { describe, expect, it } from "vitest";
import { TacticalGraph } from "../../src/game/ai/navigation/TacticalGraph";

describe("TacticalGraph", () => {
  it("routes between opposite lanes through connected tactical points", () => {
    const graph = new TacticalGraph();
    const path = graph.findPath({ x: -12, y: 0, z: -12 }, { x: 12, y: 0, z: 15 });
    expect(path.length).toBeGreaterThan(2);
    expect(path[0]?.id).toBe("left-entry");
    expect(path.at(-1)?.id).toBe("right-north");
  });

  it("provides a nearby but distinct recovery point", () => {
    const graph = new TacticalGraph();
    const point = graph.recoveryPoint({ x: 0, y: 0, z: -14 });
    expect(point).not.toBeNull();
    expect(point?.id).not.toBe("spawn");
  });
});
