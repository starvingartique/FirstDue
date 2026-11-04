// Settings menu, implemented from scratch Nov 3. Sound volumes, color
// blind mode, and text size. Every option takes effect at once: volumes
// drive the live WebAudio gains, color blind mode swaps the UI palette,
// text size sets the root font size. Persisted in localStorage under
// fd.settings, same as the wording choice.

import { setSoundLevels } from "./sound";
import { sayLine } from "./wording";

const STORE_KEY = "fd.settings";

export type ColorblindMode = "off" | "safe" | "contrast";
export type TextSize = "small" | "medium" | "large" | "xl";

export interface GameSettings {
  /** Master volume 0-100. */
  master: number;
  /** Alerts volume 0-100. */
  alerts: number;
  colorblind: ColorblindMode;
  textSize: TextSize;
  /** ACE orientation: mirror the body so the patient faces the viewer. */
  aceOrientation: boolean;
}

export const DEFAULT_SETTINGS: GameSettings = {
  master: 60,
  alerts: 80,
  colorblind: "off",
  textSize: "medium",
  aceOrientation: false
};

/**
 * Text size as page zoom. The HUD styles in px, so root font-size alone
 * would change nothing; zoom scales every panel for real. Medium is 1.0,
 * the layout the mockup was drawn against.
 */
const TEXT_ZOOM: Record<TextSize, number> = {
  small: 0.9,
  medium: 1,
  large: 1.15,
  xl: 1.3
};

function clampVolume(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(100, Math.max(0, Math.round(v))) : fallback;
}

export function loadSettings(): GameSettings {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw === null) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<GameSettings>;
    return {
      master: clampVolume(parsed.master, DEFAULT_SETTINGS.master),
      alerts: clampVolume(parsed.alerts, DEFAULT_SETTINGS.alerts),
      colorblind: parsed.colorblind === "safe" || parsed.colorblind === "contrast" ? parsed.colorblind : "off",
      textSize:
        parsed.textSize === "small" ||
        parsed.textSize === "medium" ||
        parsed.textSize === "large" ||
        parsed.textSize === "xl"
          ? parsed.textSize
          : "medium",
      aceOrientation: parsed.aceOrientation === true
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: GameSettings): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(s));
  } catch {
    // Storage blocked: lasts for this session only.
  }
}

/** Apply every setting to the live game at once. */
export function applySettings(s: GameSettings): void {
  document.body.dataset["cb"] = s.colorblind;
  document.body.dataset["text"] = s.textSize;
  document.body.dataset["ace"] = s.aceOrientation ? "mirror" : "std";
  document.body.style.zoom = String(TEXT_ZOOM[s.textSize]);
  setSoundLevels(s.master / 100, s.alerts / 100);
}

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (node === null) throw new Error(`missing #${id} in index.html`);
  return node as T;
}

/**
 * Keybindings verified in code, display only. Sources: H/Esc/Ctrl+H and
 * 1-8 plus W/A/S/D/Z/X in src/ui/acm/shell.ts, 1-4/V/G/F1 in
 * src/engine/input.ts, Enter in src/ui/chatDock.ts, Enter/Space on doll
 * regions in src/ui/bodyDoll.ts. medicalMenu, loop, and speedBar bind no
 * keys. Remapping is left for after submission: no controls here.
 */
export interface KeybindingGroup {
  group: string;
  rows: { key: string; does: string }[];
  note?: string;
}

export const KEYBINDING_GROUPS: KeybindingGroup[] = [
  {
    group: "Medical menu",
    rows: [
      { key: "H", does: "Open and close the medical menu" },
      { key: "Esc", does: "Close the menu, or its pop-up first" },
      { key: "Ctrl+H (hold)", does: "Peek the status card, menu closed" }
    ],
    note: "Some browsers eat Ctrl+H for History, so peek may not work in all browsers."
  },
  {
    group: "Categories (menu open)",
    rows: [{ key: "1 to 8", does: "Pick a category: Triage, Examine, Bleeding, Airway, Breathing, Meds, Lines, Monitor" }]
  },
  {
    group: "Body parts (menu open)",
    rows: [
      { key: "W", does: "Head" },
      { key: "S", does: "Chest" },
      { key: "A / D", does: "Arms, screen left / screen right" },
      { key: "Z / X", does: "Legs, screen left / screen right" }
    ],
    note: "A and Z pick the screen-left limbs, D and X the screen-right limbs. Default orientation puts patient-left on viewer-left, so A is the left arm; the mirrored ACE orientation swaps them."
  },
  {
    group: "Camera (menu closed)",
    rows: [{ key: "1 to 4", does: "Switch spot: Patient, Bag, Bystander, Partner" }]
  },
  {
    group: "Talk and package",
    rows: [
      { key: "V", does: "Focus chat to talk" },
      { key: "G", does: "Package for transport" }
    ]
  },
  { group: "Debug", rows: [{ key: "F1", does: "Live engine state overlay" }] },
  {
    group: "Chat box",
    rows: [{ key: "Enter", does: "Send the typed line" }]
  },
  {
    group: "Paper doll",
    rows: [{ key: "Enter or Space", does: "Open the focused region" }]
  }
];

export class SettingsPanel {
  private readonly root = el("settings-panel");
  private readonly toggle = el<HTMLButtonElement>("settings-btn");
  private settings: GameSettings;

  constructor(onChange?: (s: GameSettings) => void) {
    this.settings = loadSettings();
    applySettings(this.settings);
    onChange?.(this.settings);
    this.toggle.addEventListener("click", () => {
      this.root.hidden = !this.root.hidden;
      if (!this.root.hidden) this.render();
    });
    this.render();
  }

  get current(): GameSettings {
    return this.settings;
  }

  /** Open from anywhere (HUD button or title screen). Same menu. */
  open(): void {
    this.root.hidden = false;
    this.render();
  }

  /** Wording toggle: rebuild the labels if the menu is showing. */
  reword(): void {
    if (!this.root.hidden) this.render();
  }

  private update(patch: Partial<GameSettings>): void {
    this.settings = { ...this.settings, ...patch };
    saveSettings(this.settings);
    applySettings(this.settings);
  }

  private slider(label: string, value: number, onPick: (v: number) => void): HTMLElement {
    const wrap = document.createElement("label");
    wrap.className = "settings-row";
    const caption = document.createElement("span");
    caption.textContent = `${label}: ${value}`;
    const input = document.createElement("input");
    input.type = "range";
    input.min = "0";
    input.max = "100";
    input.step = "5";
    input.value = String(value);
    input.setAttribute("aria-label", label);
    input.addEventListener("input", () => {
      const v = Number(input.value);
      caption.textContent = `${label}: ${v}`;
      onPick(v);
    });
    // Range drags must not leak into game hotkeys or look controls.
    input.addEventListener("keydown", (event) => event.stopPropagation());
    wrap.append(caption, input);
    return wrap;
  }

  private select(
    label: string,
    options: { value: string; label: string }[],
    current: string,
    onPick: (v: string) => void
  ): HTMLElement {
    const wrap = document.createElement("label");
    wrap.className = "settings-row";
    const caption = document.createElement("span");
    caption.textContent = label;
    const sel = document.createElement("select");
    for (const o of options) {
      const opt = document.createElement("option");
      opt.value = o.value;
      opt.textContent = o.label;
      if (o.value === current) opt.selected = true;
      sel.appendChild(opt);
    }
    sel.addEventListener("change", () => onPick(sel.value));
    wrap.append(caption, sel);
    return wrap;
  }

  private render(): void {
    const s = this.settings;
    this.root.innerHTML = "";
    const head = document.createElement("div");
    head.className = "settings-head";
    head.textContent = "Settings";
    const close = document.createElement("button");
    close.type = "button";
    close.className = "settings-close";
    close.textContent = "Close";
    close.addEventListener("click", () => {
      this.root.hidden = true;
    });
    this.root.append(head, close);
    this.root.appendChild(
      this.slider("Master volume", s.master, (v) => this.update({ master: v }))
    );
    this.root.appendChild(
      this.slider("Alerts volume", s.alerts, (v) => this.update({ alerts: v }))
    );
    this.root.appendChild(
      this.select(
        "Color blind mode",
        [
          { value: "off", label: "Off" },
          { value: "safe", label: "Colorblind safe" },
          { value: "contrast", label: "High contrast" }
        ],
        s.colorblind,
        (v) => this.update({ colorblind: v as ColorblindMode })
      )
    );
    this.root.appendChild(
      this.select(
        "Text size",
        [
          { value: "small", label: "Small" },
          { value: "medium", label: "Medium" },
          { value: "large", label: "Large" },
          { value: "xl", label: "Extra large" }
        ],
        s.textSize,
        (v) => this.update({ textSize: v as TextSize })
      )
    );
    this.root.appendChild(
      this.select(
        "ACE orientation (patient facing you)",
        [
          { value: "std", label: "Off: patient left on your left" },
          { value: "mirror", label: "On: patient facing you" }
        ],
        s.aceOrientation ? "mirror" : "std",
        (v) => this.update({ aceOrientation: v === "mirror" })
      )
    );
    const keysHead = document.createElement("div");
    keysHead.className = "settings-head";
    keysHead.textContent = sayLine("Keybindings");
    this.root.appendChild(keysHead);
    for (const group of KEYBINDING_GROUPS) {
      const g = document.createElement("div");
      g.className = "settings-keys-group";
      g.textContent = sayLine(group.group);
      this.root.appendChild(g);
      for (const row of group.rows) {
        const line = document.createElement("div");
        line.className = "settings-keys-row";
        const key = document.createElement("span");
        key.className = "settings-key";
        key.textContent = sayLine(row.key);
        const does = document.createElement("span");
        does.textContent = sayLine(row.does);
        line.append(key, does);
        this.root.appendChild(line);
      }
      if (group.note !== undefined) {
        const note = document.createElement("div");
        note.className = "settings-keys-note";
        note.textContent = sayLine(group.note);
        this.root.appendChild(note);
      }
    }
  }
}
