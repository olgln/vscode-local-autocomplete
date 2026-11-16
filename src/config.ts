import * as vscode from 'vscode';

export const SECTION = 'localAutocomplete';

/** Settings contributed in package.json (defaults live there only). */
export interface Config {
    enabled: boolean;
    endpoint: string;
    disabledLanguages: string[];
    debounceMs: number;
    prefixLines: number;
    suffixLines: number;
    maxTokens: number;
    maxPredictMs: number;
    maxLineSuffix: number;
    timeoutMs: number;
}

/** Reads settings on every call: cheap, and changes apply without a reload. */
export function readConfig(): Config {
    const c = vscode.workspace.getConfiguration(SECTION);
    // VS Code fills in the package.json defaults, so every key is always present.
    const get = <K extends keyof Config>(key: K): Config[K] => c.get<Config[K]>(key) as Config[K];
    return {
        enabled: get('enabled'),
        endpoint: get('endpoint').replace(/\/+$/, ''),
        disabledLanguages: get('disabledLanguages'),
        debounceMs: get('debounceMs'),
        prefixLines: get('prefixLines'),
        suffixLines: get('suffixLines'),
        maxTokens: get('maxTokens'),
        maxPredictMs: get('maxPredictMs'),
        maxLineSuffix: get('maxLineSuffix'),
        timeoutMs: get('timeoutMs'),
    };
}

export async function setEnabled(enabled: boolean): Promise<void> {
    await vscode.workspace.getConfiguration(SECTION).update('enabled', enabled, vscode.ConfigurationTarget.Global);
}
