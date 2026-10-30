// Mouse and touch input. Drag looks around from the fixed spot; a press with
// almost no travel counts as a click for region picking. Same pointer path
// serves mouse and touch.

export interface InputHandlers {
  onLook: (dx: number, dy: number) => void;
  onTap: (x: number, y: number) => void;
  onSpotKey: (index: number) => void;
  onDebugKey: () => void;
  onTalkKey: () => void;
  /** Any other single-letter hotkey (pause, tab jumps). Lowercased. */
  onHotkey?: (key: string) => void;
}

const TAP_SLOP_PX = 6;

export function bindInput(canvas: HTMLCanvasElement, handlers: InputHandlers): void {
  let lastX = 0;
  let lastY = 0;
  let dragging = false;
  let traveled = 0;

  canvas.addEventListener("pointerdown", (event) => {
    canvas.setPointerCapture(event.pointerId);
    lastX = event.clientX;
    lastY = event.clientY;
    traveled = 0;
    dragging = true;
  });

  canvas.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;
    traveled += Math.abs(dx) + Math.abs(dy);
    handlers.onLook(dx, dy);
  });

  canvas.addEventListener("pointerup", (event) => {
    dragging = false;
    if (traveled <= TAP_SLOP_PX) {
      handlers.onTap(event.clientX, event.clientY);
    }
  });

  canvas.addEventListener("pointercancel", () => {
    dragging = false;
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "F1") {
      event.preventDefault();
      handlers.onDebugKey();
      return;
    }
    // Never steal keys while the player types (drug amounts, talk line).
    const t = event.target;
    if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === "1" || event.key === "2" || event.key === "3") {
      handlers.onSpotKey(Number(event.key) - 1);
      return;
    }
    if (event.key === "v" || event.key === "V") {
      event.preventDefault();
      handlers.onTalkKey();
      return;
    }
    if (event.key.length === 1 && handlers.onHotkey !== undefined) {
      handlers.onHotkey(event.key.toLowerCase());
    }
  });

  // Touch drag must move the view, never scroll the page.
  canvas.style.touchAction = "none";
}
