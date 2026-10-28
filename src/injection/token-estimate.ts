/**
 * Conservative token estimate for context budget enforcement.
 *
 * DSH does not expose the provider tokenizer to plugins. ASCII is budgeted at
 * four characters per token, CJK/full-width characters at one token each, and
 * other non-ASCII at two characters per token, then a 10% safety margin is
 * applied. This over-estimates English punctuation and code slightly, which is
 * the safe direction for a hard prompt budget.
 */
export function estimateTokens(text: string): number {
  let tokens = 0
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0
    if (code <= 0x7f) {
      tokens += 0.25
    } else if (
      (code >= 0x3040 && code <= 0x30ff) ||
      (code >= 0x3400 && code <= 0x4dbf) ||
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xac00 && code <= 0xd7af) ||
      (code >= 0xff00 && code <= 0xffef) ||
      (code >= 0x1f300 && code <= 0x1faff)
    ) {
      tokens += 1
    } else {
      tokens += 0.5
    }
  }
  return Math.max(1, Math.ceil(tokens * 1.1))
}
