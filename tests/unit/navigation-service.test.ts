import { describe, expect, it } from "vitest";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { NavigationService } from "../../src/game/ai/navigation/NavigationService";
import { BOMB_SITES, TEAM_SPAWNS } from "../../src/shared/game-data.mjs";

describe("long arena navigation", () => {
  it("falls back to the tactical graph when Recast stops before the destination", () => {
    const nav = new NavigationService();
    const start = Vector3.FromArray([TEAM_SPAWNS.alpha[0].x, 0, TEAM_SPAWNS.alpha[0].z]);
    const site = BOMB_SITES.B;
    const end = new Vector3(site.x, 0, site.z);
    const truncated = [start.clone(), start.add(new Vector3(0, 0, 2))];
    Reflect.set(nav, "plugin", { computePathSmooth: () => truncated });
    const path = nav.findPath(start, end);
    expect(path.length).toBeGreaterThan(2);
    expect(path.at(-1)?.x).toBe(site.x);
    expect(path.at(-1)?.z).toBe(site.z);
  });
});
