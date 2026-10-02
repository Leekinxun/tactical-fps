import { describe, expect, it } from "vitest";
import { ARENA_BOUNDS, ARENA_BOXES, BOMB_SITES, MAP_ZONES, PROTOCOL_VERSION, TEAM_SPAWNS } from "../../src/shared/game-data.mjs";
import { K7_TACTICAL_POINTS, TacticalGraph } from "../../src/game/ai/navigation/TacticalGraph";

const radius = 0.42;

function insideCollider(x: number, z: number, padding = radius): boolean {
  return ARENA_BOXES.some((box) => {
    const [width, , depth] = box.dimensions;
    const [centerX, , centerZ] = box.position;
    return Math.abs(x - centerX) <= width / 2 + padding && Math.abs(z - centerZ) <= depth / 2 + padding;
  });
}

function segmentBlocked(a: { x: number; z: number }, b: { x: number; z: number }): boolean {
  const steps = Math.ceil(Math.hypot(a.x - b.x, a.z - b.z) / 0.25);
  for (let step = 1; step < steps; step += 1) {
    const ratio = step / steps;
    if (insideCollider(a.x + (b.x - a.x) * ratio, a.z + (b.z - a.z) * ratio, 0)) return true;
  }
  return false;
}

function pathDistance(path: { x: number; z: number }[], start: { x: number; z: number }, end: { x: number; z: number }): number {
  const points = [start, ...path, end];
  return points.slice(1).reduce((total, point, index) => {
    const previous = points[index];
    return total + Math.hypot(point.x - previous.x, point.z - previous.z);
  }, 0);
}

function graphWithout(blockedIds: string[]): TacticalGraph {
  const blocked = new Set(blockedIds);
  return new TacticalGraph(
    K7_TACTICAL_POINTS.filter((point) => !blocked.has(point.id))
      .map((point) => ({ ...point, neighbors: point.neighbors.filter((neighbor) => !blocked.has(neighbor)) })),
  );
}

describe("K-7 competitive arena layout", () => {
  it("provides a larger 128 by 144 meter floor and ten safe spawn slots", () => {
    expect(PROTOCOL_VERSION).toBe(5);
    expect(ARENA_BOUNDS.groundWidth).toBe(128);
    expect(ARENA_BOUNDS.groundDepth).toBe(144);
    for (const team of ["alpha", "bravo"] as const) {
      expect(TEAM_SPAWNS[team]).toHaveLength(5);
      for (const spawn of TEAM_SPAWNS[team]) {
        expect(spawn.x).toBeGreaterThan(ARENA_BOUNDS.minX + ARENA_BOUNDS.playerPadding);
        expect(spawn.x).toBeLessThan(ARENA_BOUNDS.maxX - ARENA_BOUNDS.playerPadding);
        expect(spawn.z).toBeGreaterThan(ARENA_BOUNDS.minZ + ARENA_BOUNDS.playerPadding);
        expect(spawn.z).toBeLessThan(ARENA_BOUNDS.maxZ - ARENA_BOUNDS.playerPadding);
        expect(insideCollider(spawn.x, spawn.z)).toBe(false);
      }
    }
  });

  it("keeps both bomb-site centers open, separated, and described for radar zones", () => {
    expect(BOMB_SITES.A).toMatchObject({ x: -40, z: 22, radius: 5.5 });
    expect(BOMB_SITES.B).toMatchObject({ x: 38, z: 18, radius: 5.5 });
    expect(Math.hypot(BOMB_SITES.A.x - BOMB_SITES.B.x, BOMB_SITES.A.z - BOMB_SITES.B.z)).toBeGreaterThan(70);
    for (const site of Object.values(BOMB_SITES)) {
      expect(insideCollider(site.x, site.z, 1.5)).toBe(false);
    }
    expect(MAP_ZONES.map((zone) => zone.label)).toEqual(expect.arrayContaining([
      "进攻方集结区",
      "防守方后场",
      "A长通",
      "锅炉连廊",
      "中央设备区",
      "B仓库外场",
      "B装卸大厅",
      "A-B连接道",
    ]));
  });

  it("blocks direct spawn-to-spawn sight while keeping alternate routes to both sites", () => {
    for (const attacker of TEAM_SPAWNS.alpha) {
      for (const defender of TEAM_SPAWNS.bravo) expect(segmentBlocked(attacker, defender)).toBe(true);
    }

    for (const blockedNodes of [["W2"], ["E2"], ["ML1", "MR1"], ["ML3", "MR3"]]) {
      const graph = graphWithout(blockedNodes);
      for (const site of Object.values(BOMB_SITES)) {
        expect(graph.findPath(TEAM_SPAWNS.alpha[0], site).length).toBeGreaterThan(3);
        expect(graph.findPath(TEAM_SPAWNS.bravo[0], site).length).toBeGreaterThan(3);
      }
    }
  });

  it("keeps CS-style rotations within round timing targets", () => {
    const graph = new TacticalGraph();
    const alphaToA = pathDistance(graph.findPath(TEAM_SPAWNS.alpha[0], BOMB_SITES.A), TEAM_SPAWNS.alpha[0], BOMB_SITES.A);
    const alphaToB = pathDistance(graph.findPath(TEAM_SPAWNS.alpha[4], BOMB_SITES.B), TEAM_SPAWNS.alpha[4], BOMB_SITES.B);
    const bravoToA = pathDistance(graph.findPath(TEAM_SPAWNS.bravo[0], BOMB_SITES.A), TEAM_SPAWNS.bravo[0], BOMB_SITES.A);
    const bravoToB = pathDistance(graph.findPath(TEAM_SPAWNS.bravo[4], BOMB_SITES.B), TEAM_SPAWNS.bravo[4], BOMB_SITES.B);
    const rotateAB = pathDistance(graph.findPath(BOMB_SITES.A, BOMB_SITES.B), BOMB_SITES.A, BOMB_SITES.B);

    expect(alphaToA).toBeGreaterThanOrEqual(90);
    expect(alphaToA).toBeLessThanOrEqual(135);
    expect(alphaToB).toBeGreaterThanOrEqual(90);
    expect(alphaToB).toBeLessThanOrEqual(135);
    expect(bravoToA).toBeGreaterThanOrEqual(50);
    expect(bravoToA).toBeLessThanOrEqual(85);
    expect(bravoToB).toBeGreaterThanOrEqual(45);
    expect(bravoToB).toBeLessThanOrEqual(85);
    expect(rotateAB).toBeGreaterThanOrEqual(75);
    expect(rotateAB).toBeLessThanOrEqual(95);
  });

  it("keeps both bomb sites reachable after either primary rotation is closed", () => {
    for (const blockedNodes of [["A", "ML3"], ["B", "MR3"]]) {
      const graph = graphWithout(blockedNodes);
      const alternateTarget = blockedNodes[0] === "A" ? BOMB_SITES.B : BOMB_SITES.A;
      expect(graph.findPath(TEAM_SPAWNS.alpha[2], alternateTarget).length).toBeGreaterThan(4);
      expect(graph.findPath(TEAM_SPAWNS.bravo[2], alternateTarget).length).toBeGreaterThan(4);
    }
  });
});
