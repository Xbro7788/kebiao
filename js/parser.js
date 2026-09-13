/* ============ parser.js — 把 OCR 文本解析成课程对象 ============ */

// 周次字符串 -> 周次数组
// 支持: "1-8周" "9-10周,14-15周" "1-16周(单)" "1-16周(双)" "单周" "双周"
function parseWeeks(str) {
  if (!str) return [];
  const weeks = new Set();
  const total = (window.__kb_totalWeeks || 20);
  // 匹配 "1-8" / "1,3,5" / "1-16(单)" / "1-16(双)" / "单周" / "双周"
  const segs = str.replace(/周/g, ',').split(/[,，、\s]+/).filter(Boolean);
  for (const seg of segs) {
    if (/^单$/.test(seg)) { for (let i = 1; i <= total; i += 2) weeks.add(i); continue; }
    if (/^双$/.test(seg)) { for (let i = 2; i <= total; i += 2) weeks.add(i); continue; }
    const odd = /单/.test(seg), even = /双/.test(seg);
    const m = seg.match(/(\d+)\s*[-~—]\s*(\d+)/);
    if (m) {
      let a = +m[1], b = +m[2];
      if (a > b) [a, b] = [b, a];
      for (let i = a; i <= b; i++) {
        if (odd && i % 2 === 0) continue;
        if (even && i % 2 === 1) continue;
        weeks.add(i);
      }
    } else {
      const d = seg.match(/\d+/);
      if (d) weeks.add(+d[0]);
    }
  }
  return [...weeks].sort((x, y) => x - y);
}

// 从文本提取节次 [start, end]
function extractPeriod(text) {
  const m = text.match(/[\(（]?\s*(\d+)\s*[-~至]\s*(\d+)\s*节\s*[\)）]?/);
  if (m) return [+m[1], +m[2]];
  const m2 = text.match(/[\(（]?\s*(\d+)\s*节\s*[\)）]?/);
  if (m2) return [+m2[1], +m2[1]];
  return null;
}

// 从文本提取周次字符串
function extractWeeksStr(text) {
  // 形如 1-8周 / 9-10周,14-15周 / 1-16周(单) / 1-16周(双)
  const m = text.match(/(?:\d+\s*[-~—]\s*\d+|\d+)\s*周(?:\s*[\(（]?\s*(?:单|双)\s*[\)）]?)?(?:\s*[,，、]\s*(?:\d+\s*[-~—]\s*\d+|\d+)\s*周(?:\s*[\(（]?\s*(?:单|双)\s*[\)）]?)?)*/);
  return m ? m[0].replace(/\s+/g, '') : null;
}

// 清理 OCR 噪声字符
function cleanText(s) {
  if (!s) return '';
  return s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
          .replace(/[｜|¦]/g, '')
          .replace(/\s+/g, ' ')
          .trim();
}

// 课程名过滤：排除纯数字/纯符号
function looksLikeName(t) {
  if (!t) return false;
  if (/^[\d\s\W]+$/.test(t)) return false;
  if (t.length < 2) return false;
  if (/^(上午|下午|晚上|星期|周[一二三四五六日天]|时间段|节次|场地|教师|教室|教学班|考核方式|备注|选课|课程|学时|学分|总学时|周学时)$/.test(t)) return false;
  return true;
}

// 主解析：OCR 单元格文本 -> 课程对象
function parseCourseText(raw) {
  const text = cleanText(raw);
  if (!text) return null;
  // 课程名：★ 前的内容
  let name = '';
  const star = text.indexOf('★');
  if (star > 0) name = text.slice(0, star).trim();
  else {
    // 无★：取第一段（到节次/场地/教师等关键词为止）
    const m = text.match(/^(.+?)(?=[\(（]?\d+\s*[-~]\s*\d+\s*节|\s*(?:场地|教师|教室|教学班|考核|周次))/);
    name = m ? m[1].trim() : text.slice(0, 20);
  }
  name = name.replace(/^[\s:：,，]+|[\s:：,，]+$/g, '');
  if (!looksLikeName(name)) return null;

  const period = extractPeriod(text);
  const weeksStr = extractWeeksStr(text);
  const weeks = weeksStr ? parseWeeks(weeksStr) : [];

  // 场地：场地[:：]? 后到 教师/教学班/考核/斜杠
  let location = '';
  const locM = text.match(/场地\s*[:：]?\s*([^/]+?)(?=\s*(?:教师|教室|教学班|考核方式|选课|周次|$))/);
  if (locM) location = locM[1].replace(/[，,。]+$/, '').trim();

  // 教师：教师[:：]? 后到 教学班/考核/斜杠
  let teacher = '';
  const tchM = text.match(/教师\s*[:：]?\s*([^/]+?)(?=\s*(?:教学班|考核方式|选课|场地|$))/);
  if (tchM) teacher = tchM[1].trim();

  // 备注：教学班、考核方式等剩余信息
  let note = '';
  const noteStart = text.search(/教学班|考核方式|选课备注|课程学时组成/);
  if (noteStart >= 0) note = text.slice(noteStart).trim();

  return {
    name,
    start: period ? period[0] : null,
    end: period ? period[1] : null,
    weeksStr: weeksStr || '',
    weeks,
    location,
    teacher,
    note
  };
}

// 归一化文本用于比较（去空格、全半角）
function norm(s) {
  return (s || '').replace(/\s+/g, '').toLowerCase();
}

// 合并同一格内多段课程文本（OCR 可能把一个格子拆成多行）
function mergeCellTexts(texts) {
  return texts.join('\n');
}

// 批量行解析：格式 "星期 节次 周次 教室 教师 课程名"
function dayOf(tk) {
  const map = { '周一': 0, '星期一': 0, '礼拜一': 0, '周二': 1, '星期二': 1, '礼拜二': 1,
    '周三': 2, '星期三': 2, '礼拜三': 2, '周四': 3, '星期四': 3, '礼拜四': 3,
    '周五': 4, '星期五': 4, '礼拜五': 4, '周六': 5, '星期六': 5, '礼拜六': 5,
    '周日': 6, '周天': 6, '星期日': 6, '星期天': 6, '礼拜日': 6, '礼拜天': 6, '周七': 6 };
  return tk in map ? map[tk] : null;
}

function parseBatchLine(line) {
  line = (line || '').trim();
  if (!line) return null;
  const isPractice = /^(实践|实习)/.test(line);
  let tokens = line.split(/\s+/).filter(Boolean);
  if (isPractice) tokens = tokens.slice(1);

  let day = null, start = null, end = null, weeksStr = '', location = '', nameTokens = [];
  for (const tk of tokens) {
    const d = dayOf(tk);
    if (d !== null) { day = d; continue; }
    let m = tk.match(/^第?(\d+)\s*[-~至]\s*(\d+)\s*节$/);
    if (m) { start = +m[1]; end = +m[2]; continue; }
    m = tk.match(/^第?(\d+)\s*节$/);
    if (m) { start = +m[1]; end = +m[1]; continue; }
    if (/周$/.test(tk) && /\d/.test(tk)) {
      const w = extractWeeksStr(tk);
      if (w) { weeksStr = weeksStr ? weeksStr + ',' + w : w; continue; }
    }
    if (tk.includes('楼')) { location = location ? location + tk : tk; continue; }
    nameTokens.push(tk);
  }

  // 教师/课程名：实践行教师=最后 token；常规行教师=倒数第二（2-4汉字）
  let teacher = '';
  let name = '';
  if (isPractice) {
    const last = nameTokens.pop();
    if (/^[\u4e00-\u9fa5]{2,4}$/.test(last)) teacher = last;
    else nameTokens.push(last);
    name = nameTokens.join(' ');
  } else if (nameTokens.length >= 2) {
    const t = nameTokens[nameTokens.length - 2];
    if (/^[\u4e00-\u9fa5]{2,4}$/.test(t)) {
      teacher = t;
      nameTokens.splice(nameTokens.length - 2, 1);
    }
    name = nameTokens.join(' ');
  } else {
    name = nameTokens.join(' ');
  }
  if (!name) return null;
  if (isPractice && !/^(实践|实习)/.test(name)) name = name;

  return {
    name,
    day,
    start, end,
    weeksStr,
    weeks: weeksStr ? parseWeeks(weeksStr) : [],
    location,
    teacher,
    note: isPractice ? '实践课程' : '',
    isPractice
  };
}

window.__kb_parser = { parseWeeks, extractPeriod, extractWeeksStr, parseCourseText, parseBatchLine, cleanText, looksLikeName, dayOf };
