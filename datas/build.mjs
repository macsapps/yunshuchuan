/**
 * datas/build.mjs — 本地数据构建脚本
 *
 * 数据源: /Users/HeSirCode/vue_project/bto-share/data (list.json + movies/*.json)
 * 输出:   giteeapi-front/datas/ 下的一套 JSON，字段结构对齐运输船后端(ThinkPHP)接口:
 *   - list.json        ← MoviesInfoYsc/baseInfoListYSC 的 paginate 结果
 *   - movies/*.json    ← MoviesInfoYsc/DetailYSC 单条记录 (文件名 douban_id.json)
 *   - specials.json    ← Moviesnew/Specials 的 paginate 结果
 *   - specials/*.json  ← Moviesnew/SpecialDetail 单条记录
 *   - users.json       ← 访客设备档案(合成种子数据, 系统无真实用户表)
 *   - stats.json       ← y_daycount 每日访问统计(合成) + 站点真实汇总
 *   - hotsearch.json   ← y_hotsearch 热搜词(合成自真实片名)
 *   - cates.json       ← y_cate 分类(带真实计数)
 *   - config.json      ← public/config.js 的 JSON 版本
 *
 * 运行: node datas/build.mjs
 */
import fs from "node:fs";
import path from "node:path";

const SRC = "/Users/HeSirCode/vue_project/bto-share/data";
const OUT = path.resolve(import.meta.dirname);

// ---------- 确定性随机 ----------
let seed = 20261028;
const rnd = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const rint = (min, max) => Math.floor(min + rnd() * (max - min + 1));

// ---------- 网盘类型映射 ----------
// Detail.vue foramtType: 1百度 2阿里 3夸克 4UC 5迅雷 其他→其他
// shareType=6 前端按磁力渲染, 本数据无磁力, 非5大网盘用 7(其他) 走"立即转存"
const TYPE_MAP = {
  baidu: 1,
  ali: 2,
  quark: 3,
  kuake: 3,
  uc: 4,
  xunlei: 5,
};
const HOST_WHITELIST = {
  baidu: ["pan.baidu.com"],
  ali: ["alipan.com", "aliyundrive.com"],
  quark: ["pan.quark.cn"],
  kuake: ["pan.quark.cn"],
  uc: ["drive.uc.cn"],
  xunlei: ["pan.xunlei.com"],
  guangya: ["guangyapan.com"],
  123: ["123pan.com", "123pan.cn", "123684.com", "123865.com"],
  115: ["115.com", "115cdn.com"],
};

const NAME_JUNK = ["<img", "onerror", "SLEEP", "example.com", "http://a.com"];

function validLink(type, link) {
  const hosts = HOST_WHITELIST[type];
  if (!hosts || !link) return false;
  try {
    const host = new URL(link).hostname;
    return hosts.some((h) => host === h || host.endsWith("." + h));
  } catch {
    return false;
  }
}

function cleanName(name) {
  const n = (name || "").trim();
  if (n.length < 2) return "";
  if (NAME_JUNK.some((k) => n.toLowerCase().includes(k.toLowerCase()))) return "";
  return n;
}

// 从资源名里抠体积 "12.57GB" / "2.31G" / "1.2TB"; 识别中文字幕
// 返回纯数字字符串(GB): 前端模板会自己追加 "GB"/"G" 字样
function extractSize(name) {
  const tb = name.match(/([\d.]+)\s*TB/i);
  if (tb) return String(Math.round(parseFloat(tb[1]) * 1024 * 10) / 10);
  const gb = name.match(/([\d.]+)\s*G(?=B|\b|\s|\/|$)/i);
  if (gb) return String(Math.round(parseFloat(gb[1]) * 10) / 10);
  return "";
}
const hasSub = (name) => /中字|简体|繁体|国语|中文|双语/.test(name);

// netdisk 条目 → 前端 myShareurl / shareUrl 行
function mapShare(it) {
  const name = cleanName(it.name);
  if (!validLink(it.type, it.link) || !name) return null;
  return {
    shareType: TYPE_MAP[it.type] || 7,
    name,
    size: extractSize(name),
    isZn: hasSub(name) ? 1 : 0,
    date: (it.shared_at || "").slice(0, 10) || "",
    // 规范化: 去首尾空白, 协议头统一小写
    url: it.link.trim().replace(/^https?:\/\//i, (m) => m.toLowerCase()),
  };
}

const scoreOf = (m) => m.douban_score || 0;

// ---------- 读取源数据 ----------
console.log("reading source list.json ...");
const srcList = JSON.parse(fs.readFileSync(path.join(SRC, "list.json"), "utf8"));
const movies = [...srcList.movies].sort((a, b) => scoreOf(b) - scoreOf(a));

const listRows = [];
const seen = new Set();
let noDoubanId = 0;
let detailReadFail = 0;

const genreCount = {};
const yearCount = {};
const shareTypeCount = {};

for (const m of movies) {
  const doubanId = m.douban_id;
  if (!doubanId) {
    noDoubanId++;
    continue;
  }
  if (seen.has(doubanId)) continue;

  let d;
  try {
    d = JSON.parse(fs.readFileSync(path.join(SRC, m.detail_file), "utf8"));
  } catch {
    detailReadFail++;
    continue;
  }
  seen.add(doubanId);

  const shares = (d.netdisk || []).map(mapShare).filter(Boolean);
  shares.forEach((s) => (shareTypeCount[s.shareType] = (shareTypeCount[s.shareType] || 0) + 1));

  const genres = (d.genres && d.genres.length ? d.genres : m.genres) || [];
  const classStr = genres.join(",");

  // 列表行: baseInfoListYSC → field('class,title,niandai,doub_id,epic,edbf')
  listRows.push({
    id: doubanId,
    doub_id: doubanId,
    title: d.title || m.title,
    niandai: String(d.year || m.year || ""),
    class: classStr,
    epic: d.poster_raw || m.poster_raw,
    edbf: d.douban_score ?? m.douban_score ?? 0,
    hasRes: shares.length > 0 ? 1 : 0,
  });

  genres.forEach((g) => (genreCount[g] = (genreCount[g] || 0) + 1));
  const y = String(d.year || m.year || "未知").slice(0, 4);
  yearCount[y] = (yearCount[y] || 0) + 1;

  // 详情: DetailYSC 字段形状 (JSON 字符串字段保持前端 JSON.parse 的预期形态)
  const detail = {
    id: doubanId,
    doub_id: doubanId,
    title: d.title || m.title,
    years: String(d.year || m.year || ""),
    class: classStr,
    image: d.poster_raw || m.poster_raw,
    doub_score: d.douban_score ?? null,
    IMDB_number: d.imdb?.number || "",
    IMDB_score: d.imdb?.score ?? null,
    edit: d.director || "",
    bianji: JSON.stringify(d.screenwriters || []),
    performer: (d.actors || []).join(","),
    language: d.language || "",
    release: d.release_date || "",
    alias: d.alias || "",
    abstract: d.abstract || "",
    photos: null, // 源数据无剧照
    myShareurl: JSON.stringify(shares), // 前端会 JSON.parse
    shareUrl: "[]", // 旧字段, 置空
    ecca: "null", // 蓝光原盘, 前端 JSON.parse(null)===null 安全
    all_seeds: '"[]"', // 前端双重 JSON.parse
    seed_num: d.seed_count ?? m.seed_num ?? 0,
  };

  const outFile = path.join(OUT, "movies", `${doubanId}.json`);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(detail));
}

// ---------- 列表 (按评分倒序, 对齐 order by edbf desc) ----------
const totalPages = Math.ceil(listRows.length / 36);
const listJson = {
  data: listRows,
  total: listRows.length,
  per_page: 36,
  current_page: 1,
  last_page: totalPages,
  updated_at: new Date().toISOString().slice(0, 19).replace("T", " "),
};
fs.writeFileSync(path.join(OUT, "list.json"), JSON.stringify(listJson));
console.log(`list.json: ${listRows.length} rows, ${totalPages} pages`);

// ---------- 合集片单 ----------
const withRes = listRows.filter((r) => r.hasRes === 1);
const specials = [];
let sid = 100;
const addSpecial = (name, pool, n) => {
  const picked = pool.slice(0, n);
  if (picked.length < 6) return;
  specials.push({
    id: sid,
    name,
    movieIds: picked.map((r) => r.id),
    detail: { imgs: picked[0].epic },
    rows: picked, // 临时, 写文件前展开
  });
  sid++;
};

addSpecial("豆瓣高分 Top50", withRes, 50);
const topGenres = Object.entries(genreCount).sort((a, b) => b[1] - a[1]).slice(0, 8);
for (const [g] of topGenres) {
  addSpecial(
    `${g}类型精选`,
    withRes.filter((r) => r.class.split(",").includes(g)),
    24
  );
}
addSpecial("2025-2026 新片速递", withRes.filter((r) => +r.niandai >= 2025), 30);
addSpecial("2024 年度佳片", withRes.filter((r) => r.niandai === "2024"), 30);
addSpecial("2020年代佳作", withRes.filter((r) => +r.niandai >= 2020 && +r.niandai < 2024), 30);
addSpecial("2010年代经典", withRes.filter((r) => +r.niandai >= 2010 && +r.niandai < 2020), 30);
addSpecial("上世纪老片拾遗", withRes.filter((r) => +r.niandai <= 1999 && r.niandai), 30);

const specialDetailById = {};
const specialsList = specials.map((sp, i) => {
  const moviesList = sp.rows.map((r) => {
    const d = JSON.parse(fs.readFileSync(path.join(OUT, "movies", `${r.id}.json`), "utf8"));
    return {
      id: d.id,
      title: d.title,
      ratingNum: d.doub_score,
      ratingbetterthan: "",
      imgs: d.image,
      tag: d.class,
      address: "",
      years: d.years,
      date: d.release,
      photos: null,
      descs: d.abstract,
      shareUrl: d.myShareurl, // 保持 JSON 字符串形态(后端 y_movies 列即如此), 页面会 JSON.parse
    };
  });
  specialDetailById[sp.id] = {
    id: sp.id,
    name: sp.name,
    movieIds: sp.movieIds,
    detail: { imgs: sp.detail.imgs },
    moviesList,
  };
  return {
    id: sp.id,
    name: sp.name,
    movieIds: sp.movieIds,
    detail: { imgs: sp.detail.imgs },
  };
});
fs.writeFileSync(
  path.join(OUT, "specials.json"),
  JSON.stringify({ data: specialsList, total: specialsList.length, per_page: 20, current_page: 1, last_page: 1 })
);
fs.mkdirSync(path.join(OUT, "specials"), { recursive: true });
for (const [id, obj] of Object.entries(specialDetailById)) {
  fs.writeFileSync(path.join(OUT, "specials", `${id}.json`), JSON.stringify(obj));
}
console.log(`specials.json: ${specialsList.length} collections`);

// ---------- 分类 (带真实计数) ----------
const configCates = JSON.parse(fs.readFileSync(path.join(OUT, "..", "public", "config.js"), "utf8").match(/cateList:\s*(\[[^\]]+\])/)[1].replace(/,\s*\]/, "]"));
const cates = configCates.map((name, i) => ({
  id: i === 0 ? "" : i,
  name,
  count: name === "全部" ? listRows.length : genreCount[name] || 0,
}));
fs.writeFileSync(path.join(OUT, "cates.json"), JSON.stringify(cates, null, 2));

// ---------- 热搜词(合成: 真实片名 + 权重随机) ----------
const hot = withRes.slice(0, 40).map((r, i) => ({
  id: i + 1,
  name: r.title,
  times: rint(60, 3600) + Math.round(scoreOf(r) * 100),
  type: 1,
})).sort((a, b) => b.times - a.times);
fs.writeFileSync(path.join(OUT, "hotsearch.json"), JSON.stringify(hot, null, 2));

// ---------- 每日访问统计(合成 y_daycount 形状) ----------
const dayRows = [];
const today = new Date();
for (let i = 59; i >= 0; i--) {
  const dt = new Date(today.getTime() - i * 86400000);
  const date = `${dt.getFullYear()}-${dt.getMonth() + 1}-${dt.getDate()}`;
  const base = 300 + rint(0, 700) + (i < 7 ? rint(100, 500) : 0);
  const views = base + rint(0, 200);
  dayRows.push({
    id: 60 - i,
    date,
    views,
    users: rint(Math.floor(views * 0.3), Math.floor(views * 0.6)),
    clicks: rint(Math.floor(views * 0.2), Math.floor(views * 0.5)),
    MacOs: rint(5, 40),
    Windows: rint(30, 120),
    Android: rint(10, 60),
    iPhone: rint(10, 70),
  });
}

// ---------- 访客设备档案(合成, 模拟 localStorage markId 维度) ----------
const OSS = [
  { os: "MacIntel", browser: "Safari", w: 1512 },
  { os: "MacIntel", browser: "Chrome", w: 1728 },
  { os: "Win32", browser: "Chrome", w: 1920 },
  { os: "Win32", browser: "Edge", w: 1536 },
  { os: "iPhone", browser: "Safari", w: 390 },
  { os: "Linux armv8l", browser: "Chrome", w: 412 },
];
const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
const users = [];
for (let i = 1; i <= 200; i++) {
  const dev = OSS[rint(0, OSS.length - 1)];
  let markId = "";
  for (let j = 0; j < 15; j++) markId += chars[rint(0, chars.length - 1)];
  const visits = rint(1, 30);
  const firstIdx = rint(0, 44); // dayRows[0] 是最早的一天
  const lastIdx = rint(firstIdx, 59);
  users.push({
    id: i,
    markId,
    os: dev.os,
    browser: dev.browser,
    screenWidth: dev.w,
    visits,
    firstSeen: dayRows[firstIdx].date,
    lastSeen: dayRows[lastIdx].date,
  });
}

fs.writeFileSync(
  path.join(OUT, "users.json"),
  JSON.stringify({ total: users.length, note: "合成种子数据: 系统无用户表, 以 localStorage markId 作为访客标识", users }, null, 2)
);
fs.writeFileSync(path.join(OUT, "stats.json"), JSON.stringify({ note: "合成种子数据: y_daycount 形状", data: dayRows }, null, 2));
console.log(`users.json: ${users.length} devices; stats.json: ${dayRows.length} days`);

// ---------- 站点汇总 ----------
const summary = {
  generated_at: new Date().toISOString(),
  source: SRC,
  source_updated_at: srcList.updated_at,
  movies_total: listRows.length,
  movies_with_resources: withRes.length,
  movies_without_douban_id: noDoubanId,
  detail_read_fail: detailReadFail,
  specials_total: specialsList.length,
  netdisk_links_total: Object.values(shareTypeCount).reduce((a, b) => a + b, 0),
  netdisk_by_shareType: shareTypeCount, // 1百度 2阿里 3夸克 4UC 5迅雷 7其他
  genres: Object.fromEntries(Object.entries(genreCount).sort((a, b) => b[1] - a[1])),
  years: yearCount,
};
fs.writeFileSync(path.join(OUT, "summary.json"), JSON.stringify(summary, null, 2));

// ---------- config.json ----------
fs.writeFileSync(
  path.join(OUT, "config.json"),
  JSON.stringify({ apiUrl: "local:datas(本地数据目录)", webUrl: "yunshuchuan.66ghz.com", imgReg: "https://img.bbegge.com/", isAdmin: true, cateList: configCates }, null, 2)
);

console.log("done. ->", OUT);
