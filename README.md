# dsh-cost

DeepSeek Harness 的**余额与花费芯片**：在输入框下方的统计行显示账户余额、本轮（或本次对话）的估算花费、以及距高峰/空闲切换的倒计时。左键看近 7 天消费柱状图，右键切换图形样式与花费口径。

| | |
|---|---|
| 适用 | DeepSeek Harness **0.2.x 桌面版**（已在 `0.2.1-rc.2` 上实测） |
| 运行环境 | Node ≥ 22.18（用 DSH 自带的运行时即可，插件不需要额外安装依赖） |
| 许可证 | [MIT](./LICENSE) |
| 派生自 | [`@andrecgoncalves/dsh-balance`](https://github.com/andregoncalves/dsh-balance) v0.4.3（MIT） |

> 本包在原 `dsh-balance` 的基础上增加了「本轮花费」「本次对话总花费」「空对话芯片」与「高峰倒计时」，
> 并把挂载位置从侧边栏底部移到了输入框统计行。

## 目录

- [效果](#效果)
- [功能](#功能)
- [安装](#安装)
- [使用](#使用)
  - [芯片](#芯片)
  - [空对话](#空对话)
  - [左键浮层：近七天消费](#左键浮层近七天消费)
  - [右键菜单](#右键菜单)
- [配置单价](#配置单价)
- [数据来源与计价口径](#数据来源与计价口径)
- [排错](#排错)
- [开发](#开发)
- [已知限制](#已知限制)
- [许可与致谢](#许可与致谢)

## 效果

芯片与 DSH 自带的两枚统计控件同排（右键「轮次/步数」「token/缓存命中」那一行）：

```
◷ 4 轮 115 步 · 263 tok/s   ▤ 14.3M tok · 缓存命中 99%   [鲸鱼] ¥8.80 · 本轮 ¥0.0042 ● 13h3m   ◔ 21%
```

- `¥8.80` — 账户余额，跟随**当前模型的服务商**（DeepSeek / OpenRouter / Moonshot / Zhipu / MiniMax）
- `本轮 ¥0.0042` — 最后一个已完成轮次的估算花费，可切换成 `本次 ¥0.5231`（整条对话累计）
- `● 13h3m` — 距下次高峰/空闲切换的时间；红点 = 当前高峰，绿点 = 当前空闲

还没发出第一条消息的新对话里，同一枚芯片照常显示，只是不带金额：

```
[鲸鱼] ¥8.80 ● 13h3m
```

## 功能

| 功能 | 说明 |
|---|---|
| 余额 | 按当前模型的服务商选 key 与上游接口；拿不到 key 时显示 `—`，不影响其它功能 |
| 花费 | 本轮（默认）或本次对话累计，两种口径同一套计价规则 |
| 峰谷状态 | 红/绿点 + 紧凑倒计时，悬停显示中文全称（如「距空闲 45分钟」） |
| 近 7 天 | 左键弹出柱状图 + 三格摘要（今日 / 日均 / 余额可用） |
| 图形样式 | 逐日数值 或 高峰·空闲堆叠（右键切换，记忆到本地） |
| 空对话 | 同一枚芯片（`showCost: false`），左键右键照常可用 |

## 安装

> 这是一个**通过链接装入 DSH profile** 的本地插件，不走 npm 安装。

前置：已安装 DSH 桌面版（0.2.x）。

```powershell
git clone https://github.com/hui32510/dsh-cost.git
cd dsh-cost
.\install.ps1        # 写 profile 的 link 依赖 + 建 node_modules junction

# 执行策略受限时改用：
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

装完**重启 DSH**（托盘图标右键 →「重启 DeepSeek Harness」）。宿主路由与客户端 bundle 都是启动时加载的，
不重启看不到效果。

`install.ps1` 等价于手动维护 profile 的 `package.json`：

```json
"dependencies": { "dsh-cost": "link:<仓库绝对路径>" },
"dsh": { "profile": { "bundles": ["…", "dsh-cost"] } }
```

**更新到新版本**：`git pull` 后重启 DSH 即可（链接安装，不需要重装）。

**如果 `node_modules/dsh-cost` 是普通副本**（不是指向仓库的链接），改完 `lib/` 后需要同步：

```powershell
pwsh -File .\apply.ps1
```

> ⚠️ 手动编辑 `package.json` 时**不要写成带 BOM 的 UTF-8**。Windows PowerShell 的
> `Set-Content -Encoding utf8` 默认会加 BOM，DSH 解析不了这个 JSON，整个插件会**静默**加载失败
> ——界面上什么都不显示、也不报错。用编辑器的「UTF-8 无 BOM」，或：
>
> ```powershell
> [System.IO.File]::WriteAllText($path, $text, (New-Object System.Text.UTF8Encoding($false)))
> ```

## 使用

### 芯片

- 位置：输入框下方那条统计行，与宿主的「轮次/步数」「token」同一排。
- 芯片**没有 `title`**，鼠标扫过不弹提示；左键才打开浮层。
- 余额跟随模型：切到 OpenRouter 的模型就显示 OpenRouter 的余额，切回来跟着变。

### 空对话

点「新会话」、还没发第一条消息时，那条统计行由宿主渲染成空的（CSS `:empty` 会把它隐藏）。
插件把**同一枚芯片**挂进去——功能完整，只去掉金额：

- 位置、字号、间距与有对话时完全一致：它落在宿主自己的 `[data-composer-dock]` 行里，不是另画一条。
- 左键照常出七日图，右键照常出菜单。菜单里选的「消费显示」会记下来，等这条对话有了轮次就按所选口径显示
  （空对话时菜单底部有一行灰字说明这一点）。
- 发出第一条消息后，正式芯片出现，空对话那枚立刻让位，不会出现两枚。

### 左键浮层：近七天消费

浮层出现在芯片正上方（放不下时翻到下方），内容 = 柱状图 + 三格摘要：

- 图里一条虚线是**日均**，高于它的柱子一眼可见；柱顶标当天金额，今天整根点亮。
- **零消费日留空**，不画占位短条，避免在天平线上出现无意义的细线。
- 三格摘要：`今日` / `日均` / `余额可用`（余额 ÷ 日均，向下取整）。
- 非人民币账户（OpenRouter 的美元、MiniMax 的配额）没法用人民币日均去除，第三格换成 `本周轮次`。
- 七日数据拿不到时，浮层回落到纯文字明细，不会空着。
- 关闭：再点芯片、点别处、或按 `Esc`。

### 右键菜单

在芯片上按**鼠标右键**（不弹浏览器菜单），两组各带子菜单：

- **样式** —— 七日图里画哪种：
  - **逐日数值**（默认）：每天一根柱，柱顶标金额。
  - **高峰 / 空闲堆叠**：每根柱拆成高峰价（浅色）与空闲价（绿色），顶部有图例。
- **消费显示** —— 芯片里那截钱数怎么算：
  - **显示本轮消耗**（默认）：`本轮 ¥0.0042`，最后一个已完成轮次。
  - **显示本次对话总消耗**：`本次 ¥0.5231`，这条对话从第一轮累计到现在（正在跑的那一轮也算）。

选中立即生效，分别写入 `localStorage` 的 `dsh-cost/chart-style` 与 `dsh-cost/spend-mode`，刷新和重启后保持。

## 配置单价

默认单价是 **人民币 / 百万 token 的高峰价**：`input 2`、`cacheRead 0.2`、`cacheWrite 2`、`output 3`；
空闲时段自动 × 0.5。仅作估算，可按下面三种方式覆盖（优先级从低到高）：

**1. 插件 config**（profile 的 `cordis.patch.yml`）：

```yaml
- id: dsh-cost
  name: "dsh-cost"
  config:
    prices:
      deepseek-flash: { input: 2, cacheRead: 0.2, cacheWrite: 2, output: 3 }
      default: { input: 2, cacheRead: 0.2, cacheWrite: 2, output: 3 }
```

**2. 价格文件**（改完即生效，不用重启）：`~/.dsh/dsh-cost-prices.json`（旧名 `dsh-balance-prices.json` 仍兼容）

```json
{
  "deepseek-flash": { "input": 2, "cacheRead": 0.2, "cacheWrite": 2, "output": 3 },
  "default": { "input": 2, "cacheRead": 0.2, "cacheWrite": 2, "output": 3 }
}
```

**3. 内置默认**（`lib/index.js` 的 `DEFAULT_PRICES`）。

> 单位是「元 / 100 万 token」，按**高峰价**填写。若你的套餐是按订阅计费、不按 token 扣费，
> 这个数字可以理解为「等价 token 成本」，用来横向比较每轮开销。

## 数据来源与计价口径

三条数据链共用同一套规则（这是「本次」和七日图能对上的前提）：

| 路由 | 作用 | 数据来源 |
|---|---|---|
| `GET /plugins/balance?kind=<kind>` | 账户余额 | 上游余额接口（`kind` 决定用哪家的 key） |
| `GET /plugins/balance-usage?session=<id>` | 本轮 + 本次对话累计 | `ctx.sessions.get(id)` 的实时事件流 |
| `GET /plugins/balance-history?days=7` | 近 N 天逐日花费（≤31 天） | 本地会话日志 `~/.dsh/sessions/**/session.v*.jsonl[.zstd]` |

三条都是只读路由，失败也返回 `200` + `{ ok: false }`，不会把 UI 搞崩。

**本轮**：取最后一个 `turn/end` 及其对应的 `turn/start`，累加该轮内所有 `assistant/message` 的
`data.usage`（`assistant/attempt` 的流式 usage 作兜底）。

**本次对话**：同一份事件流，从第一条**自有**事件折到最后一条，`turn/end` 计数成轮数；正在跑的那一轮也计入。

**近 7 天**：把会话日志里每条 usage 折成逐日，按文件 `mtime + size` 缓存在内存（26 个日志冷启动约 0.8s，之后每次约 4ms）。

几个关键细节：

- **按事件自己的时间戳判峰谷**，不是用「现在」——所以哪怕跨过峰谷边界的一轮、或昨天的调用，也按当时的价格计。
- 峰谷窗口：**周一至周五** `01:00–04:00Z` 与 `06:00–10:00Z`（北京时间 09–12、14–18）。
- **fork 不重复计费**：fork 出来的会话会抄一份父会话历史，这些事件早于本日志的 `createdAt`，直接跳过，账算在父会话上。
- **重启恢复不是 fork**：恢复只是把整份日志读回内存，所以切分点用 `inheritedEventCount` 而非日志长度，否则历史会被整段跳过。
- 日志是**多帧 zstd** 追加容器，Node 的 `zstdDecompressSync` 只解第一帧，所以按帧边界逐帧解压。

刷新节奏：

| 项目 | 频率 | 是否走上游 |
|---|---|---|
| 余额 | 60 秒 | 是 |
| 本轮 / 本次用量与花费 | 8 秒 | 否（只读本地会话） |
| 近 7 天序列 | 60 秒（打开浮层时再拉一次） | 否 |
| 倒计时文本 | 20 秒 | 否 |

## 排错

直接访问宿主路由（无需登录态，端口见 DSH 启动日志）：

```powershell
curl "http://127.0.0.1:<port>/plugins/balance"
curl "http://127.0.0.1:<port>/plugins/balance-usage?session=<session-id>"
curl "http://127.0.0.1:<port>/plugins/balance-history?days=7"
```

`balance-usage` 返回 `{"ok":true,"usage":{…},"session":{…}}`；还没有已完成轮次时 `usage: null`，
`session` 仍给出整条对话的累计值。

| 症状 | 先查什么 |
|---|---|
| 完全没有芯片 | 是否重启过 DSH；`package.json` 是否被存成了带 BOM 的 UTF-8 |
| 余额显示 `—` | 对应服务商的 API key 没配（`DEEPSEEK_API_KEY` / `OPENROUTER_API_KEY` / `MOONSHOT_API_KEY` / `ZAI_API_KEY` / `MINIMAX_API_KEY`） |
| 金额全是 0 | 价格文件是否被配成 0；会话日志是否在写 |
| 「本次」为 0 | 该对话是否刚被重启恢复过（见上面「重启恢复不是 fork」） |
| 空对话没有芯片 | DSH 大版本升级后内部 DOM 可能变了，见下节 |

## 开发

- 结构：`lib/index.js`（宿主端三条路由 + 计价）、`lib/client.js`（浏览器端芯片/浮层/菜单）。
- **没有构建步骤**：`lib/*.js` 就是最终产物，直接改；`client.js` 是预编译形态（无 JSX），文件用 CRLF + Tab。
- 改完**必须重启 DSH** 才生效。

自测（不需要 DSH 在跑）：

```powershell
node .\test-harness\test.mjs              # 宿主路由断言（伪造 sessions + 真 zstd 日志）
node .\test-harness\render-smoke.mjs      # 组件渲染（假 react / react-dom，无需 DOM）
node .\test-harness\client-smoke.cjs .\lib\client.js   # 能加载 + 注册了哪些插槽
node .\test-harness\probe-history.mjs     # 真实 ~/.dsh/sessions 跑七日
node .\test-harness\probe-session-total.mjs 0          # 真实日志对账（「本次」vs 七日应相等）
```

维护相关（改动记录、DSH 内部机制笔记、踩过的坑、发布流程）在
[`plugin-cost.md`](./plugin-cost.md) 与 [`PUBLISHING.md`](./PUBLISHING.md)。

## 已知限制

- 依赖 DSH 的若干**内部实现**（插槽名、DOM 属性、会话事件字段），它们不承诺跨版本稳定；DSH 升级后可能需要小改。
- 界面文案目前是**中文硬编码**，没有走 DSH 的本地化机制。
- 花费是**估算**：按 token 数与配置单价计算，不等于账单（尤其缓存命中、批量折扣、订阅套餐等情况）。
- 多服务商余额路径（OpenRouter / Moonshot / Zhipu / MiniMax）验证得比 DeepSeek 少，遇到问题欢迎提 issue。

## 许可与致谢

[MIT](./LICENSE)。原项目 [`dsh-balance`](https://github.com/andregoncalves/dsh-balance) 由
Andre Goncalves 编写，本仓库在其基础上修改。
