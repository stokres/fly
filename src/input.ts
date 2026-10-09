// Keyboard, mouse and gamepad, merged into one flight intent per frame.
//
// Mouse: click the game to capture the pointer. Mouse movement pushes a virtual stick that
// springs back to center, so small moves give gentle turns and a held push keeps turning.
// Left button flaps, right button (or Shift) boosts.
import { tuning } from './tuning';

export interface FlightInput {
  /** -1..1, positive = nose up. */
  pitch: number;
  /** -1..1, positive = bank right. */
  roll: number;
  /** Held: flaps repeatedly while held, limited by cooldown and energy. */
  flap: boolean;
  /** Held: boost, burning energy. */
  boost: boolean;
}

const PITCH_DOWN = ['KeyW', 'ArrowUp'];
const PITCH_UP = ['KeyS', 'ArrowDown'];
const ROLL_LEFT = ['KeyA', 'ArrowLeft'];
const ROLL_RIGHT = ['KeyD', 'ArrowRight'];
const FLAP = ['Space'];
const BOOST = ['ShiftLeft', 'ShiftRight'];

export class Input {
  private held = new Set<string>();
  private pressed = new Set<string>();
  /** Virtual stick driven by the mouse, each axis -1..1. */
  readonly mouseStick = { x: 0, y: 0 };
  private mouseButtons = 0;
  private locked = false;
  /** Set when the player used the mouse recently; the HUD shows the stick then. */
  mouseActive = false;
  /** When false (menus open), the pointer is never captured. */
  captureEnabled = true;

  constructor(canvas: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      if (!e.repeat) this.pressed.add(e.code);
      this.held.add(e.code);
      if (e.code === 'Space' || e.code.startsWith('Arrow') || e.code === 'Tab') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.held.delete(e.code));
    window.addEventListener('blur', () => {
      this.held.clear();
      this.mouseButtons = 0;
    });

    canvas.addEventListener('mousedown', (e) => {
      if (!this.locked && this.captureEnabled) {
        void canvas.requestPointerLock?.();
        return; // the capturing click doesn't also flap
      }
      this.mouseButtons = e.buttons;
    });
    window.addEventListener('mouseup', (e) => (this.mouseButtons = e.buttons));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked) {
        this.mouseStick.x = this.mouseStick.y = 0;
        this.mouseButtons = 0;
      }
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      const k = tuning.input.mouseSensitivity * 0.004;
      const inv = tuning.input.invertPitch ? -1 : 1;
      this.mouseStick.x = clamp(this.mouseStick.x + e.movementX * k);
      // Mouse up = nose up by default (like aiming); invertPitch flips it.
      this.mouseStick.y = clamp(this.mouseStick.y - e.movementY * k * inv);
      this.mouseActive = true;
    });
  }

  get pointerLocked(): boolean {
    return this.locked;
  }

  releasePointer(): void {
    if (this.locked) document.exitPointerLock();
  }

  /** True once per key press; cleared by endFrame(). */
  wasPressed(code: string): boolean {
    return this.pressed.has(code);
  }

  endFrame(): void {
    this.pressed.clear();
  }

  read(dt: number): FlightInput {
    const any = (codes: string[]) => codes.some((c) => this.held.has(c));
    let pitch = (any(PITCH_UP) ? 1 : 0) - (any(PITCH_DOWN) ? 1 : 0);
    let roll = (any(ROLL_RIGHT) ? 1 : 0) - (any(ROLL_LEFT) ? 1 : 0);
    if (tuning.input.invertPitch) pitch = -pitch;
    let flap = any(FLAP);
    let boost = any(BOOST);

    // Mouse stick springs back to center.
    const back = 1 - Math.exp(-tuning.input.mouseReturn * dt);
    this.mouseStick.x -= this.mouseStick.x * back;
    this.mouseStick.y -= this.mouseStick.y * back;
    if (this.locked) {
      if (roll === 0) roll = this.mouseStick.x;
      if (pitch === 0) pitch = this.mouseStick.y;
      flap ||= (this.mouseButtons & 1) !== 0;
      boost ||= (this.mouseButtons & 2) !== 0;
    }

    const pad = firstGamepad();
    if (pad) {
      const dz = tuning.input.gamepadDeadzone;
      const stickX = deadzone(pad.axes[0] ?? 0, dz);
      // Stick forward (negative Y) = nose down, like a flight stick.
      let stickY = deadzone(pad.axes[1] ?? 0, dz);
      if (tuning.input.invertPitch) stickY = -stickY;
      if (stickX !== 0) roll = stickX;
      if (stickY !== 0) pitch = stickY;
      flap ||= !!pad.buttons[0]?.pressed || (pad.buttons[7]?.value ?? 0) > 0.5;
      boost ||= !!pad.buttons[1]?.pressed || (pad.buttons[6]?.value ?? 0) > 0.5 || !!pad.buttons[5]?.pressed;
    }
    return { pitch, roll, flap, boost };
  }
}

function clamp(v: number): number {
  return Math.max(-1, Math.min(1, v));
}

function firstGamepad(): Gamepad | null {
  if (!navigator.getGamepads) return null;
  for (const pad of navigator.getGamepads()) if (pad?.connected) return pad;
  return null;
}

function deadzone(value: number, dz: number): number {
  if (Math.abs(value) < dz) return 0;
  return (Math.sign(value) * (Math.abs(value) - dz)) / (1 - dz);
}
