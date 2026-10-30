# datas/ — 本地数据集

「运输船影视」前端的本地 JSON 数据。字段结构对齐 ThinkPHP 后端（`yunshuchuan/server`）接口的返回形状，页面接入时只需把 `fetch(window.config.apiUrl + ...)` 换成读本地文件即可。

- **生成方式**：`node datas/build.mjs`（数据源：`/Users/HeSirCode/vue_project/bto-share/data`，即不太灵影视的抓取数据，与运输船系统同源）
- **规模**：8827 部电影 / 6817 部带有效网盘资源 / 34358 条网盘链接 / 14 个合集
- **更新**：重跑 `build.mjs` 全量覆盖（按豆瓣评分倒序写入列表）

> 远程后端 `yunshuchuan.66ghz.com` 当前不可达，本机 MySQL 也未运行，故以同源的 bto-share 抓取数据为源。

## 文件清单

| 文件 | 对应接口 / 表 | 说明 |
|---|---|---|
| `list.json` | `MoviesInfoYsc/baseInfoListYSC` | 列表（thinkphp paginate 形状：data/total/per_page/current_page/last_page），按 `edbf` 评分倒序 |
| `movies/<douban_id>.json` | `MoviesInfoYsc/DetailYSC` | 单片详情，共 8827 个文件 |
| `specials.json` | `Moviesnew/Specials` | 合集片单列表 |
| `specials/<id>.json` | `Moviesnew/SpecialDetail` | 合集详情（含 moviesList） |
| `cates.json` | `y_cate` | 分类（来自 public/config.js 的 cateList）+ 真实计数 |
| `hotsearch.json` | `y_hotsearch` | 热搜词（合成：真实片名 + 随机权重） |
| `users.json` | （系统无用户表） | 访客设备档案，模拟 localStorage `markId` 维度，**合成种子数据** |
| `stats.json` | `y_daycount` | 近 60 天每日访问统计（views/users/clicks/各 OS），**合成种子数据** |
| `summary.json` | — | 本次构建的汇总统计 |
| `config.json` | `public/config.js` | 运行时配置的 JSON 版本 |
| `build.mjs` | — | 构建脚本，可重跑 |

## 列表行字段（list.json → data[]）

对齐 `baseInfoListYSC` 的 `field('class,title,niandai,doub_id,epic,edbf')`：

| 字段 | 源 | 说明 |
|---|---|---|
| `doub_id` | douban_id | 主键，详情文件名即此值 |
| `title` | title | 片名 |
| `niandai` | year | 年代（字符串） |
| `class` | genres | 类型，逗号分隔（后端为 like 匹配） |
| `epic` | poster_raw | 海报 URL（img.mvinfo.homes） |
| `edbf` | douban_score | 豆瓣评分（列表排序键） |
| `hasRes` | — | 附加字段：1=有有效网盘链接，便于前端过滤 |

## 详情字段（movies/*.json）

对齐 `DetailYSC` 的 field 列表。**注意**：`bianji / myShareurl / shareUrl / ecca / all_seeds / photos` 在后端存的是 JSON 字符串，前端会二次 `JSON.parse`，这里保持同样形态：

| 字段 | 源 | 说明 |
|---|---|---|
| `id` / `doub_id` | douban_id | |
| `title` / `years` / `class` / `image` | title/year/genres/poster_raw | |
| `doub_score` / `IMDB_score` / `IMDB_number` | douban_score / imdb | |
| `edit` | director | 导演 |
| `bianji` | screenwriters | **JSON 字符串** `["a","b"]` |
| `performer` | actors | 逗号分隔 |
| `language` / `release` / `alias` / `abstract` | 同名 | `abstract` 为 HTML |
| `photos` | — | null（源数据无剧照） |
| `myShareurl` | netdisk 清洗后 | **JSON 字符串**，资源列表，见下 |
| `shareUrl` | — | `"[]"` 旧字段，置空 |
| `ecca` | — | `"null"`（蓝光原盘，源数据无），前端 `JSON.parse(null)===null` 安全 |
| `all_seeds` | — | `"\"[]\""`（磁力种子，源数据无），前端双重 parse 后为 `[]` |
| `seed_num` | seed_count | 原始种子计数（保留参考） |

### myShareurl 条目（解析后的形状）

| 字段 | 说明 |
|---|---|
| `shareType` | 1百度 2阿里 3夸克 4UC 5迅雷 7其他（对齐 Detail.vue `foramtType`；前端把 6 当磁力，本数据无磁力） |
| `name` | 资源名（已剔除注入串/短串等脏数据） |
| `size` | 从资源名提取的体积，如 `"12.6GB"`（TB 已折算），无则 `""` |
| `isZn` | 1=资源名含中字/国语等标记 |
| `date` | 分享日期 `YYYY-MM-DD` |
| `url` | 网盘链接（已按网盘域名白名单校验） |

## 清洗规则（build.mjs）

- 网盘链接按 `type` 做域名白名单校验（如 quark 必须是 `pan.quark.cn`），不符丢弃——源数据里混有 `example.com`、SQL 注入串等脏行。
- 资源名 <2 字符或含 `<img`/`onerror`/`SLEEP` 等关键字的丢弃。
- 无豆瓣 ID 或详情文件读取失败（20 个）的条目跳过。
- 去重键：douban_id。

## 前端接入提示

1. **图片域名**：海报是 `img.mvinfo.homes`，不走 `window.config.imgReg` 的替换逻辑（那个替换只匹配 `img.cfwebname.top`，不会误伤）。
2. **分页**：`list.json` 是一次性全量数组，前端可本地切片模拟 `page/pageSize`，`last_page=246`。
3. **分类筛选**：对 `data[].class` 做 `includes(cate)` 即可，与后端 `like` 行为一致。
4. **搜索**：对 `data[].title` 做 includes；`hotsearch.json` 可做热搜榜。
5. `users.json` / `stats.json` 为合成种子数据（系统本无用户表，访客以 localStorage `markId` 标识），仅供展示/测试用，`summary.json` 里的站点数字是真实的。
