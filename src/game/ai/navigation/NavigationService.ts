import { CreateNavigationPluginAsync, type RecastNavigationJSPluginV2 } from "@babylonjs/addons/navigation";
import * as RecastCore from "@recast-navigation/core";
import * as RecastGenerators from "@recast-navigation/generators";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import { TacticalGraph } from "./TacticalGraph";

export type NavigationMode = "RECAST" | "TACTICAL_GRAPH";

export class NavigationService {
  mode: NavigationMode = "TACTICAL_GRAPH";
  private plugin: RecastNavigationJSPluginV2 | null = null;
  private readonly graph = new TacticalGraph();

  async initialize(scene: Scene): Promise<void> {
    try {
      await RecastCore.init();
      const instance = { ...RecastCore, ...RecastGenerators };
      const plugin = await CreateNavigationPluginAsync({ instance });
      const navigationMeshes = scene.meshes.filter((mesh): mesh is Mesh => mesh.checkCollisions);
      const result = await plugin.createNavMeshAsync(navigationMeshes, {
        cs: 0.35,
        ch: 0.2,
        walkableSlopeAngle: 42,
        walkableHeight: 9,
        walkableClimb: 3,
        walkableRadius: 2,
        maxEdgeLen: 24,
        maxSimplificationError: 1.2,
        minRegionArea: 12,
        mergeRegionArea: 32,
        maxVertsPerPoly: 6,
        detailSampleDist: 4,
        detailSampleMaxError: 1,
        maxObstacles: 0,
      });
      if (!result) throw new Error("Navigation mesh generation returned no result.");
      plugin.setDefaultQueryExtent(new Vector3(3, 5, 3));
      this.plugin = plugin;
      this.mode = "RECAST";
    } catch {
      this.plugin = null;
      this.mode = "TACTICAL_GRAPH";
    }
  }

  findPath(start: Vector3, end: Vector3): Vector3[] {
    if (this.plugin) {
      try {
        const path = this.plugin.computePathSmooth(start, end, { maxSmoothPathPoints: 96, stepSize: 0.65, slop: 0.08 });
        if (path.length > 1) return path;
      } catch {
        // Fall through to the deterministic tactical graph.
      }
    }
    return this.graph.findPath(start, end).map((point) => new Vector3(point.x, point.y, point.z));
  }

  recoveryPoint(position: Vector3, botIndex: number): Vector3 {
    const point = this.graph.recoveryPoint(position, botIndex);
    return point ? new Vector3(point.x, point.y, point.z) : position.clone();
  }
}
