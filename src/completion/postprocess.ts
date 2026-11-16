// Cleans up raw model output before it is shown as ghost text.
// Pure functions without the vscode API, so they can be tested with plain `node --test`.

export interface PostprocessContext {
    /** Text after the cursor on the current line. */
    lineSuffix: string;
    /** Lines after the current one (as sent to the model). */
    nextLines: string[];
    /** Leading whitespace to drop from the first line: the cursor already sits after it. */
    stripIndent: number;
}

/** Returns the text to insert at the cursor, or undefined when there is nothing useful. */
export function postprocess(raw: string, ctx: PostprocessContext): string | undefined {
    let lines = raw.split(/\r?\n/);

    lines[0] = stripLeadingWhitespace(lines[0], ctx.stripIndent);
    lines = dropTrailingBlankLines(lines);
    if (lines.length === 0) return undefined;

    // The model often re-types what already follows the cursor, e.g. the closing ")" in "foo(|)".
    const suffix = ctx.lineSuffix.trim();
    if (suffix && lines.length === 1 && lines[0].endsWith(suffix)) {
        lines[0] = lines[0].slice(0, lines[0].length - suffix.length);
    }

    // Stop where the model starts repeating the code that is already below the cursor.
    const nextCode = ctx.nextLines.find((l) => l.trim() !== '')?.trim();
    if (nextCode) {
        const repeatAt = lines.findIndex((l, i) => (i > 0 || ctx.lineSuffix.trim() === '') && l.trim() === nextCode);
        if (repeatAt === 0) return undefined;
        if (repeatAt > 0) lines = dropTrailingBlankLines(lines.slice(0, repeatAt));
    }

    const text = lines.join('\n');
    return text.trim() === '' ? undefined : text;
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
