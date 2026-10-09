// Post-processing: MSAA scene render -> bloom (HDR, only bright things glow) -> tone mapping and
// sRGB (OutputPass) -> grade: saturation, contrast, warm lift/gain, vignette, plus speed effects
// (radial blur and a touch of chromatic aberration as the creature goes fast).
import { type Camera, HalfFloatType, type Scene, Vector2, type WebGLRenderer, WebGLRenderTarget } from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { tuning } from './tuning';

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    saturation: { value: 1.15 },
    contrast: { value: 1.05 },
    lift: { value: [0.02, 0.015, 0.04] },
    gain: { value: [1.03, 1.0, 0.96] },
    vignette: { value: 0.35 },
    speed: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float saturation, contrast, vignette, speed;
    uniform vec3 lift, gain;
    varying vec2 vUv;
    void main() {
      vec2 d = vUv - 0.5;
      float r = length( d );
      vec3 col;
      if ( speed > 0.01 ) {
        // Radial blur, growing toward the edges: the world streams past at speed.
        float k = speed * smoothstep( 0.15, 0.7, r ) * 0.06;
        col = vec3( 0.0 );
        for ( int i = 0; i < 8; i++ ) {
          float f = float( i ) / 7.0;
          vec2 uv = vUv - d * k * f;
          col.r += texture2D( tDiffuse, uv - d * k * 0.08 ).r;
          col.g += texture2D( tDiffuse, uv ).g;
          col.b += texture2D( tDiffuse, uv + d * k * 0.08 ).b;
        }
        col /= 8.0;
      } else {
        col = texture2D( tDiffuse, vUv ).rgb;
      }
      float l = dot( col, vec3( 0.2126, 0.7152, 0.0722 ) );
      col = mix( vec3( l ), col, saturation );
      col = ( col - 0.5 ) * contrast + 0.5;
      col = col * gain + lift * ( 1.0 - col );
      col *= 1.0 - vignette * smoothstep( 0.3, 0.85, r );
      gl_FragColor = vec4( clamp( col, 0.0, 1.0 ), 1.0 );
    }
  `,
};

export class Post {
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly grade: ShaderPass;

  constructor(renderer: WebGLRenderer, scene: Scene, camera: Camera) {
    const size = renderer.getDrawingBufferSize(new Vector2());
    const target = new WebGLRenderTarget(size.x, size.y, { type: HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, target);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new Vector2(size.x / 2, size.y / 2), 0.35, 0.55, 0.92);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
  }

  setSize(width: number, height: number, pixelRatio: number): void {
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(width, height);
  }

  /** `speed` 0..1 drives the speed effects. */
  render(dt: number, speed: number): void {
    const p = tuning.post;
    this.bloom.strength = p.bloomStrength;
    this.bloom.threshold = p.bloomThreshold;
    const u = this.grade.uniforms;
    u.saturation.value = p.saturation;
    u.contrast.value = p.contrast;
    u.vignette.value = p.vignette;
    u.speed.value = speed * p.speedBlur;
    this.composer.render(dt);
  }
}
