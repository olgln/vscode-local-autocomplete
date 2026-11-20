// Cleans up raw model output before it is shown as ghost text.
// Pure functions without the vscode API, so they can be tested with plain `node --test`.

export interface PostprocessContext {
    /** Text before the cursor on the current line. */
    linePrefix: string;
    /** Text after the cursor on the current line. */
    lineSuffix: string;
    /** Lines after the current one (as sent to the model). */
    nextLines: string[];
    /** Leading whitespace to drop from the first line: the cursor already sits after it. */
    stripIndent: number;
}

/**
 * Returns the text that replaces the rest of the current line (cursor → end of line), or
 * undefined when there is nothing useful. The result ends with what remains of `lineSuffix`.
 * `hitLimit`: the server stopped at its token/time limit, so the text may end mid-block.
 */
export function postprocess(raw: string, ctx: PostprocessContext, hitLimit = false): string | undefined {
    const shaped = shape(raw.split(/\r?\n/), ctx);
    let lines = shaped.lines;
    if (!shaped.cut) lines = dropUnfinished(lines, lastLineDone(raw, hitLimit));
    lines = dropTrailingBlankLines(lines);
    if (!shaped.cut) lines = closeOpenBlock(lines, ctx);
    if (lines.length === 0) return undefined;

    // The model often re-types what already follows the cursor, e.g. the closing ")" in "foo(|)".
    const suffix = ctx.lineSuffix.trim();
    if (suffix && lines.length === 1 && lines[0].endsWith(suffix)) {
        lines[0] = lines[0].slice(0, lines[0].length - suffix.length);
    }

    const completion = lines.join('\n');
    if (completion.trim() === '') return undefined;
    return mergeSuffix(completion, ctx.linePrefix, ctx.lineSuffix);
}

const PAIRS: Record<string, string> = { ')': '(', ']': '[', '}': '{' };

interface ScanState {
    /** Open brackets, innermost last. */
    stack: string[];
    /** The quote of the string literal we are inside, if any. */
    quote?: string;
}

/**
 * Brackets VS Code auto-closed after the cursor ("foo(|)") are often closed by the model too:
 * "function sum(a, b|)" + ") {...}" must not keep the old ")". A closer from `lineSuffix` is
 * dropped when it matched an opener on this line before and the completion has closed that
 * opener itself; closers of brackets opened on earlier lines are always kept.
 * Returns undefined when the completion leaves a string literal open on the line.
 */
function mergeSuffix(completion: string, linePrefix: string, lineSuffix: string): string | undefined {
    const before = scan(linePrefix, { stack: [] });
    const after = scan(completion, scan(linePrefix, { stack: [] }));
    // Inside a string (or a quote we misread, e.g. "don't" in a comment): leave the suffix alone.
    if (before.quote !== undefined) return completion + lineSuffix;
    if (after.quote !== undefined) return completion.includes('\n') ? completion + lineSuffix : undefined;

    let kept = '';
    for (const ch of lineSuffix) {
        const opener = PAIRS[ch];
        if (opener === undefined) {
            kept += ch;
            continue;
        }
        const matchedBefore = before.stack.at(-1) === opener;
        if (matchedBefore) before.stack.pop();
        const matchedAfter = after.stack.at(-1) === opener;
        if (matchedAfter) after.stack.pop();
        if (matchedAfter || !matchedBefore) kept += ch;
    }
    const text = completion + kept;
    return text === lineSuffix ? undefined : text;
}

/** Tracks brackets and string literals over `text`; mutates and returns `state`. */
function scan(text: string, state: ScanState): ScanState {
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (state.quote !== undefined) {
            if (ch === '\\') i++;
            else if (ch === state.quote || (ch === '\n' && state.quote !== '`')) state.quote = undefined;
        } else if (ch === '"' || ch === "'" || ch === '`') {
            state.quote = ch;
        } else if (ch === '(' || ch === '[' || ch === '{') {
            state.stack.push(ch);
        } else if (PAIRS[ch] !== undefined && state.stack.at(-1) === PAIRS[ch]) {
            state.stack.pop();
        }
    }
    return state;
}

/**
 * For streaming: true once the complete lines received so far already reach the end of the
 * completion, so the rest of the generation would be thrown away and can be stopped.
 */
export function isComplete(partial: string, ctx: PostprocessContext): boolean {
    const lines = partial.split(/\r?\n/);
    lines.pop(); // the last line may still grow
    return lines.length > 0 && shape(lines, ctx).cut;
}

/** Applies the line-level rules; `cut` tells whether the output was cut before its end. */
function shape(input: string[], ctx: PostprocessContext): { lines: string[]; cut: boolean } {
    const lines = [...input];
    lines[0] = stripLeadingWhitespace(lines[0], ctx.stripIndent);

    // Stop where the model starts repeating the code that is already below the cursor.
    const nextCode = ctx.nextLines.find((l) => l.trim() !== '')?.trim();
    if (nextCode) {
        const repeatAt = lines.findIndex((l, i) => (i > 0 || ctx.lineSuffix.trim() === '') && l.trim() === nextCode);
        if (repeatAt >= 0) return { lines: lines.slice(0, repeatAt), cut: true };
    }

    const end = blockEnd(lines, ctx.linePrefix, ctx.linePrefix + ctx.lineSuffix);
    return end === undefined ? { lines, cut: false } : { lines: lines.slice(0, end), cut: true };
}

const OPENERS = ['{', '(', '[', ':'];
const CLOSERS = ['}', ')', ']'];

/**
 * Small models rarely stop on their own: after the block the cursor is in they go on with the
 * next function. Keep only the part that belongs to the cursor's block, judged by indentation:
 * - the cursor line opens a block ("{", ":", ...): stop at the first line indented at most as
 *   much as the cursor line; keep it when it is the closing bracket ("}", "});").
 * - otherwise: stop before a blank line followed by code at that indentation (a new unit,
 *   e.g. the next function).
 * Returns the number of lines to keep, or undefined when the block does not end in `lines`.
 */
function blockEnd(lines: string[], linePrefix: string, lineText: string): number | undefined {
    const base = indentOf(lineText);
    const opensBlock = OPENERS.some((c) => (linePrefix + lines[0]).trimEnd().endsWith(c));

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim() === '' || indentOf(line) > base) continue;
        if (opensBlock) return CLOSERS.some((c) => line.trimStart().startsWith(c)) ? i + 1 : i;
        if (lines[i - 1].trim() === '') return i;
    }
    return undefined;
}

/**
 * Drops everything from the first nested block that was opened but not closed (the limit cut
 * it, or the model just stopped), so the ghost text never leaves e.g. a dangling "for (...) {"
 * or "try:"; when `lastLineDone` is false, also the half-written last line.
 * The block the cursor line itself opens may stay open: the user is writing it.
 */
function dropUnfinished(input: string[], lastLineDone: boolean): string[] {
    const lines = lastLineDone || input.length < 2 ? input : input.slice(0, -1);
    const open: number[] = []; // indices of lines that opened a block not yet closed
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim() === '') continue;
        while (open.length > 0 && indentOf(line) <= indentOf(lines[open[open.length - 1]])) open.pop();
        if (OPENERS.some((c) => line.trimEnd().endsWith(c))) open.push(i);
    }
    return open.length > 0 ? lines.slice(0, open[0]) : lines;
}

/**
 * Whether the output's last line is finished. A line followed by "\n" is. Without it, the limit
 * may have cut the line, and the model itself sometimes stops mid-line too (seen at the end of a
 * file: `console.log("`, `var`), so a line that is clearly unfinished does not count.
 */
function lastLineDone(raw: string, hitLimit: boolean): boolean {
    if (raw.endsWith('\n')) return true;
    if (hitLimit) return false;
    const last = raw.slice(raw.lastIndexOf('\n') + 1).trimEnd();
    const state = scan(last, { stack: [] });
    return state.quote === undefined && state.stack.length === 0 && !UNFINISHED_END.test(last);
}

/** A line ending like this needs more code: an operator, a "." or ",", or a declaration keyword. */
const UNFINISHED_END = /(?:[=+\-*/%.,&|!<>?^~]|\b(?:var|let|const|new|await|import|from|def|class|function|and|or|not))$/;

const CLOSER_OF: Record<string, string> = { '{': '}', '(': ')', '[': ']' };

/**
 * The block the cursor line opens was not closed (the limit cut a long body, or the model just
 * stopped): add its closing bracket at the cursor line's indentation, so the ghost text is
 * balanced. Not when that bracket is already the next line below the cursor (auto-closed).
 */
function closeOpenBlock(lines: string[], ctx: PostprocessContext): string[] {
    // Only an empty rest of the cursor line: the model wrote nothing to close.
    if (lines.length === 0 || (lines.length === 1 && lines[0].trim() === '')) return lines;
    const closer = CLOSER_OF[(ctx.linePrefix + lines[0]).trimEnd().slice(-1)];
    if (closer === undefined) return lines; // e.g. Python ":" needs no closing line
    const lineText = ctx.linePrefix + ctx.lineSuffix;
    const indent = lineText.slice(0, indentOf(lineText));
    const next = ctx.nextLines.find((l) => l.trim() !== '');
    if (next !== undefined && indentOf(next) <= indent.length && next.trimStart().startsWith(closer)) return lines;
    return [...lines, indent + closer];
}

function indentOf(line: string): number {
    return line.length - line.trimStart().length;
}

function stripLeadingWhitespace(line: string, max: number): string {
    let i = 0;
    while (i < max && i < line.length && (line[i] === ' ' || line[i] === '\t')) i++;
    return line.slice(i);
}

function dropTrailingBlankLines(lines: string[]): string[] {
    let end = lines.length;
    while (end > 0 && lines[end - 1].trim() === '') end--;
    return lines.slice(0, end);
}
