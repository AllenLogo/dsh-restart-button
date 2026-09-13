/**
 * dsh-restart-button — client half.
 *
 * Registers one row in the General settings section
 * (`settings.general.item` slot): a title, a hint, and a "Restart now"
 * button. Clicking it calls the host RPC channel over the connection fence
 * (loopback authority), then polls `status` until the boot id changes and
 * reloads the page. On a non-loopback client the row renders disabled.
 */
import type { Context } from './context-types.ts';
export declare const name = "dsh-restart-button-client";
export declare const inject: string[];
export declare const NS = "restart.button";
export declare const CHANNEL = "/_dsh-restart-button";
export declare function apply(ctx: Context): void;
