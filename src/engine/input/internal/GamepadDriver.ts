export class GamepadDriver {
  private readonly deadzone = 0.15;
  private activeGamepadIndex: number | null = null;

  constructor() {
    this.handleGamepadConnected = this.handleGamepadConnected.bind(this);
    this.handleGamepadDisconnected = this.handleGamepadDisconnected.bind(this);

    window.addEventListener("gamepadconnected", this.handleGamepadConnected);
    window.addEventListener("gamepaddisconnected", this.handleGamepadDisconnected);
  }

  public dispose(): void {
    window.removeEventListener("gamepadconnected", this.handleGamepadConnected);
    window.removeEventListener("gamepaddisconnected", this.handleGamepadDisconnected);
  }

  public get isConnected(): boolean {
    return this.activeGamepadIndex !== null && this.getGamepad() !== null;
  }

  public getGamepadName(): string {
    const pad = this.getGamepad();
    return pad ? pad.id : "Nenhum Gamepad Conectado";
  }

  public isButtonDown(buttonIndex: number): boolean {
    const pad = this.getGamepad();
    if (!pad || buttonIndex >= pad.buttons.length) return false;
    return pad.buttons[buttonIndex].pressed;
  }

  public getAxisValue(axisIndex: number): number {
    const pad = this.getGamepad();
    if (!pad || axisIndex >= pad.axes.length) return 0;

    const rawValue = pad.axes[axisIndex];
    if (Math.abs(rawValue) < this.deadzone) return 0;

    // Aplicação de curva de interpolação suave para remover zonas mortas nos analógicos
    const sign = Math.sign(rawValue);
    return sign * ((Math.abs(rawValue) - this.deadzone) / (1 - this.deadzone));
  }

  private getGamepad(): Gamepad | null {
    if (this.activeGamepadIndex === null) return null;
    const gamepads = navigator.getGamepads();
    return gamepads[this.activeGamepadIndex] || null;
  }

  private handleGamepadConnected(event: GamepadEvent): void {
    console.log(`[GamepadDriver] Gamepad conectado [${event.gamepad.index}]: ${event.gamepad.id}`);
    if (this.activeGamepadIndex === null) {
      this.activeGamepadIndex = event.gamepad.index;
    }
  }

  private handleGamepadDisconnected(event: GamepadEvent): void {
    console.log(`[GamepadDriver] Gamepad desconectado [${event.gamepad.index}]`);
    if (this.activeGamepadIndex === event.gamepad.index) {
      this.activeGamepadIndex = null;
      const gamepads = navigator.getGamepads();
      for (const pad of gamepads) {
        if (pad && pad.connected) {
          this.activeGamepadIndex = pad.index;
          break;
        }
      }
    }
  }
}