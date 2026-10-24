window.__ModuleLoader__.load({
	id: "dsh-cost",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/index.tsx
		/**
		* dsh-balance, browser half.
		*
		* Renders a right-aligned balance chip into the sidebar foot — the
		* `sidebar.footer.action` slot, the "optional actions beside Settings"
		* extension point (it renders in the foot area directly above the Settings
		* trigger). The chip polls the host route served by the node half
		* (`GET /plugins/balance`), so the API key never reaches the browser.
		*
		* The chip is provider-aware: it reads the *active session's* selected model
		* from the model-directory store (`ctx.modelDirectories`) and asks the host for
		* the balance of the provider that model rides on. A model on the `openrouter`
		* route shows the
		* OpenRouter remaining credits, a `moonshotai` route shows the Moonshot/Kimi
		* available balance, a `zai` route shows the Zhipu/GLM (Z.ai) account balance,
		* and a `minimax` route shows the MiniMax plan remaining. Any other route
		* (including a DeepSeek model, or an unknown route keeping the plugin's
		* original behavior) shows the DeepSeek account balance. The balance shown
		* therefore follows whichever provider the active model is on.
		*
		* States: loading text → amount (click to refresh), or a muted error pill
		* with the reason in a tooltip. Refreshes every minute, on click, whenever the
		* active session changes, AND as soon as the active session's model is switched
		* (via its model-directory store) — so flipping a model in the dropdown flips
		* the chip to that provider's balance immediately. The collapsed 56px rail
		* hides the chip.
		*
		* The status dot has provider meaning: DeepSeek marks its peak/off-peak
		* billing window (green = off-peak, red = peak; peak hours are 01:00–04:00 and
		* 06:00–10:00 UTC). OpenRouter marks remaining credits (green = credits left,
		* red = exhausted), Moonshot/Zhipu/MiniMax mark a positive remaining balance
		* or quota (green = left, red = exhausted).
		*/
		/** Cordis plugin name — unused here (the entry name comes from the loader row), kept for symmetry. */
		const name = "dsh-cost";
		/** Client bundle version, mirrored into the diagnostic probe (keep in sync with package.json). */
		const CLIENT_VERSION = "0.8.3";
		/**
		* Required services: the slot registry (provided by the client runtime). The
		* model-directory service (`ctx.modelDirectories`) is read lazily and treated
		* as optional — without it the chip keeps its original DeepSeek behavior.
		*/
		const inject = ["slots"];
		/** How often the chip re-polls the balance (ms). */
		const REFRESH_INTERVAL_MS = 6e4;
		/** Host route served by the node half. */
		const BALANCE_ENDPOINT = "/plugins/balance";
		/** Host route serving the last completed turn's tokens and estimated cost. */
		const USAGE_ENDPOINT = "/plugins/balance-usage";
		/** Host route serving the last N days' spend, folded from the local session logs. */
		const HISTORY_ENDPOINT = "/plugins/balance-history";
		/** How often the chip re-polls the (cheap, local) turn usage (ms). */
		const USAGE_INTERVAL_MS = 8e3;
		/** How long a fetched daily series stays usable before the popover refetches (ms). */
		const HISTORY_INTERVAL_MS = 6e4;
		/** How often the countdown text re-renders between polls (ms). */
		const CLOCK_INTERVAL_MS = 2e4;
		/**
		* Strip the modlens vision plugin's synthetic route prefix before matching.
		*
		* modlens registers `modlens-<upstream>` (and the legacy `deepseek-modlens`)
		* wrapper routes so a text-only model can accept pasted images. Those routes
		* bill the upstream provider's account, so they resolve to that provider's
		* balance kind; without this, selecting a "(modlens vision)" model fell through
		* to DeepSeek and the chip showed a missing-key error instead of the OpenRouter
		* credit the session was actually spending.
		*/
		function unwrapModlensProvider(provider) {
			const p = provider.toLowerCase();
			if (p === "deepseek-modlens") return "deepseek";
			return p.startsWith("modlens-") ? p.slice(8) : p;
		}
		/**
		* Map a provider route id to the balance the plugin serves. These are the
		* routes the plugin knows; a provider route it does not recognize (including a
		* custom provider id) falls back to DeepSeek, so such a session keeps showing
		* the DeepSeek balance rather than failing the chip. The route ids are the DSH
		* pi-ai built-in catalog names; each regional (`-cn`) variant maps to the same
		* kind because the host tries the matching mirror endpoint for that key's site.
		*/
		function kindForProvider(provider) {
			const p = unwrapModlensProvider(provider);
			if (p === "openrouter") return "openrouter";
			if (p === "moonshotai" || p === "moonshotai-cn") return "moonshot";
			if (p === "zai" || p === "zai-coding-cn" || p === "zhipu") return "zhipu";
			if (p === "minimax" || p === "minimax-cn") return "minimax";
			return "deepseek";
		}
		/**
		* Resolve the session the user currently has open.
		*
		* alpha.1: the list snapshot's `current`. alpha.2: that field is gone, so fall
		* back to the session retained by the main view — the same derivation
		* `ui-session` and `DocumentTitle` use. Returns undefined when nothing is open,
		* which the chip treats as its DeepSeek fallback (never failing the chip).
		* @param snapshot - the sessions list snapshot supplied by `useSessions`.
		* @returns the open session id, or undefined when none is retained.
		*/
		function currentSessionId(snapshot) {
			if (snapshot.current !== void 0 && snapshot.current !== null) return snapshot.current;
			return Object.values(snapshot.byId ?? {}).find((row) => (row.retainedBy?.mainView ?? 0) > 0)?.id;
		}
		/**
		* Resolve the balance kind for the active session's model from the shared
		* model-directory store — the same state the composer's model seat writes, so
		* the chip follows the exact selection the session will use next. A missing
		* session, an absent model-directory service, a directory that is not yet
		* resolved (its `current` is `null` until the catalog loads), or any lookup
		* failure falls back to DeepSeek, never failing the chip; the store
		* subscription re-polls once `current` resolves or changes.
		* @param modelDirectories - the session model-selection service, when composed.
		* @param sessionId - the active session, or undefined when none is current.
		* @returns the balance kind to query.
		*/
		function kindForSession(modelDirectories, sessionId) {
			if (sessionId === void 0 || modelDirectories === void 0) return "deepseek";
			try {
				const provider = modelDirectories.directoryFor(sessionId).store.getSnapshot().current?.provider;
				return provider === void 0 ? "deepseek" : kindForProvider(provider);
			} catch {
				return "deepseek";
			}
		}
		/** Currency code → glyph; unknown codes fall back to the code itself. */
		function currencySymbol(currency) {
			switch (currency.toUpperCase()) {
				case "CNY": return "¥";
				case "USD": return "$";
				case "EUR": return "€";
				case "GBP": return "£";
				case "JPY": return "¥";
				default: return `${currency} `;
			}
		}
		/**
		* DeepSeek peak/off-peak billing (official footnote:
		* https://api-docs.deepseek.com/quick_start/pricing). Peak is **Monday–Friday**,
		* Beijing time (UTC+8) 09:00–12:00 and 14:00–18:00 — which is 01:00–04:00 and
		* 06:00–10:00 UTC on the same day. Every other hour, including the whole
		* weekend, is off-peak (half the peak price). Both peak windows fall inside the
		* same UTC day as their Beijing weekday, so the weekend check uses the UTC day.
		* @param now - the instant to classify (defaults to now).
		* @returns whether the instant falls inside a peak window.
		*/
		function isPeakHour(now = /* @__PURE__ */ new Date()) {
			const day = now.getUTCDay();
			if (day === 0 || day === 6) return false;
			const hour = now.getUTCHours();
			return hour >= 1 && hour < 4 || hour >= 6 && hour < 10;
		}
		/**
		* The instant the billing window next flips, and which window it flips to.
		* The scan steps forward a minute at a time (at most eight days, the
		* weekend gap), so it needs no hand-written weekday arithmetic and cannot
		* disagree with {@link isPeakHour}.
		* @param now - the instant to measure from.
		* @returns the next window change, or undefined if none was found.
		*/
		function nextWindowChange(now) {
			const STEP_MS = 6e4;
			const current = isPeakHour(now) ? "peak" : "offpeak";
			let cursor = Math.ceil(now.getTime() / STEP_MS) * STEP_MS;
			for (let index = 0; index < 8 * 24 * 60; index += 1) {
				cursor += STEP_MS;
				const at = new Date(cursor);
				const kind = isPeakHour(at) ? "peak" : "offpeak";
				if (kind !== current) return {
					at,
					kind,
					current
				};
			}
			return void 0;
		}
		/** A compact "2小时13分" / "45分钟" span. */
		function formatRemaining(ms) {
			const minutes = Math.max(0, Math.round(ms / 6e4));
			const hours = Math.floor(minutes / 60);
			const rest = minutes % 60;
			if (hours === 0) return `${rest}分钟`;
			if (rest === 0) return `${hours}小时`;
			return `${hours}小时${rest}分`;
		}
		/** The same span in the sidebar's short form: "2h13m" / "45m". */
		function formatRemainingShort(ms) {
			const minutes = Math.max(0, Math.round(ms / 6e4));
			const hours = Math.floor(minutes / 60);
			const rest = minutes % 60;
			if (hours === 0) return `${rest}m`;
			if (rest === 0) return `${hours}h`;
			return `${hours}h${rest}m`;
		}
		/** An estimated amount, kept readable at sub-cent precision. */
		function formatCost(value, symbol) {
			if (typeof value !== "number" || !Number.isFinite(value)) return "";
			if (value > 0 && value < 1e-4) return `${symbol}<0.0001`;
			return `${symbol}${value.toFixed(4)}`;
		}
		/** "本轮 #12 · 未缓存输入 1,234 · 缓存读 5,678 · 输出 890" for the tooltip. */
		function usageDetail(usage, symbol) {
			if (usage === null || usage === void 0) return "";
			const tokens = usage.tokens ?? {};
			const route = usage.route === null || usage.route === void 0 ? "" : ` · ${usage.route.model}`;
			const parts = [
				`第 ${usage.turn} 轮${route}`,
				`本轮 ≈${formatCost(usage.estimatedCost, symbol)}`,
				`未缓存输入 ${tokens.uncachedInput ?? 0}`,
				`缓存读 ${tokens.cacheRead ?? 0}`,
				`输出 ${tokens.output ?? 0}`,
				`共 ${tokens.total ?? 0} tok`
			];
			return parts.join(" · ");
		}
		/** "本次对话 共 3 轮 · 累计 ≈¥0.42 · …" — the whole-conversation readout. */
		function sessionDetail(spend, symbol) {
			if (spend === null || spend === void 0) return "";
			const tokens = spend.tokens ?? {};
			const parts = [
				`本次对话 共 ${spend.turns ?? 0} 轮`,
				`累计 ≈${formatCost(spend.estimatedCost, symbol)}`,
				`未缓存输入 ${tokens.uncachedInput ?? 0}`,
				`缓存读 ${tokens.cacheRead ?? 0}`,
				`输出 ${tokens.output ?? 0}`,
				`共 ${tokens.total ?? 0} tok`
			];
			return parts.join(" · ");
		}
		/**
		* Shape the OpenRouter response into the chip display state. The host serves
		* `total_credits`/`total_usage` (from `/api/v1/credits`), whose difference is
		* the remaining balance in dollars.
		*/
		function renderOpenRouter(data) {
			const info = data.balance;
			const totalCredits = typeof info?.total_credits === "number" ? info.total_credits : void 0;
			const totalUsage = typeof info?.total_usage === "number" ? info.total_usage : void 0;
			if (totalCredits === void 0 || totalUsage === void 0) return {
				kind: "error",
				message: "No OpenRouter balance info returned"
			};
			const remaining = Math.max(0, totalCredits - totalUsage);
			const total = remaining.toFixed(2);
			return {
				kind: "ok",
				provider: "openrouter",
				symbol: "$",
				total,
				title: `OpenRouter · remaining $${total}`,
				dotColor: remaining > 0 ? "var(--dsw-alias-state-success-primary)" : "var(--dsw-alias-state-error-primary)"
			};
		}
		/** Shape the DeepSeek response into the chip display state (the original behavior). */
		function renderDeepSeek(data) {
			const info = data.balance?.balance_infos?.[0];
			if (info === void 0) return {
				kind: "error",
				message: "No balance info returned"
			};
			const symbol = currencySymbol(info.currency);
			const breakdown = `Total ${symbol}${info.total_balance} · Granted ${symbol}${info.granted_balance} · Topped up ${symbol}${info.topped_up_balance}`;
			const peak = isPeakHour();
			const windowLabel = peak ? "Peak · Mon–Fri 09:00–12:00, 14:00–18:00 Beijing (01:00–04:00, 06:00–10:00 UTC)" : "Off-peak · 50% of the peak price";
			return {
				kind: "ok",
				provider: "deepseek",
				symbol,
				total: info.total_balance,
				title: `${windowLabel} · ${breakdown}`,
				dotColor: peak ? "var(--dsw-alias-state-error-primary)" : "var(--dsw-alias-state-success-primary)"
			};
		}
		/**
		* Shape the Moonshot (Kimi) response into the chip display state. The host
		* unwraps `data` and serves `available_balance` (USD, cash + voucher) from
		* `/v1/users/me/balance`.
		*/
		function renderMoonshot(data) {
			const info = data.balance;
			const available = typeof info?.available_balance === "number" ? info.available_balance : void 0;
			if (available === void 0) return {
				kind: "error",
				message: "No Moonshot balance info returned"
			};
			const total = Math.max(0, available).toFixed(2);
			const cash = typeof info?.cash_balance === "number" ? info.cash_balance : void 0;
			const voucher = typeof info?.voucher_balance === "number" ? info.voucher_balance : void 0;
			return {
				kind: "ok",
				provider: "moonshot",
				symbol: "$",
				total,
				title: `Moonshot · ${cash !== void 0 && voucher !== void 0 ? `Cash $${cash.toFixed(2)} · Voucher $${voucher.toFixed(2)}` : `Available $${total}`}`,
				dotColor: available > 0 ? "var(--dsw-alias-state-success-primary)" : "var(--dsw-alias-state-error-primary)"
			};
		}
		/**
		* Shape the Zhipu / GLM (Z.ai) response into the chip display state. The host
		* unwraps the account-report container, whose balance sits under a variety of
		* names (`balance`, `availableBalance`, `available_balance`, …) with a currency
		* that defaults to CNY. This is a prepaid account amount in the provider's
		* currency, not necessarily dollars.
		*/
		function renderZhipu(data) {
			const info = data.balance;
			const container = info !== void 0 && info !== null && typeof info === "object" && !Array.isArray(info) ? info : void 0;
			if (container === void 0) return {
				kind: "error",
				message: "No Zhipu balance info returned"
			};
			const entries = Array.isArray(container.data) ? container.data : [container];
			let remaining;
			for (const entry of entries) {
				for (const key of [
					"available_balance",
					"availableBalance",
					"balance",
					"total_balance",
					"totalBalance",
					"rechargeAmount"
				]) {
					const value = entry[key];
					if (typeof value === "number") {
						remaining = value;
						break;
					}
				}
				if (remaining !== void 0) break;
			}
			if (remaining === void 0) return {
				kind: "error",
				message: "No Zhipu balance amount returned"
			};
			const symbol = currencySymbol(typeof container.currency === "string" ? container.currency : "CNY");
			const total = Math.max(0, remaining).toFixed(2);
			return {
				kind: "ok",
				provider: "zhipu",
				symbol,
				total,
				title: `Zhipu · remaining ${symbol}${total}`,
				dotColor: remaining > 0 ? "var(--dsw-alias-state-success-primary)" : "var(--dsw-alias-state-error-primary)"
			};
		}
		/**
		* Shape the MiniMax response into the chip display state. The host relays the
		* top-level token-plan body; the first `model_remains` entry carries the
		* remaining prompts (MiniMax reports the mislabeled `current_interval_usage_count`
		* as the remainder, with explicit `*_remaining_*` aliases) or a remaining
		* percentage. This is a subscription quota, not a prepaid dollar balance, so
		* the chip renders the count or percent rather than a currency amount.
		*/
		function renderMiniMax(data) {
			const entry = data.balance?.model_remains?.[0];
			if (entry === void 0) return {
				kind: "error",
				message: "No MiniMax plan info returned"
			};
			const remainingCount = typeof entry.current_interval_remaining_count === "number" ? entry.current_interval_remaining_count : typeof entry.current_interval_remains_count === "number" ? entry.current_interval_remains_count : typeof entry.current_interval_usage_count === "number" ? entry.current_interval_usage_count : void 0;
			const remainingPercent = typeof entry.current_interval_remaining_percent === "number" ? entry.current_interval_remaining_percent : void 0;
			const plan = entry.current_subscribe_title ?? entry.plan_name ?? entry.plan ?? "MiniMax";
			if (remainingCount !== void 0) return {
				kind: "ok",
				provider: "minimax",
				symbol: "",
				total: remainingPercent !== void 0 ? `${remainingCount} (${remainingPercent}%)` : String(remainingCount),
				title: `${plan} · ${remainingCount} remaining`,
				dotColor: remainingCount > 0 ? "var(--dsw-alias-state-success-primary)" : "var(--dsw-alias-state-error-primary)"
			};
			if (remainingPercent !== void 0) return {
				kind: "ok",
				provider: "minimax",
				symbol: "",
				total: `${remainingPercent}%`,
				title: `${plan} · ${remainingPercent}% remaining`,
				dotColor: remainingPercent > 0 ? "var(--dsw-alias-state-success-primary)" : "var(--dsw-alias-state-error-primary)"
			};
			return {
				kind: "error",
				message: "No MiniMax remaining value returned"
			};
		}
		/** Choose the provider-aware display state for a host response. */
		function displayState(data) {
			switch (data.provider ?? "deepseek") {
				case "openrouter": return renderOpenRouter(data);
				case "moonshot": return renderMoonshot(data);
				case "zhipu": return renderZhipu(data);
				case "minimax": return renderMiniMax(data);
				default: return renderDeepSeek(data);
			}
		}
		/**
		* One or more LobeHub 24×24 brand-mark paths per provider, all filled with
		* `currentColor` so they inherit the chip's muted label color across
		* light/dark themes. Every known provider has a real mark; adding a provider
		* means adding an entry here (and its kind to {@link BalanceKind}).
		*/
		const PROVIDER_LOGO_PATHS = {
			deepseek: ["M23.748 4.482c-.254-.124-.364.113-.512.234-.051.039-.094.09-.137.136-.372.397-.806.657-1.373.626-.829-.046-1.537.214-2.163.848-.133-.782-.575-1.248-1.247-1.548-.352-.156-.708-.311-.955-.65-.172-.241-.219-.51-.305-.774-.055-.16-.11-.323-.293-.35-.2-.031-.278.136-.356.276-.313.572-.434 1.202-.422 1.84.027 1.436.633 2.58 1.838 3.393.137.093.172.187.129.323-.082.28-.18.552-.266.833-.055.179-.137.217-.329.14a5.526 5.526 0 01-1.736-1.18c-.857-.828-1.631-1.742-2.597-2.458a11.365 11.365 0 00-.689-.471c-.985-.957.13-1.743.388-1.836.27-.098.093-.432-.779-.428-.872.004-1.67.295-2.687.684a3.055 3.055 0 01-.465.137 9.597 9.597 0 00-2.883-.102c-1.885.21-3.39 1.102-4.497 2.623C.082 8.606-.231 10.684.152 12.85c.403 2.284 1.569 4.175 3.36 5.653 1.858 1.533 3.997 2.284 6.438 2.14 1.482-.085 3.133-.284 4.994-1.86.47.234.962.327 1.78.397.63.059 1.236-.03 1.705-.128.735-.156.684-.837.419-.961-2.155-1.004-1.682-.595-2.113-.926 1.096-1.296 2.746-2.642 3.392-7.003.05-.347.007-.565 0-.845-.004-.17.035-.237.23-.256a4.173 4.173 0 001.545-.475c1.396-.763 1.96-2.015 2.093-3.517.02-.23-.004-.467-.247-.588zM11.581 18c-2.089-1.642-3.102-2.183-3.52-2.16-.392.024-.321.471-.235.763.09.288.207.486.371.739.114.167.192.416-.113.603-.673.416-1.842-.14-1.897-.167-1.361-.802-2.5-1.86-3.301-3.307-.774-1.393-1.224-2.887-1.298-4.482-.02-.386.093-.522.477-.592a4.696 4.696 0 011.529-.039c2.132.312 3.946 1.265 5.468 2.774.868.86 1.525 1.887 2.202 2.891.72 1.066 1.494 2.082 2.48 2.914.348.292.625.514.891.677-.802.09-2.14.11-3.054-.614zm1-6.44a.306.306 0 01.415-.287.302.302 0 01.2.288.306.306 0 01-.31.307.303.303 0 01-.304-.308zm3.11 1.596c-.2.081-.399.151-.59.16a1.245 1.245 0 01-.798-.254c-.274-.23-.47-.358-.552-.758a1.73 1.73 0 01.016-.588c.07-.327-.008-.537-.239-.727-.187-.156-.426-.199-.688-.199a.559.559 0 01-.254-.078c-.11-.054-.2-.19-.114-.358.028-.054.16-.186.192-.21.356-.202.767-.136 1.146.016.352.144.618.408 1.001.782.391.451.462.576.685.914.176.265.336.537.445.848.067.195-.019.354-.25.452z"],
			openrouter: ["M18.654 3.87a5.087 5.087 0 110 10.174L23.7 19.09c.64.641.187 1.737-.72 1.737H8.48a8.479 8.479 0 010-16.958h10.175zM8.479 7.26a5.087 5.087 0 100 10.176 5.087 5.087 0 000-10.175z"],
			moonshot: ["M21.846 0a1.923 1.923 0 110 3.846H20.15a.226.226 0 01-.227-.226V1.923C19.923.861 20.784 0 21.846 0z", "M11.065 11.199l7.257-7.2c.137-.136.06-.41-.116-.41H14.3a.164.164 0 00-.117.051l-7.82 7.756c-.122.12-.302.013-.302-.179V3.82c0-.127-.083-.23-.185-.23H3.186c-.103 0-.186.103-.186.23V19.77c0 .128.083.23.186.23h2.69c.103 0 .186-.102.186-.23v-3.25c0-.069.025-.135.069-.178l2.424-2.406a.158.158 0 01.205-.023l6.484 4.772a7.677 7.677 0 003.453 1.283c.108.012.2-.095.2-.23v-3.06c0-.117-.07-.212-.164-.227a5.028 5.028 0 01-2.027-.807l-5.613-4.064c-.117-.078-.132-.279-.028-.381z"],
			zhipu: ["M12.105 2L9.927 4.953H.653L2.83 2h9.276zM23.254 19.048L21.078 22h-9.242l2.174-2.952h9.244zM24 2L9.264 22H0L14.736 2H24z"],
			minimax: ["M16.278 2c1.156 0 2.093.927 2.093 2.07v12.501a.74.74 0 00.744.709.74.74 0 00.743-.709V9.099a2.06 2.06 0 012.071-2.049A2.06 2.06 0 0124 9.1v6.561a.649.649 0 01-.652.645.649.649 0 01-.653-.645V9.1a.762.762 0 00-.766-.758.762.762 0 00-.766.758v7.472a2.037 2.037 0 01-2.048 2.026 2.037 2.037 0 01-2.048-2.026v-12.5a.785.785 0 00-.788-.753.785.785 0 00-.789.752l-.001 15.904A2.037 2.037 0 0113.441 22a2.037 2.037 0 01-2.048-2.026V18.04c0-.356.292-.645.652-.645.36 0 .652.289.652.645v1.934c0 .263.142.506.372.638.23.131.514.131.744 0a.734.734 0 00.372-.638V4.07c0-1.143.937-2.07 2.093-2.07zm-5.674 0c1.156 0 2.093.927 2.093 2.07v11.523a.648.648 0 01-.652.645.648.648 0 01-.652-.645V4.07a.785.785 0 00-.789-.78.785.785 0 00-.789.78v14.013a2.06 2.06 0 01-2.07 2.048 2.06 2.06 0 01-2.071-2.048V9.1a.762.762 0 00-.766-.758.762.762 0 00-.766.758v3.8a2.06 2.06 0 01-2.071 2.049A2.06 2.06 0 010 12.9v-1.378c0-.357.292-.646.652-.646.36 0 .653.29.653.646V12.9c0 .418.343.757.766.757s.766-.339.766-.757V9.099a2.06 2.06 0 012.07-2.048 2.06 2.06 0 012.071 2.048v8.984c0 .419.343.758.767.758.423 0 .766-.339.766-.758V4.07c0-1.143.937-2.07 2.093-2.07z"]
		};
		/**
		* A small theme-friendly brand glyph for a provider, rendered left of the
		* amount. Each provider's mark fills `currentColor`, so it adapts to the
		* chip's muted label color across light/dark themes.
		*/
		function ProviderLogo({ provider, size = 14 }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				width: size,
				height: size,
				viewBox: "0 0 24 24",
				fill: "currentColor",
				fillRule: "evenodd",
				style: {
					flexShrink: 0,
					display: "block"
				},
				"aria-hidden": "true",
				children: PROVIDER_LOGO_PATHS[provider].map((d) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d }, d))
			});
		}
		/** Chip geometry and the stat-row typography (a copy of the chat package's `StatsPills.module.css`). */
		const CHIP_CSS = ".dshcost_anchor{min-width:0;font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));display:inline-flex}.dshcost_pill{box-sizing:border-box;border-radius:var(--dsw-radius-sm);max-width:100%;color:var(--dsw-alias-label-tertiary);font:inherit;font-variant-numeric:tabular-nums;line-height:inherit;white-space:nowrap;background:0 0;border:none;align-items:center;gap:6px;padding:1px 8px;display:inline-flex;cursor:pointer}.dshcost_pill:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}.dshcost_pill[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}.dshcost_pill svg{flex:none;width:14px;height:14px}.dshcost_label{text-overflow:ellipsis;min-width:0;overflow:hidden;white-space:nowrap}.dshcost_sep{color:var(--dsw-alias-separator-primary);margin:0 6px}.dshcost_dot{display:inline-block;width:6px;height:6px;border-radius:50%;margin:0 6px;vertical-align:middle}";
		/** The pinned bubble: the UX kit tooltip metrics plus the chart footer. */
		const POP_CSS = ".dshcost_pop{position:fixed;z-index:1100;box-sizing:border-box;width:max-content;max-width:min(50vw,560px);padding:5px 9px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-tooltip-bg);color:var(--dsw-static-neutral-bluish-00);font-size:13px;line-height:20px;white-space:pre-line;overflow-wrap:break-word;pointer-events:auto;animation:dshcost_pop_in .15s var(--ds-ease-in-out)}.dshcost_pop[data-side=top]{transform:translate(-50%,-100%)}.dshcost_pop[data-side=bottom]{transform:translate(-50%,0)}.dshcost_popchart{width:300px;padding:8px 10px}.dshcost_poptext{min-width:0}@keyframes dshcost_pop_in{0%{opacity:0}}";
		/** The two spend charts (daily values, peak/off-peak stack). */
		const CHART_CSS = ".dshcost_chead{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin-bottom:9px}.dshcost_ctitle{font-size:13px;line-height:20px;color:#ffffffb3}.dshcost_cright{display:inline-flex;align-items:baseline;gap:10px}.dshcost_avgkey{display:inline-flex;align-items:center;gap:5px;font-size:10px;line-height:18px;color:#ffffff99;white-space:nowrap}.dshcost_avgkey i{width:12px;flex:none;border-top:1px dashed #ffffffa6}.dshcost_avg{position:absolute;left:0;right:0;border-top:1px dashed #ffffffa6;pointer-events:none;z-index:0}.dshcost_stats{display:flex;margin-top:8px;padding-top:7px;border-top:1px solid #ffffff1a}.dshcost_stat{flex:1;min-width:0;text-align:center}.dshcost_stat+.dshcost_stat{border-left:1px solid #ffffff14}.dshcost_stat b{display:block;font-size:13px;line-height:18px;font-weight:600;color:#fff;font-variant-numeric:tabular-nums}.dshcost_stat span{display:block;font-size:11px;line-height:15px;color:#ffffff73}.dshcost_ctotal{font-size:13px;line-height:20px;font-weight:600;color:#fff;font-variant-numeric:tabular-nums}.dshcost_legend{display:inline-flex;align-items:center;font-size:11px;line-height:18px;color:#ffffff99}.dshcost_swatch{width:7px;height:7px;border-radius:2px;display:inline-block;margin-right:4px}.dshcost_bars{position:relative;display:flex;align-items:flex-end;justify-content:center;gap:10px;height:78px;padding-bottom:1px;border-bottom:1px solid #ffffff1f}.dshcost_bcol{width:22px;height:100%;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;gap:3px;position:relative;z-index:1}.dshcost_bval{font-size:10px;line-height:12px;color:#ffffff8c;font-variant-numeric:tabular-nums;white-space:nowrap}.dshcost_bbar{width:22px;border-radius:3px 3px 0 0;background:#ffffff4d}.dshcost_bcol.dshcost_on .dshcost_bbar{background:#fff}.dshcost_bcol.dshcost_on .dshcost_bval{color:#fff}.dshcost_axis{display:flex;justify-content:center;gap:10px;margin-top:4px}.dshcost_day{width:22px;text-align:center;font-size:10px;line-height:15px;color:#ffffff7a}.dshcost_day.dshcost_on{color:#fff}.dshcost_sbars{display:flex;align-items:flex-end;justify-content:center;gap:12px;height:52px}.dshcost_scol{width:22px;display:flex;flex-direction:column;justify-content:flex-end;border-radius:6px;overflow:hidden}.dshcost_speak{width:22px;background:#f2f4f7}.dshcost_soff{width:22px;background:#4ecb78}.dshcost_sempty{display:none}";
		/** The right-click menu, matched to the UX kit's own menu metrics. */
		const MENU_CSS = ".dshcost_menu{position:fixed;z-index:1200;box-sizing:border-box;min-width:176px;padding:4px;border-radius:12px;background:var(--dsw-menu-surface-fill,#43454a73);backdrop-filter:var(--dsw-menu-backdrop-filter,blur(40px) saturate(150%));box-shadow:var(--dsw-elevation-prominent,0 0 0 .5px #ffffff14,0 8px 24px #00000059);color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px;animation:dshcost_pop_in .12s var(--ds-ease-in-out)}.dshcost_mitem{display:flex;align-items:center;gap:6px;width:100%;min-height:34px;padding:6px 8px;border:0;border-radius:var(--dsw-radius-md,12px);background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}.dshcost_mitem:hover,.dshcost_mitem[data-open=true]{background:var(--dsw-alias-interactive-bg-hover)}.dshcost_micon{display:inline-flex;flex:none;width:14px;height:14px;align-items:center;justify-content:center;color:var(--dsw-alias-menu-icon,#adb2b8)}.dshcost_mchevron{margin-left:auto;display:inline-flex;width:14px;height:14px;align-items:center;justify-content:center;color:var(--dsw-alias-label-tertiary)}.dshcost_msub{position:absolute;top:-4px;z-index:1;min-width:190px;padding:4px;border-radius:12px;background:var(--dsw-menu-surface-fill,#43454a73);backdrop-filter:var(--dsw-menu-backdrop-filter,blur(40px) saturate(150%));box-shadow:var(--dsw-elevation-prominent,0 0 0 .5px #ffffff14,0 8px 24px #00000059)}.dshcost_msub[data-side=right]{left:calc(100% + 6px)}.dshcost_msub[data-side=left]{right:calc(100% + 6px)}.dshcost_msub[data-valign=up]{top:auto;bottom:-4px}.dshcost_mcheck{display:inline-flex;flex:none;width:14px;height:14px;align-items:center;justify-content:center;color:var(--dsw-alias-label-primary)}.dshcost_mnote{margin-top:2px;padding:5px 8px 1px;border-top:1px solid var(--dsw-alias-border-l3);font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary)}.dshcost_msub[data-pane=spend]{top:34px}.dshcost_msub[data-pane=spend][data-valign=up]{top:auto;bottom:-4px}";
		/** Every rule this plugin owns, installed as one stylesheet. */
		const DOCK_CSS = CHIP_CSS + POP_CSS + CHART_CSS + MENU_CSS;
		/** Install the chip stylesheet once (idempotent across HMR and reloads). */
		function ensureDockStyle() {
			if (typeof document === "undefined") return;
			const tagId = "dsh-cost/chip.css";
			if (document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") !== null) return;
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-cost";
			tag.dataset.pluginCss = tagId;
			tag.textContent = DOCK_CSS;
			document.head.appendChild(tag);
		}
		/** Weekday glyphs for the chart axis (0 = Sunday). */
		const WEEKDAY_LABELS = ["日", "一", "二", "三", "四", "五", "六"];
		/** localStorage key holding the chosen chart style. */
		const CHART_STYLE_KEY = "dsh-cost/chart-style";
		/** Chart style ids: the annotated daily bars (default) and the peak/off-peak stack. */
		const CHART_STYLE_BARS = "bars";
		const CHART_STYLE_STACKED = "stacked";
		/** localStorage key holding the chosen cost readout. */
		const SPEND_MODE_KEY = "dsh-cost/spend-mode";
		/** Cost readout ids: the last completed turn (default) and the whole conversation. */
		const SPEND_MODE_TURN = "turn";
		const SPEND_MODE_SESSION = "session";
		/**
		* The persisted chart style, defaulting to {@link CHART_STYLE_BARS}. A missing
		* or unreadable `localStorage` (private mode, a foreign value) keeps the
		* default instead of failing the chip.
		* @returns the style id to render.
		*/
		function readChartStyle() {
			try {
				const stored = window.localStorage.getItem(CHART_STYLE_KEY);
				return stored === CHART_STYLE_STACKED || stored === CHART_STYLE_BARS ? stored : CHART_STYLE_BARS;
			} catch {
				return CHART_STYLE_BARS;
			}
		}
		/**
		* Persist the chosen chart style.
		* @param value - the style id to remember.
		*/
		function saveChartStyle(value) {
			try {
				window.localStorage.setItem(CHART_STYLE_KEY, value);
			} catch {}
		}
		/**
		* The persisted cost readout, defaulting to {@link SPEND_MODE_TURN}. A missing
		* or unreadable `localStorage` keeps the default instead of failing the chip.
		* @returns the readout id to render.
		*/
		function readSpendMode() {
			try {
				const stored = window.localStorage.getItem(SPEND_MODE_KEY);
				return stored === SPEND_MODE_SESSION ? SPEND_MODE_SESSION : SPEND_MODE_TURN;
			} catch {
				return SPEND_MODE_TURN;
			}
		}
		/**
		* Persist the chosen cost readout.
		* @param value - the readout id to remember.
		*/
		function saveSpendMode(value) {
			try {
				window.localStorage.setItem(SPEND_MODE_KEY, value);
			} catch {}
		}
		/** Two fraction digits for the headline total. */
		function formatMoney2(value) {
			return typeof value === "number" && Number.isFinite(value) ? value.toFixed(2) : "0.00";
		}
		/** A per-day amount: an em dash for a day with no spend, never a bare 0.00. */
		function formatBarValue(value) {
			if (typeof value !== "number" || !(value > 0)) return "";
			if (value < 0.01) return "<0.01";
			return value.toFixed(2);
		}
		/** The axis glyph for a day: its weekday, or 今 for today. */
		function weekdayLabel(day) {
			if (day.today === true) return "今";
			return WEEKDAY_LABELS[day.weekday] ?? "";
		}
		/**
		* Bar height in pixels: proportional to the window's largest day, with a
		* two-pixel floor so a small-but-real day still draws a visible line.
		* @param value - that day's cost.
		* @param max - the largest cost in the window.
		* @param height - the tallest bar's height.
		* @returns the bar height in pixels.
		*/
		function barPixels(value, max, height) {
			if (!(max > 0) || !(value > 0)) return 0;
			return Math.max(2, Math.round(value / max * height));
		}
		/**
		* The account balance as a plain amount, or null when the provider does not
		* report a currency figure. MiniMax reports a quota count and a percentage
		* (empty symbol), and OpenRouter reports dollars — neither can be divided by
		* the CNY seven-day average, so both return null and the summary falls back
		* to a different third cell.
		* @param state - the current chip display state.
		* @returns the CNY balance, or null.
		*/
		function cnyBalance(state) {
			if (state === null || state === void 0 || state.kind !== "ok" || state.symbol !== "¥") return null;
			if (state.provider !== "deepseek" && state.provider !== "zhipu") return null;
			const value = Number.parseFloat(String(state.total).replace(/,/g, ""));
			return Number.isFinite(value) && value >= 0 ? value : null;
		}
		/** The `样式` menu glyph: three bars of different heights. */
		function ChartIcon() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				width: 14,
				height: 14,
				viewBox: "0 0 14 14",
				fill: "none",
				"aria-hidden": "true",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M2.6 11.4V7.6",
					stroke: "currentColor",
					strokeWidth: 1.6,
					strokeLinecap: "round"
				}, "a"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M7 11.4V3.2",
					stroke: "currentColor",
					strokeWidth: 1.6,
					strokeLinecap: "round"
				}, "b"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M11.4 11.4V6",
					stroke: "currentColor",
					strokeWidth: 1.6,
					strokeLinecap: "round"
				}, "c")]
			});
		}
		/** The `消费显示` menu glyph: a yuan sign inside a coin. */
		function SpendIcon() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				width: 14,
				height: 14,
				viewBox: "0 0 14 14",
				fill: "none",
				"aria-hidden": "true",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
					cx: 7,
					cy: 7,
					r: 5.3,
					stroke: "currentColor",
					strokeWidth: 1.3
				}, "c"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M4.9 4.5 7 7.3l2.1-2.8",
					stroke: "currentColor",
					strokeWidth: 1.2,
					strokeLinecap: "round",
					strokeLinejoin: "round"
				}, "y"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M7 7.3v2.4M5.5 8.3h3",
					stroke: "currentColor",
					strokeWidth: 1.2,
					strokeLinecap: "round"
				}, "s")]
			});
		}
		/** The selected-option tick in the `样式` submenu. */
		function CheckIcon() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				width: 14,
				height: 14,
				viewBox: "0 0 14 14",
				fill: "none",
				"aria-hidden": "true",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M3 7.4l2.6 2.6L11 4.6",
					stroke: "currentColor",
					strokeWidth: 1.6,
					strokeLinecap: "round",
					strokeLinejoin: "round"
				})
			});
		}
		/** The default chart: a bar per day with its amount above it, today lit. */
		function DailyChart({ history }) {
			const days = history.days;
			let max = 0;
			for (const day of days) if (typeof day.cost === "number" && day.cost > max) max = day.cost;
			const average = days.length > 0 ? history.total / days.length : 0;
			const averagePx = max > 0 && average > 0 ? 1 + Math.round(average / max * 52) : 0;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dshcost_chart",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dshcost_chead",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dshcost_ctitle",
						children: "近 7 天消费"
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: "dshcost_cright",
						children: [averagePx === 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "dshcost_avgkey",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("i", { "aria-hidden": "true" }), `日均 ¥${formatMoney2(average)}`]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "dshcost_ctotal",
							children: ["¥", formatMoney2(history.total)]
						})]
					})]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dshcost_bars",
					children: [averagePx === 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dshcost_avg",
						style: { bottom: `${averagePx}px` }
					}, "avg"), days.map((day) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: day.today === true ? "dshcost_bcol dshcost_on" : "dshcost_bcol",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dshcost_bval",
							children: formatBarValue(day.cost)
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dshcost_bbar",
							style: { height: `${barPixels(day.cost, max, 52)}px` }
						})]
					}, day.date))]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "dshcost_axis",
					children: days.map((day) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: day.today === true ? "dshcost_day dshcost_on" : "dshcost_day",
						children: weekdayLabel(day)
					}, day.date))
				})]
			});
		}
		/**
		* The three-number summary under either chart: today, the daily average and
		* either how many days the balance lasts (CNY) or how many turns the week
		* took (any other provider, where a dollar/quota balance cannot be divided
		* by the CNY average).
		*/
		function SpendStats({ history, balance }) {
			const days = history.days;
			const average = days.length > 0 ? history.total / days.length : 0;
			let today = 0;
			let turns = 0;
			for (const day of days) {
				if (day.today === true) today = day.cost;
				turns += typeof day.turns === "number" ? day.turns : 0;
			}
			const cells = [{
				value: `¥${formatMoney2(today)}`,
				label: "今日"
			}, {
				value: `¥${formatMoney2(average)}`,
				label: "日均"
			}, balance !== null && average > 0 ? {
				value: `${Math.floor(balance / average)} 天`,
				label: "余额可用"
			} : {
				value: `${turns} 轮`,
				label: "本周轮次"
			}];
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "dshcost_stats",
				children: cells.map((cell) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dshcost_stat",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", { children: cell.value }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: cell.label })]
				}, cell.label))
			});
		}
		/** The alternative chart: each day stacked into peak price and off-peak price. */
		function StackedChart({ history }) {
			const days = history.days;
			let max = 0;
			for (const day of days) if (typeof day.cost === "number" && day.cost > max) max = day.cost;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dshcost_chart",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dshcost_chead",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dshcost_ctitle",
						children: "近 7 天消费"
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: "dshcost_cright",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "dshcost_legend",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dshcost_swatch",
								style: { background: "#f2f4f7" }
							}), "高峰"]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "dshcost_legend",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dshcost_swatch",
								style: { background: "#4ecb78" }
							}), "空闲"]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "dshcost_ctotal",
							children: ["¥", formatMoney2(history.total)]
						})]
					})]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "dshcost_sbars",
					children: days.map((day) => {
						if (!(day.cost > 0)) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dshcost_scol",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { className: "dshcost_sempty" })
						}, day.date);
						const total = barPixels(day.cost, max, 48);
						const peak = Math.round(total * (day.peak / day.cost));
						const offpeak = total - peak;
						const stack = [];
						if (peak > 0) stack.push(/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dshcost_speak",
							style: { height: `${peak}px` }
						}, "peak"));
						if (offpeak > 0) stack.push(/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dshcost_soff",
							style: { height: `${offpeak}px` }
						}, "off"));
						return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dshcost_scol",
							children: stack
						}, day.date);
					})
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "dshcost_axis",
					children: days.map((day) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: day.today === true ? "dshcost_day dshcost_on" : "dshcost_day",
						children: weekdayLabel(day)
					}, day.date))
				})]
			});
		}
		/**
		* `react-dom`, resolved opportunistically so a composition that does not
		* publish it still renders the chip (the popover then stays inline).
		*/
		const reactDom = (() => {
			try {
				return require("react-dom");
			} catch {
				return void 0;
			}
		})();
		/** The pinned detail bubble's element id, referenced by the chip's `aria-controls`. */
		const POPOVER_ID = "dshcost-popover";
		/**
		* The balance chip, rendered into the composer's statistic row
		* (`conversation.composer.dock`) instead of the sidebar foot — the foot has
		* no room for the account name once a cost line joins the amount, and the
		* dock is where the user already reads per-turn numbers.
		*
		* The chip is hover-silent: it carries no `title`, so hovering it pops
		* nothing up. A left click opens (and a second closes) one pinned bubble
		* above it, docked and styled exactly like the UX kit's own tooltip
		* (`._bubble_12mhf_1`): fixed positioning, 13px/20px, the tooltip fill and
		* the shared small radius, centred on the chip and flipped below it when
		* there is no room above. The bubble shows the last seven days as a bar
		* chart — the annotated daily bars by default, or the peak/off-peak stack —
		* with the account/turn detail kept as a footer.
		*
		* A right click opens the chip's own menu, whose `样式` entry picks between
		* the two charts; the choice is persisted in `localStorage`. Both the bubble
		* and the menu are portalled to `document.body` so the composer's overflow
		* cannot clip them; click-away and Escape close whichever is open.
		*
		* @param props - composed slot props plus the injected model-directory accessor.
		* @returns the chip, its pinned bubble and its context menu.
		*/
		function BalanceDock({ getModelDirectories, useSessions, showCost = true }) {
			const [state, setState] = (0, react.useState)({ kind: "loading" });
			const [usage, setUsage] = (0, react.useState)(null);
			const [open, setOpen] = (0, react.useState)(false);
			const [history, setHistory] = (0, react.useState)(null);
			const [chartStyle, setChartStyle] = (0, react.useState)(readChartStyle);
			const [spendMode, setSpendMode] = (0, react.useState)(readSpendMode);
			const [sessionUsage, setSessionUsage] = (0, react.useState)(null);
			const [menu, setMenu] = (0, react.useState)(null);
			const [, tick] = (0, react.useState)(0);
			const lastBalanceRef = (0, react.useRef)({ at: 0, key: "" });
			const historyAtRef = (0, react.useRef)(0);
			const pillRef = (0, react.useRef)(null);
			const popRef = (0, react.useRef)(null);
			const menuRef = (0, react.useRef)(null);
			// The dock is a session-scoped slot; `useSessions` comes from the shared
			// root kit. Guard the absent case so a composition without the sessions
			// service still renders a (priceless) chip instead of crashing the row.
			const sessionsHook = typeof useSessions === "function" ? useSessions : () => void 0;
			const activeSession = sessionsHook((snapshot) => currentSessionId(snapshot));
			const refresh = (0, react.useCallback)(async () => {
				const kind = kindForSession(getModelDirectories(), activeSession);
				const key = `${kind}|${activeSession ?? ""}`;
				const nowMs = Date.now();
				const wantBalance = lastBalanceRef.current.key !== key || nowMs - lastBalanceRef.current.at >= REFRESH_INTERVAL_MS;
				if (wantBalance) lastBalanceRef.current = {
					at: nowMs,
					key
				};
				try {
					const [balanceResponse, usageResponse] = await Promise.all([wantBalance ? fetch(`${BALANCE_ENDPOINT}?kind=${kind}`, { headers: { accept: "application/json" } }) : void 0, activeSession === void 0 ? void 0 : fetch(`${USAGE_ENDPOINT}?session=${encodeURIComponent(activeSession)}`, { headers: { accept: "application/json" } }).catch(() => void 0)]);
					if (balanceResponse !== void 0) {
						const data = await balanceResponse.json();
						setState(data.ok ? displayState(data) : {
							kind: "error",
							message: data.message ?? data.error ?? "unavailable"
						});
					}
					if (usageResponse !== void 0) {
						const usageData = await usageResponse.json().catch(() => void 0);
						if (usageData !== void 0 && usageData.ok === true) {
							setUsage(usageData.usage ?? null);
							setSessionUsage(usageData.session ?? null);
						}
					} else {
						setUsage(null);
						setSessionUsage(null);
					}
				} catch {
					if (wantBalance) setState({
						kind: "error",
						message: "Failed to load"
					});
				}
			}, [getModelDirectories, activeSession]);
			/**
			* Fetch the seven-day series, at most once per {@link HISTORY_INTERVAL_MS}
			* unless forced. The host folds it from the local session logs, so this is
			* a cheap local request — but not one worth repeating on every render.
			* @param force - bypass the interval (first mount, popover open, refreshes).
			*/
			const loadHistory = (0, react.useCallback)(async (force) => {
				const nowMs = Date.now();
				if (!force && nowMs - historyAtRef.current < HISTORY_INTERVAL_MS) return;
				historyAtRef.current = nowMs;
				try {
					const response = await fetch(`${HISTORY_ENDPOINT}?days=7`, { headers: { accept: "application/json" } });
					const data = await response.json();
					if (data !== null && data.ok === true && Array.isArray(data.days) && data.days.length > 0) setHistory(data);
				} catch {}
			}, []);
			(0, react.useEffect)(() => {
				refresh();
				const timer = window.setInterval(() => {
					refresh();
				}, USAGE_INTERVAL_MS);
				return () => {
					window.clearInterval(timer);
				};
			}, [refresh]);
			(0, react.useEffect)(() => {
				const timer = window.setInterval(() => {
					tick((value) => value + 1);
				}, CLOCK_INTERVAL_MS);
				return () => {
					window.clearInterval(timer);
				};
			}, []);
			(0, react.useEffect)(() => {
				loadHistory(true);
			}, [loadHistory]);
			(0, react.useEffect)(() => {
				if (!open) return;
				loadHistory(false);
				const timer = window.setInterval(() => {
					loadHistory(true);
				}, HISTORY_INTERVAL_MS);
				return () => {
					window.clearInterval(timer);
				};
			}, [open, loadHistory]);
			(0, react.useLayoutEffect)(() => {
				if (!open) return;
				const pill = pillRef.current;
				const pop = popRef.current;
				if (pill === null || pop === null) return;
				const place = () => {
					const anchor = pill.getBoundingClientRect();
					const width = pop.offsetWidth;
					const height = pop.offsetHeight;
					const margin = 12;
					const gap = 8;
					const left = Math.max(margin + width / 2, Math.min(anchor.left + anchor.width / 2, window.innerWidth - margin - width / 2));
					const above = anchor.top - gap - height >= margin;
					pop.dataset.side = above ? "top" : "bottom";
					pop.style.left = `${left}px`;
					pop.style.top = `${above ? anchor.top - gap : anchor.bottom + gap}px`;
					pop.style.visibility = "visible";
				};
				place();
				const observer = new ResizeObserver(place);
				observer.observe(pop);
				window.addEventListener("resize", place);
				window.addEventListener("scroll", place, true);
				return () => {
					observer.disconnect();
					window.removeEventListener("resize", place);
					window.removeEventListener("scroll", place, true);
				};
			}, [open]);
			(0, react.useEffect)(() => {
				if (!open) return;
				const onPointerDown = (event) => {
					const target = event.target;
					if (pillRef.current !== null && pillRef.current.contains(target)) return;
					if (popRef.current !== null && popRef.current.contains(target)) return;
					setOpen(false);
				};
				const onKeyDown = (event) => {
					if (event.key !== "Escape") return;
					event.preventDefault();
					event.stopPropagation();
					setOpen(false);
				};
				document.addEventListener("pointerdown", onPointerDown, true);
				document.addEventListener("keydown", onKeyDown, true);
				return () => {
					document.removeEventListener("pointerdown", onPointerDown, true);
					document.removeEventListener("keydown", onKeyDown, true);
				};
			}, [open]);
			(0, react.useEffect)(() => {
				if (menu === null) return;
				const onPointerDown = (event) => {
					if (menuRef.current !== null && menuRef.current.contains(event.target)) return;
					setMenu(null);
				};
				const onKeyDown = (event) => {
					if (event.key !== "Escape") return;
					event.preventDefault();
					event.stopPropagation();
					setMenu(null);
				};
				const dismiss = () => {
					setMenu(null);
				};
				document.addEventListener("pointerdown", onPointerDown, true);
				document.addEventListener("keydown", onKeyDown, true);
				window.addEventListener("resize", dismiss);
				window.addEventListener("blur", dismiss);
				window.addEventListener("scroll", dismiss, true);
				return () => {
					document.removeEventListener("pointerdown", onPointerDown, true);
					document.removeEventListener("keydown", onKeyDown, true);
					window.removeEventListener("resize", dismiss);
					window.removeEventListener("blur", dismiss);
					window.removeEventListener("scroll", dismiss, true);
				};
			}, [menu]);
			const now = new Date();
			const change = nextWindowChange(now);
			const remainingMs = change === void 0 ? 0 : change.at.getTime() - now.getTime();
			const countdown = change === void 0 ? "" : formatRemainingShort(remainingMs);
			const windowNote = change === void 0 ? "" : change.kind === "peak" ? `距高峰 ${formatRemaining(remainingMs)}` : `距空闲 ${formatRemaining(remainingMs)}`;
			// -- the right-click sheet: 样式 -> (逐日数值 | 高峰 / 空闲堆叠),
			//    消费显示 -> (显示本轮消耗 | 显示本次对话总消耗) -----------------
			const openMenu = (event) => {
				event.preventDefault();
				event.stopPropagation();
				setOpen(false);
				const width = 176;
				const height = showCost ? 78 : 100;
				const submenu = 208;
				const submenuHeight = 84;
				const x = Math.max(8, Math.min(event.clientX, window.innerWidth - width - 8));
				const y = Math.max(8, Math.min(event.clientY, window.innerHeight - height - 8));
				setMenu({
					x,
					y,
					pane: "root",
					side: x + width + submenu > window.innerWidth ? "left" : "right",
					valign: y + submenuHeight > window.innerHeight - 8 ? "up" : "down"
				});
			};
			const chooseStyle = (value) => {
				setChartStyle(value);
				saveChartStyle(value);
				setMenu(null);
			};
			const chooseSpend = (value) => {
				setSpendMode(value);
				saveSpendMode(value);
				setMenu(null);
			};
			if (state.kind === "loading") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "dshcost_anchor",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "dshcost_pill",
					"aria-busy": "true",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dshcost_label",
						children: "余额 …"
					})
				})
			});
			if (state.kind === "error") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "dshcost_anchor",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: "dshcost_pill",
					"aria-label": `余额不可用 — ${state.message}（点击重试）`,
					onClick: () => {
						refresh();
					},
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dshcost_label",
						children: "余额 —"
					})
				})
			});
			const turnCost = usage !== null && usage !== void 0 && typeof usage.estimatedCost === "number" ? usage.estimatedCost : void 0;
			const sessionCost = sessionUsage !== null && typeof sessionUsage.estimatedCost === "number" ? sessionUsage.estimatedCost : void 0;
			const shownCost = spendMode === SPEND_MODE_SESSION ? sessionCost : turnCost;
			const costText = !showCost || shownCost === void 0 ? "" : `${spendMode === SPEND_MODE_SESSION ? "本次" : "本轮"} ${formatCost(shownCost, state.symbol)}`;
			const detail = !showCost ? "" : spendMode === SPEND_MODE_SESSION ? sessionDetail(sessionUsage, state.symbol) : usageDetail(usage, state.symbol);
			const lines = [state.title, windowNote, detail].filter((line) => line !== "");
			const hasChart = history !== null && Array.isArray(history.days) && history.days.length > 0;
			const bubble = open ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				ref: popRef,
				id: POPOVER_ID,
				className: hasChart ? "dshcost_pop dshcost_popchart" : "dshcost_pop",
				role: "dialog",
				"aria-label": "近 7 天消费",
				"data-side": "top",
				style: { visibility: "hidden" },
				children: hasChart ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [chartStyle === CHART_STYLE_STACKED ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(StackedChart, { history }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DailyChart, { history }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SpendStats, {
					history,
					balance: cnyBalance(state)
				})] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "dshcost_poptext",
					children: lines.join("\n")
				})
			}) : null;
			const mounted = bubble === null || reactDom === void 0 || typeof reactDom.createPortal !== "function" || typeof document === "undefined" ? bubble : (0, reactDom.createPortal)(bubble, document.body);
			const styleOption = (value, label) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
				type: "button",
				role: "menuitemradio",
				"aria-checked": chartStyle === value,
				className: "dshcost_mitem",
				onClick: () => {
					chooseStyle(value);
				},
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "dshcost_mcheck",
					children: chartStyle === value ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CheckIcon, {}) : null
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: label })]
			}, value);
			const spendOption = (value, label) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
				type: "button",
				role: "menuitemradio",
				"aria-checked": spendMode === value,
				className: "dshcost_mitem",
				onClick: () => {
					chooseSpend(value);
				},
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "dshcost_mcheck",
					children: spendMode === value ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CheckIcon, {}) : null
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: label })]
			}, value);
			/** One root row: opens its own submenu and closes whichever was open. */
			const paneRow = (pane, label, Icon) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
				type: "button",
				role: "menuitem",
				className: "dshcost_mitem",
				"aria-haspopup": "menu",
				"aria-expanded": menu !== null && menu.pane === pane,
				"data-open": menu !== null && menu.pane === pane ? "true" : void 0,
				onClick: () => {
					setMenu((current) => current === null ? null : {
						...current,
						pane: current.pane === pane ? "root" : pane
					});
				},
				onMouseEnter: () => {
					setMenu((current) => current === null || current.pane === pane ? current : {
						...current,
						pane
					});
				},
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "dshcost_micon",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Icon, {})
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: label }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "dshcost_mchevron",
					"aria-hidden": "true",
					children: "›"
				})]
			}, pane);
			/** The open pane's options, anchored beside the root menu. */
			const submenuPanel = (pane, label, options) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "dshcost_msub",
				role: "menu",
				"aria-label": label,
				"data-pane": pane,
				"data-side": menu.side,
				"data-valign": menu.valign,
				children: options
			});
			const menuPanel = menu === null ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				ref: menuRef,
				className: "dshcost_menu",
				role: "menu",
				"aria-label": "dsh-cost",
				style: {
					left: `${menu.x}px`,
					top: `${menu.y}px`
				},
				children: [
					paneRow("style", "样式", ChartIcon),
					paneRow("spend", "消费显示", SpendIcon),
					menu.pane === "style" ? submenuPanel("style", "样式", [styleOption(CHART_STYLE_BARS, "逐日数值"), styleOption(CHART_STYLE_STACKED, "高峰 / 空闲堆叠")]) : menu.pane === "spend" ? submenuPanel("spend", "消费显示", [spendOption(SPEND_MODE_TURN, "显示本轮消耗"), spendOption(SPEND_MODE_SESSION, "显示本次对话总消耗")]) : null,
					showCost ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dshcost_mnote",
						children: "花费显示将在对话开始后生效"
					})
				]
			});
			const menuMounted = menuPanel === null || reactDom === void 0 || typeof reactDom.createPortal !== "function" || typeof document === "undefined" ? menuPanel : (0, reactDom.createPortal)(menuPanel, document.body);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				className: "dshcost_anchor",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
					ref: pillRef,
					type: "button",
					className: "dshcost_pill",
					"data-composer-stat": showCost ? "balance" : void 0,
					"aria-haspopup": "dialog",
					"aria-expanded": open,
					"aria-controls": open ? POPOVER_ID : void 0,
					onClick: () => {
						if (open) {
							setOpen(false);
							return;
						}
						setOpen(true);
						refresh();
						loadHistory(false);
					},
					onContextMenu: openMenu,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ProviderLogo, {
						provider: state.provider,
						size: 14
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: "dshcost_label",
						children: [`${state.symbol}${state.total}`, costText === "" ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dshcost_sep",
							"aria-hidden": true,
							children: "·"
						}), costText] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dshcost_dot",
							"aria-hidden": true,
							style: { background: state.dotColor }
						}), countdown === "" ? null : countdown]
					})]
				}), mounted, menuMounted]
			});
		}
		/** The empty-conversation chat region, or null when it is not on screen. */
		function heroChatRegion() {
			if (typeof document === "undefined") return null;
			return document.querySelector('[data-conversation-region="chat"][data-content-phase="hero"]');
		}
		/**
		* The statistics row of an empty conversation (the hero screen), or null.
		*
		* A settled conversation renders its own statistics through the
		* `conversation.composer.dock` slot; while the conversation is still empty the
		* host renders that same row but leaves it unoccupied (and its `:empty` CSS
		* hides it). This returns that row only in that state, so the hero chip can
		* occupy exactly the place the settled chip will later take.
		* @returns the dock element to portal into, or null when it is not on screen.
		*/
		function heroComposerDock() {
			const region = heroChatRegion();
			if (region === null) return null;
			const dock = region.querySelector("[data-composer-dock]");
			if (dock === null) return null;
			// A settled conversation fills the row with its own stat chips.
			if (dock.querySelector("[data-composer-stat]") !== null) return null;
			return dock;
		}
		/**
		* The full composer chip on an empty conversation, minus its money segment.
		*
		* A new conversation has no turn to price, so `本轮`/`本次` are meaningless
		* there and the chip suppresses them (`showCost: false`). Everything else is
		* the settled chip: the same balance, the same peak/off-peak countdown, the
		* seven-day chart on a left click, and the same right-click menu.
		*
		* It is registered on the always-mounted `shell.overlay` slot and portals the
		* component into the composer's own statistics row, because the host only
		* renders the `conversation.composer.dock` slot itself once the conversation
		* has started. The row is re-checked on a short timer so switching between
		* the empty chat and a running conversation never leaves the hero chip behind.
		* @param props - composed slot props plus the injected model-directory accessor.
		* @returns the portalled chip, or null when there is no empty-composer row.
		*/
		function HeroCostChip({ getModelDirectories, useSessions }) {
			const [dock, setDock] = (0, react.useState)(heroComposerDock);
			const missesRef = (0, react.useRef)(0);
			const warnedRef = (0, react.useRef)(false);
			(0, react.useEffect)(() => {
				const place = () => {
					const next = heroComposerDock();
					// The empty chat is on screen but its statistics row is not: the host
					// DOM changed (usually a DSH upgrade). Say so once instead of silently
					// rendering nothing; __dshCostProbe() in the console tells the rest.
					if (next === null && heroChatRegion() !== null && !warnedRef.current) {
						missesRef.current += 1;
						if (missesRef.current >= 25) {
							warnedRef.current = true;
							console.warn("[dsh-cost] 找不到空对话的统计行：宿主 DOM 可能变了（DSH 升级？）。在控制台运行 __dshCostProbe() 查看，并对照 plugin-cost.md 的「DSH 升级自检」。");
						}
					}
					setDock((current) => current === next ? current : next);
				};
				place();
				const timer = window.setInterval(place, 400);
				return () => {
					window.clearInterval(timer);
				};
			}, []);
			if (dock === null || reactDom === void 0 || typeof reactDom.createPortal !== "function") return null;
			return (0, reactDom.createPortal)(/* @__PURE__ */ (0, react_jsx_runtime.jsx)(BalanceDock, {
				getModelDirectories,
				useSessions,
				showCost: false
			}), dock);
		}
		/**
		* Register the chip into the composer's statistic row on the
		* `conversation.composer.dock` slot (declared by the ui-conversation
		* package), so it sits beside the turn/step and token pills at the bottom of
		* the composer instead of competing with the account name in the sidebar
		* foot. The wrapper closes over the plugin scope so the chip can read the
		* active model's provider from the model-directory service — resolved
		* lazily, because that service is optional and may activate after this one.
		* @param ctx - client plugin context carrying `slots`.
		*/
		function apply(ctx) {
			ensureDockStyle();
			// Support handle: run __dshCostProbe() in the DevTools console after a DSH
			// upgrade to see which host selectors this build can still find.
			try {
				window.__dshCostProbe = () => ({
					version: CLIENT_VERSION,
					contentPhase: document.querySelector('[data-conversation-region="chat"]')?.getAttribute("data-content-phase") ?? null,
					heroRegion: heroChatRegion() !== null,
					heroDock: heroComposerDock() !== null,
					stats: [...document.querySelectorAll("[data-composer-stat]")].map((node) => node.getAttribute("data-composer-stat"))
				});
			} catch {}
			ctx.inject(["slots"], (scope) => {
				const getModelDirectories = () => scope.get("modelDirectories");
				scope.slots.inject("conversation.composer.dock", () => scope.slots.register({
					name: "conversation.composer.dock",
					id: "balance",
					order: 9
				}, (props) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(BalanceDock, {
					...props,
					getModelDirectories
				})));
				// The empty-conversation chip rides the always-mounted shell overlay: the
				// host mounts no composer dock entries until a conversation has started, so
				// there is nothing to register into on the new-chat screen. Wrapped because
				// a composition without the layout package has no such slot.
				try {
					scope.slots.inject("shell.overlay", () => scope.slots.register({
						name: "shell.overlay",
						id: "hero-cost",
						order: 9
					}, (props) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(HeroCostChip, {
						...props,
						getModelDirectories
					})));
				} catch {}
			});
		}
		//#endregion
		exports.BalanceDock = BalanceDock;
		exports.HeroCostChip = HeroCostChip;
		exports.apply = apply;
		exports.inject = inject;
		exports.isPeakHour = isPeakHour;
		exports.name = name;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map