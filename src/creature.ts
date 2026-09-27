// The creature: a stylized long-winged seabird built in code, animated procedurally from the
// flight state rather than from baked clips, so every wing pose answers speed and input.
//
//  - glide: wings spread, slight gull droop, breathing dihedral, tips flutter at speed
//  - dive:  wings tuck back with speed (falcon stoop), tail closes
//  - flare: pulling up at low speed sweeps the wings forward and twists them up, tail fans open
//  - flap:  a full wingbeat per flap: fold on the upstroke, whip through on the downstroke
//  - turns: the head looks into the turn, wings go asymmetric, the tail twists
//
// Local frame: forward -Z, up +Y, right +X (same as the flight model).
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  DoubleSide,
  Group,
  LatheGeometry,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  Vector2,
} from 'three';
import type { FlightPose } from './flight';
import { PALETTE } from './palette';
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

/** Adds a view-angle rim light (fresnel) so the silhouette reads against a bright sky. */
function withRim(material: MeshStandardMaterial, rim: RimUniforms): MeshStandardMaterial {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, rim);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 rimColor;\nuniform float rimStrength;\nuniform float rimPower;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        float rimFactor = pow(1.0 - saturate(abs(dot(normal, normalize(vViewPosition)))), rimPower);
        totalEmissiveRadiance += rimColor * rimFactor * rimStrength;`,
      );
  };
  material.customProgramCacheKey = () => 'creature-rim';
  return material;
}

interface RimUniforms {
  rimColor: { value: Color };
  rimStrength: { value: number };
  rimPower: { value: number };
}

/**
 * Flat wing panel in the XZ plane, hinge along the Z axis at x = 0, extending to +X.
 * Leading edge toward -Z. A raised mid-chord line gives a faceted camber.
 */
function panel(
  length: number,
  rootChord: number,
  tipChord: number,
  tipSweep: number,
  color: Color,
  tipColor = color,
  overlap = 0,
): BufferGeometry {
  const le = 0.35; // fraction of chord ahead of the hinge line
  const camber = 0.035;
  // `overlap` extends the root back past the hinge, so folding a joint never opens a gap.
  const r = -overlap;
  const pts = [
    [r, 0, -rootChord * le], // root leading edge
    [r, camber, rootChord * (0.5 - le)], // root mid
    [r, 0, rootChord * (1 - le)], // root trailing edge
    [length, 0, tipSweep - tipChord * le],
    [length, camber * 0.6, tipSweep + tipChord * (0.5 - le)],
    [length, 0, tipSweep + tipChord * (1 - le)],
  ];
  const tris = [0, 3, 1, 1, 3, 4, 1, 4, 2, 2, 4, 5];
  return build(pts, tris, (i) => (i < 3 ? color : tipColor));
}

/** One long feather: tapered blade from its base (origin) to +X. */
function feather(length: number, width: number, base: Color, tip: Color): BufferGeometry {
  const pts = [
    [0, 0, -width * 0.35],
    [0, 0.01, width * 0.65],
    [length * 0.75, 0.012, -width * 0.3],
    [length * 0.8, 0, width * 0.55],
    [length, 0, width * 0.1],
  ];
  const tris = [0, 2, 1, 1, 2, 3, 2, 4, 3];
  return build(pts, tris, (i) => (i < 2 ? base : tip));
}

function build(pts: number[][], tris: number[], colorOf: (i: number) => Color): BufferGeometry {
  const pos = new Float32Array(tris.length * 3);
  const col = new Float32Array(tris.length * 3);
  tris.forEach((idx, k) => {
    pos.set(pts[idx], k * 3);
    colorOf(idx).toArray(col, k * 3);
  });
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(pos, 3));
  geo.setAttribute('color', new BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return geo;
}

/** Joint hierarchy of one (right) wing. The left wing is the same hierarchy under a mirror. */
class Wing {
  readonly shoulder = new Group();
  readonly elbow = new Group();
  readonly wrist = new Group();
  readonly primaries: Group[] = [];

  constructor(material: MeshStandardMaterial) {
    const bone = new Color(PALETTE.bone);
    const sand = new Color(PALETTE.sand);
    const ember = new Color(PALETTE.ember);
    for (const joint of [this.shoulder, this.elbow, this.wrist]) joint.rotation.order = 'YZX';

    this.shoulder.position.set(0.12, 0.06, -0.1);
    this.shoulder.add(new Mesh(panel(0.55, 0.52, 0.5, 0.03, bone), material));
    this.elbow.position.set(0.55, 0, 0.03);
    this.shoulder.add(this.elbow);
    this.elbow.add(new Mesh(panel(0.62, 0.5, 0.42, 0.06, bone, sand, 0.12), material));
    this.wrist.position.set(0.62, 0, 0.06);
    this.elbow.add(this.wrist);
    this.wrist.add(new Mesh(panel(0.22, 0.42, 0.3, 0.04, sand, sand, 0.12), material));

    // Primary feathers fan out from the hand; their spread is animated.
    for (let i = 0; i < 5; i++) {
      const f = new Group();
      f.position.set(0.14 + i * 0.015, 0, -0.08 + i * 0.07);
      f.add(new Mesh(feather(0.72 - i * 0.07, 0.13, sand, ember.clone().lerp(sand, i * 0.12)), material));
      this.wrist.add(f);
      this.primaries.push(f);
    }
  }
}

export class Creature {
  /** Root in world space: holds the bird (posed each frame) and the world-space streamers. */
  readonly object = new Group();
  private readonly bird = new Group();
  private readonly head = new Group();
  private readonly tail = new Group();
  private readonly tailFeathers: Group[] = [];
  private readonly right: Wing;
  private readonly left: Wing;
  private readonly streamers: Streamers;
  private readonly rim: RimUniforms = {
    rimColor: { value: new Color(PALETTE.skyLight) },
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
    const bodyMat = withRim(new MeshStandardMaterial({ color: PALETTE.bone, flatShading: true, roughness: 0.8 }), this.rim);
    const wingMat = withRim(
      new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85, side: DoubleSide }),
      this.rim,
    );
    const beakMat = new MeshStandardMaterial({ color: PALETTE.terracotta, flatShading: true });

    // Body: a lathe spindle from tail (y = -0.75) to neck, laid along -Z.
    const profile = [
      [0.0, -0.75], [0.06, -0.62], [0.13, -0.38], [0.18, -0.08], [0.17, 0.18], [0.11, 0.36], [0.07, 0.44],
    ].map(([r, y]) => new Vector2(r, y));
    const bodyGeo = new LatheGeometry(profile, 8).rotateX(-Math.PI / 2).scale(1.05, 0.9, 1);
    this.bird.add(new Mesh(bodyGeo, bodyMat));

    this.head.position.set(0, 0.04, -0.46);
    const skull = new Mesh(new SphereGeometry(0.11, 7, 5).scale(0.9, 0.85, 1.3), bodyMat);
    skull.position.z = -0.06;
    const beak = new Mesh(new ConeGeometry(0.035, 0.22, 5).rotateX(-Math.PI / 2), beakMat);
    beak.position.set(0, -0.015, -0.26);
    this.head.add(skull, beak);
    this.bird.add(this.head);

    this.right = new Wing(wingMat);
    this.left = new Wing(wingMat);
    const mirror = new Group();
    mirror.scale.x = -1; // same joint values on both sides give a symmetric pose
    mirror.add(this.left.shoulder);
    this.bird.add(this.right.shoulder, mirror);

    // Tail: a fan of feathers pointing back (+Z).
    const bone = new Color(PALETTE.bone);
    const sand = new Color(PALETTE.sand);
    this.tail.position.set(0, 0.02, 0.62);
    this.tail.rotation.order = 'ZXY';
    for (let i = 0; i < 5; i++) {
      const f = new Group();
      f.add(new Mesh(feather(0.5 - Math.abs(i - 2) * 0.04, 0.12, bone, sand).rotateY(-Math.PI / 2), wingMat));
      this.tail.add(f);
      this.tailFeathers.push(f);
    }
    this.bird.add(this.tail);
    this.bird.rotation.order = 'YXZ';

    this.streamers = new Streamers();
    this.object.add(this.bird, this.streamers.mesh);
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
    this.tailFeathers.forEach((f, i) => (f.rotation.y = (i - 2) * tailSpread * 0.5));
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
