# dsh-cost

一个 DeepSeek Harness 客户端插件：在输入框下方的统计行显示**账户余额**、**上一轮对话的估算花费**和**距高峰/空闲切换的倒计时**。空对话时是同一枚芯片，只是不显示消费金额（还没对话，没有消费可显示）；右键可以在「本轮消耗」和「本次对话总消耗」之间切换。

本包派生自 [`@andrecgoncalves/dsh-balance`](https://github.com/andregoncalves/dsh-balance) v0.4.3（MIT），在其基础上增加了「每轮花费」「本次对话总花费」「空对话芯片」与「倒计时」，并把挂载位置从侧边栏底部移到了输入框统计行。

- `lib/index.js` —— 宿主端三条只读路由：`GET /plugins/balance`（余额）、`GET /plugins/balance-usage?session=<id>`（最后一个已完成轮次的花费 + 整条对话累计花费）、`GET /plugins/balance-history?days=7`（近 N 天逐日花费，从本地会话日志折出来）。
- `lib/client.js` —— 浏览器端：挂在 `conversation.composer.dock`，与「轮次/步数」「token/缓存命中」同排；空对话时挂在 `shell.overlay` 并 portal 进同一条统计行；左键点开七日柱状图，右键选「样式」或「消费显示」。

## 效果

```
◷ 4 轮 115 步 · 263 tok/s   ▤ 14.3M tok · 缓存命中 99%   [鲸鱼] ¥8.80 · 本轮 ¥0.0042 ● 13h3m   ◔ 21%
```

- `¥8.80` 账户余额（跟随当前模型的服务商：DeepSeek / OpenRouter / Moonshot / Zhipu / MiniMax）
- `本轮 ¥0.0042` 最后一个已完成轮次的估算花费（可切换成 `本次 ¥0.5231`，见「右键菜单」）
- `● 13h3m` 距下次高峰/空闲切换的时间（红点=高峰，绿点=空闲）

## 空对话也显示

点「新会话」、还没发出第一条消息时，输入框下方那条统计行由宿主渲染成空的（CSS 的 `:empty` 会把它隐藏）。
插件把**同一枚芯片**挂进去——完整功能，只去掉消费金额：

```
[鲸鱼] ¥8.80 ● 13h3m
```

- 位置、字号、间距与有对话时完全一致：它落在宿主自己的 `[data-composer-dock]` 行里，不是另画一条。
- **左键**照常弹出近 7 天柱状图，**右键**照常弹「样式 / 消费显示」菜单。新对话没有消费，所以不显示 `本轮`/`本次`；
  菜单里选中的「消费显示」会记下来，等这条对话有了轮次就按所选模式显示。
- 实现：`HeroCostChip` 只是把同一个 `BalanceDock`（`showCost: false`）portal 进空对话的统计行；
  发出第一条消息后，宿主开始往那一行渲染「轮次/步数」「token」和正式芯片，这枚芯片立刻让位，不会出现两枚。
- 挂载：注册在始终挂载的 `shell.overlay` 上，找到 `[data-conversation-region="chat"][data-content-phase="hero"]` 里的
  `[data-composer-dock]` 后 `createPortal` 进去；每 400ms 复核一次，切到有内容的对话就撤销 portal。

## 右键菜单：样式 / 消费显示

在芯片上按**鼠标右键**弹出菜单（不弹浏览器的右键菜单），菜单有两组，各有子菜单：

- **样式** —— 七日浮层里画哪种图：
  - **逐日数值**（默认）：每天一根柱，柱顶标出当天金额，今天整根点亮。
  - **高峰 / 空闲堆叠**：每根柱拆成高峰价（浅色）与空闲价（绿色），顶部有图例。
- **消费显示** —— 芯片里那截钱数怎么算：
  - **显示本轮消耗**（默认）：`本轮 ¥0.0042`，最后一个已完成轮次的花费。
  - **显示本次对话总消耗**：`本次 ¥0.5231`，这条对话从第一轮到现在累计的估算花费（正在跑的那一轮也算在内）。

选中立即生效，分别写入 `localStorage` 的 `dsh-cost/chart-style` 与 `dsh-cost/spend-mode`，刷新与重启后保持。
**空对话里**菜单底部会多一行灰字「花费显示将在对话开始后生效」——那枚芯片本来就不显示金额，选了也不会立刻有变化。
菜单是 DSH 菜单的材质（`--dsw-menu-surface-fill` + 40px 模糊、项高 34px、圆角 12px），子菜单在右侧放不下时向左、靠近窗口底部时向上展开。

## 详情浮层：左键点击才出现

芯片**不挂 `title`**，鼠标扫过时什么都不弹。左键点一下芯片才弹出浮层，再点一次、点别处、或按 `Esc` 关闭。
浮层刻意对齐 DSH 自带的 tooltip（对话区右下角「上下文已用 15%」那一枚）的观感：

| 项目 | 取值 | 来源 |
|---|---|---|
| 位置 | 芯片正上方、水平居中；上方放不下时翻到下方 | `position: fixed` + 每帧测量锚点 |
| 字号 / 行高 | 13px / 20px（不随主题字号缩放） | `._bubble_12mhf_1` |
| 底色 | `--dsw-alias-tooltip-bg` | 同上 |
| 文字色 | `--dsw-static-neutral-bluish-00` | 同上 |
| 内边距 / 圆角 | 8px 10px（有图时）/ `--dsw-radius-sm`（8px） | 同上，padding 为容纳图表略放宽 |

浮层内容 = **近 7 天柱状图** + **图下三格摘要**：

- 图里一条虚线是**日均**（图例在标题右侧），高于它的柱子一眼可见；柱顶仍标当天金额，今天整根点亮。
- **零消费日留空**：不画占位短条、也不标金额，避免在天平线上出现一条无意义的细线。
- 三格摘要：`今日` / `日均` / `余额可用`（余额 ÷ 日均，向下取整）。
- 非 CNY 账户（OpenRouter 美元、MiniMax 配额）没法拿人民币日均去除，第三格自动换成 `本周轮次`。
- 七日数据还没到手时（宿主路由不可用），浮层回落到原来的纯文字明细，不会空着。

实现要点：

- 浮层通过 `react-dom` 的 `createPortal` 挂到 `document.body`，composer 的 `overflow` 裁不到它；`react-dom` 拿不到时回落到原地渲染。
- 打开时重新拉一次用量与七日序列；打开期间窗口缩放、页面滚动、内容高度变化（`ResizeObserver`）都会重新定位。
- 无障碍：按钮带 `aria-haspopup="dialog"`、`aria-expanded`、`aria-controls`，浮层是 `role="dialog"`。

## 近 7 天消费

宿主新增 `GET /plugins/balance-history?days=7`（`days` 上限 31），从**本地会话日志**把花费折成逐日：

- 数据来源：`<harness home>/sessions/<工作区>/<会话>/session.v*.jsonl[.zstd]` 里每条 `assistant/message` / `assistant/attempt` 的 usage。
- 计价时间：用**该事件自己的时间戳**判断高峰/空闲（空闲 ×0.5），而不是用「现在」——所以昨天的高峰调用会如实按高峰价计。
- 多帧 zstd：日志是「一帧一批」的追加容器，Node 的 `zstdDecompressSync` 只解第一帧，所以路由自己按帧头/块头找边界，再逐帧解压。
- 不重复计费：fork 出的会话会把父会话的历史事件抄一份，这些事件的时间早于该日志的 `createdAt`，直接跳过。
- 性能：按文件 `mtime + size` 缓存在内存里；26 个日志冷启动约 0.8s，之后每次约 4ms。日志里没有的日期返回 0。

## 每轮花费怎么算

- 数据来源：`ctx.sessions.get(id)` 的实时事件流，取最后一个 `turn/end` 及其对应的 `turn/start`，累加该轮内所有 `assistant/message` 的 `data.usage`（`assistant/attempt` 的流式 usage 作为兜底）。
- 计价：`(未缓存输入 × input + 缓存读 × cacheRead + 缓存写 × cacheWrite + 输出 × output) / 1e6`，空闲时段再 × 0.5。
- 计价时间：**每个事件用自己的时间戳**判断峰谷（0.8.3 起），所以跨峰谷边界的一轮会分别按两种价格计，和「本次对话」「近 7 天」完全同一套规则。
- 默认单价（CNY / 百万 token，**高峰价**）：`input 2`、`cacheRead 0.2`、`cacheWrite 2`、`output 3`。仅作估算，可按下面的方式覆盖。

## 本次对话总花费怎么算

同一份事件流，从会话的第一条**自有**事件折到最后一条：

- 每个 `assistant/message` / `assistant/attempt` 的 usage 累加成整条对话的 token 总额，`turn/end` 计数成轮数。
- 计价时间用**该事件自己的时间戳**判断高峰/空闲——和七日图完全同一条规则，所以两处数字对得上。
- 正在跑的那一轮也已计入（钱已经花了），只是它还不算一个「已完成轮次」。
- fork 出来的会话会抄一份父会话历史——这些（`inheritedEventCount` 之前、或早于本日志 `createdAt` 的事件）跳过，账算在父会话上，与七日图一致。
- 会话被**重启后恢复**不算 fork：恢复只是把整份日志读回内存，`firstLiveSeq` 会等于日志长度——所以切分点必须用 `inheritedEventCount`，不能用 `firstLiveSeq`，否则整段历史会被跳过（0.8.1 修复）。
- 增量折算是按 `session.seq` 缓存的：只有新事件会再算一遍，长对话也不会每次轮询都全量扫描。
- 结果通过 `balance-usage` 的 `session` 字段一起下发：`{ turns, tokens, route, currency, estimatedCost }`。

## 高峰倒计时

- 高峰窗口：周一至周五 `01:00–04:00Z`、`06:00–10:00Z`（北京时间 09:00–12:00、14:00–18:00）。
- 胶囊尾部显示紧凑倒计时（`1h32m`），悬停显示中文全称（`距高峰 2小时13分` / `距空闲 45分钟`）。
- 算法：从「当前分钟」起逐分钟前推，直到 `isPeakHour` 翻转（最多 8 天，覆盖周末），与红/绿点判定永远一致。

## 刷新节奏

| 项目 | 频率 | 是否走上游 |
|---|---|---|
| 余额 | 60 秒 | 是（`api.deepseek.com`） |
| 本轮 / 本次用量与花费 | 8 秒 | 否（只读本地会话） |
| 近 7 天序列 | 60 秒（打开浮层时再拉一次） | 否（只读本地会话日志） |
| 倒计时文本 | 20 秒 | 否 |
| 空对话那枚芯片 | 与上面相同，另加 400ms 的行位置复核 | 同上 |

## 配置单价

三种方式，优先级从低到高：

1. **内置默认**（`lib/index.js` 里的 `DEFAULT_PRICES`）。
2. **插件 config**（profile 的 `cordis.patch.yml`）：

```yaml
- id: dsh-cost
  name: "dsh-cost"
  config:
    prices:
      deepseek-flash: { input: 2, cacheRead: 0.2, cacheWrite: 2, output: 3 }
      default: { input: 2, cacheRead: 0.2, cacheWrite: 2, output: 3 }
```

3. **价格文件**（改完即生效，无需重启）：`~/.dsh/dsh-cost-prices.json`（旧名 `dsh-balance-prices.json` 仍兼容）

```json
{
  "deepseek-flash": { "input": 2, "cacheRead": 0.2, "cacheWrite": 2, "output": 3 },
  "default": { "input": 2, "cacheRead": 0.2, "cacheWrite": 2, "output": 3 }
}
```

> 单位是「元 / 100 万 token」，按**高峰价**填写；空闲时段自动 ×0.5。若你的套餐按订阅计价、不按 token 扣费，这个数字是「等价 token 成本」，可用来横向比较每轮开销。

## 安装 / 重新应用

profile 的 `package.json` 里已经把它声明为本地 `link:` 依赖：

```json
"dependencies": { "dsh-cost": "link:C:/Users/hui/Documents/deepseek-harness/default-workspace/plugins/dsh-cost" },
"dsh": { "profile": { "bundles": ["…", "dsh-cost"] } }
```

如果 `node_modules/dsh-cost` 还是普通副本（不是指向本目录的链接），改完 `lib/` 后执行：

```powershell
pwsh -File .\apply.ps1
```

然后重启 DSH。若某次 `pnpm install` 把它变成了链接，`apply.ps1` 会自动跳过。

> ⚠️ 改 `package.json` 千万别写成**带 BOM 的 UTF-8**：Windows PowerShell 的 `Set-Content -Encoding utf8`
> 默认会加 BOM，宿主解析不了这个 JSON，整个包（宿主路由 + 客户端芯片）会**静默**加载失败——界面上什么都不显示，
> 也不报错。存盘时用编辑器默认的「UTF-8 无 BOM」，或：
>
> ```powershell
> [System.IO.File]::WriteAllText($path, $text, (New-Object System.Text.UTF8Encoding($false)))
> ```
>
> `node test-harness/test.mjs` 的第一条断言就是查这个。

## 验证

```powershell
curl "http://127.0.0.1:<port>/plugins/balance"
curl "http://127.0.0.1:<port>/plugins/balance-usage?session=<session-id>"
curl "http://127.0.0.1:<port>/plugins/balance-history?days=7"
```

`balance-usage` 预期返回 `{"ok":true,"usage":{"turn":…,"tokens":{…},"estimatedCost":…},"session":{"turns":…,"tokens":{…},"estimatedCost":…}}`；无已完成轮次时 `usage: null`，`session` 仍给出整条对话的累计值。
`balance-history` 预期返回 `{"ok":true,"days":[{date,weekday,today,cost,peak,offpeak,turns}×7],"total":…,"peakTotal":…,"offpeakTotal":…}`。

## 自测

`test-harness/` 里有宿主路由的离线用例：伪造 `sessions` 服务与会话事件，并在临时 `DSH_HOME` 里写一份**真正的多帧 zstd** 会话日志，覆盖逐帧解码、峰谷计价、fork 历史去重，以及「本次对话总消耗」的增量折算（追加一轮不重复计费、进行中的一轮也计入、fork 继承的历史不计入）：

```powershell
node .\test-harness\test.mjs        # 全部断言
```

`test-harness/render-smoke.mjs` 用假的 `react` / `react-dom` 直接跑 `BalanceDock` 与 `HeroCostChip` 的渲染路径，覆盖两种「消费显示」文案、右键菜单的第二组，以及空对话芯片的 portal 与「有对话时让位」：

```powershell
node .\test-harness\render-smoke.mjs
```

`test-harness/probe-history.mjs` 拿**真实**的 `~/.dsh/sessions` 跑一遍并打印七天明细与耗时，用来核对线上数据：

```powershell
node .\test-harness\probe-history.mjs
```

`test-harness/probe-session-total.mjs` 拿一条**真实**会话日志当会话跑「本次对话总消耗」，再把同一份日志丢进临时 home 用七日路由折一遍，两个数字应当完全相等：

```powershell
node .\test-harness\probe-session-total.mjs 0   # 0 = 最新的会话日志
```

## 维护

这个插件是长期维护项目。改动记录、DSH 内部机制笔记、踩过的坑、验证清单与「开工清单」都在
[`plugin-cost.md`](./plugin-cost.md) 里——下次开工先读它。

版本控制：本仓库就是 `plugins/dsh-cost`（git 2.56，基线 `v0.8.2`、当前 `v0.8.3`）：

```powershell
git log --oneline --decorate
git tag
```

改动前若想额外留一份快照（可选），`.\snapshot.ps1` 仍可用；执行策略受限时：

```powershell
powershell -ExecutionPolicy Bypass -File .\snapshot.ps1
```

## 许可

MIT，衍生自 Andre Goncalves 的 `dsh-balance`。
