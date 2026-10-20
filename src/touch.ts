// Mobile controls: steer by tilting the phone, on-screen buttons to boost and flap.
//
// Tilt comes from DeviceOrientationEvent, turned into the "up" direction in the phone's own frame
// (robust at any holding angle, unlike raw beta/gamma near vertical). Side tilt banks; tilting the
// top away (phone flatter) dives, toward you climbs, relative to the pose captured at calibration,
// so it works however the player holds the phone. Screen rotation is accounted for.
// Without a sensor (or if permission is refused) dragging a thumb on the screen steers instead.
import { tuning } from './tuning';

export interface TouchIntent {
  pitch: number;
  roll: number;
  flap: boolean;
  boost: boolean;
}

/** True on phones and tablets (coarse pointer, touch). */
export const isTouchDevice =
  typeof window !== 'undefined' &&
  (window.matchMedia?.('(pointer: coarse)').matches || 'ontouchstart' in window) &&
  !window.matchMedia?.('(pointer: fine)').matches;

const DEG = Math.PI / 180;

export class TouchControls {
  readonly root: HTMLElement;
  /** Sensor delivering data (permission granted and events arriving). */
  tiltActive = false;
  private permission: 'unknown' | 'granted' | 'denied' = 'unknown';
  /** Latest raw tilt: bank angle and pitch angle (radians), in screen space. */
  private rawRoll = 0;
  private rawPitch = 0;
  private neutralPitch = Math.PI / 4;
  private calibrateNext = true;
  private roll = 0;
  private pitch = 0;
  private boostHeld = false;
  private flapHeld = false;
  /** Thumb-drag fallback stick. */
  private drag: { id: number; x0: number; y0: number; x: number; y: number } | null = null;
  private readonly stickEl: HTMLElement;
  private readonly stickDot: HTMLElement;
  onPause: () => void = () => {};

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'touch';
    this.root.className = 'hidden';
    this.root.innerHTML = `
      <button class="tbtn pause" data-pause aria-label="pause">❚❚</button>
      <button class="tbtn recal" data-recal aria-label="recalibrate">◎</button>
      <div class="tstick" data-stick><div class="dot"></div></div>
      <button class="tbtn flap" data-flap aria-label="flap"><span>⌃</span></button>
      <button class="tbtn boost" data-boost aria-label="boost"><span>»</span></button>`;
    parent.appendChild(this.root);
    const q = (s: string) => this.root.querySelector(s) as HTMLElement;
    this.stickEl = q('[data-stick]');
    this.stickDot = this.stickEl.querySelector('.dot') as HTMLElement;

    const hold = (el: HTMLElement, set: (v: boolean) => void) => {
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        try {
          el.setPointerCapture(e.pointerId); // keep the press even if the thumb slides off
        } catch {
          // Synthetic or already-ended pointers can't be captured; the press still counts.
        }
        el.classList.add('on');
        set(true);
        navigator.vibrate?.(8);
      });
      const up = () => {
        el.classList.remove('on');
        set(false);
      };
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      el.addEventListener('lostpointercapture', up);
    };
    hold(q('[data-boost]'), (v) => (this.boostHeld = v));
    hold(q('[data-flap]'), (v) => (this.flapHeld = v));
    q('[data-pause]').addEventListener('click', () => this.onPause());
    q('[data-recal]').addEventListener('click', () => this.calibrate());

    // Thumb drag anywhere else steers when there is no tilt sensor.
    const canvasArea = parent.parentElement ?? document.body;
    canvasArea.addEventListener('pointerdown', (e) => {
      if (this.tiltActive || this.drag || e.pointerType !== 'touch') return;
      if ((e.target as HTMLElement).closest('.tbtn, .screen')) return;
      this.drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY };
    });
    window.addEventListener('pointermove', (e) => {
      if (this.drag && e.pointerId === this.drag.id) {
        this.drag.x = e.clientX;
        this.drag.y = e.clientY;
      }
    });
    const end = (e: PointerEvent) => {
      if (this.drag && e.pointerId === this.drag.id) this.drag = null;
    };
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);

    window.addEventListener('deviceorientation', (e) => this.onOrientation(e));
  }

  set visible(v: boolean) {
    this.root.classList.toggle('hidden', !v);
  }

  /** Re-captures the neutral pose on the next sensor reading. */
  calibrate(): void {
    this.calibrateNext = true;
  }

  /**
   * Asks for motion permission where needed (iOS). Must be called from a user gesture, before any
   * await in that handler.
   */
  requestPermission(): void {
    const DOE = (window as unknown as { DeviceOrientationEvent?: { requestPermission?: () => Promise<string> } })
      .DeviceOrientationEvent;
    if (DOE?.requestPermission) {
      DOE.requestPermission()
        .then((r) => (this.permission = r === 'granted' ? 'granted' : 'denied'))
        .catch(() => (this.permission = 'denied'));
    } else {
      this.permission = 'granted';
    }
    this.calibrate();
  }

  private onOrientation(e: DeviceOrientationEvent): void {
    if (e.beta === null || e.gamma === null) return;
    const b = e.beta * DEG;
    const g = e.gamma * DEG;
    // World "up" seen in the device frame (W3C Z-X'-Y'' Euler angles).
    let ux = -Math.sin(g) * Math.cos(b);
    let uy = Math.sin(b);
    const uz = Math.cos(g) * Math.cos(b);
    // Into screen axes, for whichever way the screen is rotated.
    const angle = ((screen.orientation?.angle ?? (window as unknown as { orientation?: number }).orientation ?? 0) * Math.PI) / 180;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    [ux, uy] = [ux * c + uy * s, -ux * s + uy * c];
    // Bank: how far "up" leans toward the screen's left/right edge. Pitch: angle of the screen
    // back from upright (0 = held vertical, 90° = lying flat).
    this.rawRoll = Math.asin(Math.max(-1, Math.min(1, -ux)));
    this.rawPitch = Math.atan2(uz, uy);
    if (this.calibrateNext) {
      this.neutralPitch = this.rawPitch;
      this.calibrateNext = false;
    }
    this.tiltActive = true;
  }

  read(dt: number): TouchIntent {
    const t = tuning.input;
    const k = 1 - Math.exp(-14 * dt); // smooth sensor jitter
    let targetRoll = 0;
    let targetPitch = 0;
    if (this.tiltActive) {
      const range = Math.max(5, t.tiltRangeDeg / Math.max(0.2, t.tiltSensitivity)) * DEG;
      const dz = t.tiltDeadzoneDeg * DEG;
      const shape = (a: number) => {
        const m = Math.max(0, Math.abs(a) - dz) / (range - dz);
        return Math.sign(a) * Math.min(1, m) ** 1.25; // gentle near center, full at the edge
      };
      targetRoll = shape(this.rawRoll);
      // Phone flatter than neutral (top tilted away) = push forward = dive.
      targetPitch = -shape(this.rawPitch - this.neutralPitch);
      if (t.invertPitch) targetPitch = -targetPitch;
    } else if (this.drag) {
      const r = 70;
      targetRoll = Math.max(-1, Math.min(1, (this.drag.x - this.drag.x0) / r));
      // Thumb up = nose down, like pushing a stick.
      targetPitch = Math.max(-1, Math.min(1, (this.drag.y - this.drag.y0) / r));
      if (t.invertPitch) targetPitch = -targetPitch;
    }
    this.roll += (targetRoll - this.roll) * k;
    this.pitch += (targetPitch - this.pitch) * k;
    // Settle to exactly zero: the flight model only self-levels the nose on a zero input.
    if (targetRoll === 0 && Math.abs(this.roll) < 0.01) this.roll = 0;
    if (targetPitch === 0 && Math.abs(this.pitch) < 0.01) this.pitch = 0;

    // Little indicator of the current steering, above the buttons.
    this.stickDot.style.transform = `translate(${(this.roll * 26).toFixed(1)}px, ${(-this.pitch * 26).toFixed(1)}px)`;
    this.stickEl.classList.toggle('show', this.tiltActive || this.drag !== null);
    return { pitch: this.pitch, roll: this.roll, flap: this.flapHeld, boost: this.boostHeld };
  }

  get permissionDenied(): boolean {
    return this.permission === 'denied';
  }
}
