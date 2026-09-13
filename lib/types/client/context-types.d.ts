/** DSH client contracts consumed by the browser half. */
import type { Context as ClientContext } from '@deepseek-ai/cordis';
import type { zh } from './locales.ts';
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        'restart.button': keyof typeof zh;
    }
}
/** Minimal shape of the client-side connection service we consume. */
export interface ConnectionLike {
    isLoopback: boolean;
    rpc: {
        call: (channel: string, endpoint: string, payload?: unknown) => Promise<unknown>;
    };
}
/** rpcResultSchema envelope-inner shape the client validates against. */
export interface RestartResult {
    ok?: boolean;
    value?: {
        boot?: string;
        pid?: number;
        delayMs?: number;
        helperPid?: number;
    };
    error?: {
        code?: string;
        message?: string;
    };
}
export type Context = ClientContext;
