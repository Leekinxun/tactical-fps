import { ARENA_BOXES, MAP_NAV_POINTS } from "../../../shared/game-data.mjs";

export interface TacticalPoint {
  id: string;
  x: number;
  y: number;
  z: number;
  neighbors: string[];
}

export const K7_TACTICAL_POINTS: TacticalPoint[] = MAP_NAV_POINTS.map((point) => ({ ...point, neighbors: [...point.neighbors] }));

export class TacticalGraph {
  private readonly points: Map<string, TacticalPoint>;

  constructor(points: TacticalPoint[] = K7_TACTICAL_POINTS) {
    this.points = new Map(points.map((point) => [point.id, point]));
  }

  findPath(start: { x: number; y: number; z: number }, end: { x: number; y: number; z: number }): TacticalPoint[] {
    const startPoint = this.nearest(start);
    const endPoint = this.nearest(end);
    if (!startPoint || !endPoint) return [];
    if (startPoint.id === endPoint.id) return [endPoint];

    const open = new Set([startPoint.id]);
    const cameFrom = new Map<string, string>();
    const cost = new Map<string, number>([[startPoint.id, 0]]);
    const estimate = new Map<string, number>([[startPoint.id, distance(startPoint, endPoint)]]);

    while (open.size) {
      const currentId = [...open].sort((a, b) => (estimate.get(a) ?? Infinity) - (estimate.get(b) ?? Infinity))[0];
      if (currentId === endPoint.id) return this.reconstruct(cameFrom, currentId);
      open.delete(currentId);
      const current = this.points.get(currentId);
      if (!current) continue;
      for (const neighborId of current.neighbors) {
        const neighbor = this.points.get(neighborId);
        if (!neighbor) continue;
        const nextCost = (cost.get(currentId) ?? Infinity) + distance(current, neighbor);
        if (nextCost >= (cost.get(neighborId) ?? Infinity)) continue;
        cameFrom.set(neighborId, currentId);
        cost.set(neighborId, nextCost);
        estimate.set(neighborId, nextCost + distance(neighbor, endPoint));
        open.add(neighborId);
      }
    }
    return [];
  }

  recoveryPoint(position: { x: number; y: number; z: number }, offset = 0): TacticalPoint | null {
    const ordered = [...this.points.values()].sort((a, b) => distance(a, position) - distance(b, position));
    return ordered[Math.min(ordered.length - 1, 1 + (offset % 3))] ?? null;
  }

  private nearest(position: { x: number; y: number; z: number }): TacticalPoint | null {
    const nearest = [...this.points.values()].sort((a, b) => distance(a, position) - distance(b, position));
    return nearest.find((point) => ARENA_BOXES.every((box) => !crossesBox(position, point, box))) ?? nearest[0] ?? null;
  }

  private reconstruct(cameFrom: Map<string, string>, currentId: string): TacticalPoint[] {
    const path: TacticalPoint[] = [];
    let cursor: string | undefined = currentId;
    while (cursor) {
      const point = this.points.get(cursor);
      if (point) path.unshift(point);
      cursor = cameFrom.get(cursor);
    }
    return path;
  }
}

function distance(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function crossesBox(a: { x: number; z: number }, b: { x: number; z: number }, box: (typeof ARENA_BOXES)[number]): boolean {
  const [width, , depth] = box.dimensions;
  const [centerX, , centerZ] = box.position;
  const bounds = [
    [a.x, b.x - a.x, centerX - width / 2, centerX + width / 2],
    [a.z, b.z - a.z, centerZ - depth / 2, centerZ + depth / 2],
  ];
  let entering = 0;
  let exiting = 1;
  for (const [start, delta, minimum, maximum] of bounds) {
    if (Math.abs(delta) < 1e-8) {
      if (start < minimum || start > maximum) return false;
      continue;
    }
    const first = (minimum - start) / delta;
    const second = (maximum - start) / delta;
    entering = Math.max(entering, Math.min(first, second));
    exiting = Math.min(exiting, Math.max(first, second));
    if (entering > exiting) return false;
  }
  return true;
}
