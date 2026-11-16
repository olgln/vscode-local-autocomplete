import * as vscode from 'vscode';
import { Config, readConfig } from '../config';
import { InfillResult, isAbortError, requestInfill, ServerUnavailableError } from '../llama/client';
import { StatusBar } from '../ui/status-bar';
import { buildContext, CompletionContext } from './context';
import { postprocess } from './postprocess';

/**
 * VS Code calls provideInlineCompletionItems on every edit/cursor move. Each call gets a
 * CancellationToken that VS Code cancels as soon as the user keeps typing, so a stale
 * request is aborted instead of piling up on the server.
 */
export class InlineCompletionProvider implements vscode.InlineCompletionItemProvider {
    constructor(
        private readonly status: StatusBar,
        private readonly log: vscode.LogOutputChannel,
    ) {}

    async provideInlineCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        context: vscode.InlineCompletionContext,
        token: vscode.CancellationToken,
    ): Promise<vscode.InlineCompletionItem[] | undefined> {
        const cfg = readConfig();
        if (!cfg.enabled || cfg.disabledLanguages.includes(document.languageId)) return undefined;

        const automatic = context.triggerKind === vscode.InlineCompletionTriggerKind.Automatic;
        // Do not compete with the suggestion list (IntelliSense) while it is open.
        if (automatic && context.selectedCompletionInfo) return undefined;

        const ctx = buildContext(document, position, cfg);
        // In the middle of existing code a completion is rarely useful and often confusing.
        if (automatic && ctx.lineSuffix.trim().length > cfg.maxLineSuffix) return undefined;

        // Debounce: wait for a pause in typing. Typing on cancels the token, and we bail out.
        if (automatic && cfg.debounceMs > 0) {
            await delay(cfg.debounceMs);
            if (token.isCancellationRequested) return undefined;
        }

        const text = await this.complete(ctx, cfg, token, document.languageId);
        if (text === undefined) return undefined;
        return [new vscode.InlineCompletionItem(text, new vscode.Range(position, position))];
    }

    /** Asks the server and cleans the answer; undefined on cancel, error or nothing useful. */
    private async complete(
        ctx: CompletionContext,
        cfg: Config,
        token: vscode.CancellationToken,
        languageId: string,
    ): Promise<string | undefined> {
        const abort = new AbortController();
        const subscription = token.onCancellationRequested(() => abort.abort());
        const finish = this.status.startRequest();
        const started = Date.now();
        try {
            const result = await requestInfill(cfg.endpoint, ctx.request, cfg.timeoutMs, abort.signal);
            this.status.setServer('ready');
            if (token.isCancellationRequested) return undefined;

            const text = postprocess(result.content, ctx);
            this.log.debug(`${languageId} ${Date.now() - started}ms | ${describeTimings(result)} | ${describeText(text)}`);
            return text;
        } catch (error) {
            this.handleError(error, cfg, token);
            return undefined;
        } finally {
            subscription.dispose();
            finish();
        }
    }

    private handleError(error: unknown, cfg: Config, token: vscode.CancellationToken): void {
        if (isAbortError(error)) {
            // A cancel is normal (the user kept typing); only a timeout is worth logging.
            if (!token.isCancellationRequested) this.log.warn(`Request timed out after ${cfg.timeoutMs}ms`);
        } else if (error instanceof ServerUnavailableError) {
            this.status.setServer('unavailable');
            this.log.warn(error.message);
        } else {
            this.log.error(error instanceof Error ? error.message : String(error));
        }
    }
}

function describeTimings(r: InfillResult): string {
    const n = (v: number | undefined) => (v === undefined ? '?' : String(Math.round(v)));
    return (
        `prompt ${n(r.promptTokens)} tok ${n(r.promptMs)}ms (cached ${n(r.cachedTokens)}) | ` +
        `gen ${n(r.predictedTokens)} tok ${n(r.predictedMs)}ms`
    );
}

function describeText(text: string | undefined): string {
    return text === undefined ? 'discarded' : JSON.stringify(text.slice(0, 80));
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
