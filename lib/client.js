window.__ModuleLoader__.load({
	id: "dsh-restart-button",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/RestartRow.tsx
		/**
		* RestartRow — one row in the General settings section.
		*
		* Row contract: the slot owner passes no props; `inject` in the slot
		* registration supplies `{ t, call, loopback }`. All copy and controls live
		* here. After a restart is accepted, poll `status` until the boot id changes
		* (the replacement host is up), then reload. The connection fence rejects
		* non-loopback callers anyway; the row just degrades visibly first.
		*/
		const styles = {
			row: {
				borderBottom: "1px solid var(--dsw-alias-border-l2)",
				alignItems: "center",
				gap: "8px",
				padding: "16px 0",
				display: "flex",
				width: "100%"
			},
			text: {
				flexDirection: "column",
				flex: 1,
				gap: "4px",
				minWidth: 0,
				paddingRight: 48,
				display: "flex"
			},
			title: {
				color: "var(--dsw-alias-label-primary)",
				fontSize: "14px",
				fontWeight: 400,
				lineHeight: "22px"
			},
			desc: {
				color: "var(--dsw-alias-label-secondary)",
				fontSize: "12px",
				lineHeight: "18px"
			},
			button: {
				background: "var(--dsw-alias-bg-module-platform)",
				height: 36,
				font: "inherit",
				color: "var(--dsw-alias-label-primary)",
				cursor: "pointer",
				border: "none",
				borderRadius: 18,
				alignItems: "center",
				gap: 12,
				padding: "0 14px",
				fontSize: "14px",
				lineHeight: "22px",
				display: "inline-flex",
				flexShrink: 0
			},
			error: {
				color: "#d64545",
				fontSize: "12px",
				whiteSpace: "nowrap"
			}
		};
		function RestartRow({ t, call, loopback }) {
			const [restarting, setRestarting] = (0, react.useState)(false);
			const [error, setError] = (0, react.useState)(null);
			const restart = async () => {
				if (restarting) return;
				setRestarting(true);
				setError(null);
				try {
					const result = await call("restart", {});
					if (!result.ok || result.value === void 0) throw new Error(result.error?.message ?? "restart rejected");
					const previous = result.value.boot;
					const deadline = Date.now() + 6e4;
					const poll = () => {
						call("status", {}).then((raw) => {
							const next = raw;
							if (typeof next.value?.boot === "string" && next.value.boot !== previous) {
								window.location.reload();
								return;
							}
							retry();
						}).catch(() => retry());
					};
					const retry = () => {
						if (Date.now() > deadline) {
							setRestarting(false);
							setError(t("timeout"));
						} else setTimeout(poll, 1500);
					};
					poll();
				} catch {
					setRestarting(false);
					setError(t("failed"));
				}
			};
			if (!loopback) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: styles.row,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: styles.text,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: styles.title,
						children: t("title")
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: styles.desc,
						children: t("localOnly")
					})]
				})
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: styles.row,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: styles.text,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: styles.title,
							children: t("title")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: styles.desc,
							children: t("hint")
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						style: styles.button,
						disabled: restarting,
						onClick: () => {
							restart();
						},
						children: restarting ? t("restarting") : t("restart")
					}),
					error ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						role: "status",
						style: styles.error,
						children: error
					}) : null
				]
			});
		}
		//#endregion
		//#region src/client/locales.ts
		/** zh/en dictionaries for the restart row. */
		const zh = {
			title: "重启 DeepSeek Harness",
			hint: "重启进程以重载插件与配置,约 5 秒,会话保留。运行中的轮次会中断。",
			restarting: "重启中…",
			restart: "立即重启",
			localOnly: "仅本机可用",
			failed: "重启失败",
			timeout: "重启超时,请手动重启"
		};
		const en = {
			title: "Restart DeepSeek Harness",
			hint: "Reload plugins and configuration (~5s). Sessions are kept; a running turn is interrupted.",
			restarting: "Restarting…",
			restart: "Restart now",
			localOnly: "Available on this machine only",
			failed: "Restart failed",
			timeout: "Restart timed out — restart manually"
		};
		//#endregion
		//#region src/client/index.ts
		const name = "dsh-restart-button-client";
		const inject = [
			"slots",
			"locale",
			"connection"
		];
		const NS = "restart.button";
		const CHANNEL = "/_dsh-restart-button";
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "dsh-restart-button: dictionaries");
			ctx.slots.inject("settings.general.item", () => ctx.slots.register({
				name: "settings.general.item",
				id: "restart",
				order: 30,
				locale: NS,
				inject: () => {
					const connection = ctx.get("connection");
					return {
						call: (endpoint, payload) => connection.rpc.call(CHANNEL, endpoint, payload),
						loopback: connection.isLoopback
					};
				}
			}, RestartRow));
		}
		//#endregion
		exports.CHANNEL = CHANNEL;
		exports.NS = NS;
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map