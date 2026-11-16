import * as vscode from 'vscode';

export type ServerState = 'unknown' | 'ready' | 'loading' | 'unavailable';

/** Status bar item: shows on/off, server state and a spinner while a request runs. Click toggles. */
export class StatusBar implements vscode.Disposable {
    private readonly item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    private enabled = true;
    private server: ServerState = 'unknown';
    private busy = 0;

    constructor(toggleCommand: string) {
        this.item.command = toggleCommand;
        this.render();
        this.item.show();
    }

    setEnabled(enabled: boolean): void {
        this.enabled = enabled;
        this.render();
    }

    setServer(state: ServerState): void {
        this.server = state;
        this.render();
    }

    /** Marks a request as running; call the returned function when it finishes. */
    startRequest(): () => void {
        this.busy++;
        this.render();
        let done = false;
        return () => {
            if (done) return;
            done = true;
            this.busy--;
            this.render();
        };
    }

    dispose(): void {
        this.item.dispose();
    }

    private render(): void {
        const name = 'Autocomplete';
        this.item.backgroundColor = undefined;
        if (!this.enabled) {
            this.item.text = `$(circle-slash) ${name}`;
            this.item.tooltip = 'Local autocomplete is off. Click to turn on.';
        } else if (this.busy > 0) {
            this.item.text = `$(loading~spin) ${name}`;
            this.item.tooltip = 'Waiting for the local model…';
        } else if (this.server === 'unavailable') {
            this.item.text = `$(warning) ${name}`;
            this.item.tooltip = 'llama-server is not reachable. Start it, then run "Local Autocomplete: Check Server". Click to turn off.';
            this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        } else if (this.server === 'loading') {
            this.item.text = `$(sync~spin) ${name}`;
            this.item.tooltip = 'llama-server is loading the model…';
        } else {
            this.item.text = `$(sparkle) ${name}`;
            this.item.tooltip = 'Local autocomplete is on. Click to turn off.';
        }
    }
}
