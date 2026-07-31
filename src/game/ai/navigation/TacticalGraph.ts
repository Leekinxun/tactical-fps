export interface TacticalPoint {
  id: string;
  x: number;
  y: number;
  z: number;
  neighbors: string[];
}

export const K7_TACTICAL_POINTS: TacticalPoint[] = [
  { id: "spawn", x: 0, y: 0, z: -14, neighbors: ["left-entry", "right-entry", "center-south"] },
  { id: "left-entry", x: -11, y: 0, z: -12, neighbors: ["spawn", "left-mid"] },
  { id: "right-entry", x: 11, y: 0, z: -12, neighbors: ["spawn", "right-mid"] },
  { id: "center-south", x: 0, y: 0, z: -7, neighbors: ["spawn", "center"] },
  { id: "left-mid", x: -12, y: 0, z: 1, neighbors: ["left-entry", "left-north", "center"] },
  { id: "right-mid", x: 12, y: 0, z: 1, neighbors: ["right-entry", "right-north", "center"] },
  { id: "center", x: 0, y: 0, z: 2, neighbors: ["center-south", "left-mid", "right-mid", "center-north"] },
  { id: "left-north", x: -12, y: 0, z: 15, neighbors: ["left-mid", "north"] },
  { id: "right-north", x: 12, y: 0, z: 15, neighbors: ["right-mid", "north"] },
  { id: "center-north", x: 0, y: 0, z: 12, neighbors: ["center", "north"] },
  { id: "north", x: 0, y: 0, z: 21, neighbors: ["left-north", "right-north", "center-north"] },
];

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
    let best: TacticalPoint | null = null;
    let bestDistance = Infinity;
    for (const point of this.points.values()) {
      const candidate = distance(point, position);
      if (candidate < bestDistance) {
        best = point;
        bestDistance = candidate;
      }
    }
    return best;
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
