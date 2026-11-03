// Scene log, bottom right across from the chat: the recent actions the
// player has done, in order, including the blood sweep. Talk lines stay in
// the chat dock, so this panel skips kind "talk". No filters in this pass;
// none existed in the clean codebase, and Wyatt's full log stays out.

import type { Sim } from "../sim/engine";
import { word } from "./wording";

const ROWS = 8;

function fmtClock(t_s: number): string {
  return `${String(Math.floor(t_s / 60)).padStart(2, "0")}:${String(t_s % 60).padStart(2, "0")}`;
}

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (node === null) throw new Error(`missing #${id} in index.html`);
  return node as T;
}

export class SceneLog {
  private readonly root = el("scene-log");
  private readonly rows = el("scene-log-rows");
  private sim: Sim | null = null;
  private signature = "";

  /** Bind to a fresh sim on dispatch accept. Null hides the panel. */
  bind(sim: Sim | null): void {
    this.sim = sim;
    this.signature = "";
    this.root.hidden = sim === null;
    this.refresh();
  }

  /** Called every sim tick: re-render only when the log tail changes. */
  refresh(): void {
    const sim = this.sim;
    if (sim === null || this.root.hidden) return;
    const tail = sim.log.filter((e) => e.kind !== "talk").slice(-ROWS);
    const last = tail[tail.length - 1];
    const sig = `${sim.log.length}|${last?.t_s ?? -1}|${last?.text ?? ""}`;
    if (sig === this.signature) return;
    this.signature = sig;
    this.rows.innerHTML = "";
    for (const event of tail) {
      const div = document.createElement("div");
      div.textContent = `T+${fmtClock(event.t_s)} [${event.kind}] ${event.text}`;
      this.rows.appendChild(div);
      word(div);
    }
  }
}
