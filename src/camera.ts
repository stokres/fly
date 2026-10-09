// Third-person follow camera. This is where most of the "feel" lives:
//  - spring-damped follow with separate stiffness per axis (lateral / vertical / longitudinal)
//  - soft longitudinal spring, so dives pull away from the camera and climbs catch up
//  - aims at where the creature will be (look-ahead), not where it is
//  - FOV widens with speed, and the camera copies a fraction of the creature's bank
import { MathUtils, PerspectiveCamera, Vector3 } from 'three';
import type { FlightPose } from './flight';
import { tuning } from './tuning';

const UP = new Vector3(0, 1, 0);
const DEG = Math.PI / 180;

/** Height of the ground (terrain or sea) at a point, so the camera never goes under it. */
export type GroundQuery = (x: number, z: number) => number;

export class FollowCamera {
  readonly camera: PerspectiveCamera;
  private readonly vel = new Vector3();
  private roll = 0;
  private fov: number;

  // Scratch vectors, reused every frame.
  private readonly fwd = new Vector3();
  private readonly right = new Vector3();
  private readonly up = new Vector3();
  private readonly desired = new Vector3();
  private readonly err = new Vector3();
  private readonly accel = new Vector3();
  /** Camera velocity relative to the creature's: damping acts on this, so a steady flight has
   *  no lag at any speed and only changes of speed pull the camera back or push it in. */
  private readonly relVel = new Vector3();
  private readonly targetVel = new Vector3();
  private readonly look = new Vector3();

  constructor(aspect: number) {
    this.fov = tuning.camera.fovMin;
    this.camera = new PerspectiveCamera(this.fov, aspect, 0.5, 12000);
  }

  /** Jump straight to the resting position behind the creature (no spring motion). */
  snap(pose: FlightPose, velocity: Vector3, speed: number): void {
    this.computeDesired(pose, speed);
    this.camera.position.copy(this.desired);
    this.vel.copy(velocity);
    this.roll = pose.bank * tuning.camera.rollFactor;
    this.fov = this.targetFov(speed);
    this.apply(pose, velocity);
  }

  /** 0..1 extra intensity from boosting / riding a current (wider FOV, more shake). */
  rush = 0;
  private shakeTime = 0;

  update(dt: number, pose: FlightPose, velocity: Vector3, speed: number, groundAt: GroundQuery): void {
    const c = tuning.camera;
    this.computeDesired(pose, speed);

    // Per-axis damped spring in the creature's heading frame. Semi-implicit Euler;
    // substeps keep stiff springs stable on long frames.
    const steps = Math.max(1, Math.ceil(dt * 120));
    const h = dt / steps;
    this.targetVel.copy(velocity);
    for (let i = 0; i < steps; i++) {
      this.err.subVectors(this.desired, this.camera.position);
      this.relVel.subVectors(this.vel, this.targetVel);
      this.accel.set(0, 0, 0);
      this.addAxis(this.right, c.lateralHz, c.lateralDamping);
      this.addAxis(this.up, c.verticalHz, c.verticalDamping);
      this.addAxis(this.fwd, c.longitudinalHz, c.longitudinalDamping);
      this.vel.addScaledVector(this.accel, h);
      this.camera.position.addScaledVector(this.vel, h);
    }

    // Stay above the ground: ride up over slopes instead of clipping into them.
    const cam = this.camera.position;
    const floor = groundAt(cam.x, cam.z) + c.groundClearance;
    if (cam.y < floor) {
      cam.y = floor;
      this.vel.y = Math.max(0, this.vel.y);
    }

    this.roll = MathUtils.lerp(this.roll, pose.bank * c.rollFactor, 1 - Math.exp(-c.rollResponse * dt));
    this.fov = MathUtils.lerp(this.fov, this.targetFov(speed) + this.rush * c.boostFov, 1 - Math.exp(-c.fovResponse * dt));
    this.apply(pose, velocity);
    // Speed shake: a fine tremble that grows with speed and rush, never at a cruise.
    this.shakeTime += dt;
    const amp = c.shake * (MathUtils.smoothstep(speed, 55, 110) * 0.5 + this.rush * 0.35) * DEG;
    if (amp > 0) {
      const t = this.shakeTime;
      this.camera.rotateX((Math.sin(t * 37.1) + Math.sin(t * 23.7 + 1.3)) * amp);
      this.camera.rotateY((Math.sin(t * 31.3 + 0.7) + Math.sin(t * 19.1 + 2.1)) * amp);
    }
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  private computeDesired(pose: FlightPose, speed: number): void {
    const c = tuning.camera;
    const cp = Math.cos(pose.pitch);
    this.fwd.set(-Math.sin(pose.yaw) * cp, Math.sin(pose.pitch), -Math.cos(pose.yaw) * cp);
    this.right.crossVectors(this.fwd, UP).normalize();
    this.up.crossVectors(this.right, this.fwd);

    const extra = Math.max(0, speed - tuning.flight.startSpeed) * c.distancePerSpeed;
    this.desired
      .copy(pose.position)
      .addScaledVector(this.fwd, -(c.distance + extra))
      .addScaledVector(UP, c.height);
  }

  private addAxis(axis: Vector3, hz: number, damping: number): void {
    const w = 2 * Math.PI * hz;
    const a = w * w * this.err.dot(axis) - 2 * damping * w * this.relVel.dot(axis);
    this.accel.addScaledVector(axis, a);
  }

  private targetFov(speed: number): number {
    const c = tuning.camera;
    const t = MathUtils.smoothstep(speed, c.fovSpeedMin, c.fovSpeedMax);
    return MathUtils.lerp(c.fovMin, c.fovMax, t);
  }

  private apply(pose: FlightPose, velocity: Vector3): void {
    const c = tuning.camera;
    this.look
      .copy(pose.position)
      .addScaledVector(velocity, c.lookAhead)
      .addScaledVector(UP, c.lookHeight);
    this.camera.up.copy(UP);
    this.camera.lookAt(this.look);
    // Camera looks down -Z like the creature, so the same sign convention applies.
    this.camera.rotateZ(-this.roll);
    if (Math.abs(this.camera.fov - this.fov) > 1e-3) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }
}
