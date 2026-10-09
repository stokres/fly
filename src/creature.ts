// The creature: a pearl-white spirit bird modeled in Blender (art/creature.py) as rigid parts,
// assembled here into a skeleton and animated procedurally from the flight state rather than from
// baked clips, so every wing pose answers speed and input.
//
//  - glide: wings spread, slight gull droop, breathing dihedral, tips flutter at speed
//  - dive:  wings tuck back with speed (falcon stoop), tail closes
//  - flare: pulling up at low speed sweeps the wings forward and twists them up, tail fans open
//  - flap:  a full wingbeat per flap: fold on the upstroke, whip through on the downstroke
//  - turns: the head looks into the turn, wings go asymmetric, the tail twists
//
// Local frame: forward -Z, up +Y, right +X (same as the flight model).
import { type BufferGeometry, Color, DoubleSide, Group, MathUtils, Mesh, MeshLambertMaterial } from 'three';
import type { FlightPose } from './flight';
import { loadGeometries } from './models';
import { Streamers } from './streamers';
import { tuning } from './tuning';

/** Flight state that drives the animation. */
export interface CreatureDrive {
  speed: number;
  /** Stick input, -1..1 (positive = nose up / bank right). */
  pitchInput: number;
  rollInput: number;
  /** Increments once per flap. */
  flapCount: number;
}

const DEG = Math.PI / 180;
/** Primary feather lengths (m), outermost first. */
const PRIMARIES = [1.0, 0.98, 0.93, 0.86, 0.78, 0.69, 0.6];
/** Tail plume lengths (m), left to right. */
const PLUMES = [1.4, 1.85, 2.4, 1.85, 1.4];

interface RimUniforms {
  rimColor: { value: Color };
  rimStrength: { value: number };
  rimPower: { value: number };
}

/** Adds a view-angle rim light (fresnel) so the silhouette reads against a bright sky. */
function withRim(material: MeshLambertMaterial, rim: RimUniforms): MeshLambertMaterial {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, rim);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 rimColor;\nuniform float rimStrength;\nuniform float rimPower;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        float rimFactor = pow( 1.0 - saturate( abs( dot( normal, normalize( vViewPosition ) ) ) ), rimPower );
        totalEmissiveRadiance += rimColor * rimFactor * rimStrength;`,
      );
  };
  material.customProgramCacheKey = () => 'creature-rim';
  return material;
}

/** Joint hierarchy of one (right) wing. The left wing is the same hierarchy under a mirror. */
class Wing {
  readonly shoulder = new Group();
  readonly elbow = new Group();
  readonly wrist = new Group();
  readonly primaries: Group[] = [];

  constructor() {
    for (const joint of [this.shoulder, this.elbow, this.wrist]) joint.rotation.order = 'YZX';
    this.shoulder.position.set(0.17, 0.1, -0.1);
    this.elbow.position.set(0.68, 0, 0.0);
    this.wrist.position.set(0.78, 0, 0.03);
    this.shoulder.add(this.elbow);
    this.elbow.add(this.wrist);
    PRIMARIES.forEach((len, i) => {
      const f = new Group();
      f.position.set(0.12 + i * 0.03, -0.005 * i, -0.08 + i * 0.065);
      f.scale.set(len, 1, 1);
      this.wrist.add(f);
      this.primaries.push(f);
    });
  }

  dress(parts: Map<string, BufferGeometry>, material: MeshLambertMaterial): void {
    const mesh = (name: string) => {
      const m = new Mesh(parts.get(name), material);
      m.castShadow = true;
      return m;
    };
    this.shoulder.add(mesh('bird_arm'));
    this.elbow.add(mesh('bird_forearm'));
    this.wrist.add(mesh('bird_hand'));
    for (const f of this.primaries) f.add(mesh('bird_primary'));
  }
}

export class Creature {
  /** Root in world space: holds the bird (posed each frame) and the world-space streamers. */
  readonly object = new Group();
  private readonly bird = new Group();
  private readonly head = new Group();
  private readonly tail = new Group();
  private readonly tailFeathers: Group[] = [];
  private readonly right = new Wing();
  private readonly left = new Wing();
  private readonly streamers: Streamers;
  private readonly rim: RimUniforms = {
    rimColor: { value: new Color(0xe4f3ff) },
    rimStrength: { value: 0.6 },
    rimPower: { value: 2.5 },
  };

  // Smoothed animation state.
  private spread = 1;
  private flare = 0;
  private headYaw = 0;
  private roll = 0;
  private pitchIn = 0;
  private beat = 1; // 0..1 through the current wingbeat, 1 = idle
  private lastFlapCount = 0;
  private time = 0;

  constructor() {
    this.head.position.set(0, 0.28, -0.62);
    this.tail.position.set(0, 0.04, 0.6);
    this.tail.rotation.order = 'ZXY';
    PLUMES.forEach((len) => {
      const f = new Group();
      f.scale.set(1, 1, len);
      this.tail.add(f);
      this.tailFeathers.push(f);
    });
    const mirror = new Group();
    mirror.scale.x = -1; // same joint values on both sides give a symmetric pose
    mirror.add(this.left.shoulder);
    this.bird.add(this.head, this.tail, this.right.shoulder, mirror);
    this.bird.rotation.order = 'YXZ';

    this.streamers = new Streamers();
    this.object.add(this.bird, this.streamers.mesh);

    const material = withRim(new MeshLambertMaterial({ vertexColors: true, side: DoubleSide }), this.rim);
    loadGeometries('creature.glb').then((parts) => {
      const body = new Mesh(parts.get('bird_body'), material);
      const head = new Mesh(parts.get('bird_head'), material);
      body.castShadow = head.castShadow = true;
      this.bird.add(body);
      this.head.add(head);
      this.right.dress(parts, material);
      this.left.dress(parts, material);
      for (const f of this.tailFeathers) {
        const m = new Mesh(parts.get('bird_plume'), material);
        m.castShadow = true;
        f.add(m);
      }
    });
  }

  /** Rim light color, set from the sky so the silhouette glows in the ambient light of the moment. */
  setRimColor(color: Color): void {
    this.rim.rimColor.value.copy(color);
  }

  update(dt: number, pose: FlightPose, drive: CreatureDrive): void {
    const c = tuning.creature;
    this.time += dt;
    const k = (rate: number) => 1 - Math.exp(-rate * dt);

    this.bird.position.copy(pose.position);
    this.bird.rotation.set(pose.pitch, pose.yaw, -pose.bank);
    this.bird.scale.setScalar(c.scale);
    this.rim.rimStrength.value = c.rimStrength;
    this.rim.rimPower.value = c.rimPower;

    // Wing spread: full when slow, tucked back as speed builds toward a dive.
    const tuck = MathUtils.smoothstep(drive.speed, c.tuckSpeedMin, c.tuckSpeedMax);
    this.spread += (1 - tuck - this.spread) * k(3);
    // Flare: pulling up at low speed, like braking to land.
    const slow = 1 - MathUtils.smoothstep(drive.speed, 10, 30);
    this.flare += (Math.max(0, drive.pitchInput) * slow - this.flare) * k(4);
    this.roll += (drive.rollInput - this.roll) * k(5);
    this.pitchIn += (drive.pitchInput - this.pitchIn) * k(5);
    this.headYaw += (-drive.rollInput * c.headTurnDeg * DEG - this.headYaw) * k(3);

    if (drive.flapCount !== this.lastFlapCount) {
      this.lastFlapCount = drive.flapCount;
      this.beat = 0;
    }
    this.beat = Math.min(1, this.beat + dt / c.flapDuration);

    // Right wing turns toward bank right with positive roll; the inner wing drops and folds a little.
    this.poseWing(this.right, this.roll, drive.speed);
    this.poseWing(this.left, -this.roll, drive.speed);

    this.head.rotation.set(-0.08 + this.pitchIn * 0.1, this.headYaw, 0);

    // Tail: spreads when slow or flaring, closes in a dive; pitches with the stick, twists in turns.
    const tailSpread = MathUtils.lerp(0.15, 0.55, Math.max(1 - tuck, this.flare)) * c.tailSpread;
    this.tailFeathers.forEach((f, i) => (f.rotation.y = (i - 2) * tailSpread * 0.45));
    this.tail.rotation.set(this.pitchIn * 0.35 + this.flare * 0.3, 0, -this.roll * 0.3);

    this.object.updateMatrixWorld();
    this.streamers.update(dt, this.tail);
  }

  private poseWing(wing: Wing, roll: number, speed: number): void {
    const c = tuning.creature;
    const s = this.spread;
    const t = this.beat;
    const beating = t < 1 ? 1 : 0;

    // Wingbeat: up then down (sin), elbow folds on the upstroke, wrist lags for a whip.
    const stroke = Math.sin(t * Math.PI * 2) * c.flapAmplitudeDeg * DEG * beating;
    const upFold = Math.max(0, Math.sin(t * Math.PI * 2)) * beating;
    const whip = Math.sin(t * Math.PI * 2 - 0.9) * 0.35 * beating;

    const breathe = Math.sin(this.time * 0.8) * 1.5 * DEG;
    const flutter = Math.sin(this.time * 31 + (roll > 0 ? 0 : 1.7)) * c.flutterDeg * DEG * MathUtils.smoothstep(speed, 25, 60);

    // Shoulder: dihedral (z), sweep (y), twist (x).
    wing.shoulder.rotation.set(
      this.flare * 0.35 + this.pitchIn * 0.08, // twist nose-up when flaring
      MathUtils.lerp(-0.85, 0.05, s) + this.flare * 0.25 - upFold * 0.15, // tucked sweeps back
      c.dihedralDeg * DEG * s + breathe + stroke - roll * 0.12,
    );
    // Elbow and wrist: fold into a stoop as spread drops; fold on the upstroke.
    wing.elbow.rotation.set(0, MathUtils.lerp(1.15, -0.05, s) - upFold * 0.5 + roll * 0.08, -0.03 + whip * 0.4);
    wing.wrist.rotation.set(
      0,
      MathUtils.lerp(-1.55, -0.22, s) - upFold * 0.35 + this.flare * 0.2,
      MathUtils.lerp(0, -0.3, s) + whip + flutter, // gull droop at the hand
    );
    // Primaries fan open when slow or flaring, stack closed when fast.
    const fan = MathUtils.lerp(0.02, 0.12, Math.max(s * 0.6, this.flare));
    wing.primaries.forEach((f, i) => (f.rotation.y = -i * fan));
  }
}
