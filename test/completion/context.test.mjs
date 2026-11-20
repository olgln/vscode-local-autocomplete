import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildContext, isBulkInsert } from '../../out/completion/context.js';

/** Fake TextDocument from a string. */
const doc = (text) => {
    const lines = text.split('\n');
    return { lineCount: lines.length, lineAt: (i) => ({ text: lines[i] }) };
};
const opts = { prefixLines: 256, suffixLines: 64, maxTokens: 128, maxPredictMs: 500 };

test('splits text around the cursor into prefix, prompt and suffix', () => {
    const d = doc('def add(a, b):\n    return a\n\nprint(add(1, 2))');
    const ctx = buildContext(d, { line: 1, character: 12 }, opts);
    assert.equal(ctx.request.inputPrefix, 'def add(a, b):\n');
    assert.equal(ctx.request.prompt, '    return a');
    assert.equal(ctx.request.inputSuffix, '\n\nprint(add(1, 2))\n');
    assert.equal(ctx.request.nIndent, 4);
    assert.equal(ctx.lineSuffix, '');
    assert.deepEqual(ctx.nextLines, ['', 'print(add(1, 2))']);
    assert.equal(ctx.stripIndent, 0);
});

test('sends an indentation-only line as an empty prompt', () => {
    const ctx = buildContext(doc('if x:\n    '), { line: 1, character: 4 }, opts);
    assert.equal(ctx.request.prompt, '');
    assert.equal(ctx.stripIndent, 4);
});

test('keeps the rest of the line after the cursor', () => {
    const ctx = buildContext(doc('foo()'), { line: 0, character: 4 }, opts);
    assert.equal(ctx.request.prompt, 'foo(');
    assert.equal(ctx.lineSuffix, ')');
    assert.equal(ctx.request.inputSuffix, ')\n');
    assert.equal(ctx.request.inputPrefix, '');
});

test('limits context to prefixLines / suffixLines', () => {
    const d = doc(['a', 'b', 'c', 'CUR', 'd', 'e', 'f'].join('\n'));
    const ctx = buildContext(d, { line: 3, character: 3 }, { ...opts, prefixLines: 2, suffixLines: 1 });
    assert.equal(ctx.request.inputPrefix, 'b\nc\n');
    assert.deepEqual(ctx.nextLines, ['d']);
});

test('isBulkInsert: a paste or dictation, not typing', () => {
    const bulk = (...texts) => isBulkInsert(texts.map((text) => ({ text })));
    // Typing, auto-closed brackets, Enter with auto-indent, IntelliSense words, multi-cursor typing.
    assert.equal(bulk('a'), false);
    assert.equal(bulk('()'), false);
    assert.equal(bulk('\n    '), false);
    assert.equal(bulk('\n    \n'), false);
    assert.equal(bulk('\n * '), false);
    assert.equal(bulk('addEventListener'), false);
    assert.equal(bulk('x', 'x', 'x'), false);
    assert.equal(bulk(''), false); // a deletion
    // Dictated sentence, pasted lines, an accepted multi-line completion.
    assert.equal(bulk('Returns the sum of both arguments.'), true);
    assert.equal(bulk('const a = 1;\nconst b = 2;'), true);
    assert.equal(bulk('a', ' {\n  return 1;\n}'), true);
});
