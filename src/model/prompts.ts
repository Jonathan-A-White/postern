// src/model/prompts.ts — pure: the check of a typed call '/<name> [--flag value]...'
// against the saved prompts' signatures, and the prompts the composer offers while the
// name is still being typed. It fills nothing in: defaults are the Mayor's side, and
// the text he typed is the call that goes out.
import type { Prompt, PromptOption } from '../data/db';

export type CallCheck = { ok: true; name: string; options: Record<string, string> } | { ok: false; error: string };

/** Does this text claim to be a call? Only text whose very first character is '/'. */
export function beginsCall(text: string): boolean {
  return text.startsWith('/');
}

/**
 * Splits a call on whitespace; a word in single or double quotes stays whole, quotes
 * removed. undefined when a quote is never closed.
 */
export function tokenizeCall(text: string): string[] | undefined {
  const tokens: string[] = [];
  let current = '';
  let started = false;
  let quote: string | undefined;
  for (const char of text) {
    if (quote) {
      if (char === quote) quote = undefined;
      else current += char;
    } else if (char === '"' || char === "'") {
      quote = char;
      started = true;
    } else if (/\s/.test(char)) {
      if (started) tokens.push(current);
      current = '';
      started = false;
    } else {
      current += char;
      started = true;
    }
  }
  if (quote) return undefined;
  if (started) tokens.push(current);
  return tokens;
}

/** The prompts to offer: while the text is '/' and the start of a name, no space yet. */
export function matchPrompts(text: string, prompts: Prompt[]): Prompt[] {
  if (!/^\/[^\s]*$/.test(text)) return [];
  const typed = text.slice(1);
  return prompts.filter((prompt) => prompt.name.startsWith(typed));
}

// Go's time.ParseDuration: an optional sign, then one or more number+unit pieces; a bare '0' is allowed.
const GO_DURATION = /^[-+]?(?:(?:\d+(?:\.\d*)?|\.\d+)(?:ns|us|µs|μs|ms|s|m|h))+$/;

function isDuration(value: string): boolean {
  return /^[-+]?0$/.test(value) || GO_DURATION.test(value);
}

function badValue(option: PromptOption): string {
  switch (option.type) {
    case 'duration':
      return `${option.flag} wants a duration like 30m`;
    case 'int':
      return `${option.flag} wants a whole number`;
    default:
      return `${option.flag} wants a value`;
  }
}

function valueFits(option: PromptOption, value: string): boolean {
  switch (option.type) {
    case 'duration':
      return isDuration(value);
    case 'int':
      return /^[-+]?\d+$/.test(value);
    case 'bool':
      return value === 'true' || value === 'false';
    default:
      return true;
  }
}

/** Checks a text beginning '/' against the prompts: a good call, or the one line saying what is wrong. */
export function checkPromptCall(text: string, prompts: Prompt[]): CallCheck {
  const tokens = tokenizeCall(text);
  if (!tokens) return { ok: false, error: 'A quote is not closed' };
  const word = tokens[0] ?? '/';
  if (word === '/') return { ok: false, error: 'Choose a prompt from the list' };
  const name = word.slice(1);
  const prompt = prompts.find((candidate) => candidate.name === name);
  if (!prompt) return { ok: false, error: `Unknown prompt /${name}` };

  const options: Record<string, string> = {};
  for (let at = 1; at < tokens.length; at += 1) {
    const flag = tokens[at];
    if (!flag.startsWith('--')) return { ok: false, error: `Expected an option like ${prompt.signature[0]?.flag ?? '--option'}, not "${flag}"` };
    const option = prompt.signature.find((candidate) => candidate.flag === flag);
    if (!option) return { ok: false, error: `/${name} has no option ${flag}` };
    if (flag in options) return { ok: false, error: `${flag} is given twice` };
    const next = tokens[at + 1];
    if (option.type === 'bool') {
      // on its own it means true; 'true' or 'false' after it says so
      if (next === 'true' || next === 'false') {
        options[flag] = next;
        at += 1;
      } else options[flag] = 'true';
      continue;
    }
    if (next === undefined || next.startsWith('--')) return { ok: false, error: badValue(option) };
    if (!valueFits(option, next)) return { ok: false, error: badValue(option) };
    options[flag] = next;
    at += 1;
  }
  const missing = prompt.signature.find((option) => option.required && !(option.flag in options));
  if (missing) return { ok: false, error: `/${name} needs ${missing.flag}` };
  return { ok: true, name, options };
}

/** What the composer shows in grey after the text: `text` is the whole element, `rest` what taking it adds to the box. */
export interface Suggestion {
  kind: 'option' | 'value';
  text: string;
  rest: string;
}

function asWord(value: string): string {
  return /\s/.test(value) ? `"${value}"` : value;
}

/**
 * The next likely element of a call, zsh-style: a half-typed option ('-', '--', '--du')
 * completes to the first option not yet given, with a space after; after a complete option
 * name and a space, its default. Nothing when the text is not a call to a known prompt, when
 * every option is given, or when the option has no default. Never fills anything in itself.
 */
export function suggestNext(text: string, prompts: Prompt[]): Suggestion | undefined {
  if (!beginsCall(text)) return undefined;
  const tokens = tokenizeCall(text);
  if (!tokens || tokens.length === 0) return undefined;
  const trailing = /\s$/.test(text);
  if (tokens.length === 1 && !trailing) return undefined; // still the name
  const prompt = prompts.find((candidate) => candidate.name === tokens[0].slice(1));
  if (!prompt) return undefined;

  const done = trailing ? tokens.slice(1) : tokens.slice(1, -1);
  const partial = trailing ? undefined : tokens[tokens.length - 1];
  const given = new Set<string>();
  let awaiting: PromptOption | undefined;
  for (let at = 0; at < done.length; at += 1) {
    const option = prompt.signature.find((candidate) => candidate.flag === done[at]);
    if (!option) return undefined;
    given.add(option.flag);
    if (option.type === 'bool') {
      if (done[at + 1] === 'true' || done[at + 1] === 'false') at += 1;
    } else if (at + 1 < done.length) at += 1;
    else awaiting = option;
  }

  if (awaiting) {
    const value = awaiting.default;
    if (!value || partial?.startsWith('-')) return undefined;
    const word = asWord(value);
    const typed = partial ?? '';
    if (!word.startsWith(typed) || word === typed) return undefined;
    return { kind: 'value', text: word, rest: word.slice(typed.length) };
  }
  if (partial === undefined || !partial.startsWith('-')) return undefined;
  const option = prompt.signature.find((candidate) => !given.has(candidate.flag) && candidate.flag.startsWith(partial) && candidate.flag !== partial);
  if (!option) return undefined;
  return { kind: 'option', text: option.flag, rest: `${option.flag.slice(partial.length)} ` };
}

/**
 * True while the call's last word is the start of an option still being typed ('--', '--du',
 * even a bare '--duration' with no space after it): that is not an error yet. A fault earlier
 * in the call still is one, and so is a complete unknown option.
 */
export function halfTypedOption(text: string, prompts: Prompt[]): boolean {
  if (!beginsCall(text) || /\s$/.test(text)) return false;
  const raw = text.match(/\S+$/)?.[0];
  if (!raw || !raw.startsWith('-') || /["']/.test(raw)) return false;
  const tokens = tokenizeCall(text);
  if (!tokens || tokens.length < 2) return false;
  const name = tokens[0].slice(1);
  const prompt = prompts.find((candidate) => candidate.name === name);
  if (!prompt || !prompt.signature.some((option) => option.flag.startsWith(raw))) return false;
  const before = checkPromptCall(text.slice(0, text.length - raw.length), prompts);
  return before.ok || before.error.startsWith(`/${name} needs `);
}
