// Title screen, implemented from scratch Nov 3. First thing the player
// sees: the title animation full screen behind the title UI. WebM plays
// first with MP4 as the fallback source, looped and muted. A static
// title card sits behind the video as the base layer, so a missing or
// unplayable video never leaves a blank screen (no logo image file
// exists in the repo, so the card carries the styled title text).
// Reduced motion skips the video and shows the card. Start Game opens
// the fiction disclaimer; Continue starts the existing level flow,
// Back returns here. Buttons only, no new hotkeys.

import logoPng from "../../assets/First_Due__Paramedic_Simulator.png";
import titleMp4 from "../../assets/title-animation.mp4";
import titleWebm from "../../assets/title-animation.webm";
import { DISCLAIMER_TEXT } from "./disclaimer";
import { sayLine } from "./wording";

export interface TitleHooks {
  /** Continue pressed: start the existing game flow (level select). */
  onStart: () => void;
  /** Open the existing settings menu. Never gated on the disclaimer. */
  onSettings: () => void;
}

export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export class TitleScreen {
  private readonly root: HTMLElement;
  private readonly hooks: TitleHooks;
  private readonly modal: HTMLElement;

  constructor(root: HTMLElement, hooks: TitleHooks) {
    this.root = root;
    this.hooks = hooks;
    this.root.className = "title-root";
    this.root.hidden = true;

    // Static base layer: the logo image full screen, always present,
    // never blank. It is also the fallback when the video cannot play
    // and the full background under reduced motion.
    const card = document.createElement("div");
    card.className = "title-card";
    const cardImg = document.createElement("img");
    cardImg.className = "title-card-img";
    cardImg.src = logoPng;
    cardImg.alt = "";
    cardImg.setAttribute("aria-hidden", "true");
    card.appendChild(cardImg);
    this.root.appendChild(card);

    if (!prefersReducedMotion()) {
      const video = document.createElement("video");
      video.className = "title-video";
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      video.autoplay = true;
      video.poster = logoPng;
      video.setAttribute("aria-hidden", "true");
      const webm = document.createElement("source");
      webm.src = titleWebm;
      webm.type = "video/webm";
      const mp4 = document.createElement("source");
      mp4.src = titleMp4;
      mp4.type = "video/mp4";
      video.append(webm, mp4);
      // If neither source plays, the card underneath stays visible.
      video.addEventListener("error", () => video.remove());
      mp4.addEventListener("error", () => video.remove());
      this.root.appendChild(video);
      void video.play().catch(() => {
        // Autoplay blocked: the static card underneath carries the title.
      });
    }

    // No overlay title words: the animation already carries the logo
    // and "First Due: Paramedic Simulator". Buttons live in the empty
    // bottom third, over the road, below the Star of Life.
    const ui = document.createElement("div");
    ui.className = "title-ui";
    const group = document.createElement("div");
    group.className = "title-btn-group";
    const start = document.createElement("button");
    start.type = "button";
    start.className = "title-btn title-start";
    start.textContent = sayLine("Start Game");
    start.addEventListener("click", () => this.showModal());
    const settings = document.createElement("button");
    settings.type = "button";
    settings.className = "title-btn";
    settings.textContent = sayLine("Settings");
    settings.addEventListener("click", () => this.hooks.onSettings());
    const disclaimerLink = document.createElement("button");
    disclaimerLink.type = "button";
    disclaimerLink.className = "title-link";
    disclaimerLink.textContent = sayLine("Disclaimer");
    disclaimerLink.addEventListener("click", () => this.showModal());
    group.append(start, settings, disclaimerLink);
    ui.appendChild(group);
    this.root.appendChild(ui);

    this.modal = document.createElement("div");
    this.modal.className = "title-modal";
    this.modal.hidden = true;
    const panel = document.createElement("div");
    panel.className = "title-modal-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", sayLine("Disclaimer"));
    const head = document.createElement("div");
    head.className = "title-modal-head";
    head.textContent = sayLine("Disclaimer");
    panel.appendChild(head);
    for (const paragraph of DISCLAIMER_TEXT.split("\n\n")) {
      const p = document.createElement("p");
      p.className = "title-modal-p";
      p.textContent = sayLine(paragraph);
      panel.appendChild(p);
    }
    const row = document.createElement("div");
    row.className = "title-modal-row";
    const back = document.createElement("button");
    back.type = "button";
    back.className = "title-btn";
    back.textContent = sayLine("Back");
    back.addEventListener("click", () => {
      this.modal.hidden = true;
    });
    const cont = document.createElement("button");
    cont.type = "button";
    cont.className = "title-btn title-start";
    cont.textContent = sayLine("Continue");
    cont.addEventListener("click", () => {
      this.modal.hidden = true;
      this.hide();
      this.hooks.onStart();
    });
    row.append(back, cont);
    panel.appendChild(row);
    this.modal.appendChild(panel);
    this.root.appendChild(this.modal);
  }

  show(): void {
    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
  }

  private showModal(): void {
    this.modal.hidden = false;
  }
}
