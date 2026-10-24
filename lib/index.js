import { credentialRef } from "@deepseek-ai/dsh-credentials";
import { launchEnvironmentOf } from "@deepseek-ai/dsh-launch-environment";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { zstdDecompressSync } from "node:zlib";
//#region src/index.ts
/** Cordis plugin name (matches the profile patch row id). */
const name = "dsh-cost";
/** Required services: the web route registry. Credentials are resolved lazily via ctx.get. */
const inject = ["webServer"];
/** The route the browser half polls (an exact route beside the /plugins/events dev channel). */
const BALANCE_ENDPOINT = "/plugins/balance";
/** The route serving the active session's last completed turn (usage + estimated cost). */
const USAGE_ENDPOINT = "/plugins/balance-usage";
/** The route serving the last N days' spend, folded out of the local session logs. */
const HISTORY_ENDPOINT = "/plugins/balance-history";
/**
* Unit prices used to turn a turn's token counts into an estimated cost.
* CNY per 1,000,000 tokens, quoted at the DEEPSEEK PEAK price; an off-peak turn
* is billed at DeepSeek's 50% discount. Override per model through the plugin
* config: `config.prices["<model>"]` or `config.prices.default`.
*/
const DEFAULT_PRICES = {
	input: 2,
	cacheRead: 0.2,
	cacheWrite: 2,
	output: 3
};
/** The supported provider set; a request naming an unknown kind serves DeepSeek. */
const PROVIDER_SPECS = {
	deepseek: {
		apiKeyEnvs: ["DEEPSEEK_API_KEY"],
		urls: ["https://api.deepseek.com/user/balance"],
		fallbackToEnv: false,
		authScheme: "bearer"
	},
	openrouter: {
		apiKeyEnvs: ["OPENROUTER_API_KEY"],
		urls: ["https://openrouter.ai/api/v1/credits"],
		fallbackToEnv: true,
		authScheme: "bearer"
	},
	moonshot: {
		apiKeyEnvs: ["MOONSHOT_API_KEY"],
		urls: ["https://api.moonshot.ai/v1/users/me/balance", "https://api.moonshot.cn/v1/users/me/balance"],
		fallbackToEnv: true,
		authScheme: "bearer"
	},
	zhipu: {
		apiKeyEnvs: [
			"ZAI_API_KEY",
			"GLM_API_KEY",
			"ZHIPU_API_KEY"
		],
		urls: ["https://open.bigmodel.cn/api/biz/account/query-customer-account-report", "https://api.z.ai/api/biz/account/query-customer-account-report"],
		fallbackToEnv: true,
		authScheme: "raw"
	},
	minimax: {
		apiKeyEnvs: [
			"MINIMAX_API_KEY",
			"MINIMAX_CN_API_KEY",
			"MINIMAX_API_TOKEN"
		],
		urls: ["https://www.minimax.io/v1/token_plan/remains", "https://api.minimaxi.com/v1/token_plan/remains"],
		fallbackToEnv: true,
		authScheme: "bearer"
	}
};
/** Upstream call timeout. */
const UPSTREAM_TIMEOUT_MS = 1e4;
/**
* Dev-only canned upstream bodies for each provider kind, used when mock mode is
* enabled (see {@link mockEnabled}). Handy for previewing the chip rendering a
* real balance without holding an account on every provider. Kept in the raw
* upstream shape so the same {@link unwrapBalance} normalization runs.
*/
const MOCK_BODY = {
	deepseek: {
		is_available: true,
		balance_infos: [{
			currency: "CNY",
			total_balance: "88.00",
			granted_balance: "0.00",
			topped_up_balance: "88.00"
		}]
	},
	openrouter: { data: {
		total_credits: 12.5,
		total_usage: 2.5
	} },
	moonshot: { data: {
		available_balance: 49.59,
		voucher_balance: 46.59,
		cash_balance: 3
	} },
	zhipu: { data: {
		balance: 142.5,
		availableBalance: 132.5,
		currency: "CNY"
	} },
	minimax: {
		base_resp: { status_code: 0 },
		model_remains: [{
			current_interval_remaining_count: 88,
			current_interval_total_count: 100,
			current_subscribe_title: "Pro"
		}]
	}
};
/**
* Whether this request runs in dev mock mode. Off by default; enabled by the
* `DSH_BALANCE_MOCK=1` environment variable or a `?mock=1` query param. When on,
* {@link handleBalance} serves {@link MOCK_BODY} for any known kind without
* resolving a credential or calling the provider, so the chip can be previewed
* without an account on that platform.
*/
function mockEnabled(req) {
	if (process.env.DSH_BALANCE_MOCK === "1") return true;
	return new URL(req.url ?? "/", "http://internal").searchParams.get("mock") === "1";
}
function json(res, status, body) {
	res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
	res.end(JSON.stringify(body));
}
/** The known provider kinds, derived from the spec map so a new entry is picked up automatically. */
const KNOWN_KINDS = new Set(Object.keys(PROVIDER_SPECS));
/** Read `kind` from the request query; an absent or unknown value serves DeepSeek. */
function kindOf(req) {
	const kind = new URL(req.url ?? "/", "http://internal").searchParams.get("kind");
	return kind !== null && KNOWN_KINDS.has(kind) ? kind : "deepseek";
}
/**
* Resolve one provider's API key: the credentials seam first, then — for a
* provider configured to authenticate from the ambient environment — the
* launch environment (process, then the invoking project's .env, then the
* Harness home's .env). Each candidate credential reference is tried in order.
* Failures surface as an `undefined` return, which the caller reports as the
* `no-key` chip state.
* @param ctx - host plugin context carrying `credentials`/`launchEnvironment`.
* @param spec - the provider descriptor.
* @returns the key, or `undefined` when no layer supplies one.
*/
async function resolveApiKey(ctx, spec) {
	const credentials = ctx.get("credentials");
	if (credentials !== void 0) for (const env of spec.apiKeyEnvs) {
		const value = (await credentials.resolve(credentialRef(env)))?.value;
		if (value !== void 0 && value !== "") return value;
	}
	if (spec.fallbackToEnv) for (const env of spec.apiKeyEnvs) {
		const value = launchEnvironmentOf(ctx).get(env)?.value;
		if (value !== void 0 && value !== "") return value;
	}
}
/**
* Handle one balance request: resolve the key for the requested provider, call
* the provider, relay the normalized result. Failures are reported to the
* chip, never thrown into the server (the chip shows a retry affordance).
*/
async function handleBalance(ctx, req, res) {
	if (req.method !== "GET" && req.method !== "HEAD") {
		res.writeHead(405);
		res.end();
		return;
	}
	const kind = kindOf(req);
	const spec = PROVIDER_SPECS[kind];
	if (mockEnabled(req)) {
		json(res, 200, {
			ok: true,
			provider: kind,
			balance: unwrapBalance(kind, MOCK_BODY[kind])
		});
		return;
	}
	const apiKey = await resolveApiKey(ctx, spec);
	if (apiKey === void 0) {
		json(res, 200, {
			ok: false,
			provider: kind,
			error: "no-key",
			message: `Set ${spec.apiKeyEnvs.join(" or ")} in ~/.dsh/.credentials.yaml (or the environment)`
		});
		return;
	}
	const authorization = spec.authScheme === "raw" ? apiKey : `Bearer ${apiKey}`;
	let lastError;
	for (const url of spec.urls) try {
		const upstream = await fetch(url, {
			headers: { authorization },
			signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)
		});
		if (!upstream.ok) {
			if ((upstream.status === 401 || upstream.status === 403) && spec.urls.length > 1) {
				lastError = `${kind} answered ${upstream.status}`;
				continue;
			}
			json(res, 200, {
				ok: false,
				provider: kind,
				error: "upstream",
				message: `${kind} answered ${upstream.status}`
			});
			return;
		}
		const body = await upstream.json();
		if (spec.urls.length > 1 && isRecord(body) && body.success === false) {
			const code = typeof body.code === "number" ? body.code : void 0;
			if (code === 401 || code === 1001) {
				lastError = `${kind} rejected the key`;
				continue;
			}
		}
		json(res, 200, {
			ok: true,
			provider: kind,
			balance: unwrapBalance(kind, body)
		});
		return;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (spec.urls.length === 1) {
			json(res, 200, {
				ok: false,
				provider: kind,
				error: "upstream",
				message
			});
			return;
		}
		lastError = message;
	}
	json(res, 200, {
		ok: false,
		provider: kind,
		error: "upstream",
		message: lastError ?? "unreachable"
	});
}
/**
* Normalize one upstream body to the "balance facts" object the client
* renderers read. DeepSeek and MiniMax return their facts at the top level;
* OpenRouter, Moonshot, and Zhipu wrap them in a `data` key.
*/
function unwrapBalance(kind, body) {
	return (kind === "openrouter" || kind === "moonshot" || kind === "zhipu") && isRecord(body) && isRecord(body.data) ? body.data : body;
}
/** Narrow a runtime value to a non-null object record. */
function isRecord(value) {
	return typeof value === "object" && value !== null;
}
/** Whether an instant falls inside DeepSeek's peak billing window (Mon–Fri, 01–04 and 06–10 UTC). */
function isPeakInstant(now) {
	const day = now.getUTCDay();
	if (day === 0 || day === 6) return false;
	const hour = now.getUTCHours();
	return hour >= 1 && hour < 4 || hour >= 6 && hour < 10;
}
/** A non-negative finite count, or 0. */
function countOf(value) {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}
/** The last usage chunk carried by a recorded assistant stream, if any. */
function streamUsageOf(stream) {
	if (!Array.isArray(stream)) return void 0;
	for (let index = stream.length - 1; index >= 0; index -= 1) {
		const chunk = stream[index];
		if (chunk !== null && typeof chunk === "object" && chunk.usage !== null && typeof chunk.usage === "object") return chunk.usage;
	}
}
/** Locate the most recent completed turn (its `turn/start` and `turn/end` sequence numbers). */
function lastCompletedTurn(session) {
	const total = typeof session.seq === "number" ? session.seq : 0;
	let endSeq = -1;
	for (let seq = total - 1; seq >= 0; seq -= 1) {
		const event = session.eventAt(seq);
		if (event !== null && event !== void 0 && event.type === "turn/end") {
			endSeq = seq;
			break;
		}
	}
	if (endSeq < 0) return void 0;
	const turn = session.eventAt(endSeq)?.data?.turn;
	if (typeof turn !== "number") return void 0;
	for (let seq = endSeq - 1; seq >= 0; seq -= 1) {
		const event = session.eventAt(seq);
		if (event !== null && event !== void 0 && event.type === "turn/start" && event.data?.turn === turn) return {
			turn,
			startSeq: seq,
			endSeq
		};
	}
	return void 0;
}
/**
* Fold one turn's assistant usage into exact token buckets, the billed route,
* and the estimated cost.
*
* Each event is priced at its OWN timestamp, so a turn that straddles a billing
* window boundary is billed at both rates — the same rule the conversation total
* and the daily chart use.
* @param session - the live session handle.
* @param turn - `{ turn, startSeq, endSeq }`.
* @param config - plugin config carrying per-model prices.
* @returns token totals, the billed route, the cost, and whether the LAST billed
* event fell in the peak window (display hint only).
*/
function foldTurnUsage(session, turn, config) {
	const totals = {
		uncachedInput: 0,
		cacheRead: 0,
		cacheWrite: 0,
		output: 0,
		reasoning: 0
	};
	let route;
	let cost = 0;
	let peak = false;
	for (let seq = turn.startSeq; seq <= turn.endSeq; seq += 1) {
		const event = session.eventAt(seq);
		if (event === null || event === void 0) continue;
		if (event.type !== "assistant/message" && event.type !== "assistant/attempt") continue;
		const usage = event.data?.usage ?? streamUsageOf(event.data?.stream);
		if (usage === null || typeof usage !== "object") continue;
		const source = event.data?.message?.source;
		const prices = pricesFor(config, source?.model);
		const rawCost = (countOf(usage.inputTokens) * prices.input + countOf(usage.cacheReadTokens) * prices.cacheRead + countOf(usage.cacheWriteTokens) * prices.cacheWrite + countOf(usage.outputTokens) * prices.output) / 1e6;
		const at = typeof event.time === "number" ? new Date(event.time) : new Date();
		peak = isPeakInstant(at);
		cost += peak ? rawCost : rawCost * 0.5;
		totals.uncachedInput += countOf(usage.inputTokens);
		totals.cacheRead += countOf(usage.cacheReadTokens);
		totals.cacheWrite += countOf(usage.cacheWriteTokens);
		totals.output += countOf(usage.outputTokens);
		totals.reasoning += countOf(usage.reasoningTokens);
		if (source !== void 0 && source !== null && typeof source.provider === "string" && typeof source.model === "string") route = {
			provider: source.provider,
			model: source.model
		};
	}
	return {
		totals,
		route,
		cost,
		peak
	};
}
/** Accumulated whole-session spend, cached per live session handle. */
const SESSION_SPEND_CACHE = new WeakMap();
/** Fresh token buckets for one accumulator. */
function emptyTokenTotals() {
	return {
		uncachedInput: 0,
		cacheRead: 0,
		cacheWrite: 0,
		output: 0,
		reasoning: 0
	};
}
/**
* Fold a whole session's recorded model calls into one running total: token
* buckets, completed turns, and the estimated bill.
*
* Unlike {@link foldTurnUsage}, every event is priced at its OWN timestamp, so
* a call made in the off-peak window stays discounted even after the peak
* window opens — the same rule the daily chart applies, which keeps the
* conversation total and the seven-day series telling the same story.
*
* Events inherited from a parent (a fork copies the parent's history into the
* child log) are skipped: they are billed to the parent, exactly as the daily
* chart treats them. The cut is `inheritedEventCount` — NOT `firstLiveSeq`,
* which is merely the length of the log loaded into memory and therefore jumps
* to the whole history every time a session is resumed after a restart.
*
* The walk is incremental: a live session only appends events, so a cached
* accumulator is extended from the last folded sequence instead of rescanning
* the whole log on every poll. A rewound handle restarts from zero.
* @param session - the live session handle.
* @param config - plugin config carrying per-model prices.
* @returns the cached accumulators for that handle.
*/
function sessionSpend(session, config) {
	const total = typeof session.seq === "number" ? session.seq : 0;
	const inherited = typeof session.inheritedEventCount === "number" && session.inheritedEventCount > 0 ? session.inheritedEventCount : 0;
	const createdAt = typeof session.header?.createdAt === "number" ? session.header.createdAt : void 0;
	let cache = SESSION_SPEND_CACHE.get(session);
	if (cache === void 0 || cache.seq > total || cache.first !== inherited || cache.createdAt !== createdAt) cache = {
		first: inherited,
		createdAt,
		seq: inherited,
		totals: emptyTokenTotals(),
		cost: 0,
		turns: 0,
		route: void 0
	};
	for (let seq = Math.max(cache.seq, cache.first); seq < total; seq += 1) {
		const event = session.eventAt(seq);
		if (event === null || event === void 0) continue;
		if (createdAt !== void 0 && typeof event.time === "number" && event.time < createdAt - 6e4) continue;
		if (event.type === "turn/end") {
			cache.turns += 1;
			continue;
		}
		if (event.type !== "assistant/message" && event.type !== "assistant/attempt") continue;
		const usage = event.data?.usage ?? streamUsageOf(event.data?.stream);
		if (usage === null || typeof usage !== "object") continue;
		const source = event.data?.message?.source;
		const prices = pricesFor(config, source?.model);
		const rawCost = (countOf(usage.inputTokens) * prices.input + countOf(usage.cacheReadTokens) * prices.cacheRead + countOf(usage.cacheWriteTokens) * prices.cacheWrite + countOf(usage.outputTokens) * prices.output) / 1e6;
		const at = typeof event.time === "number" ? new Date(event.time) : new Date();
		cache.cost += isPeakInstant(at) ? rawCost : rawCost * 0.5;
		cache.totals.uncachedInput += countOf(usage.inputTokens);
		cache.totals.cacheRead += countOf(usage.cacheReadTokens);
		cache.totals.cacheWrite += countOf(usage.cacheWriteTokens);
		cache.totals.output += countOf(usage.outputTokens);
		cache.totals.reasoning += countOf(usage.reasoningTokens);
		if (source !== void 0 && source !== null && typeof source.provider === "string" && typeof source.model === "string") cache.route = {
			provider: source.provider,
			model: source.model
		};
	}
	cache.seq = total;
	SESSION_SPEND_CACHE.set(session, cache);
	return cache;
}
/** Shape one session accumulator into the `session` block the chip reads. */
function sessionPayload(spend) {
	return {
		turns: spend.turns,
		tokens: {
			...spend.totals,
			total: spend.totals.uncachedInput + spend.totals.cacheRead + spend.totals.cacheWrite + spend.totals.output
		},
		route: spend.route ?? null,
		currency: "CNY",
		estimatedCost: round6(spend.cost)
	};
}
/** Peak unit prices for a model, mixing defaults with the plugin config and a user-editable file. */
function pricesFor(config, model) {
	const table = config !== null && config !== void 0 && typeof config === "object" && config.prices !== null && typeof config.prices === "object" ? config.prices : {};
	const override = pickPrices(table, model) ?? pickPrices(readPriceFile(), model) ?? {};
	const merged = { ...DEFAULT_PRICES };
	for (const key of Object.keys(DEFAULT_PRICES)) if (typeof override[key] === "number" && Number.isFinite(override[key]) && override[key] >= 0) merged[key] = override[key];
	return merged;
}
/** One model's entry (or `default`) out of a `{ model: {input,cacheRead,cacheWrite,output} }` table. */
function pickPrices(table, model) {
	if (table === null || table === void 0 || typeof table !== "object") return void 0;
	if (typeof model === "string" && table[model] !== null && typeof table[model] === "object") return table[model];
	return table.default !== null && typeof table.default === "object" ? table.default : void 0;
}
/**
* Read `<harness home>/dsh-cost-prices.json` — a hand-editable price table so
* the estimate can be tuned without touching this file or restarting. The old
* `dsh-balance-prices.json` name is still honoured for a fork that predates the
* rename. Absent or malformed input simply keeps the built-in defaults.
*/
function readPriceFile() {
	const home = harnessHome();
	for (const file of ["dsh-cost-prices.json", "dsh-balance-prices.json"]) try {
		return JSON.parse(readFileSync(join(home, file), "utf8"));
	} catch {}
	return void 0;
}
/**
* The Harness home directory: `DSH_HOME` when the launcher sets it, otherwise
* `~/.dsh`. Both the price file and the session logs live under it.
* @returns the absolute Harness home path.
*/
function harnessHome() {
	return process.env.DSH_HOME !== void 0 && process.env.DSH_HOME !== "" ? process.env.DSH_HOME : join(homedir(), ".dsh");
}
/**
* Handle one turn-usage request: read the active session's last completed turn
* from the live session log and price its token buckets. Every failure is
* reported in the body, never thrown into the server.
*/
function handleUsage(ctx, config, req, res) {
	if (req.method !== "GET" && req.method !== "HEAD") {
		res.writeHead(405);
		res.end();
		return;
	}
	const sessionId = new URL(req.url ?? "/", "http://internal").searchParams.get("session");
	if (sessionId === null || sessionId === "") {
		json(res, 200, {
			ok: false,
			error: "no-session"
		});
		return;
	}
	const sessions = ctx.get("sessions");
	if (sessions === void 0) {
		json(res, 200, {
			ok: false,
			error: "no-session-service"
		});
		return;
	}
	let session;
	try {
		session = sessions.get(sessionId);
	} catch {
		session = void 0;
	}
	if (session === null || session === void 0) {
		json(res, 200, {
			ok: false,
			error: "session-not-found"
		});
		return;
	}
	const spend = sessionPayload(sessionSpend(session, config));
	const turn = lastCompletedTurn(session);
	if (turn === void 0) {
		json(res, 200, {
			ok: true,
			usage: null,
			session: spend
		});
		return;
	}
	const { totals, route, cost, peak } = foldTurnUsage(session, turn, config);
	const prices = pricesFor(config, route?.model);
	json(res, 200, {
		ok: true,
		usage: {
			turn: turn.turn,
			tokens: {
				...totals,
				total: totals.uncachedInput + totals.cacheRead + totals.cacheWrite + totals.output
			},
			route: route ?? null,
			peak,
			prices,
			currency: "CNY",
			estimatedCost: cost
		},
		session: spend
	});
}
/** Zstandard frame magic, little endian. */
const ZSTD_MAGIC = 4247762216;
/** Default and maximum window of the daily-spend route. */
const HISTORY_DEFAULT_DAYS = 7;
const HISTORY_MAX_DAYS = 31;
/** Parsed-per-file day buckets, reused while the file's mtime and size are unchanged. */
const HISTORY_FILE_CACHE = new Map();
/** Upper bound on cached session files, so a huge history cannot pin memory. */
const HISTORY_CACHE_LIMIT = 512;
/** A session log artifact: `session.<format>.jsonl` or its `.zstd` container. */
const SESSION_FILE = /^session\..+\.jsonl(?:\.zstd|\.zst)?$/;
/**
* Locate the complete Zstandard frames of a concatenated container.
*
* The persistence backend appends one frame per durable batch, so a session log
* is a sequence of independent frames — Node's one-shot decompressor only reads
* the first one. This walks the frame headers and block headers instead of
* trusting frame-magic bytes (which can occur inside compressed data), and
* stops cleanly at a torn trailing frame.
* @param buffer - the complete bytes currently on disk.
* @returns the {@link start,end} byte range of every complete frame.
*/
function scanZstdFrames(buffer) {
	const frames = [];
	let offset = 0;
	while (offset < buffer.length) {
		const start = offset;
		if (buffer.length - offset < 4) break;
		if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) break;
		offset += 4;
		if (offset === buffer.length) break;
		const descriptor = buffer.readUInt8(offset);
		offset += 1;
		if ((descriptor & 24) !== 0) break;
		const contentSizeFlag = descriptor >>> 6;
		const singleSegment = (descriptor & 32) !== 0;
		const checksum = (descriptor & 4) !== 0;
		const dictionaryFlag = descriptor & 3;
		const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag;
		const contentSizeBytes = contentSizeFlag === 0 ? singleSegment ? 1 : 0 : 1 << contentSizeFlag;
		offset += (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes;
		if (offset > buffer.length) break;
		let complete = true;
		for (;;) {
			if (buffer.length - offset < 3) {
				complete = false;
				break;
			}
			const blockHeader = buffer.readUIntLE(offset, 3);
			offset += 3;
			const lastBlock = (blockHeader & 1) !== 0;
			const blockType = blockHeader >>> 1 & 3;
			const blockSize = blockHeader >>> 3;
			if (blockType === 3) {
				complete = false;
				break;
			}
			offset += blockType === 1 ? 1 : blockSize;
			if (offset > buffer.length) {
				complete = false;
				break;
			}
			if (lastBlock) break;
		}
		if (!complete) break;
		if (checksum) {
			if (buffer.length - offset < 4) break;
			offset += 4;
		}
		frames.push({
			start,
			end: offset
		});
	}
	return frames;
}
/**
* Decode one session-log artifact to its JSONL text, transparently handling the
* multi-frame Zstandard container and the plaintext form.
* @param buffer - the artifact bytes.
* @param compressed - whether the artifact is Zstandard-compressed.
* @returns the decoded text, or an empty string when nothing could be decoded.
*/
function decodeSessionLog(buffer, compressed) {
	if (!compressed) return buffer.toString("utf8");
	const frames = scanZstdFrames(buffer);
	const parts = [];
	for (const frame of frames) try {
		parts.push(zstdDecompressSync(buffer.subarray(frame.start, frame.end)));
	} catch {
		return parts.length === 0 ? "" : Buffer.concat(parts).toString("utf8");
	}
	return Buffer.concat(parts).toString("utf8");
}
/** `YYYY-MM-DD` in the machine's local timezone. */
function localDayKey(time) {
	const date = new Date(time);
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
/** A day bucket: what one calendar day cost, split by the billing window. */
function emptyBucket() {
	return {
		cost: 0,
		peak: 0,
		offpeak: 0,
		turns: 0
	};
}
/**
* Fold one session log's text into per-day buckets.
*
* Every settled or failed model attempt carries the provider's usage, and the
* attempt's own timestamp decides whether it billed at the peak or the off-peak
* (50%) price. Events older than the log's own `createdAt` are inherited history
* copied in by a fork — they are already counted in the parent log, so counting
* them again would double the child's bill.
* @param text - the decoded JSONL session log.
* @param config - plugin config carrying per-model prices.
* @param byDay - the bucket map to accumulate into.
*/
function foldSessionText(text, config, byDay) {
	let created;
	for (const line of text.split("\n")) {
		if (line === "") continue;
		let event;
		try {
			event = JSON.parse(line);
		} catch {
			continue;
		}
		if (event === null || typeof event !== "object") continue;
		if (created === void 0) {
			if (event.type === "session") created = typeof event.createdAt === "number" ? event.createdAt : 0;
			else created = 0;
		}
		const time = typeof event.time === "number" ? event.time : void 0;
		if (time === void 0 || time < created - 6e4) continue;
		const key = localDayKey(time);
		if (event.type === "turn/end") {
			let turnBucket = byDay.get(key);
			if (turnBucket === void 0) {
				turnBucket = emptyBucket();
				byDay.set(key, turnBucket);
			}
			turnBucket.turns += 1;
			continue;
		}
		if (event.type !== "assistant/message" && event.type !== "assistant/attempt") continue;
		const usage = event.data?.usage ?? streamUsageOf(event.data?.stream);
		if (usage === null || typeof usage !== "object") continue;
		let bucket = byDay.get(key);
		if (bucket === void 0) {
			bucket = emptyBucket();
			byDay.set(key, bucket);
		}
		const prices = pricesFor(config, event.data?.message?.source?.model);
		const cost = (countOf(usage.inputTokens) * prices.input + countOf(usage.cacheReadTokens) * prices.cacheRead + countOf(usage.cacheWriteTokens) * prices.cacheWrite + countOf(usage.outputTokens) * prices.output) / 1e6;
		if (isPeakInstant(new Date(time))) {
			bucket.cost += cost;
			bucket.peak += cost;
		} else {
			const discounted = cost * 0.5;
			bucket.cost += discounted;
			bucket.offpeak += discounted;
		}
	}
}
/**
* List every session-log artifact under `<harness home>/sessions`: one
* directory per workspace, one per session, the log inside it.
* @param root - the sessions directory.
* @returns absolute paths of the candidate logs.
*/
function listSessionFiles(root) {
	const files = [];
	const walk = (directory, depth) => {
		let entries;
		try {
			entries = readdirSync(directory, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			const path = join(directory, entry.name);
			if (entry.isDirectory()) {
				if (depth < 3) walk(path, depth + 1);
				continue;
			}
			if (!entry.isFile() || !SESSION_FILE.test(entry.name)) continue;
			files.push(path);
		}
	};
	walk(root, 0);
	return files;
}
/** Round a currency amount to six decimals so the wire stays readable. */
function round6(value) {
	return Math.round(value * 1e6) / 1e6;
}
/**
* Handle one daily-spend request: fold every session log touched inside the
* window into per-day cost, split by billing window, and serve the series the
* popover charts. Everything is local; nothing leaves the machine.
* @param config - plugin config carrying per-model prices.
* @param req - the HTTP request (`?days=` selects the window).
* @param res - the HTTP response.
*/
function handleHistory(config, req, res) {
	if (req.method !== "GET" && req.method !== "HEAD") {
		res.writeHead(405);
		res.end();
		return;
	}
	const requested = Number(new URL(req.url ?? "/", "http://internal").searchParams.get("days") ?? "");
	const days = Number.isSafeInteger(requested) && requested > 0 ? Math.min(requested, HISTORY_MAX_DAYS) : HISTORY_DEFAULT_DAYS;
	const today = new Date();
	const keys = [];
	for (let index = days - 1; index >= 0; index -= 1) {
		const at = new Date(today.getFullYear(), today.getMonth(), today.getDate() - index);
		keys.push({
			key: localDayKey(at.getTime()),
			weekday: at.getDay(),
			time: at.getTime()
		});
	}
	const byDay = new Map(keys.map((entry) => [entry.key, emptyBucket()]));
	let scanned = 0;
	const files = listSessionFiles(join(harnessHome(), "sessions"));
	for (const file of files) {
		let stat;
		try {
			stat = statSync(file);
		} catch {
			continue;
		}
		if (stat.mtimeMs < keys[0].time) continue;
		const cached = HISTORY_FILE_CACHE.get(file);
		let buckets;
		if (cached !== void 0 && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) buckets = cached.buckets;
		else try {
			const bucketsOfFile = new Map();
			foldSessionText(decodeSessionLog(readFileSync(file), /\.zst(?:d)?$/.test(file)), config, bucketsOfFile);
			buckets = bucketsOfFile;
			if (HISTORY_FILE_CACHE.size >= HISTORY_CACHE_LIMIT) HISTORY_FILE_CACHE.clear();
			HISTORY_FILE_CACHE.set(file, {
				mtimeMs: stat.mtimeMs,
				size: stat.size,
				buckets
			});
		} catch {
			continue;
		}
		scanned += 1;
		for (const [key, bucket] of buckets) {
			const total = byDay.get(key);
			if (total === void 0) continue;
			total.cost += bucket.cost;
			total.peak += bucket.peak;
			total.offpeak += bucket.offpeak;
			total.turns += bucket.turns;
		}
	}
	let total = 0;
	let peakTotal = 0;
	let offpeakTotal = 0;
	const series = keys.map((entry, index) => {
		const bucket = byDay.get(entry.key) ?? emptyBucket();
		total += bucket.cost;
		peakTotal += bucket.peak;
		offpeakTotal += bucket.offpeak;
		return {
			date: entry.key,
			weekday: entry.weekday,
			today: index === keys.length - 1,
			cost: round6(bucket.cost),
			peak: round6(bucket.peak),
			offpeak: round6(bucket.offpeak),
			turns: bucket.turns
		};
	});
	json(res, 200, {
		ok: true,
		currency: "CNY",
		days: series,
		total: round6(total),
		peakTotal: round6(peakTotal),
		offpeakTotal: round6(offpeakTotal),
		files: scanned,
		generatedAt: Date.now()
	});
}
/**
* Mount the routes: the balance the chip polls, the last turn's cost, and the
* last N days' spend folded out of the session logs.
* @param ctx - host plugin context carrying `webServer`.
* @param config - optional plugin config carrying per-model `prices`.
*/
function apply(ctx, config) {
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: BALANCE_ENDPOINT,
		handler: (req, res) => {
			handleBalance(ctx, req, res);
		}
	}), "dsh-cost: balance route");
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: USAGE_ENDPOINT,
		handler: (req, res) => {
			handleUsage(ctx, config, req, res);
		}
	}), "dsh-cost: turn usage route");
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: HISTORY_ENDPOINT,
		handler: (req, res) => {
			handleHistory(config, req, res);
		}
	}), "dsh-cost: daily history route");
}

//#endregion
export { BALANCE_ENDPOINT, HISTORY_ENDPOINT, USAGE_ENDPOINT, apply, inject, name };
