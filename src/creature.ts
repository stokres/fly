// Placeholder creature: a box with two wing slabs, so bank and wingbeats are readable.
// Will be replaced by the real model with procedural wings (see CLAUDE.md roadmap).
import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from 'three';
import type { FlightPose } from './flight';
import { PALETTE } from './palette';

export class Creature {
  readonly object = new Group();
  private readonly leftWing: Group;
  private readonly rightWing: Group;
  private beat = 1; // 0..1 progress through the current wingbeat, 1 = idle
  private lastFlapCount = 0;

  constructor() {
    const body = new Mesh(
      new BoxGeometry(0.5, 0.35, 1.4),
      new MeshStandardMaterial({ color: PALETTE.bone, flatShading: true }),
    );
    this.object.add(body);

    const wingGeo = new BoxGeometry(1.6, 0.06, 0.7);
    wingGeo.translate(0.8, 0, 0); // hinge at the body
    const wingMat = new MeshStandardMaterial({ color: PALETTE.ember, flatShading: true });
    this.rightWing = new Group();
    this.rightWing.add(new Mesh(wingGeo, wingMat));
    this.rightWing.position.set(0.25, 0.05, 0.05);
    this.leftWing = new Group();
    this.leftWing.add(new Mesh(wingGeo, wingMat));
    this.leftWing.position.set(-0.25, 0.05, 0.05);
    this.leftWing.scale.x = -1;
    this.object.add(this.rightWing, this.leftWing);

    this.object.rotation.order = 'YXZ';
  }

  update(dt: number, pose: FlightPose, flapCount: number): void {
    this.object.position.copy(pose.position);
    this.object.rotation.set(pose.pitch, pose.yaw, -pose.bank);

    if (flapCount !== this.lastFlapCount) {
      this.lastFlapCount = flapCount;
      this.beat = 0;
    }
    this.beat = Math.min(1, this.beat + dt / 0.4);
    const angle = Math.sin(this.beat * Math.PI * 2) * 0.7 * (1 - this.beat);
    this.rightWing.rotation.z = angle;
    this.leftWing.rotation.z = -angle;
  }
}
