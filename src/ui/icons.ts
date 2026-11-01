// Line icons for the ACM menu rail and action rows. 24x24, stroke only, so
// they inherit currentColor and read in any state color. Inline SVG strings,
// no external assets.

const wrap = (inner: string): string =>
  `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;

export const ICONS = {
  examine: wrap('<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>'),
  airway: wrap('<path d="M8 3v5a4 4 0 0 0 8 0V3"/><path d="M12 12v9"/><path d="M9 21h6"/>'),
  breathing: wrap('<path d="M12 4v8"/><path d="M12 12c-2 0-6 1-6 6 0 2 1 3 3 3s3-2 3-5"/><path d="M12 12c2 0 6 1 6 6 0 2-1 3-3 3s-3-2-3-5"/>'),
  circulation: wrap('<path d="M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11z"/>'),
  meds: wrap('<rect x="3" y="9" width="18" height="6" rx="3" transform="rotate(-35 12 12)"/><path d="M9.5 8.5l5 7"/>'),
  lines: wrap('<path d="M14 3l7 7"/><path d="M17.5 6.5L8 16l-3 1 1-3 9.5-9.5"/><path d="M5 19l-2 2"/>'),
  monitor: wrap('<rect x="3" y="4" width="18" height="13" rx="1"/><path d="M6 11h3l2-3 2 6 2-3h3"/><path d="M9 21h6"/>'),
  talk: wrap('<path d="M4 5h16v10H9l-5 4z"/>'),
  tourniquet: wrap('<rect x="3" y="9" width="18" height="6" rx="1"/><path d="M12 5v14"/><circle cx="12" cy="5" r="1.5"/>'),
  gauze: wrap('<rect x="4" y="5" width="16" height="14" rx="1"/><path d="M4 10h16M4 14h16"/>'),
  hand: wrap('<path d="M8 12V5a1.5 1.5 0 0 1 3 0v6"/><path d="M11 11V4a1.5 1.5 0 0 1 3 0v7"/><path d="M14 11V6a1.5 1.5 0 0 1 3 0v8a6 6 0 0 1-6 6h-1a5 5 0 0 1-4-2l-3-4a1.5 1.5 0 0 1 2.3-2L8 14"/>'),
  bandage: wrap('<rect x="2" y="8" width="20" height="8" rx="4"/><rect x="8" y="8" width="8" height="8"/>'),
  mask: wrap('<path d="M5 10c0-3 3-5 7-5s7 2 7 5-2 8-7 8-7-5-7-8z"/><path d="M12 18v3"/>'),
  bag: wrap('<ellipse cx="9" cy="12" rx="6" ry="5"/><path d="M15 12h6"/>'),
  drop: wrap('<path d="M12 3s5 6 5 10a5 5 0 0 1-10 0c0-4 5-10 5-10z"/><path d="M10 14a2 2 0 0 0 2 2"/>'),
  syringe: wrap('<path d="M18 2l4 4"/><path d="M20 4l-9 9"/><path d="M15 6l3 3"/><path d="M11 9l4 4-6 6H5v-4z"/><path d="M5 19l-3 3"/>'),
  truck: wrap('<path d="M2 7h11v9H2z"/><path d="M13 10h4l3 3v3h-7"/><circle cx="6" cy="17" r="2"/><circle cx="17" cy="17" r="2"/>'),
  blanket: wrap('<path d="M3 6h18v12H3z"/><path d="M3 10l18 4M3 14l18-4"/>'),
  suction: wrap('<path d="M4 20l7-7"/><path d="M11 13c2-2 2-6 6-8l3 3c-2 4-6 4-8 6"/>'),
  vitals: wrap('<path d="M3 12h4l2-5 4 10 2-5h6"/>'),
  scissors: wrap('<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M8.5 8.5L20 20M8.5 15.5L20 4"/>'),
  roll: wrap('<path d="M4 12a8 8 0 0 1 16 0"/><path d="M20 12a8 8 0 0 1-16 0"/><path d="M16 8l4 4 4-4"/>'),
  check: wrap('<path d="M5 12l5 5 9-10"/>'),
  remove: wrap('<path d="M6 6l12 12M18 6L6 18"/>'),
  chevron: wrap('<path d="M9 6l6 6-6 6"/>'),
  collapse: wrap('<path d="M15 6l-6 6 6 6"/>'),
  expand: wrap('<path d="M9 6l6 6-6 6"/>')
} as const;

export type IconName = keyof typeof ICONS;

/** Pick an action-row icon from its label. First match wins. */
export function iconForAction(label: string): IconName {
  const l = label.toLowerCase();
  const rules: [RegExp, IconName][] = [
    [/remove|pull line|release|lift the edge|swap holder/, "remove"],
    [/cat|tourniquet|belt/, "tourniquet"],
    [/pack/, "gauze"],
    [/dressing/, "bandage"],
    [/pressure bag/, "drop"],
    [/pressure|take over/, "hand"],
    [/expose|shears/, "scissors"],
    [/log roll/, "roll"],
    [/inspect|palpate|reassess|check the back/, "examine"],
    [/fetch|truck/, "truck"],
    [/wrap|clothing/, "blanket"],
    [/suction/, "suction"],
    [/opa|npa|supraglottic|intubate|tube/, "airway"],
    [/squeeze|bvm|fit mask/, "bag"],
    [/o2|reservoir|cylinder|oxygen/, "mask"],
    [/iv|io|drill|hang bag|fluid/, "lines"],
    [/push|prep|drug/, "syringe"],
    [/pulse|bp |bp\(|rr:|spo2|etco2|nibp|cap refill|pupils|glucose|temperature|skin|lung|gcs|monitor|switch to l/, "vitals"],
    [/ask|talk/, "talk"]
  ];
  for (const [re, icon] of rules) if (re.test(l)) return icon;
  return "chevron";
}
