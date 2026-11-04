// Fiction disclaimer text, Nov 3. Shown on the title screen before play
// and re-openable from the title. Exact wording, byte for byte, in both
// Medical and Plain modes: the text holds no wording-table word, and a
// headless test pins that in both modes so a future table addition
// cannot silently reword it. Paragraphs split on blank lines.

export const DISCLAIMER_TEXT =
  "All characters in First Due are fictional. Any resemblance to real persons is coincidental.\n\n" +
  "This is a work of fiction using real medications and procedures, but it should not be used as medical advice.\n\n" +
  "First Due is a training simulation for paramedic decision-making, for education only. " +
  "It is not a substitute for professional medical training, agency protocols, or advice from a qualified medical professional. " +
  "Always follow your agency protocols and local medical direction in real life.";
