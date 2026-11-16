// Run with `npm test` (compiles first). Uses only Node's built-in test runner.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isComplete, postprocess } from '../../out/completion/postprocess.js';

const ctx = (over = {}) => ({ linePrefix: '', lineSuffix: '', nextLines: [], stripIndent: 0, ...over });

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
    // The result replaces the rest of the line, so it ends with the kept suffix.
    assert.equal(postprocess('a, b)', ctx({ linePrefix: 'foo(', lineSuffix: ')' })), 'a, b)');
    assert.equal(postprocess('a, b);', ctx({ linePrefix: 'foo(', lineSuffix: ');' })), 'a, b);');
    assert.equal(postprocess(')', ctx({ linePrefix: 'foo(', lineSuffix: ')' })), undefined);
});

test('merges auto-closed brackets after the cursor with the ones the model wrote', () => {
    // The case from manual testing: "function sum (a,b|)".
    const sum = ctx({ linePrefix: 'function sum (a,b', lineSuffix: ')' });
    assert.equal(postprocess(') {\n    return a + b;\n}', sum), ') {\n    return a + b;\n}');
    assert.equal(postprocess(') { return a + b; }', sum), ') { return a + b; }');
    // The model closed the inner "(" only: one of the two ")" stays.
    const reduce = ctx({ linePrefix: 'const total = xs.reduce((', lineSuffix: '))' });
    assert.equal(postprocess('acc, x) => acc + x, 0', reduce), 'acc, x) => acc + x, 0)');
    // Nothing closed by the model: both stay.
    const map = ctx({ linePrefix: 'console.log(xs.map(', lineSuffix: '))' });
    assert.equal(postprocess('x => x * 2', map), 'x => x * 2))');
});

test('keeps a closer whose opener is on an earlier line', () => {
    assert.equal(postprocess(', c', ctx({ linePrefix: '  a, b', lineSuffix: ')' })), ', c)');
});

test('discards a completion that leaves a string open, but not inside a string already', () => {
    const join = ctx({ linePrefix: 'print(os.path.join(', lineSuffix: '))' });
    assert.equal(postprocess("'c:\\\\', '", join), undefined);
    const tpl = ctx({ linePrefix: 'console.log(`Hello, ${', lineSuffix: '}`)' });
    assert.equal(postprocess('user.name', tpl), 'user.name}`)');
});

test('stops where the code below the cursor starts repeating', () => {
    const nextLines = ['', '    return total'];
    assert.equal(postprocess('total += x\n    return total\n', ctx({ nextLines })), 'total += x');
});

test('discards a completion that only repeats the next line', () => {
    assert.equal(postprocess('    return total', ctx({ nextLines: ['    return total'] })), undefined);
});

test('stops after the closing bracket of the block the cursor line opens', () => {
    // The case from manual testing: the model went on with the next function and was cut mid-way.
    const raw = '\n  return fs.readFileSync(path, "utf-8");\n}\n\nfunction write(path, content) {\n  fs.writeFileSync(path, content);\n';
    assert.equal(
        postprocess(raw, ctx({ linePrefix: 'function read(path) {' })),
        '\n  return fs.readFileSync(path, "utf-8");\n}',
    );
});

test('keeps a closing line like "});" and works inside nested blocks', () => {
    const raw = '\n    console.log(x);\n  });\n  done();\n';
    assert.equal(postprocess(raw, ctx({ linePrefix: '  items.forEach((x) => {' })), '\n    console.log(x);\n  });');
});

test('python: stops before the next definition after an opened block', () => {
    const raw = '\n    return self.w * self.h\n\ndef perimeter(self):\n    return 0\n';
    assert.equal(postprocess(raw, ctx({ linePrefix: 'def area(self):' })), '\n    return self.w * self.h');
});

test('the block ends on the line typed by the model itself', () => {
    const raw = 'is_even(n):\n    return n % 2 == 0\n\n\ndef is_odd(n):\n    return n % 2 == 1\n';
    assert.equal(postprocess(raw, ctx({ linePrefix: 'def ' })), 'is_even(n):\n    return n % 2 == 0');
});

test('without an opened block: stops before a blank line followed by a new unit', () => {
    const raw = 'const a = 1;\nconst b = 2;\n\nfunction next() {\n';
    assert.equal(postprocess(raw, ctx({ linePrefix: '' })), 'const a = 1;\nconst b = 2;');
});

test('keeps deeper code and blank lines inside the block', () => {
    const raw = '\n  const x = 1;\n\n  if (x) {\n    go();\n  }\n}';
    assert.equal(postprocess(raw, ctx({ linePrefix: 'function f() {' })), raw);
});

test('does not duplicate a closing bracket that is already below the cursor', () => {
    const raw = '\n  return a * b;\n}\n\nfunction div(a, b) {\n';
    const c = ctx({ linePrefix: 'function mul(a, b) {', nextLines: ['}'] });
    assert.equal(postprocess(raw, c), '\n  return a * b;');
});

test('isComplete: true only once a complete line ends the block', () => {
    const c = ctx({ linePrefix: 'function f() {' });
    assert.equal(isComplete('\n  return 1;\n', c), false);
    assert.equal(isComplete('\n  return 1;\n}', c), false); // "}" may still become "});"
    assert.equal(isComplete('\n  return 1;\n}\n', c), true);
    assert.equal(isComplete('return a', ctx()), false);
});

test('cut by the limit: drops an unclosed nested block and a half-written line', () => {
    const c = ctx({ linePrefix: 'function parseCsv(text) {' });
    const raw = "\n  var rows = text.split('\\n');\n  var data = [];\n  for (var i = 1; i < rows.length; i++) {\n    var row = rows[i].split(',');\n";
    // The function's own "}" is added back (see closeOpenBlock).
    assert.equal(postprocess(raw, c, true), "\n  var rows = text.split('\\n');\n  var data = [];\n}");
    assert.equal(postprocess('\n  var a = 1;\n  var b = fo', c, true), '\n  var a = 1;\n}');
    // A nested block that was closed stays.
    const closed = '\n  if (a) {\n    b();\n  }\n  c(';
    assert.equal(postprocess(closed, c, true), '\n  if (a) {\n    b();\n  }\n}');
    // Without the limit the last line is complete and stays.
    assert.equal(postprocess('\n  var a = 1;\n  var b = fo', c), '\n  var a = 1;\n  var b = fo\n}');
});

test('drops a dangling opener even when the model stopped by itself', () => {
    const c = ctx({ linePrefix: '    for attempt in range(retries):' });
    assert.equal(postprocess('\n        try:\n', c), undefined);
    // The opener on the cursor line itself is fine.
    assert.equal(postprocess('is_even(n):', ctx({ linePrefix: 'def ' })), 'is_even(n):');
});

test('closes the block the cursor line opens when the model did not', () => {
    // The case from manual testing: "type |" + a type literal cut by the limit.
    const c = ctx({ linePrefix: 'type ' });
    const raw = 'Toc = {\n  id: string;\n  title: string;\n  children: To';
    assert.equal(postprocess(raw, c, true), 'Toc = {\n  id: string;\n  title: string;\n}');
    // Indented, "(" and "[" blocks.
    assert.equal(postprocess('\n    a,\n', ctx({ linePrefix: '  foo(' })), '\n    a,\n  )');
    assert.equal(postprocess('\n    1,\n', ctx({ linePrefix: '  const xs = [' })), '\n    1,\n  ]');
    // Not when the closing bracket is already below the cursor, and never for Python.
    assert.equal(postprocess('\n  a();\n', ctx({ linePrefix: 'if (x) {', nextLines: ['', '}'] })), '\n  a();');
    assert.equal(postprocess('\n    pass\n', ctx({ linePrefix: 'def f():' })), '\n    pass');
});

test('drops a last line the model abandoned mid-way, even without hitting the limit', () => {
    // The case from manual testing: "functinon myL|" at the end of a file.
    const c = ctx({ linePrefix: 'functinon myL' });
    assert.equal(postprocess('ogger() {\n    console.log("', c), 'ogger() {\n}');
    assert.equal(postprocess('ogger() {\n    var', c), 'ogger() {\n}');
    assert.equal(postprocess('ogger() {\n    total = a +', c), 'ogger() {\n}');
    // A finished last line without "\n" stays (Python bodies often end like this).
    assert.equal(postprocess('\n        return self.w * self.h', ctx({ linePrefix: '    def area(self):' })), '\n        return self.w * self.h');
    assert.equal(postprocess('ogger() {\n  console.log("hi");\n}', c), 'ogger() {\n  console.log("hi");\n}');
});
