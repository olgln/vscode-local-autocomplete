// Run with `npm test` (compiles first). Uses only Node's built-in test runner.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { postprocess } from '../../out/completion/postprocess.js';

const ctx = (over = {}) => ({ lineSuffix: '', nextLines: [], stripIndent: 0, ...over });

test('returns plain completion unchanged', () => {
    assert.equal(postprocess('return a + b', ctx()), 'return a + b');
});

test('drops trailing blank lines', () => {
    assert.equal(postprocess('x = 1\ny = 2\n\n  \n', ctx()), 'x = 1\ny = 2');
});

test('empty or whitespace-only output gives no completion', () => {
    assert.equal(postprocess('', ctx()), undefined);
    assert.equal(postprocess('  \n\n', ctx()), undefined);
});

test('strips indentation the cursor already sits after', () => {
    assert.equal(postprocess('    return 1', ctx({ stripIndent: 4 })), 'return 1');
    assert.equal(postprocess('  return 1', ctx({ stripIndent: 4 })), 'return 1');
    assert.equal(postprocess('return 1', ctx({ stripIndent: 4 })), 'return 1');
});

test('does not re-type the closing characters after the cursor', () => {
    assert.equal(postprocess('a, b)', ctx({ lineSuffix: ')' })), 'a, b');
    assert.equal(postprocess(')', ctx({ lineSuffix: ')' })), undefined);
});

test('stops where the code below the cursor starts repeating', () => {
    const nextLines = ['', '    return total'];
    assert.equal(postprocess('total += x\n    return total\n', ctx({ nextLines })), 'total += x');
});

test('discards a completion that only repeats the next line', () => {
    assert.equal(postprocess('    return total', ctx({ nextLines: ['    return total'] })), undefined);
});
