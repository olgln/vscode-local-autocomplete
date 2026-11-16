import * as vscode from 'vscode';
import { readConfig, setEnabled } from './config';
import { checkHealth } from './llama/client';
import { StatusBar } from './ui/status-bar';

/** Command IDs; keep in sync with "contributes.commands" in package.json. */
export const Commands = {
    toggle: 'localAutocomplete.toggle',
    checkServer: 'localAutocomplete.checkServer',
} as const;

export function registerCommands(status: StatusBar, log: vscode.LogOutputChannel): vscode.Disposable[] {
    return [
        vscode.commands.registerCommand(Commands.toggle, () => setEnabled(!readConfig().enabled)),
        vscode.commands.registerCommand(Commands.checkServer, () => refreshServerState(status, log, true)),
    ];
}

/** Pings GET /health, updates the status bar; with notify, also shows a message. */
export async function refreshServerState(status: StatusBar, log: vscode.LogOutputChannel, notify: boolean): Promise<void> {
    const { endpoint } = readConfig();
    const health = await checkHealth(endpoint);
    status.setServer(health === 'ok' ? 'ready' : health);
    log.info(`Server ${endpoint}: ${health}`);
    if (!notify) return;
    if (health === 'ok') void vscode.window.showInformationMessage(`llama-server is ready at ${endpoint}.`);
    else if (health === 'loading') void vscode.window.showInformationMessage('llama-server is still loading the model.');
    else void vscode.window.showWarningMessage(`llama-server is not reachable at ${endpoint}.`);
}
