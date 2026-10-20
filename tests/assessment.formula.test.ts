import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, findFormulas } from '../src/domain/assessment/formula.ts';

test('evaluate: operators, precedence, implicit multiplication, exponents', () => {
  assert.equal(evaluate('m·a', { m: 4, a: 3 }), 12);
  assert.equal(evaluate('u + at', { u: 2, a: 3, t: 4 }), 14);
  assert.equal(evaluate('mc^2', { m: 2, c: 3 }), 18);
  assert.equal(evaluate('(a+b)(a-b)', { a: 5, b: 3 }), 16);
  assert.equal(evaluate('a + b * c', { a: 1, b: 2, c: 3 }), 7);
  assert.equal(evaluate('2^3^2', {}), 512, '^ is right-associative');
  assert.equal(evaluate('-2^2', {}), -4);
  assert.equal(evaluate('2^-2', {}), 0.25);
  assert.equal(evaluate('a ÷ b', { a: 9, b: 3 }), 3);
});

test('evaluate: malformed or unsafe input is NaN, never executed', () => {
  assert.ok(Number.isNaN(evaluate('a +', { a: 1 })));
  assert.ok(Number.isNaN(evaluate('a/0', { a: 1 })));
  assert.ok(Number.isNaN(evaluate('x', {})), 'unknown variable');
  assert.ok(Number.isNaN(evaluate('process.exit(1)', {})));
  assert.ok(Number.isNaN(evaluate('m2', { m: 1 })), 'ambiguous subscript is refused');
  assert.ok(Number.isNaN(evaluate('((a)', { a: 1 })));
});

test('findFormulas: picks physics-style formulas, several per sentence', () => {
  const found = findFormulas('Newton: F = m·a, where m is mass. Also v = u + at and E = mc^2.').map(f => f.text);
  assert.deepEqual(found, ['F = m·a', 'v = u + at', 'E = mc^2']);
  const f = findFormulas('Force is F = m * a.')[0];
  assert.equal(f.text, 'F = m·a');
  assert.deepEqual(f.vars, ['m', 'a']);
});

test('findFormulas: rejects prose, assignments to a constant and self-reference', () => {
  assert.deepEqual(findFormulas('x = is a thing that we study'), []);
  assert.deepEqual(findFormulas('Total = 5.'), []);
  assert.deepEqual(findFormulas('x = x + 1'), []);
  assert.deepEqual(findFormulas('The result = the sum of all parts'), []);
  assert.deepEqual(findFormulas('y = z'), []);
});
