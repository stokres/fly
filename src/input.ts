// Keyboard + gamepad, merged into one flight intent per frame.
import { tuning } from './tuning';

export interface FlightInput {
  /** -1..1, positive = nose up. */
  pitch: number;
  /** -1..1, positive = bank right. */
  roll: number;
  /** Held: flaps repeatedly while held, limited by cooldown and energy. */
  flap: boolean;
}

const PITCH_DOWN = ['KeyW', 'ArrowUp'];
const PITCH_UP = ['KeyS', 'ArrowDown'];
const ROLL_LEFT = ['KeyA', 'ArrowLeft'];
const ROLL_RIGHT = ['KeyD', 'ArrowRight'];
const FLAP = ['Space'];

export class Input {
  private held = new Set<string>();
  private pressed = new Set<string>();

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      if (!e.repeat) this.pressed.add(e.code);
      this.held.add(e.code);
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    });
    target.addEventListener('keyup', (e) => this.held.delete(e.code));
    target.addEventListener('blur', () => this.held.clear());
  }

  /** True once per key press; cleared by endFrame(). */
  wasPressed(code: string): boolean {
    return this.pressed.has(code);
  }

  endFrame(): void {
    this.pressed.clear();
  }

  read(): FlightInput {
    const any = (codes: string[]) => codes.some((c) => this.held.has(c));
    let pitch = (any(PITCH_UP) ? 1 : 0) - (any(PITCH_DOWN) ? 1 : 0);
    let roll = (any(ROLL_RIGHT) ? 1 : 0) - (any(ROLL_LEFT) ? 1 : 0);
    let flap = any(FLAP);

    const pad = firstGamepad();
    if (pad) {
      const dz = tuning.input.gamepadDeadzone;
      const stickX = deadzone(pad.axes[0] ?? 0, dz);
      // Stick forward (negative Y) = nose down, like a flight stick.
      const stickY = deadzone(pad.axes[1] ?? 0, dz);
      if (stickX !== 0) roll = stickX;
      if (stickY !== 0) pitch = stickY;
      flap ||= !!pad.buttons[0]?.pressed || (pad.buttons[7]?.value ?? 0) > 0.5;
    }

    if (tuning.input.invertPitch) pitch = -pitch;
    return { pitch, roll, flap };
  }
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
