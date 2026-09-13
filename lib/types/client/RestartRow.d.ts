import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots';
import type { NS } from './index.ts';
export interface RestartRowProps extends PropsLocale<typeof NS> {
    call: (endpoint: string, payload?: unknown) => Promise<unknown>;
    loopback: boolean;
}
export declare function RestartRow({ t, call, loopback }: RestartRowProps): import("react").JSX.Element;
