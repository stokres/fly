// Sky dome: horizon-to-zenith gradient, sun glow and disc, moon at night. Drawn first, always
// behind everything, centered on the camera. The sun glow uses the same formula and uniforms
// as the fog (fog.ts), so fogged land at the horizon matches the sky behind it.
import { BackSide, Color, Mesh, ShaderMaterial, SphereGeometry, type Vector3 } from 'three';
import type { AtmosphereState } from './atmosphere';
import { fogUniforms } from './fog';
import { tuning } from './tuning';

const RADIUS = 10000;

const vertexShader = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  gl_Position = p.xyww; // depth = far plane
}
`;

const fragmentShader = /* glsl */ `
uniform vec3 zenith;
uniform vec3 horizon;
uniform vec3 fogSunColor;
uniform vec3 fogSunDir;
uniform vec3 fogParams;
uniform vec3 moonDir;
uniform float sunDiscCos;
uniform float night;
uniform vec3 veilColor;
uniform float veil;
varying vec3 vDir;

void main() {
  vec3 dir = normalize( vDir );
  float up = max( dir.y, 0.0 );
  vec3 col = mix( horizon, zenith, pow( up, 0.55 ) );
  // Same sun tint as the fog at the horizon.
  float s = max( dot( dir, fogSunDir ), 0.0 );
  col = mix( col, fogSunColor, pow( s, fogParams.y ) * fogParams.x );
  // Tight halo and disc. The disc sinks below the horizon with the sun.
  col += fogSunColor * pow( s, 300.0 ) * 0.6;
  float disc = smoothstep( sunDiscCos - 0.00015, sunDiscCos + 0.00005, s ) * smoothstep( -0.02, 0.01, dir.y );
  col = mix( col, fogSunColor * 1.6 + 0.2, disc );
  // Moon: a pale disc opposite the sun, only at night.
  float m = max( dot( dir, moonDir ), 0.0 );
  float moon = smoothstep( sunDiscCos - 0.0001, sunDiscCos + 0.00005, m ) * night * smoothstep( 0.0, 0.03, dir.y );
  col = mix( col, vec3( 0.85, 0.88, 0.95 ), moon );
  // Inside a cloud the sky disappears into the same whiteout as everything else.
  col = mix( col, veilColor, veil );
  gl_FragColor = vec4( col, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class Sky {
  readonly mesh: Mesh;
  private readonly uniforms = {
    zenith: { value: new Color() },
    horizon: { value: new Color() },
    moonDir: { value: new Float32Array(3) },
    sunDiscCos: { value: 0.9998 },
    night: { value: 0 },
    veilColor: { value: new Color() },
    veil: { value: 0 },
    ...fogUniforms,
  };

  constructor() {
    const material = new ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader,
      fragmentShader,
      side: BackSide,
      depthWrite: false,
    });
    this.mesh = new Mesh(new SphereGeometry(RADIUS, 32, 16), material);
    this.mesh.renderOrder = -1;
    this.mesh.frustumCulled = false;
  }

  /** `veil` (0..1) fades the whole sky to `veilColor`, e.g. inside a cloud. */
  update(state: AtmosphereState, camera: Vector3, veil: number, veilColor: Color): void {
    this.uniforms.veil.value = veil;
    this.uniforms.veilColor.value.copy(veilColor);
    this.mesh.position.copy(camera);
    this.uniforms.zenith.value.copy(state.zenith);
    this.uniforms.horizon.value.copy(state.horizon);
    const m = this.uniforms.moonDir.value;
    m[0] = -state.sunDir.x;
    m[1] = -state.sunDir.y;
    m[2] = -state.sunDir.z;
    this.uniforms.night.value = state.night;
    this.uniforms.sunDiscCos.value = Math.cos((tuning.atmosphere.sunDiscDeg * Math.PI) / 360);
  }
}
