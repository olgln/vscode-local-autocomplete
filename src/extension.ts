import * as vscode from 'vscode';
import { Commands, refreshServerState, registerCommands } from './commands';
import { readConfig, SECTION } from './config';
import { InlineCompletionProvider } from './completion/provider';
import { StatusBar } from './ui/status-bar';

/** Entry point: wires the provider, status bar, commands and settings listener together. */
export function activate(context: vscode.ExtensionContext): void {
    // Per-request timings are logged at Debug level: Output panel → "Local Autocomplete",
    // then the gear icon → Debug.
    const log = vscode.window.createOutputChannel('Local Autocomplete', { log: true });
    const status = new StatusBar(Commands.toggle);
    status.setEnabled(readConfig().enabled);
    const provider = new InlineCompletionProvider(status, log);

    context.subscriptions.push(
        log,
        status,
        // Only real files and unsaved editors: not the Output panel, Git input box, settings, etc.
        vscode.languages.registerInlineCompletionItemProvider([{ scheme: 'file' }, { scheme: 'untitled' }], provider),
        vscode.workspace.onDidChangeTextDocument((event) => provider.onDocumentChanged(event)),
        ...registerCommands(status, log),
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (!event.affectsConfiguration(SECTION)) return;
            status.setEnabled(readConfig().enabled);
            if (event.affectsConfiguration(`${SECTION}.endpoint`)) void refreshServerState(status, log, false);
        }),
    );

    void refreshServerState(status, log, false);
}

export function deactivate(): void {
    // Everything is disposed through context.subscriptions.
}
