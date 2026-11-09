/**
 * Shared state that the on-screen touch controls write and the input manager reads.
 * Keeping it a plain object lets the UI layer stay ignorant of the game.
 */
export class TouchState {
  /** Stick vector in screen space (x right, y up), length 0–1. */
  stickX = 0;
  stickY = 0;
  /** Classic layout: steering −1..1 and pedals 0..1. */
  steer = 0;
  gas = 0;
  reverse = 0;
  action = false;
  brake = false;
  private actionEdge = false;
  private enterExitEdge = false;
  private cameraTurnEdge: -1 | 0 | 1 = 0;
  private zoomEdge: -1 | 0 | 1 = 0;
  private pauseEdge = false;
  /** Set whenever a touch control is used; cleared by the input manager each frame. */
  active = false;

  pressAction(): void {
    this.action = true;
    this.actionEdge = true;
    this.active = true;
  }

  releaseAction(): void {
    this.action = false;
  }

  pressEnterExit(): void {
    this.enterExitEdge = true;
    this.active = true;
  }

  turnCamera(direction: -1 | 1): void {
    this.cameraTurnEdge = direction;
    this.active = true;
  }

  zoom(step: -1 | 1): void {
    this.zoomEdge = step;
    this.active = true;
  }

  pressPause(): void {
    this.pauseEdge = true;
  }

  /** Returns and clears the one-frame events. */
  takeEdges(): {
    actionPressed: boolean;
    enterExitPressed: boolean;
    cameraTurn: -1 | 0 | 1;
    zoomStep: -1 | 0 | 1;
    pausePressed: boolean;
  } {
    const edges = {
      actionPressed: this.actionEdge,
      enterExitPressed: this.enterExitEdge,
      cameraTurn: this.cameraTurnEdge,
      zoomStep: this.zoomEdge,
      pausePressed: this.pauseEdge,
    };
    this.actionEdge = false;
    this.enterExitEdge = false;
    this.cameraTurnEdge = 0;
    this.zoomEdge = 0;
    this.pauseEdge = false;
    return edges;
  }

  reset(): void {
    this.stickX = 0;
    this.stickY = 0;
    this.steer = 0;
    this.gas = 0;
    this.reverse = 0;
    this.action = false;
    this.brake = false;
    this.takeEdges();
  }
}
