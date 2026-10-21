// Challenge-mode HUD: score with combo multiplier, lights (lives), danger level, event banner
// and status line, floating score pop-ups, edge markers for shadows closing in and for the
// event target (next ring, golden spirit), and full-screen hurt / lightning flashes.
import { type PerspectiveCamera, Vector3 } from 'three';

const LIGHT_SVG = `<svg viewBox="0 0 24 24"><path d="M12 2c2.6 4.2 6.5 6.9 6.5 11.4A6.5 6.5 0 0 1 5.5 13.4C5.5 8.9 9.4 6.2 12 2z"/><path class="core" d="M12 10c1.2 2 3 3.2 3 5.2a3 3 0 0 1-6 0c0-2 1.8-3.2 3-5.2z"/></svg>`;
const ARROW_SVG = `<svg viewBox="0 0 24 24"><path d="M12 2 20 20 12 15.5 4 20z"/></svg>`;
const THREATS = 8;
const POPS = 7;

export interface ChallengeHudState {
  score: number;
  mult: number;
  /** 0..1 time left in the combo window. */
  combo: number;
  lives: number;
  maxLives: number;
  danger: number;
  camera: PerspectiveCamera;
  /** Shadows to point at (positions); only the near, off-screen ones are shown. */
  threats: readonly { pos: Vector3; alive: boolean; dying: boolean }[];
  /** Event target to point at (gold), or null. */
  target: Vector3 | null;
}

export class ChallengeHud {
  readonly root: HTMLElement;
  private readonly scoreEl: HTMLElement;
  private readonly multEl: HTMLElement;
  private readonly comboFill: HTMLElement;
  private readonly livesEl: HTMLElement;
  private readonly dangerEl: HTMLElement;
  private readonly banner: HTMLElement;
  private readonly status: HTMLElement;
  private readonly statusText: HTMLElement;
  private readonly statusFill: HTMLElement;
  private readonly pops: HTMLElement[] = [];
  private readonly threats: HTMLElement[] = [];
  private readonly target: HTMLElement;
  private readonly targetDist: HTMLElement;
  private readonly hurt: HTMLElement;
  private readonly flashEl: HTMLElement;
  private popNext = 0;
  private bannerTimer = 0;
  private shownScore = 0;
  private lastLives = -1;
  private lastDanger = -1;
  private lastMult = 0;
  private readonly v = new Vector3();

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'chud';
    this.root.className = 'hidden';
    this.root.innerHTML = `
      <div class="hurt" data-hurt></div>
      <div class="flash" data-flash></div>
      <div class="cscore">
        <div class="score shadow" data-score>0</div>
        <div class="multrow"><span class="mult shadow" data-mult>×1</span><div class="cbar"><div data-cfill></div></div></div>
        <div class="lives" data-lives></div>
        <div class="danger shadow" data-danger></div>
      </div>
      <div class="banner shadow" data-banner><div class="big"></div><div class="small"></div></div>
      <div class="status shadow" data-status><span></span><div class="sbar"><div></div></div></div>
      <div class="pops"></div>
      <div class="cmarker" data-target>${ARROW_SVG}<div class="dist shadow"></div></div>`;
    parent.appendChild(this.root);
    const q = (s: string) => this.root.querySelector(s) as HTMLElement;
    this.scoreEl = q('[data-score]');
    this.multEl = q('[data-mult]');
    this.comboFill = q('[data-cfill]');
    this.livesEl = q('[data-lives]');
    this.dangerEl = q('[data-danger]');
    this.banner = q('[data-banner]');
    this.status = q('[data-status]');
    this.statusText = this.status.querySelector('span') as HTMLElement;
    this.statusFill = this.status.querySelector('.sbar div') as HTMLElement;
    this.target = q('[data-target]');
    this.targetDist = this.target.querySelector('.dist') as HTMLElement;
    this.hurt = q('[data-hurt]');
    this.flashEl = q('[data-flash]');
    const popRoot = q('.pops');
    for (let i = 0; i < POPS; i++) {
      const el = document.createElement('div');
      el.className = 'pop shadow';
      popRoot.appendChild(el);
      this.pops.push(el);
    }
    for (let i = 0; i < THREATS; i++) {
      const el = document.createElement('div');
      el.className = 'threat';
      el.innerHTML = ARROW_SVG;
      this.root.appendChild(el);
      this.threats.push(el);
    }
  }

  set visible(v: boolean) {
    this.root.classList.toggle('hidden', !v);
  }

  /** Resets the displayed score (new run). */
  reset(): void {
    this.shownScore = 0;
    this.lastLives = -1;
    this.lastDanger = -1;
    this.status.classList.remove('show');
    this.banner.classList.remove('show');
  }

  /** A floating "+150 Purified" near the center. */
  pop(text: string, kind: 'good' | 'bad' | 'gold' = 'good'): void {
    const el = this.pops[this.popNext];
    this.popNext = (this.popNext + 1) % POPS;
    el.textContent = text;
    el.className = `pop shadow ${kind}`;
    el.style.left = `${50 + (Math.random() - 0.5) * 16}%`;
    void el.offsetWidth; // restart the animation
    el.classList.add('go');
  }

  /** Big announcement (events, danger). */
  announce(big: string, small = '', seconds = 2.8): void {
    (this.banner.querySelector('.big') as HTMLElement).textContent = big;
    (this.banner.querySelector('.small') as HTMLElement).textContent = small;
    this.banner.classList.remove('show');
    void this.banner.offsetWidth;
    this.banner.classList.add('show');
    this.bannerTimer = seconds;
  }

  /** Event status line with a progress bar (null hides it). */
  setStatus(text: string | null, fraction = 0, urgent = false): void {
    if (text === null) {
      this.status.classList.remove('show');
      return;
    }
    this.status.classList.add('show');
    this.status.classList.toggle('urgent', urgent);
    this.statusText.textContent = text;
    this.statusFill.style.transform = `scaleX(${Math.max(0, Math.min(1, fraction)).toFixed(3)})`;
  }

  /** Red vignette pulse when hurt. */
  hurtFlash(): void {
    this.hurt.classList.remove('go');
    void this.hurt.offsetWidth;
    this.hurt.classList.add('go');
  }

  update(dt: number, s: ChallengeHudState, flash: number): void {
    // Score rolls up toward the real value.
    this.shownScore += (s.score - this.shownScore) * (1 - Math.exp(-10 * dt));
    if (Math.abs(s.score - this.shownScore) < 1) this.shownScore = s.score;
    this.scoreEl.textContent = Math.round(this.shownScore).toLocaleString('es-ES');
    this.multEl.textContent = `×${s.mult}`;
    if (s.mult !== this.lastMult) {
      this.multEl.classList.remove('bump');
      void this.multEl.offsetWidth;
      if (s.mult > this.lastMult) this.multEl.classList.add('bump');
      this.lastMult = s.mult;
    }
    this.multEl.classList.toggle('hot', s.mult >= 4);
    this.comboFill.style.transform = `scaleX(${s.combo.toFixed(3)})`;
    if (s.lives !== this.lastLives) {
      this.livesEl.innerHTML = Array.from({ length: s.maxLives }, (_, i) => `<span class="life ${i < s.lives ? 'on' : ''}">${LIGHT_SVG}</span>`).join('');
      this.lastLives = s.lives;
    }
    if (s.danger !== this.lastDanger) {
      this.dangerEl.innerHTML = Array.from({ length: 6 }, (_, i) => `<i class="${i < s.danger ? 'on' : ''}"></i>`).join('');
      this.lastDanger = s.danger;
    }
    if (this.bannerTimer > 0 && (this.bannerTimer -= dt) <= 0) this.banner.classList.remove('show');
    this.flashEl.style.opacity = (flash * 0.55).toFixed(3);

    // Edge markers: shadows within reach that are off screen or behind.
    let t = 0;
    const cam = s.camera;
    for (const th of s.threats) {
      if (t >= THREATS) break;
      if (!th.alive || th.dying) continue;
      const d = cam.position.distanceTo(th.pos);
      if (d > 420) continue;
      const placed = this.place(this.threats[t], th.pos, cam, true);
      if (!placed) continue;
      this.threats[t].style.opacity = (0.35 + 0.65 * (1 - d / 420)).toFixed(2);
      this.threats[t].classList.add('show');
      t++;
    }
    for (; t < THREATS; t++) this.threats[t].classList.remove('show');

    if (s.target) {
      this.place(this.target, s.target, cam, false);
      const d = cam.position.distanceTo(s.target);
      this.targetDist.textContent = `${Math.round(d)} m`;
      this.target.classList.add('show');
    } else {
      this.target.classList.remove('show');
    }
  }

  /**
   * Positions an arrow marker at a world point (on screen) or pinned to the edge pointing at it.
   * With `offscreenOnly`, returns false (and leaves it hidden) when the point is on screen.
   */
  private place(el: HTMLElement, at: Vector3, cam: PerspectiveCamera, offscreenOnly: boolean): boolean {
    this.v.copy(at).project(cam);
    const behind = this.v.z > 1;
    let x = behind ? -this.v.x : this.v.x;
    let y = behind ? -this.v.y : this.v.y;
    const onScreen = !behind && Math.abs(x) < 0.92 && Math.abs(y) < 0.88;
    if (onScreen && offscreenOnly) {
      el.classList.remove('show');
      return false;
    }
    if (!onScreen) {
      const k = 0.88 / Math.max(Math.abs(x), Math.abs(y), 1e-3);
      x *= k;
      y *= k;
    }
    const angle = onScreen ? 180 : (Math.atan2(x, y) * 180) / Math.PI;
    el.style.left = `${((x + 1) / 2) * 100}%`;
    el.style.top = `${((1 - y) / 2) * 100}%`;
    (el.querySelector('svg') as SVGElement).style.transform = `rotate(${angle.toFixed(0)}deg)`;
    return true;
  }
}
