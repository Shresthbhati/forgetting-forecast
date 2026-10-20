/**
 * Finds simple formulas in text ("F = m·a", "v = u + at", "E = mc^2") and evaluates them safely.
 * No eval(): a small tokenizer + shunting-yard parser over single-letter variables, numbers, + - * / ^ and parentheses.
 */

export interface Formula {
  /** Normalised display text, e.g. "F = m·a". */
  text: string;
  lhs: string;
  rhs: string;
  vars: string[];
}

type Token = { t: 'num'; v: number } | { t: 'var'; v: string } | { t: 'op'; v: string } | { t: '(' } | { t: ')' };

const OPERATORS = new Set(['+', '-', '*', '/', '^']);
// Short English words that would parse as products of letters ("x = is a ...").
const COMMON_WORDS = new Set('is an as of in on to so be by it or if we he no do go up us me my the and are for can has was not but you our'.split(' '));

function tokenize(expr: string): Token[] | null {
  const tokens: Token[] = [];
  const src = expr.replace(/[·×]/g, '*').replace(/÷/g, '/').replace(/−/g, '-').replace(/\s+/g, ' ').trim();
  for (let i = 0; i < src.length; ) {
    const c = src[i];
    if (c === ' ') { i++; continue; }
    if (/\d|\./.test(c)) {
      const m = /^\d+(?:\.\d+)?/.exec(src.slice(i));
      if (!m) return null;
      tokens.push({ t: 'num', v: Number(m[0]) });
      i += m[0].length;
    } else if (/[A-Za-z]/.test(c)) {
      tokens.push({ t: 'var', v: c });
      i++;
    } else if (OPERATORS.has(c)) {
      tokens.push({ t: 'op', v: c });
      i++;
    } else if (c === '(' || c === ')') {
      tokens.push({ t: c });
      i++;
    } else {
      return null;
    }
  }
  // Implicit multiplication: "mc", "2m", "m(a+b)", "(a)(b)".
  const out: Token[] = [];
  for (const tok of tokens) {
    const prev = out[out.length - 1];
    const prevEndsValue = prev && (prev.t === 'num' || prev.t === 'var' || prev.t === ')');
    const startsValue = tok.t === 'num' || tok.t === 'var' || tok.t === '(';
    if (prevEndsValue && startsValue) {
      // "m2" would be ambiguous (subscript vs product): refuse it rather than guess.
      if (prev.t === 'var' && tok.t === 'num') return null;
      out.push({ t: 'op', v: '*' });
    }
    out.push(tok);
  }
  return out;
}

const PRECEDENCE: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2, '^': 4, neg: 3 };

/** Evaluates `expr` with the given variable values. Returns NaN for anything malformed or non-finite. */
export function evaluate(expr: string, values: Record<string, number>): number {
  const tokens = tokenize(expr);
  if (!tokens || tokens.length === 0) return NaN;
  const output: Array<number | string> = [];
  const stack: string[] = [];
  const applyOp = (op: string): boolean => {
    if (op === 'neg') {
      const a = output.pop();
      if (typeof a !== 'number') return false;
      output.push(-a);
      return true;
    }
    const b = output.pop();
    const a = output.pop();
    if (typeof a !== 'number' || typeof b !== 'number') return false;
    output.push(op === '+' ? a + b : op === '-' ? a - b : op === '*' ? a * b : op === '/' ? a / b : Math.pow(a, b));
    return true;
  };
  let expectValue = true;
  for (const tok of tokens) {
    if (tok.t === 'num') { output.push(tok.v); expectValue = false; }
    else if (tok.t === 'var') {
      const v = values[tok.v];
      if (v === undefined) return NaN;
      output.push(v);
      expectValue = false;
    } else if (tok.t === '(') { stack.push('('); expectValue = true; }
    else if (tok.t === ')') {
      while (stack.length && stack[stack.length - 1] !== '(') if (!applyOp(stack.pop()!)) return NaN;
      if (stack.pop() !== '(') return NaN;
      expectValue = false;
    } else {
      if (expectValue) {
        // A leading or post-operator "-" is unary minus; any other operator here is malformed.
        if (tok.v !== '-') return NaN;
        stack.push('neg');
        continue;
      }
      const op = tok.v;
      const leftAssoc = op !== '^';
      while (stack.length) {
        const top = stack[stack.length - 1];
        if (top === '(') break;
        if (PRECEDENCE[top] > PRECEDENCE[op] || (PRECEDENCE[top] === PRECEDENCE[op] && leftAssoc)) {
          if (!applyOp(stack.pop()!)) return NaN;
        } else break;
      }
      stack.push(op);
      expectValue = true;
    }
  }
  if (expectValue) return NaN;
  while (stack.length) {
    const op = stack.pop()!;
    if (op === '(' || !applyOp(op)) return NaN;
  }
  const result = output.length === 1 ? output[0] : NaN;
  return typeof result === 'number' && Number.isFinite(result) ? result : NaN;
}

// The right-hand side is captured in a lookahead so consecutive formulas in one sentence don't swallow each other.
const CANDIDATE = /(?<![\p{L}\d_])([A-Za-z])\s*=\s*(?=([A-Za-z0-9\s+\-*/^·×÷−().]+))/gu;

/** Cuts the right-hand side at the first word that is plain English rather than part of an expression. */
function trimRhs(rhs: string): string {
  const chunks = rhs.trim().split(/\s+/);
  const hasOperator = /[+\-*/^·×÷−]/.test(rhs);
  const kept: string[] = [];
  for (const chunk of chunks) {
    const word = chunk.replace(/[().,;:]+$/g, '');
    const isLetters = /^[A-Za-z]+$/.test(word);
    if (isLetters && word.length > 3) break;
    if (isLetters && word.length >= 2 && (COMMON_WORDS.has(word.toLowerCase()) || !hasOperator)) break;
    kept.push(chunk);
    if (/[.,;:]$/.test(chunk)) break;
  }
  return kept.join(' ').replace(/[.,;:\s]+$/g, '').trim();
}

/** Formulas of the shape `L = <expression in single-letter variables>` found anywhere in `text`. */
export function findFormulas(text: string): Formula[] {
  const found = new Map<string, Formula>();
  for (const match of text.matchAll(CANDIDATE)) {
    const lhs = match[1];
    const rhs = trimRhs(match[2]);
    if (!rhs) continue;
    const letters: string[] = rhs.match(/[A-Za-z]/g) ?? [];
    const vars = [...new Set(letters)].filter(v => v !== lhs);
    // No self-reference ("x = x + 1" is an update, not a formula) and a sane number of variables.
    if (vars.length === 0 || vars.length > 4 || letters.includes(lhs)) continue;
    // A formula must parse and evaluate with sample values; this rejects prose and malformed fragments.
    const sample = Object.fromEntries(vars.map((v, i) => [v, i + 2]));
    if (Number.isNaN(evaluate(rhs, sample))) continue;
    // Must actually combine variables (an operator or implicit product), not just rename one.
    if (!/[+\-*/^·×÷−]/.test(rhs) && letters.length < 2) continue;
    const display = `${lhs} = ${rhs.replace(/\s*\*\s*/g, '·').replace(/\s+/g, ' ')}`;
    if (!found.has(display)) found.set(display, { text: display, lhs, rhs, vars });
  }
  return [...found.values()];
}
