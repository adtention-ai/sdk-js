// Terminal safety. Ad copy is advertiser-submitted and may be rendered into a terminal / status
// line, so it MUST be stripped of escape/control bytes before display. The server sanitizes too;
// this is the client-side half of a non-negotiable terminal-safety guarantee. We sanitize on the
// way OUT of the client so a caller can never forget to.

// Full ANSI escape sequences: CSI (e.g. color `\x1b[31m`, cursor moves, screen clears) and OSC
// (e.g. hyperlinks `\x1b]8;;URL\x07`). Stripped wholesale so no literal `[31m` litter is left behind.
const CSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
const OSC_RE = /\x1b\][\s\S]*?(?:\x07|\x1b\\)/g;

// Every remaining C0 control byte (incl. a lone ESC, tab, newline, carriage return) plus DEL. This
// is the actual safety guarantee: with no control byte reaching the terminal, nothing can be
// interpreted as an escape, and tabs/newlines can't break a line-oriented log.
const CONTROL_RE = /[\x00-\x1f\x7f]/g;

/**
 * Make advertiser text safe to render: strip ANSI escape sequences and every control byte, then
 * trim. The result is a single line of plain text, safe to print to a terminal/status line or write
 * to a TSV/JSON log. Always applied by {@link AdtentionClient.serve} before returning ad text.
 */
export function sanitizeAd(s: string): string {
  return s.replace(CSI_RE, '').replace(OSC_RE, '').replace(CONTROL_RE, '').trim();
}

/** Strip ANSI escape sequences (leaves other text intact). For measuring rendered width. */
export function stripAnsi(s: string): string {
  return s.replace(CSI_RE, '').replace(OSC_RE, '');
}

/** Visible width of a string in code points, ignoring ANSI escape sequences. */
export function visibleWidth(s: string): number {
  return [...stripAnsi(s)].length;
}
