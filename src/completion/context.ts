// Builds the FIM request from the document around the cursor.
// Type-only imports: this module does not load the vscode API, so it is unit-testable.
import type { Config } from '../config';
import type { InfillRequest } from '../llama/client';

/** The slice of vscode.TextDocument this module needs. */
export interface TextSource {
    readonly lineCount: number;
    lineAt(line: number): { readonly text: string };
}

export interface Cursor {
    readonly line: number;
    readonly character: number;
}

export type ContextOptions = Pick<Config, 'prefixLines' | 'suffixLines' | 'maxTokens' | 'maxPredictMs'>;

export interface CompletionContext {
    request: InfillRequest;
    /** Text before the cursor on the current line. */
    linePrefix: string;
    /** Text after the cursor on the current line. */
    lineSuffix: string;
    /** Lines after the current one that were sent to the model. */
    nextLines: string[];
    /** Indentation already typed before the cursor; stripped from the model's first line. */
    stripIndent: number;
}

/**
 * Splits the text the way llama.vscode does: previous lines go to input_prefix and the
 * current line to `prompt`. While typing on one line only the tail of the prompt changes,
 * so llama-server reuses its cache for everything else and answers faster.
 */
export function buildContext(doc: TextSource, cursor: Cursor, opts: ContextOptions): CompletionContext {
    const lineText = doc.lineAt(cursor.line).text;
    const linePrefix = lineText.slice(0, cursor.character);
    const lineSuffix = lineText.slice(cursor.character);

    const prevLines = readLines(doc, Math.max(0, cursor.line - opts.prefixLines), cursor.line);
    const nextLines = readLines(doc, cursor.line + 1, Math.min(doc.lineCount, cursor.line + 1 + opts.suffixLines));

    // Trailing whitespace hurts tokenization, so an indentation-only prompt is sent empty;
    // the indentation the model then generates is stripped again in postprocess().
    const onlyIndent = linePrefix.trim() === '';

    return {
        request: {
            inputPrefix: joinLines(prevLines),
            inputSuffix: lineSuffix + '\n' + joinLines(nextLines),
            prompt: onlyIndent ? '' : linePrefix,
            nIndent: lineText.length - lineText.trimStart().length,
            maxTokens: opts.maxTokens,
            maxPredictMs: opts.maxPredictMs,
        },
        linePrefix,
        lineSuffix,
        nextLines,
        stripIndent: onlyIndent ? linePrefix.length : 0,
    };
}

/** The slice of vscode.TextDocumentContentChangeEvent this module needs. */
export interface TextChange {
    readonly text: string;
}

/** Inserted text this long (without surrounding whitespace) is not typing. */
const BULK_INSERT_CHARS = 30;

/**
 * True when an edit inserted a chunk of text at once: a paste, a dictation app pasting a sentence,
 * an accepted completion. Not typing: single characters, auto-closed brackets, Enter with its
 * auto-indent, IntelliSense words. Right after such an edit an automatic completion is rarely
 * wanted, and skipping it keeps the model idle while e.g. a speech-to-text app is still busy.
 */
export function isBulkInsert(changes: readonly TextChange[]): boolean {
    return changes.some((c) => {
        const text = c.text.trim();
        return text.length >= BULK_INSERT_CHARS || (c.text.includes('\n') && text.length >= 3);
    });
}

/** Lines [from, to) of the document. */
function readLines(doc: TextSource, from: number, to: number): string[] {
    const lines: string[] = [];
    for (let i = from; i < to; i++) lines.push(doc.lineAt(i).text);
    return lines;
}

/** Joins lines, each terminated by "\n" (empty string for no lines). */
function joinLines(lines: string[]): string {
    return lines.map((l) => l + '\n').join('');
}
