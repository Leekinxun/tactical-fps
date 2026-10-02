import { describe, expect, it } from "vitest";
import { K7_TACTICAL_POINTS, TacticalGraph } from "../../src/game/ai/navigation/TacticalGraph";
import { ARENA_BOXES, BOMB_SITES } from "../../src/shared/game-data.mjs";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { BotController } from "../../src/game/ai/BotController";
import type { NavigationService } from "../../src/game/ai/navigation/NavigationService";

describe("TacticalGraph", () => {
  it("routes between opposite lanes through connected tactical points", () => {
    const graph = new TacticalGraph();
    const path = graph.findPath({ x: -48, y: 0, z: -32 }, { x: 42, y: 0, z: 36 });
    expect(path.length).toBeGreaterThan(5);
    expect(path[0]?.id).toBe("W1");
    expect(path.at(-1)?.id).toBe("E4");
    expect(path.some((point) => Math.abs(point.x) < 12)).toBe(true);
  });

  it("chooses a first waypoint on the same side of a solid wall", () => {
    const graph = new TacticalGraph();
    const path = graph.findPath({ x: -10, y: 0, z: 8 }, BOMB_SITES.A);
    expect(path[0]?.x).toBeGreaterThan(-18);
    expect(path.at(-1)?.id).toBe("A");
  });

  it("enters the B warehouse through all three modeled doors", () => {
    const graph = new TacticalGraph();
    const south = graph.findPath({ x: 44, y: 0, z: -12 }, BOMB_SITES.B);
    const west = graph.findPath({ x: 10, y: 0, z: 24 }, BOMB_SITES.B);
    const north = graph.findPath({ x: 42, y: 0, z: 42 }, BOMB_SITES.B);
    expect(south.map((point) => point.id)).toEqual(expect.arrayContaining(["E3", "B"]));
    expect(west.map((point) => point.id)).toEqual(expect.arrayContaining(["MR3", "B"]));
    expect(north.map((point) => point.id)).toEqual(expect.arrayContaining(["E4", "B"]));
  });

  it("keeps every fallback edge clear of arena boxes in ground projection", () => {
    const byId = new Map(K7_TACTICAL_POINTS.map((point) => [point.id, point]));
    const checked = new Set<string>();
    for (const point of K7_TACTICAL_POINTS) {
      for (const neighborId of point.neighbors) {
        const neighbor = byId.get(neighborId);
        expect(neighbor, `${point.id} -> ${neighborId} exists`).toBeDefined();
        expect(neighbor?.neighbors, `${point.id} <-> ${neighborId} is bidirectional`).toContain(point.id);
        if (!neighbor) continue;
        const edge = [point.id, neighborId].sort().join("|");
        if (checked.has(edge)) continue;
        checked.add(edge);
        const samples = Math.ceil(Math.hypot(point.x - neighbor.x, point.z - neighbor.z) * 10);
        let blockage: string | undefined;
        for (let sample = 0; sample <= samples && !blockage; sample += 1) {
          const fraction = sample / samples;
          const x = point.x + (neighbor.x - point.x) * fraction;
          const z = point.z + (neighbor.z - point.z) * fraction;
          for (const box of ARENA_BOXES) {
            const [width, , depth] = box.dimensions;
            const [centerX, , centerZ] = box.position;
            const inside = Math.abs(x - centerX) <= width / 2 + 0.42 && Math.abs(z - centerZ) <= depth / 2 + 0.42;
            if (inside) { blockage = `${edge} crosses ${box.name} near (${x.toFixed(1)}, ${z.toFixed(1)})`; break; }
          }
        }
        expect(blockage).toBeUndefined();
      }
    }
    expect(checked.size).toBeGreaterThanOrEqual(44);
  });

  it("provides a nearby but distinct recovery point", () => {
    const graph = new TacticalGraph();
    const point = graph.recoveryPoint({ x: 0, y: 0, z: -61 });
    expect(point).not.toBeNull();
    expect(point?.id).not.toBe("T");
  });

  it("blocks the final bot step when a scene collider is in front", () => {
    const origin = new Vector3(0, 1, -42);
    const actor = { root: { position: origin.clone() }, origin, alive: true, health: 100, phase: 0 };
    let blocked = true;
    let testedCollider = false;
    const scene = {
      pickWithRay: (_ray: unknown, predicate: (mesh: { checkCollisions: boolean }) => boolean) => {
        testedCollider = predicate({ checkCollisions: true });
        return blocked ? { hit: true, distance: 0.02 } : null;
      },
    };
    const navigation = { findPath: () => [new Vector3(0, 1, -34)], recoveryPoint: () => origin.clone() };
    const bot = new BotController({
      index: 0,
      actor: actor as unknown as ConstructorParameters<typeof BotController>[0]["actor"],
      scene: scene as unknown as ConstructorParameters<typeof BotController>[0]["scene"],
      navigation: navigation as unknown as NavigationService,
      onFire: () => undefined,
    });
    bot.setObjective(new Vector3(0, 1, -34), "advance");
    bot.update(0.05, 0, new Vector3(0, 1, 42), false);
    expect(testedCollider).toBe(true);
    expect(actor.root.position.z).toBe(-42);
    blocked = false;
    bot.update(0.05, 50, new Vector3(0, 1, 42), false);
    expect(actor.root.position.z).toBeGreaterThan(-42);
  });
});
