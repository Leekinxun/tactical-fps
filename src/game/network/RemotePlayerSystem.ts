import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import type { NetworkPlayerState, TeamId } from "../../shared/protocol";

interface RemoteAvatar {
  root: Mesh;
  material: StandardMaterial;
  targetPosition: Vector3;
  targetYaw: number;
}

export class RemotePlayerSystem {
  private readonly scene: Scene;
  private readonly avatars = new Map<string, RemoteAvatar>();

  constructor(scene: Scene) {
    this.scene = scene;
  }

  apply(players: NetworkPlayerState[], localPlayerId: string, localTeam: TeamId): void {
    const activeIds = new Set(players.filter((player) => player.id !== localPlayerId).map((player) => player.id));
    for (const player of players) {
      if (player.id === localPlayerId) continue;
      let avatar = this.avatars.get(player.id);
      if (!avatar) {
        const root = MeshBuilder.CreateCapsule(`remote-player-${player.id}`, { height: 1.8, radius: 0.42 }, this.scene);
        const material = new StandardMaterial(`remote-player-material-${player.id}`, this.scene);
        material.diffuseColor = Color3.FromHexString("#5b9d83");
        material.emissiveColor = Color3.FromHexString("#0b281f");
        root.material = material;
        root.checkCollisions = false;
        avatar = { root, material, targetPosition: new Vector3(player.position.x, player.position.y - 0.72, player.position.z), targetYaw: player.yaw };
        root.position.copyFrom(avatar.targetPosition);
        this.avatars.set(player.id, avatar);
      }
      avatar.targetPosition.set(player.position.x, player.position.y - 0.72, player.position.z);
      avatar.targetYaw = player.yaw;
      const allied = player.team === localTeam;
      avatar.material.diffuseColor = Color3.FromHexString(allied ? "#5b9d83" : "#d86845");
      avatar.material.emissiveColor = Color3.FromHexString(allied ? "#0b281f" : "#35120d");
      avatar.root.setEnabled(player.alive && player.connected);
    }
    for (const [id, avatar] of this.avatars) {
      if (activeIds.has(id)) continue;
      avatar.root.material?.dispose();
      avatar.root.dispose();
      this.avatars.delete(id);
    }
  }

  update(deltaSeconds: number): void {
    const amount = Math.min(1, deltaSeconds * 12);
    for (const avatar of this.avatars.values()) {
      Vector3.LerpToRef(avatar.root.position, avatar.targetPosition, amount, avatar.root.position);
      avatar.root.rotation.y += normalizeAngle(avatar.targetYaw - avatar.root.rotation.y) * amount;
    }
  }

  clear(): void {
    for (const avatar of this.avatars.values()) {
      avatar.root.material?.dispose();
      avatar.root.dispose();
    }
    this.avatars.clear();
  }
}

function normalizeAngle(value: number): number {
  return Math.atan2(Math.sin(value), Math.cos(value));
}
