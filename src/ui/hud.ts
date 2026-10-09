// In-flight HUD: energy bar, speed, feather and shrine counters, trail combo, toasts, one-time
// hints, an edge marker pointing at the revealed feather, and the mouse stick reticle.
import { type PerspectiveCamera, Vector3 } from 'three';
import { t } from './i18n';

const FEATHER_SVG = `<svg viewBox="0 0 24 24"><path fill="#ffd27a" d="M20.5 3.5c-6 0-11 3.5-13.2 9.2l-3.8 7.1 1 .9 3.2-3.2c5.4-.3 10.6-5.4 12.8-14z"/><path fill="none" stroke="#f2a93b" stroke-width="1.2" d="M19 5 6.2 17.8"/></svg>`;
const SHRINE_SVG = `<svg viewBox="0 0 24 24"><path fill="#bfefff" d="M3 6h18v2H3zM5 8h2v12H5zM17 8h2v12h-2zM4 4h16v1.5H4z"/><circle cx="12" cy="15" r="2.4" fill="#7fe8ff"/></svg>`;
const ARROW_SVG = `<svg viewBox="0 0 24 24"><path fill="#ffd27a" d="M12 2 20 20 12 15.5 4 20z"/></svg>`;

export class Hud {
  readonly root: HTMLElement;
  private readonly featherCount: HTMLElement;
  private readonly shrineCount: HTMLElement;
  private readonly energy: HTMLElement;
  private readonly energyFill: HTMLElement;
  private readonly speed: HTMLElement;
  private readonly combo: HTMLElement;
  private readonly toast: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly marker: HTMLElement;
  private readonly markerDist: HTMLElement;
  private readonly stick: HTMLElement;
  private readonly stickDot: HTMLElement;
  private comboTimer = 0;
  private toastTimer = 0;
  private hintTimer = 0;
  private readonly toastQueue: { big: string; small: string }[] = [];
  private readonly v = new Vector3();

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'hud';
    this.root.className = 'hidden';
    this.root.innerHTML = `
      <div class="counter shadow">
        <div class="item" title="${t('feathers')}">${FEATHER_SVG}<span data-f></span></div>
        <div class="item" title="${t('shrines')}">${SHRINE_SVG}<span data-s></span></div>
      </div>
      <div class="speed shadow" data-speed></div>
      <div class="energy"><div class="fill" data-energy></div></div>
      <div class="combo shadow" data-combo></div>
      <div class="toast shadow" data-toast><div class="big"></div><div class="small"></div></div>
      <div class="hint" data-hint></div>
      <div class="marker" data-marker>${ARROW_SVG}<div class="dist shadow"></div></div>
      <div class="stick" data-stick><div class="dot"></div></div>`;
    parent.appendChild(this.root);
    const q = (sel: string) => this.root.querySelector(sel) as HTMLElement;
    this.featherCount = q('[data-f]');
    this.shrineCount = q('[data-s]');
    this.energyFill = q('[data-energy]');
    this.energy = this.energyFill.parentElement as HTMLElement;
    this.speed = q('[data-speed]');
    this.combo = q('[data-combo]');
    this.toast = q('[data-toast]');
    this.hint = q('[data-hint]');
    this.marker = q('[data-marker]');
    this.markerDist = this.marker.querySelector('.dist') as HTMLElement;
    this.stick = q('[data-stick]');
    this.stickDot = this.stick.querySelector('.dot') as HTMLElement;
  }

  set visible(v: boolean) {
    this.root.classList.toggle('hidden', !v);
  }

  setCounts(feathers: number, featherTotal: number, shrines: number, shrineTotal: number, bump = false): void {
    this.featherCount.textContent = `${feathers}/${featherTotal}`;
    this.shrineCount.textContent = `${shrines}/${shrineTotal}`;
    if (bump) {
      for (const el of [this.featherCount, this.shrineCount]) {
        el.classList.remove('bump');
        void el.offsetWidth; // restart the animation
        el.classList.add('bump');
      }
    }
  }

  showCombo(n: number, total: number): void {
    this.combo.textContent = `${n} / ${total}`;
    this.combo.classList.add('show');
    this.comboTimer = 1.6;
  }

  showToast(big: string, small = ''): void {
    this.toastQueue.push({ big, small });
    if (this.toastTimer <= 0) this.nextToast();
  }

  private nextToast(): void {
    const next = this.toastQueue.shift();
    if (!next) return;
    (this.toast.querySelector('.big') as HTMLElement).textContent = next.big;
    (this.toast.querySelector('.small') as HTMLElement).textContent = next.small;
    this.toast.classList.add('show');
    this.toastTimer = 3.6;
  }

  showHint(text: string): void {
    this.hint.textContent = text;
    this.hint.classList.add('show');
    this.hintTimer = 5;
  }

  update(
    dt: number,
    state: {
      energy: number;
      boost: number;
      speed: number;
      stick: { x: number; y: number } | null;
      target: Vector3 | null;
      camera: PerspectiveCamera;
    },
  ): void {
    this.energyFill.style.transform = `scaleX(${Math.max(0, Math.min(1, state.energy)).toFixed(3)})`;
    this.energy.classList.toggle('boost', state.boost > 0.3);
    this.energy.classList.toggle('low', state.energy < 0.15);
    this.speed.textContent = `${Math.round(state.speed * 3.6)} km/h`;

    if (this.comboTimer > 0 && (this.comboTimer -= dt) <= 0) this.combo.classList.remove('show');
    if (this.toastTimer > 0 && (this.toastTimer -= dt) <= 0) {
      this.toast.classList.remove('show');
      if (this.toastQueue.length) setTimeout(() => this.nextToast(), 600);
    }
    if (this.hintTimer > 0 && (this.hintTimer -= dt) <= 0) this.hint.classList.remove('show');

    if (state.stick) {
      this.stick.classList.add('show');
      this.stickDot.style.transform = `translate(${(state.stick.x * 22).toFixed(1)}px, ${(-state.stick.y * 22).toFixed(1)}px)`;
    } else {
      this.stick.classList.remove('show');
    }

    // Marker toward the revealed feather: on screen at its position, else pinned to the edge.
    if (state.target) {
      const cam = state.camera;
      const dist = cam.position.distanceTo(state.target);
      this.v.copy(state.target).project(cam);
      const behind = this.v.z > 1;
      let x = behind ? -this.v.x : this.v.x;
      let y = behind ? -this.v.y : this.v.y;
      const onScreen = !behind && Math.abs(x) < 0.92 && Math.abs(y) < 0.88;
      if (!onScreen) {
        const k = 0.9 / Math.max(Math.abs(x), Math.abs(y), 1e-3);
        x *= k;
        y *= k;
      }
      const angle = onScreen ? 180 : (Math.atan2(x, y) * 180) / Math.PI;
      this.marker.style.left = `${((x + 1) / 2) * 100}%`;
      this.marker.style.top = `${((1 - y) / 2) * 100}%`;
      (this.marker.querySelector('svg') as SVGElement).style.transform = `rotate(${angle.toFixed(0)}deg)`;
      this.markerDist.textContent = dist > 1000 ? `${(dist / 1000).toFixed(1)} km` : `${Math.round(dist)} m`;
      this.marker.classList.add('show');
    } else {
      this.marker.classList.remove('show');
    }
  }
}
