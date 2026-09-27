// Arcade flight model. Readable behavior over physical accuracy:
//  - pitch trades altitude for speed (gravity along the path), drag grows with speed²
//  - turning comes from bank; turn rate scales with lift (speed²), capped at cruise
//  - below stall speed the nose drops and sink grows, which forces a dive to recover
//  - flapping costs energy and has a cooldown, so gliding is the default state
//
// Conventions: meters, seconds, radians. Forward is -Z. yaw > 0 turns left,
// pitch > 0 is nose up, bank > 0 is right wing down.
import { Vector3 } from 'three';
import type { FlightInput } from './input';
import { tuning } from './tuning';

const DEG = Math.PI / 180;

export interface FlightPose {
  position: Vector3;
  yaw: number;
  pitch: number;
  bank: number;
}

export class Flight {
  readonly position = new Vector3();
  yaw = 0;
  pitch = 0;
  bank = 0;
  /** Airspeed along the forward axis. */
  speed = 0;
  /** Upward velocity from flaps, decays over time. */
  climb = 0;
  /** Current sink rate (m/s, positive = down). */
  sink = 0;
  /** Rising air at the current position (m/s), from thermals. Moves the creature, not its airspeed. */
  updraft = 0;
  /** 0..1 */
  energy = 1;
  /** Increments on each flap; visuals can use it to trigger a wingbeat. */
  flapCount = 0;

  private pitchRate = 0;
  private flapTimer = 0;

  /** Pose at the start of the last step, for render interpolation. */
  readonly previous: FlightPose = { position: new Vector3(), yaw: 0, pitch: 0, bank: 0 };

  constructor() {
    this.reset();
  }

  reset(): void {
    const t = tuning.flight;
    this.position.set(0, 120, 0);
    this.yaw = 0;
    this.pitch = t.glidePitchDeg * DEG;
    this.bank = 0;
    this.speed = t.startSpeed;
    this.climb = 0;
    this.updraft = 0;
    this.energy = 1;
    this.pitchRate = 0;
    this.flapTimer = 0;
    this.storePrevious();
  }

  forward(out = new Vector3()): Vector3 {
    const cp = Math.cos(this.pitch);
    return out.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
  }

  velocity(out = new Vector3()): Vector3 {
    this.forward(out).multiplyScalar(this.speed);
    out.y += this.climb + this.updraft - this.sink;
    return out;
  }

  /** Advances one fixed step. `updraft` is the rising air (m/s) at the current position. */
  step(dt: number, input: FlightInput, updraft = 0): void {
    const t = tuning.flight;
    this.storePrevious();
    this.updraft = updraft;

    const stallRatio = Math.min(1, this.speed / Math.max(t.stallSpeed, 0.01));
    const stalled = 1 - stallRatio * stallRatio; // 0 above stall speed, ->1 as speed ->0
    const lift = Math.min(1, (this.speed * this.speed) / Math.max(t.startSpeed * t.startSpeed, 1));

    // Bank: spring toward stick target, returns to level on release.
    const targetBank = input.roll * t.maxBankDeg * DEG;
    this.bank += (targetBank - this.bank) * (1 - Math.exp(-t.bankResponse * dt));

    // Pitch: stick drives a smoothed pitch rate. Hands off, the nose settles to a glide.
    const targetRate = input.pitch * t.pitchRateDeg * DEG;
    this.pitchRate += (targetRate - this.pitchRate) * (1 - Math.exp(-t.pitchResponse * dt));
    this.pitch += this.pitchRate * dt;
    if (input.pitch === 0) {
      const glide = t.glidePitchDeg * DEG;
      this.pitch += (glide - this.pitch) * (1 - Math.exp(-t.pitchAutoLevel * dt));
    }
    // Banking spends lift, so the nose sags in turns; stalling drops it hard.
    this.pitch -= t.bankPitchDrop * (1 - Math.cos(this.bank)) * dt;
    this.pitch -= t.stallNoseDrop * stalled * dt;
    const maxPitch = t.maxPitchDeg * DEG;
    this.pitch = Math.min(maxPitch, Math.max(-maxPitch, this.pitch));

    // Turn by bank. Right bank (bank > 0) turns right (yaw decreases).
    this.yaw -= t.turnRate * Math.sin(this.bank) * lift * dt;

    // Speed: gravity along the flight path, quadratic drag.
    this.speed -= t.gravity * Math.sin(this.pitch) * dt;
    this.speed -= t.drag * this.speed * this.speed * dt;

    // Flap.
    this.flapTimer = Math.max(0, this.flapTimer - dt);
    if (input.flap && this.flapTimer === 0 && this.energy >= t.flapCost) {
      this.speed += t.flapThrust;
      this.climb += t.flapLift;
      this.energy -= t.flapCost;
      this.flapTimer = t.flapCooldown;
      this.flapCount++;
    } else if (!input.flap) {
      this.energy = Math.min(1, this.energy + t.energyRegen * dt);
    }
    this.climb *= Math.exp(-t.flapLiftDecay * dt);
    this.speed = Math.min(t.maxSpeed, Math.max(0, this.speed));

    this.sink = t.baseSink + t.stallSink * stalled;

    this.position.addScaledVector(this.velocity(scratch), dt);

    // Ground: no crashes, just skim and nose up.
    if (this.position.y < t.groundClearance) {
      this.position.y = t.groundClearance;
      if (this.pitch < 0) this.pitch *= Math.exp(-4 * dt);
      this.climb = Math.max(0, this.climb);
    }
  }

  /** Pose blended between the previous and current step. */
  interpolate(alpha: number, out: FlightPose): FlightPose {
    const p = this.previous;
    out.position.lerpVectors(p.position, this.position, alpha);
    out.yaw = p.yaw + (this.yaw - p.yaw) * alpha;
    out.pitch = p.pitch + (this.pitch - p.pitch) * alpha;
    out.bank = p.bank + (this.bank - p.bank) * alpha;
    return out;
  }

  private storePrevious(): void {
    this.previous.position.copy(this.position);
    this.previous.yaw = this.yaw;
    this.previous.pitch = this.pitch;
    this.previous.bank = this.bank;
  }
}

const scratch = new Vector3();
