// Optional local classifier — turns text or a file listing into a {@link Category}, entirely on the
// integrator's side. Only the resulting one-word tag is ever sent. No model, no I/O, no
// dependencies — just keyword and filename heuristics.

import type { Category } from './types.js';

// Keyword signals per category. Order matters only for tie-breaks (see below).
const TOPIC_PATTERNS: ReadonlyArray<[Category, RegExp]> = [
  ['web3', /solidity|ethereum|web3|smart contract|defi|onchain|blockchain|wallet|stablecoin|crypto|erc-?20/g],
  ['web', /react|tailwind|next\.js|frontend|vite|jsx|tsx|css|component/g],
  ['devops', /docker|kubernetes|terraform|kubectl|nginx|ci\/cd|pipeline|deployment/g],
  ['data', /dataset|training data|pandas|embedding|inference|fine-tune|gpu|machine learning/g],
  ['systems', /goroutine|borrow checker|mutex|concurrency|memory safety|rustc/g],
];

/**
 * Classify free text (a prompt, a description, recent transcript) into a category by keyword count.
 * Returns the strongest category, or `general` if no category reaches `minHits` (default 3) — the
 * default threshold, so weak/ambiguous text stays `general` rather than guessing.
 */
export function classify(text: string, opts: { minHits?: number } = {}): Category {
  const minHits = opts.minHits ?? 3;
  const hay = text.toLowerCase();
  let best: Category = 'general';
  let bestN = 0;
  // Iterate in fixed order and keep the first strict maximum, so equal scores tie-break
  // deterministically (fixed category order, not map iteration order).
  for (const [cat, re] of TOPIC_PATTERNS) {
    const n = (hay.match(re) ?? []).length;
    if (n > bestN) {
      best = cat;
      bestN = n;
    }
  }
  return bestN >= minHits ? best : 'general';
}

// Filename → category signals, evaluated in priority order (web3 before devops before web …) so a
// Solidity repo that also has a package.json classifies as web3.
const FILE_SIGNALS: ReadonlyArray<[Category, (name: string) => boolean]> = [
  ['web3', (n) => n === 'foundry.toml' || n.endsWith('.sol') || n.startsWith('hardhat.config.')],
  ['devops', (n) => n === 'Dockerfile' || n.endsWith('.tf')],
  ['web', (n) => n === 'package.json'],
  ['data', (n) => n === 'requirements.txt' || n.endsWith('.py')],
  ['systems', (n) => n === 'Cargo.toml' || n === 'go.mod'],
];

/**
 * Classify by a list of file/dir names you already have (basenames, not full paths — the SDK does
 * no filesystem I/O so it stays universal). Returns the first matching category in priority order,
 * or `general`. For Node integrators, pass e.g. `fs.readdirSync(cwd)`.
 */
export function classifyFiles(names: Iterable<string>): Category {
  const list = [...names];
  for (const [cat, test] of FILE_SIGNALS) {
    if (list.some(test)) return cat;
  }
  return 'general';
}
