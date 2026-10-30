/**
 * datas/build-sql.mjs — 从 y_movies.sql 全量导出重建本地数据
 *
 * 数据源: /Users/hesir/Downloads/y_movies.sql (phpMyAdmin 导出的 y_movies 表, 1585 条)
 * 旧 bto-share 数据先挪入 datas/backup/bto-share/ 再重建:
 *   list.json / movies/*.json / specials.json / specials/*.json / cates.json
 *   hotsearch.json / summary.json
 *
 * 字段映射(y_movies → 前端 DetailYSC/baseInfoListYSC 形状):
 *   id→id,doub_id  title→title  years→niandai,years  cates(字母)→class(中文)
 *   imgs→epic,image  ratingNum→edbf,doub_score  dy→edit  bj→bianji(JSON数组)
 *   zy→performer  otherName→alias  date→release  lan→language
 *   descs→abstract  IMDb→IMDB_number  photos→photos  shareUrl→myShareurl
 * 运行: node datas/build-sql.mjs
 */
import fs from "node:fs";
import path from "node:path";

const SRC_SQL = process.env.HOME + "/Downloads/y_movies.sql";
const OUT = path.resolve(import.meta.dirname);
const BACKUP = path.join(OUT, "backup", "bto-share");

// ---------- cates 字母 → 中文 (bto_front/public/config.js 官方映射) ----------
const CATE_MAP = {
  a: "喜剧", b: "剧情", c: "动作", d: "爱情", e: "科幻", f: "动画",
  g: "悬疑", h: "惊悚", i: "恐怖", j: "犯罪", k: "音乐", l: "历史",
  m: "战争", n: "奇幻", o: "冒险", p: "灾难", q: "武侠", r: "纪录片",
  s: "传记", z: "其他",
};

// ---------- SQL VALUES 解析 ----------
// 解析 INSERT INTO `y_movies` (cols) VALUES (row1),(row2),...; 支持引号内换行、\' 与 '' 转义
function parseSqlDump(sql) {
  const rows = [];
  let cols = null;
  let i = 0;
  const n = sql.length;

  const skipWs = () => {
    while (i < n && /\s/.test(sql[i])) i++;
  };

  // 读一个字段值: 字符串/数字/NULL
  function readValue() {
    skipWs();
    if (sql[i] === "'") {
      i++;
      let out = "";
      while (i < n) {
        const ch = sql[i];
        if (ch === "\\") {
          const next = sql[i + 1];
          const map = { n: "\n", r: "\r", t: "\t", "0": "\0", b: "\b", Z: "\x1a" };
          out += next in map ? map[next] : next;
          i += 2;
        } else if (ch === "'") {
          if (sql[i + 1] === "'") {
            out += "'";
            i += 2;
          } else {
            i++;
            break;
          }
        } else {
          out += ch;
          i++;
        }
      }
      return out;
    }
    // NULL / 数字
    const m = /^NULL|^-?\d+(?:\.\d+)?/.exec(sql.slice(i, i + 16));
    if (!m) throw new Error(`unexpected token at ${i}: ${sql.slice(i, i + 40)}`);
    i += m[0].length;
    return m[0] === "NULL" ? null : m[0];
  }

  while (true) {
    const ins = sql.indexOf("INSERT INTO `y_movies`", i);
    if (ins < 0) break;
    const colStart = sql.indexOf("(", ins);
    const colEnd = sql.indexOf(")", colStart);
    if (!cols) {
      cols = sql.slice(colStart + 1, colEnd).split(",").map((c) => c.trim().replace(/`/g, ""));
    }
    const vIdx = sql.indexOf("VALUES", colEnd);
    i = sql.indexOf("(", vIdx);

    // 逐条读元组: 元组之间以 ",(" 分隔, 语句以 ");" 结束
    while (i < n) {
      if (sql[i] !== "(") break;
      i++;
      const row = {};
      for (let f = 0; f < cols.length; f++) {
        row[cols[f]] = readValue();
        skipWs();
        if (f < cols.length - 1) {
          if (sql[i] !== ",") throw new Error(`expect comma at ${i}: ${sql.slice(i, i + 40)}`);
          i++;
        }
      }
      skipWs();
      if (sql[i] !== ")") throw new Error(`expect ) at ${i}: ${sql.slice(i, i + 40)}`);
      i++;
      rows.push(row);
      skipWs();
      if (sql[i] === ",") {
        i++;
        skipWs();
        continue;
      }
      // 语句结束 ");" —— 跳过分号, 进入下一语句
      if (sql[i] === ";") i++;
      break;
    }
    i = ins + 22;
  }
  return rows;
}

// ---------- shareUrl 解析(后端存的是 JSON 字符串, 有双重编码形态) ----------
function parseShareUrl(raw) {
  if (!raw || typeof raw !== "string") return [];
  let s = raw.trim();
  if (!s) return [];
  try {
    let v = JSON.parse(s);
    if (typeof v === "string") v = JSON.parse(v); // '"[...]"' 双重编码
    if (!Array.isArray(v)) return [];
    return v
      .filter((it) => it && typeof it.url === "string" && it.url.trim().startsWith("http"))
      .map((it) => ({ ...it, url: it.url.trim() }));
  } catch {
    return [];
  }
}

// ---------- 备份旧数据 ----------
console.log("backing up old datas ...");
fs.mkdirSync(BACKUP, { recursive: true });
for (const name of ["list.json", "movies", "specials", "specials.json", "summary.json"]) {
  const from = path.join(OUT, name);
  if (fs.existsSync(from)) {
    fs.rmSync(path.join(BACKUP, name), { recursive: true, force: true });
    fs.renameSync(from, path.join(BACKUP, name));
  }
}

// ---------- 解析并重建 ----------
console.log("parsing y_movies.sql ...");
const sql = fs.readFileSync(SRC_SQL, "utf8");
const rows = parseSqlDump(sql);
console.log(`parsed rows: ${rows.length}`);

const listRows = [];
const genreCount = {};
const yearCount = {};
const shareTypeCount = {};
let withRes = 0;

fs.mkdirSync(path.join(OUT, "movies"), { recursive: true });

for (const r of rows) {
  const id = parseInt(r.id, 10);
  if (!id || !r.title) continue;

  // cates: "b,f,o" → "剧情,动画,冒险"
  const classStr = (r.cates || "")
    .split(",")
    .map((c) => CATE_MAP[c.trim()])
    .filter(Boolean)
    .join(",");

  const shares = parseShareUrl(r.shareUrl);
  shares.forEach((s) => (shareTypeCount[s.shareType] = (shareTypeCount[s.shareType] || 0) + 1));
  if (shares.length) withRes++;

  const score = r.ratingNum == null ? null : parseFloat(r.ratingNum);
  const year = (r.years || "").toString().slice(0, 4);

  listRows.push({
    id,
    doub_id: id, // 前端以 doub_id 请求详情, 详情文件名即此 id
    title: r.title,
    niandai: year,
    class: classStr,
    epic: r.imgs || "",
    edbf: score ?? 0,
    hasRes: shares.length ? 1 : 0,
    tag: r.tag || "", // 榜单标签, 如 No.10|2019评分最高动画片
  });

  classStr.split(",").filter(Boolean).forEach((g) => (genreCount[g] = (genreCount[g] || 0) + 1));
  if (year) yearCount[year] = (yearCount[year] || 0) + 1;

  const detail = {
    id,
    doub_id: id,
    title: r.title,
    years: (r.years || "").toString(),
    class: classStr,
    image: r.imgs || "",
    doub_score: r.ratingNum == null || r.ratingNum === "" ? null : parseFloat(r.ratingNum),
    IMDB_number: r.IMDb || "",
    IMDB_score: null, // y_movies 无 IMDb 评分字段
    edit: r.dy || "",
    // 前端 JSON.parse(bianji), 库里是 "a / b" 纯文本 → 转 JSON 数组字符串
    bianji: JSON.stringify((r.bj || "").split(/\s*\/\s*/).filter(Boolean)),
    performer: r.zy || "",
    language: r.lan || "",
    release: r.date || "",
    alias: r.otherName || "",
    abstract: r.descs || "",
    photos: r.photos && r.photos.trim() ? r.photos : null,
    myShareurl: JSON.stringify(shares),
    shareUrl: "[]", // 旧 zname/zqxd 格式, 置空
    ecca: "null", // 蓝光原盘, 无
    all_seeds: '"[]"', // 磁力种子, 无
    duration: r.long || "",
    address: r.address || "",
    orginName: r.orginName || "",
    ratingbetterthan: r.ratingbetterthan || "",
    tag: r.tag || "",
  };
  fs.writeFileSync(path.join(OUT, "movies", `${id}.json`), JSON.stringify(detail));
}

// ---------- list.json (评分倒序, 对齐 order by edbf desc) ----------
listRows.sort((a, b) => (b.edbf ?? 0) - (a.edbf ?? 0));
const totalPages = Math.ceil(listRows.length / 36);
fs.writeFileSync(
  path.join(OUT, "list.json"),
  JSON.stringify({
    data: listRows,
    total: listRows.length,
    per_page: 36,
    current_page: 1,
    last_page: totalPages,
    updated_at: new Date().toISOString().slice(0, 19).replace("T", " "),
    source: "y_movies.sql (sql307.my-place.us/mp_38996720_yunshuchuan)",
  })
);
console.log(`list.json: ${listRows.length} rows, ${totalPages} pages, ${withRes} with resources`);

// ---------- 合集片单 (y_moviespecial 形状, id 从 100 起) ----------
let sid = 100;
const specials = [];
const addSpecial = (name, pool, n) => {
  const picked = pool.slice(0, n);
  if (picked.length < 6) return;
  specials.push({ id: sid++, name, rows: picked });
};
const resRows = listRows.filter((r) => r.hasRes === 1);
addSpecial("豆瓣高分 Top50", resRows, 50);
const topGenres = Object.entries(genreCount).sort((a, b) => b[1] - a[1]).slice(0, 8);
for (const [g] of topGenres) {
  addSpecial(`${g}类型精选`, resRows.filter((r) => r.class.split(",").includes(g)), 24);
}
addSpecial("2024-2026 新片速递", resRows.filter((r) => +r.niandai >= 2024), 30);
addSpecial("2020年代佳作", resRows.filter((r) => +r.niandai >= 2020 && +r.niandai < 2024), 30);
addSpecial("2010年代经典", resRows.filter((r) => +r.niandai >= 2010 && +r.niandai < 2020), 30);
addSpecial("上世纪老片拾遗", resRows.filter((r) => +r.niandai <= 1999 && r.niandai), 30);

fs.mkdirSync(path.join(OUT, "specials"), { recursive: true });
const specialsList = [];
for (const sp of specials) {
  const moviesList = sp.rows.map((r) => {
    const d = JSON.parse(fs.readFileSync(path.join(OUT, "movies", `${r.id}.json`), "utf8"));
    return {
      id: d.id,
      title: d.title,
      ratingNum: d.doub_score,
      ratingbetterthan: d.ratingbetterthan,
      imgs: d.image,
      tag: d.tag || d.class,
      address: d.address,
      years: d.years,
      date: d.release,
      photos: d.photos,
      descs: d.abstract,
      shareUrl: d.myShareurl, // JSON 字符串, 页面会 parse
    };
  });
  const obj = {
    id: sp.id,
    name: sp.name,
    movieIds: sp.rows.map((r) => r.id),
    detail: { imgs: sp.rows[0].epic },
    moviesList,
  };
  fs.writeFileSync(path.join(OUT, "specials", `${sp.id}.json`), JSON.stringify(obj));
  specialsList.push({ id: sp.id, name: sp.name, movieIds: obj.movieIds, detail: obj.detail });
}
fs.writeFileSync(
  path.join(OUT, "specials.json"),
  JSON.stringify({ data: specialsList, total: specialsList.length, per_page: 20, current_page: 1, last_page: 1 })
);
console.log(`specials.json: ${specialsList.length} collections`);

// ---------- cates.json (真实计数) ----------
const configCates = JSON.parse(
  fs.readFileSync(path.join(OUT, "..", "public", "config.js"), "utf8").match(/cateList:\s*(\[[^\]]+\])/)[1].replace(/,\s*\]/, "]")
);
fs.writeFileSync(
  path.join(OUT, "cates.json"),
  JSON.stringify(
    configCates.map((name, i) => ({
      id: i === 0 ? "" : i,
      name,
      count: name === "全部" ? listRows.length : genreCount[name] || 0,
    })),
    null,
    2
  )
);

// ---------- hotsearch.json (真实高分片名) ----------
const hot = resRows.slice(0, 40).map((r, i) => ({
  id: i + 1,
  name: r.title,
  times: Math.round((r.edbf || 5) * 300) + (40 - i) * 7,
  type: 1,
})).sort((a, b) => b.times - a.times);
fs.writeFileSync(path.join(OUT, "hotsearch.json"), JSON.stringify(hot, null, 2));

// ---------- summary.json ----------
fs.writeFileSync(
  path.join(OUT, "summary.json"),
  JSON.stringify(
    {
      generated_at: new Date().toISOString(),
      source: SRC_SQL,
      db: "mp_38996720_yunshuchuan @ sql307.my-place.us",
      movies_total: listRows.length,
      movies_with_resources: withRes,
      netdisk_links_total: Object.values(shareTypeCount).reduce((a, b) => a + b, 0),
      netdisk_by_shareType: shareTypeCount,
      specials_total: specialsList.length,
      genres: Object.fromEntries(Object.entries(genreCount).sort((a, b) => b[1] - a[1])),
      years: yearCount,
      note: "stats.json/users.json 为合成种子数据, 未受本次重建影响",
    },
    null,
    2
  )
);
console.log("done. ->", OUT);
