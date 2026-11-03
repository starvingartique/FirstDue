// Speed bar, reimplemented from scratch: Pause, Play, 0.5x, 1x, 2x.
// Pause freezes sim time (the loop zeroes debt, so every sim timer,
// procedure timer, and progress readout holds, including the blood sweep).
// Play resumes at the selected speed. 0.5x runs sim time at half speed so
// the player gets more real time per sim second, 1x is normal, 2x doubles
// it. Rate changes real-time pace only: tick() still advances exactly one
// sim-second, so no sim duration, bleed rate, or procedure length changes.

export type SimRate = 0.5 | 1 | 2;

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (node === null) throw new Error(`missing #${id} in index.html`);
  return node as T;
}

export class SpeedBar {
  private readonly root = el("speed-bar");
  private readonly badge = document.createElement("span");
  private readonly pauseBtn = document.createElement("button");
  private readonly playBtn = document.createElement("button");
  private readonly rateBtns = new Map<SimRate, HTMLButtonElement>();
  private paused = false;
  private rate: SimRate = 1;

  constructor() {
    this.badge.className = "speed-paused";
    this.badge.textContent = "PAUSED";
    this.badge.hidden = true;
    this.pauseBtn.type = "button";
    this.pauseBtn.className = "spot-btn";
    this.pauseBtn.textContent = "Pause";
    this.pauseBtn.title = "Freeze sim time";
    this.playBtn.type = "button";
    this.playBtn.className = "spot-btn";
    this.playBtn.textContent = "Play";
    this.playBtn.title = "Resume at the selected speed";
    this.pauseBtn.addEventListener("click", () => {
      this.paused = true;
      this.render();
    });
    this.playBtn.addEventListener("click", () => {
      this.paused = false;
      this.render();
    });
    this.root.append(this.badge, this.pauseBtn, this.playBtn);
    for (const rate of [0.5, 1, 2] as SimRate[]) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "spot-btn";
      btn.textContent = `${rate}x`;
      btn.title =
        rate === 0.5
          ? "Half speed: more real time per sim second"
          : rate === 1
            ? "Normal speed"
            : "Double speed: less real time per sim second";
      btn.addEventListener("click", () => {
        // Selecting a speed never resumes on its own: Play resumes.
        this.rate = rate;
        this.render();
      });
      this.rateBtns.set(rate, btn);
      this.root.appendChild(btn);
    }
    this.render();
  }

  setVisible(visible: boolean): void {
    this.root.hidden = !visible;
    if (visible) {
      this.paused = false;
      this.rate = 1;
      this.render();
    }
  }

  isPaused(): boolean {
    return this.paused;
  }

  getRate(): number {
    return this.rate;
  }

  private render(): void {
    this.badge.hidden = !this.paused;
    this.pauseBtn.classList.toggle("active", this.paused);
    this.playBtn.classList.toggle("active", !this.paused);
    for (const [rate, btn] of this.rateBtns) {
      btn.classList.toggle("active", rate === this.rate);
    }
  }
}
