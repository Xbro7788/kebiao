/* ============ app.js — 课表主逻辑 ============ */

const COLORS = ['#5b8def','#f2a03d','#34b37e','#e8688a','#8e6fd8','#3aa7c9','#e0a800','#6bbf59','#d96c3f','#5a7fd4','#c94f7c','#46b3a2'];
const DAY_NAMES = ['周一','周二','周三','周四','周五','周六','周日'];
const STORE_KEY = 'kebiao_data_v1';

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

function loadState() {
  const defaultPeriods = [
    ['08:10','08:55'],['09:05','09:50'],['10:20','11:05'],['11:15','12:00'],
    ['14:00','14:45'],['14:55','15:40'],['16:10','16:55'],['17:05','17:50'],['18:30','19:15']
  ];
  const def = {
    showNonWeek: true,
    highlightToday: true,
    profiles: [{
      id: 'p1', name: '默认课表',
      data: { semesterStart: '2026-08-31', totalWeeks: 20, courses: [], periods: defaultPeriods.slice() }
    }],
    activeProfile: 'p1'
  };
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const d = JSON.parse(raw);
      if (d.profiles && d.profiles.length) {
        def.profiles = d.profiles;
        def.activeProfile = d.activeProfile || d.profiles[0].id;
        def.showNonWeek = d.showNonWeek !== false;
        def.highlightToday = d.highlightToday !== false;
      } else {
        // 旧版数据迁移：作为默认课表
        def.profiles[0].data = {
          semesterStart: d.semesterStart || '2026-08-31',
          totalWeeks: d.totalWeeks || 20,
          courses: d.courses || [],
          periods: d.periods || defaultPeriods.slice()
        };
        def.showNonWeek = d.showNonWeek !== false;
        def.highlightToday = d.highlightToday !== false;
      }
      const p = def.profiles.find((x) => x.id === def.activeProfile) || def.profiles[0];
      def.activeProfile = p.id;
      def.semesterStart = p.data.semesterStart;
      def.totalWeeks = p.data.totalWeeks;
      def.courses = p.data.courses;
      def.periods = p.data.periods;
      return def;
    }
  } catch (e) {}
  return def;
}
let S = loadState();
function activeProfile() { return S.profiles.find((p) => p.id === S.activeProfile) || S.profiles[0]; }
function syncToProfile() {
  const p = activeProfile();
  p.data = { semesterStart: S.semesterStart, totalWeeks: S.totalWeeks, courses: S.courses, periods: S.periods };
}
function save() { syncToProfile(); localStorage.setItem(STORE_KEY, JSON.stringify(S)); }

/* 多课表管理 */
function switchProfile(id) {
  if (id === S.activeProfile) return;
  save();                                  // 先保存当前课表
  S.activeProfile = id;
  const p = activeProfile();
  S.semesterStart = p.data.semesterStart;
  S.totalWeeks = p.data.totalWeeks;
  S.courses = p.data.courses;
  S.periods = p.data.periods;
  save();
  render(); initSettings(); renderProfileList();
  toast('已切换到：' + p.name);
}
function newProfile(name) {
  save();
  const id = 'p' + Date.now();
  S.profiles.push({ id, name: name || '新课表', data: { semesterStart: S.semesterStart, totalWeeks: 20, courses: [], periods: S.periods.slice() } });
  S.activeProfile = id;
  S.courses = [];
  S.totalWeeks = 20;
  save(); render(); initSettings(); renderProfileList();
  toast('已新建课表：' + name);
}
function renameProfile(name) {
  const p = activeProfile();
  p.name = (name || '').trim() || p.name;
  save(); renderProfileList();
  toast('已重命名：' + p.name);
}
function deleteProfile(id) {
  if (S.profiles.length <= 1) { toast('至少保留一个课表'); return; }
  if (!confirm('确定删除课表？课程数据将丢失（其他课表不受影响）')) return;
  S.profiles = S.profiles.filter((p) => p.id !== id);
  if (S.activeProfile === id) {
    S.activeProfile = S.profiles[0].id;
    const p = activeProfile();
    S.semesterStart = p.data.semesterStart;
    S.totalWeeks = p.data.totalWeeks;
    S.courses = p.data.courses;
    S.periods = p.data.periods;
  }
  save(); render(); initSettings(); renderProfileList();
  toast('课表已删除');
}

let curWeek = todayWeek();
let curDay = todayDay();

function todayWeek() {
  const start = new Date(S.semesterStart + 'T00:00:00');
  const now = new Date();
  const diff = Math.floor((now - start) / 86400000);
  const w = Math.floor(diff / 7) + 1;
  return Math.max(1, Math.min(w, S.totalWeeks));
}
function todayDay() {
  return (new Date().getDay() + 6) % 7;
}
function weekStartDate(week) {
  const d = new Date(S.semesterStart + 'T00:00:00');
  d.setDate(d.getDate() + (week - 1) * 7);
  return d;
}
function fmtDate(d) { return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`; }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function pad(n) { return String(n).padStart(2, '0'); }
function icsDate(d) { return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`; }

function colorOf(name) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  // 黄金角分布：相邻课程色相拉开，避免撞色；低饱和+中亮度，观感柔和
  const hue = Math.round((h * 137.508) % 360);
  return `hsl(${hue}, 42%, 56%)`;
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 2200);
}

function weekContains(course, week) {
  if (!course.weeks || course.weeks.length === 0) return true;
  return course.weeks.includes(week);
}

/* ================= 课表渲染 ================= */
function render() {
  renderTopbar();
  renderGrid();
  $('#courseCount').textContent = `共 ${S.courses.length} 门课程`;
}

function renderTopbar() {
  const d = weekStartDate(curWeek);
  const today = new Date();
  const isCur = todayWeek() === curWeek;
  $('#weekTitle').textContent = isCur ? `第${curWeek}周 ${DAY_NAMES[todayDay()]}` : `第${curWeek}周(非本周)`;
  $('#dateTitle').textContent = isCur ? fmtDate(today) : `${fmtDate(d)} 起`;
}

function renderGrid() { buildGrid($('#grid'), curWeek); }

function buildGrid(grid, week) {
  grid.innerHTML = '';
  grid.style.width = '100%';
  grid.style.height = (44 + S.periods.length * 60) + 'px';

  // 左列节次
  const periods = S.periods;
  const rowH = 60;
  const periodW = 62;

  // 节次列（紧贴左缘，顶部 sticky 月份标识跟随表头，参考教务 App）
  const pcol = document.createElement('div');
  pcol.className = 'period-col';
  const mh = document.createElement('div');
  mh.className = 'period-head';
  mh.textContent = (weekStartDate(week).getMonth() + 1) + '月';
  pcol.appendChild(mh);
  periods.forEach((p, i) => {
    const c = document.createElement('div');
    c.className = 'period-cell';
    c.innerHTML = `<div class="pnum">${i + 1}</div><div class="ptime">${p[0]}</div><div class="ptime">${p[1]}</div>`;
    pcol.appendChild(c);
  });
  grid.appendChild(pcol);

  const start = weekStartDate(week);
  const isCurWeek = todayWeek() === week;

  // 7 列
  for (let d = 0; d < 7; d++) {
    const col = document.createElement('div');
    col.className = 'day-col' + (isCurWeek && d === todayDay() && S.highlightToday ? ' today' : '');
    col.style.height = (44 + periods.length * rowH) + 'px';
    col.dataset.day = d;

    // 表头
    const head = document.createElement('div');
    head.className = 'col-head' + (isCurWeek && d === todayDay() ? ' today' : '') + (d >= 5 ? ' weekend' : '');
    head.style.height = '44px';
    const dd = addDays(start, d);
    head.innerHTML = `<div class="dnum">${dd.getDate()}</div><div>${d >= 5 ? '周' + ['六','日'][d - 5] : DAY_NAMES[d]}</div>`;
    col.appendChild(head);

    // 背景行分隔线
    for (let i = 0; i < periods.length; i++) {
      const line = document.createElement('div');
      line.style.cssText = `position:absolute;left:0;right:0;top:${44 + (i + 1) * rowH - 1}px;height:1px;background:var(--line);`;
      col.appendChild(line);
    }

    // 课程块：同格（同节次段）多课程按组均分，避免重叠
    const courses = S.courses.filter((c) => c.day === d).sort((a, b) => a.start - b.start);
    const groups = {};
    for (const c of courses) {
      const k = c.start + '-' + c.end;
      (groups[k] = groups[k] || []).push(c);
    }
    for (const k in groups) {
      const arr = groups[k];
      const span = arr[0].end - arr[0].start + 1;
      // 段展开：segments（合并保留的分段）或单段
      const segsOf = (c) => (c.segments && c.segments.length
        ? c.segments
        : [{ weeks: c.weeks || [], weeksStr: c.weeksStr || '', location: c.location, teacher: c.teacher }]);
      // 命中段 = 当前查看周有课的段
      const hits = [];
      for (const c of arr) {
        for (const s of segsOf(c)) {
          if ((s.weeks || []).includes(week)) hits.push({ c, seg: s });
        }
      }
      let visible = null, showNonWeek = false;
      if (hits.length) {
        visible = hits;
      } else {
        // 无命中：只显示"未开始"的课（整课最早周 > 当前周），标 [非本周]；已结束/空洞隐藏
        const up = arr.filter((c) => (c.weeks || []).length && Math.min(...c.weeks) > week);
        if (up.length) { visible = up.map((c) => ({ c, seg: segsOf(c)[0] })); showNonWeek = true; }
      }
      if (!visible) continue;
      visible.forEach((v, i) => {
        const c = v.c, seg = v.seg;
        const block = document.createElement('div');
        block.className = 'course-block' + (showNonWeek ? ' offweek' : '');
        if (visible.length === 1) {
          block.style.top = (44 + (c.start - 1) * rowH + 3) + 'px';
          block.style.height = (span * rowH - 6) + 'px';
        } else {
          const segH = (span * rowH) / visible.length;
          block.style.top = (44 + (c.start - 1) * rowH + 3 + i * segH) + 'px';
          block.style.height = (segH - 6) + 'px';
        }
        block.style.background = colorOf(c.name);
        const tag = showNonWeek ? '<span class="cb-tag">[非本周]</span>' : '';
        let html = `<div class="cb-name">${tag}${escapeHtml(c.name)}</div>`;
        if (seg.location || seg.teacher) {
          const locLine = (seg.location ? '@' + escapeHtml(seg.location) : '') + (seg.teacher ? ' ' + escapeHtml(seg.teacher) : '');
          html += `<div class="cb-loc">${locLine}</div>`;
        }
        block.innerHTML = html;
        block.addEventListener('click', (e) => { e.stopPropagation(); openDetail(c.id); });
        col.appendChild(block);
      });
    }

    // 点空格添加
    col.addEventListener('click', (e) => {
      if (e.target.closest('.course-block')) return;
      const rect = col.getBoundingClientRect();
      const y = e.clientY - rect.top - 44;
      const idx = Math.floor(y / rowH);
      if (idx >= 0 && idx < periods.length) openEdit(null, d, idx + 1);
    });

    grid.appendChild(col);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

/* ================= 详情 / 编辑 ================= */
function courseById(id) { return S.courses.find((c) => c.id === id); }

function openDetail(id) {
  const c = courseById(id);
  if (!c) return;
  $('#detailColorbar').style.background = colorOf(c.name);
  $('#detailName').textContent = c.name;
  const weeksStr = c.weeksStr || (c.weeks && c.weeks.length ? weeksToStr(c.weeks) : '每周');
  const rows = [
    ['星期节次', `${DAY_NAMES[c.day]} 第${c.start}-${c.end}节`],
    ['周次', weeksStr],
    ['教室', c.location || '—'],
    ['教师', c.teacher || '—']
  ];
  if (c.note) rows.push(['备注', c.note]);
  $('#detailInfo').innerHTML = rows.map(([k, v]) => `<div><b>${k}</b>　${escapeHtml(v)}</div>`).join('');
  $('#detailMask').hidden = false;
  $('#btnDeleteCourse').onclick = () => { removeCourse(id); };
  $('#btnEditCourse').onclick = () => { $('#detailMask').hidden = true; openEdit(id); };
  $('#btnCloseDetail').onclick = () => { $('#detailMask').hidden = true; };
}

function weeksToStr(weeks) {
  const arr = [...weeks].sort((a, b) => a - b);
  const segs = [];
  let s = arr[0], p = arr[0];
  for (let i = 1; i <= arr.length; i++) {
    if (arr[i] === p + 1) { p = arr[i]; continue; }
    segs.push(s === p ? `${s}` : `${s}-${p}`);
    s = p = arr[i];
  }
  return segs.map((x) => x.includes('-') ? x + '周' : x + '周').join(',');
}

function openEdit(id, presetDay, presetStart) {
  const c = id != null ? courseById(id) : null;
  $('#editTitle').textContent = c ? '编辑课程' : '添加课程';
  $('#fName').value = c ? c.name : '';
  $('#fDay').value = c ? String(c.day) : String(presetDay != null ? presetDay : 0);
  fillPeriodOptions();
  $('#fStart').value = c ? String(c.start) : String(presetStart || 1);
  $('#fEnd').value = c ? String(c.end) : String(c ? c.start : (presetStart || 1) + 1);
  $('#fWeeks').value = c ? (c.weeksStr || weeksToStr(c.weeks || []) || '1-' + S.totalWeeks + '周') : '1-' + S.totalWeeks + '周';
  $('#fLocation').value = c ? (c.location || '') : '';
  $('#fTeacher').value = c ? (c.teacher || '') : '';
  $('#fNote').value = c ? (c.note || '') : '';
  $('#editMask').hidden = false;
  window._editId = id;
}

function fillPeriodOptions() {
  const opts = S.periods.map((_, i) => `<option value="${i + 1}">第${i + 1}节</option>`).join('');
  $('#fStart').innerHTML = opts;
  $('#fEnd').innerHTML = opts;
}

function saveCourse() {
  const name = $('#fName').value.trim();
  if (!name) { toast('请填写课程名称'); return; }
  const day = +$('#fDay').value;
  let start = +$('#fStart').value, end = +$('#fEnd').value;
  if (end < start) [start, end] = [end, start];
  const weeksStr = $('#fWeeks').value.trim();
  const weeks = weeksStr ? window.__kb_parser.parseWeeks(weeksStr) : [];
  const data = {
    name,
    day, start, end,
    weeksStr: weeksStr || '',
    weeks,
    location: $('#fLocation').value.trim(),
    teacher: $('#fTeacher').value.trim(),
    note: $('#fNote').value.trim()
  };
  if (window._editId != null) {
    const c = courseById(window._editId);
    if (c) Object.assign(c, data);
  } else {
    data.id = 'c' + Date.now() + Math.random().toString(36).slice(2, 6);
    S.courses.push(data);
  }
  save();
  $('#editMask').hidden = true;
  render();
  toast('已保存');
}

function removeCourse(id) {
  S.courses = S.courses.filter((c) => c.id !== id);
  save();
  $('#detailMask').hidden = true;
  render();
  toast('已删除');
}

/* ================= 导入流程 ================= */
function initImport() {
  const fi = $('#fileInput');
  $('#btnSingleAdd').addEventListener('click', () => openEdit(null));
  $('#btnBatchAdd').addEventListener('click', openBatch);
  $('#btnFileImport').addEventListener('click', () => fi.click());
  fi.addEventListener('change', () => { if (fi.files[0]) startImport(fi.files[0]); });
  $('#btnCloseBatch').addEventListener('click', () => { $('#batchMask').hidden = true; });
  $('#batchMask').addEventListener('click', (e) => { if (e.target === $('#batchMask')) $('#batchMask').hidden = true; });
  $('#batchText').addEventListener('input', renderBatchPreview);
  $('#btnBatchImport').addEventListener('click', doBatchImport);
}

function openBatch() {
  $('#batchText').value = '';
  $('#batchPreview').innerHTML = '';
  $('#batchPreview').style.display = 'none';
  $('#btnBatchImport').disabled = true;
  $('#btnBatchImport').textContent = '一键导入（0 条）';
  $('#batchMask').hidden = false;
  setTimeout(() => $('#batchText').focus(), 120);
}

function parseBatchLines(text) {
  const lines = (text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const items = [];
  for (const line of lines) {
    const c = window.__kb_parser.parseBatchLine(line);
    if (c && c.name) items.push({ line, course: c });
    else items.push({ line, course: null });
  }
  return items;
}

function renderBatchPreview() {
  const items = parseBatchLines($('#batchText').value);
  const ok = items.filter((i) => i.course && i.course.day != null);
  const noDay = items.filter((i) => i.course && i.course.day == null);
  const bad = items.filter((i) => !i.course);
  const btn = $('#btnBatchImport');
  const total = ok.length;
  btn.disabled = total === 0;
  btn.textContent = `一键导入（${total} 条）`;
  const pre = $('#batchPreview');
  pre.innerHTML = '';
  if (!items.length) { pre.style.display = 'none'; return; }
  pre.style.display = 'block';
  const lines = [];
  ok.slice(0, 8).forEach((i) => {
    const c = i.course;
    lines.push(`<div class="bp-row ok"><span class="bp-dot"></span>${escapeHtml(`${DAY_NAMES[c.day]} ${c.start}-${c.end}节 · ${c.name}`)}</div>`);
  });
  if (ok.length > 8) lines.push(`<div class="bp-more">…等共 ${ok.length} 条</div>`);
  if (noDay.length) lines.push(`<div class="bp-row warn">⚠ ${noDay.length} 条实践/无星期课程（${noDay.map((i) => i.course.name).join('、')}），将单独导入</div>`);
  if (bad.length) lines.push(`<div class="bp-row err">✗ ${bad.length} 行无法识别：${bad.map((i) => i.line).join('；')}</div>`);
  pre.innerHTML = lines.join('');
}

function doBatchImport() {
  const items = parseBatchLines($('#batchText').value);
  let n = 0, merged = 0, practice = 0;
  const practices = [];
  for (const i of items) {
    if (!i.course) continue;
    const c = i.course;
    if (c.day == null) {
      // 实践课程：记录到备注，不占课表格子
      practices.push(c);
      continue;
    }
    // 同格同名课程：合并周次/教室（教务常见分时段），保留分段配对
    const dup = S.courses.find((x) => x.day === c.day && x.start === c.start && x.end === c.end && x.name === c.name);
    if (dup) {
      if (!dup.segments) {
        // 旧格式数据（无分段信息）：直接用新数据覆盖，保证按周次分段显示
        dup.weeks = c.weeks || []; dup.weeksStr = c.weeksStr || '';
        dup.location = c.location; dup.teacher = c.teacher;
        dup.segments = [{ weeks: c.weeks || [], weeksStr: c.weeksStr || '', location: c.location, teacher: c.teacher }];
        n++;
        continue;
      }
      dup.segments.push({ weeks: c.weeks || [], weeksStr: c.weeksStr || '', location: c.location, teacher: c.teacher });
      const set = new Set([...(dup.weeks || []), ...(c.weeks || [])]);
      dup.weeks = [...set].sort((a, b) => a - b);
      dup.weeksStr = compressWeeks(dup.weeks) || dup.weeksStr;
      if (c.location && dup.location !== c.location) dup.location = dup.location ? dup.location + ' / ' + c.location : c.location;
      if (c.teacher && dup.teacher !== c.teacher) dup.teacher = dup.teacher ? dup.teacher + '、' + c.teacher : c.teacher;
      merged++;
      continue;
    }
    c.segments = [{ weeks: c.weeks || [], weeksStr: c.weeksStr || '', location: c.location, teacher: c.teacher }];
    S.courses.push(Object.assign({ id: 'c' + Date.now() + Math.random().toString(36).slice(2, 6) }, c));
    n++;
  }
  if (practices.length) {
    const p = S.courses.find((x) => x.name === '实践课程' && x.day == null);
    const note = practices.map((c) => `${c.name}(${c.weeksStr})·${c.teacher}`).join('；');
    if (p) p.note = p.note ? p.note + '；' + note : note;
    else S.courses.push({ id: 'c' + Date.now(), name: '实践课程', day: null, start: null, end: null, weeks: [], weeksStr: '', location: '', teacher: '', note, isPractice: true });
    practice = practices.length;
  }
  save();
  render();
  $('#batchMask').hidden = true;
  toast(`已导入 ${n} 条${merged ? `，合并 ${merged} 条同课` : ''}${practice ? `，实践课 ${practice} 条已记录` : ''}`);
}

// 周数组 → "1-8,9-10,14-15" 压缩字符串
function compressWeeks(weeks) {
  const sorted = [...(weeks || [])].sort((a, b) => a - b);
  if (!sorted.length) return '';
  const parts = [];
  let s = sorted[0], prev = sorted[0];
  for (let i = 1; i <= sorted.length; i++) {
    const w = sorted[i];
    if (w === prev + 1) { prev = w; continue; }
    parts.push(s === prev ? `${s}` : `${s}-${prev}`);
    if (i < sorted.length) { s = prev = w; }
  }
  return parts.join(',');
}

async function startImport(file) {
  const prog = $('#ocrProgress'), bar = $('#ocrBarInner'), st = $('#ocrStatus');
  prog.hidden = false;
  bar.style.width = '0%';
  $('#ocrResult').innerHTML = '';
  const pad = document.createElement('div');
  pad.style.padding = '8px'; pad.style.color = '#8a8f99'; pad.style.fontSize = '13px';
  pad.textContent = `正在解析「${file.name}」…`;
  $('#ocrResult').appendChild(pad);

  let statusOk = true;
  try {
    const courses = await Importer.importFile(
      file,
      (p) => { bar.style.width = p + '%'; st.textContent = `OCR 识别中 ${p}%`; },
      (pg, total) => { st.textContent = `第 ${pg}/${total} 页 OCR 识别中…`; }
    );
    st.textContent = `识别完成，共 ${courses.length} 条`;
    renderOcrCards(courses);
  } catch (err) {
    console.error(err);
    statusOk = false;
    st.textContent = '解析失败：' + err.message;
    toast('解析失败，请重试');
  }
  pad.remove();
}

function renderOcrCards(courses) {
  const box = $('#ocrResult');
  box.innerHTML = '';
  if (!courses.length) {
    box.innerHTML = '<div style="text-align:center;color:#8a8f99;padding:20px">未识别到课程，可尝试上传更清晰的图片</div>';
    return;
  }
  const imported = [];
  for (const c of courses) {
    const card = document.createElement('div');
    card.className = 'ocr-card';
    const weeksStr = c.weeksStr || (c.weeks && c.weeks.length ? weeksToStr(c.weeks) : '每周');
    const meta = `${DAY_NAMES[c.day]} ${c.start}-${c.end}节 · ${weeksStr} · ${c.location || '?'}${c.teacher ? ' · ' + c.teacher : ''}`;
    const dup = S.courses.some((x) => x.day === c.day && x.start === c.start && x.name === c.name);
    card.innerHTML = `
      <div class="oc-main">
        <div class="oc-name">${escapeHtml(c.name)}</div>
        <div class="oc-meta">${escapeHtml(meta)}</div>
      </div>
      <span class="oc-state ${dup ? 'fail' : 'ok'}">${dup ? '已存在' : '新课程'}</span>`;
    card.addEventListener('click', () => {
      openEdit(null, c.day, c.start);
      // 预填识别结果
      $('#fName').value = c.name;
      $('#fWeeks').value = c.weeksStr || weeksToStr(c.weeks) || '';
      $('#fLocation').value = c.location || '';
      $('#fTeacher').value = c.teacher || '';
      $('#fNote').value = c.note || '';
      $('#fStart').value = String(c.start);
      $('#fEnd').value = String(c.end);
    });
    box.appendChild(card);
    imported.push(c);
  }
  const btn = document.createElement('button');
  btn.className = 'btn-import-all';
  btn.textContent = `全部导入（${courses.length} 条）`;
  btn.onclick = () => {
    let n = 0;
    for (const c of courses) {
      const dup = S.courses.some((x) => x.day === c.day && x.start === c.start && x.name === c.name);
      if (dup) continue;
      S.courses.push(Object.assign({ id: 'c' + Date.now() + Math.random().toString(36).slice(2, 6) }, c));
      n++;
    }
    save();
    render();
    toast(`已导入 ${n} 条课程`);
  };
  box.appendChild(btn);
}

/* ================= 设置页 ================= */
// 预置课表（夏文 2026-2027-1 学期，已逐格核对）
const PRESET_TIMETABLE = [
  '周三 1-2节 1-8周 笃学A楼204(多) 陈国荣 机械设计',
  '周三 1-2节 9-10周,14-15周 笃学A楼308(多) 陈国荣 机械设计',
  '周四 1-2节 1-8周 笃学B楼205(多) 孙永艳 马克思主义基本原理',
  '周五 1-2节 9-10周 笃学A楼402(多) 南文光 工程流体力学',
  '周一 3-4节 1-8周 笃学B楼205(多) 孙永艳 马克思主义基本原理',
  '周一 3-4节 9-10周,14-15周 笃学B楼402(多) 姚桂焕 热工基础',
  '周二 3-4节 1-8周 笃学A楼407(多) 鹿盈盈 汽车构造-1',
  '周三 3-4节 1-8周,12-13周 笃学B楼202(多) 刘玉珍 习近平新时代中国特色社会主义思想概论',
  '周五 3-4节 1-8周,12-13周 同和楼211(多) 刘玉珍 习近平新时代中国特色社会主义思想概论',
  '周一 5-6节 1-8周 笃学C楼201(多) 康正阳 汽车构造-2',
  '周一 5-6节 14-15周 笃学B楼302(多) 刘海存 形势与政策',
  '周二 5-6节 5-8周 笃学B楼401(多) 孙永艳 马克思主义基本原理',
  '周四 5-6节 1-6周 笃学A楼605(多) 姚桂焕 热工基础',
  '周四 5-6节 7-10周 笃学B楼208(多) 姚桂焕 热工基础',
  '周四 5-6节 14-15周 笃学B楼205(多) 姚桂焕 热工基础',
  '周五 5-6节 1-8周 笃学A楼303(多) 鹿盈盈 汽车构造-1',
  '周一 7-8节 1-10周,14-15周 笃学A楼407(多) 南文光 工程流体力学',
  '周二 7-8节 1-10周,14-15周 笃学A楼207(多) 李磊 控制工程基础',
  '周四 7-8节 1-8周 笃学C楼201(多) 康正阳 汽车构造-2',
  '周四 7-8节 9-10周,14-15周 笃学C楼205(多) 李磊 控制工程基础',
  '周五 7-8节 1-10周,14-15周 笃学A楼505(多) 陈国荣 机械设计',
  '实践 生产实习 11-13周 齐新丹',
  '实践 机械设计课程设计 16-18周 陈国荣'
].join('\n');

function renderProfileList() {
  const box = $('#profileList');
  if (!box) return;
  box.innerHTML = '';
  S.profiles.forEach((p) => {
    const n = p.data.courses.length;
    const item = document.createElement('div');
    item.className = 'profile-item' + (p.id === S.activeProfile ? ' active' : '');
    item.innerHTML = `<span class="pi-name">${escapeHtml(p.name)}</span><span class="pi-count">${n} 门课</span>`;
    if (p.id !== S.activeProfile) {
      const sw = document.createElement('button');
      sw.className = 'btn mini';
      sw.textContent = '切换';
      sw.addEventListener('click', () => switchProfile(p.id));
      item.appendChild(sw);
    }
    const del = document.createElement('button');
    del.className = 'btn mini danger-mini';
    del.textContent = '删';
    del.addEventListener('click', () => deleteProfile(p.id));
    item.appendChild(del);
    box.appendChild(item);
  });
}

function initSettings() {
  $('#setSemesterStart').value = S.semesterStart;
  $('#setTotalWeeks').value = S.totalWeeks;
  $('#setShowNonWeek').checked = S.showNonWeek;
  $('#setHighlightToday').checked = S.highlightToday;

  $('#setSemesterStart').addEventListener('change', (e) => {
    if (e.target.value) { S.semesterStart = e.target.value; save(); render(); toast('学期已更新'); }
  });
  $('#setTotalWeeks').addEventListener('change', (e) => {
    const v = Math.max(1, Math.min(30, +e.target.value || 20));
    S.totalWeeks = v; save(); render();
  });
  $('#setShowNonWeek').addEventListener('change', (e) => { S.showNonWeek = e.target.checked; save(); render(); });
  $('#setHighlightToday').addEventListener('change', (e) => { S.highlightToday = e.target.checked; save(); render(); });

  renderPeriodEditor();
  $('#btnAddPeriod').addEventListener('click', () => {
    S.periods.push(['00:00', '00:00']);
    renderPeriodEditor();
    save();
  });

  $('#btnPreset').addEventListener('click', () => {
    if (!confirm('将清空当前课表并导入预置课表（夏文 2026-2027-1）？')) return;
    S.courses = [];
    $('#batchText').value = PRESET_TIMETABLE;
    doBatchImport();
  });
  $('#btnRenameProfile').addEventListener('click', () => {
    const name = $('#profileName').value || activeProfile().name;
    renameProfile(name);
  });
  $('#btnNewProfile').addEventListener('click', () => {
    const name = prompt('新建课表名称：', '新课表');
    if (name === null) return;
    newProfile(name.trim() || '新课表');
  });
  renderProfileList();
  const ap = activeProfile();
  if ($('#profileName')) $('#profileName').value = ap.name;
  $('#btnExportJson').addEventListener('click', downloadJson);
  $('#btnImportJson').addEventListener('click', () => $('#jsonInput').click());
  $('#jsonInput').addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const d = JSON.parse(r.result);
        if (!d || !Array.isArray(d.courses)) throw new Error('格式不正确');
        S.courses = d.courses;
        if (d.periods) S.periods = d.periods;
        if (d.semesterStart) S.semesterStart = d.semesterStart;
        if (d.totalWeeks) S.totalWeeks = d.totalWeeks;
        save(); render(); initSettings();
        toast('备份已恢复');
      } catch (err) { toast('导入失败：' + err.message); }
    };
    r.readAsText(f);
  });
  $('#btnExportIcs').addEventListener('click', exportICS);
  $('#btnClear').addEventListener('click', () => {
    if (confirm('确定清空全部课程？此操作不可恢复（可先导出备份）')) {
      S.courses = [];
      save(); render();
      toast('已清空');
    }
  });
}

function renderPeriodEditor() {
  const box = $('#periodEditor');
  box.innerHTML = '';
  S.periods.forEach((p, i) => {
    const row = document.createElement('div');
    row.className = 'period-row';
    row.innerHTML = `<span style="width:44px;color:#8a8f99;font-size:13px">第${i + 1}节</span>
      <input type="time" value="${p[0]}"><span>—</span><input type="time" value="${p[1]}">
      <button class="p-del">✕</button>`;
    const [a, b] = row.querySelectorAll('input');
    a.addEventListener('change', () => { S.periods[i][0] = a.value || '00:00'; save(); render(); });
    b.addEventListener('change', () => { S.periods[i][1] = b.value || '00:00'; save(); render(); });
    row.querySelector('.p-del').addEventListener('click', () => {
      if (S.periods.length <= 1) return;
      S.periods.splice(i, 1);
      renderPeriodEditor();
      save(); render();
    });
    box.appendChild(row);
  });
}

function downloadJson() {
  const blob = new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' });
  downloadBlob('课表备份.json', blob);
}

function exportICS() {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Kebiao//CN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  for (const c of S.courses) {
    const weeks = c.weeks && c.weeks.length ? c.weeks : Array.from({ length: S.totalWeeks }, (_, i) => i + 1);
    for (const w of weeks) {
      if (w < 1 || w > S.totalWeeks) continue;
      const date = addDays(new Date(S.semesterStart + 'T00:00:00'), (w - 1) * 7 + c.day);
      const s = S.periods[c.start - 1] || ['00:00', '00:00'];
      const e = S.periods[c.end - 1] || ['00:00', '00:00'];
      const ds = icsDate(date);
      lines.push('BEGIN:VEVENT');
      lines.push(`DTSTART;TZID=Asia/Shanghai:${ds}T${s[0].replace(':', '')}00`);
      lines.push(`DTEND;TZID=Asia/Shanghai:${ds}T${e[1].replace(':', '')}00`);
      lines.push(`SUMMARY:${c.name}`);
      if (c.location) lines.push(`LOCATION:${c.location}`);
      const desc = [c.teacher, c.note].filter(Boolean).join(' | ');
      if (desc) lines.push(`DESCRIPTION:${desc}`);
      lines.push('END:VEVENT');
    }
  }
  lines.push('END:VCALENDAR');
  downloadBlob('课表.ics', new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' }));
}

function downloadBlob(name, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/* ================= 导航 ================= */
// 手势状态（模块级，供 changeWeek 与事件共用）
let tX = 0, tY = 0, tOn = false, dragAxis = null, suppressClick = false, pendingSwitch = null;
let dragEl = null, dragDir = 0, velX = 0, lastMoveT = 0, lastMoveX = 0;
const gridEl = () => $('#grid');
const gridWrapEl = () => document.querySelector('.grid-wrap');
function cancelPending() { if (pendingSwitch) { clearTimeout(pendingSwitch); pendingSwitch = null; } }
function cleanupDrag() {
  if (dragEl) { dragEl.remove(); dragEl = null; dragDir = 0; }
  const g = gridEl();
  g.style.transition = '';
  g.style.transform = '';
  g.style.opacity = '';
}

function changeWeek(delta) {
  const nw = Math.max(1, Math.min(S.totalWeeks, curWeek + delta));
  if (nw === curWeek) return;
  cancelPending();
  cleanupDrag();
  const grid = $('#grid');
  grid.classList.add('grid-out');          // 旧课表快速淡出
  pendingSwitch = setTimeout(() => {
    pendingSwitch = null;
    curWeek = nw;
    curDay = todayDay();
    grid.style.transition = 'none';
    grid.style.transform = '';
    grid.classList.remove('grid-out');
    render();
    grid.classList.add('grid-zoom-in');    // 新课表缩放淡入（同"回到本周"）
    grid.addEventListener('animationend', () => grid.classList.remove('grid-zoom-in'), { once: true });
  }, 130);
}

function initNav() {
  $$('.tab').forEach((t) => {
    t.addEventListener('click', () => {
      $$('.tab').forEach((x) => x.classList.remove('active'));
      t.classList.add('active');
      $$('.page').forEach((p) => p.classList.remove('active'));
      $('#page-' + t.dataset.page).classList.add('active');
    });
  });
  $('#btnPrevWeek').addEventListener('click', () => changeWeek(-1));
  $('#btnNextWeek').addEventListener('click', () => changeWeek(1));
  $('#btnToday').addEventListener('click', () => {
    if (curWeek === todayWeek()) return;
    cancelPending();
    cleanupDrag();
    const g = gridEl();
    g.style.setProperty('--dir', todayWeek() > curWeek ? '30px' : '-30px');
    g.classList.add('grid-out');
    pendingSwitch = setTimeout(() => {
      pendingSwitch = null;
      curWeek = todayWeek();
      curDay = todayDay();
      g.style.transition = 'none';
      g.style.transform = '';
      g.classList.remove('grid-out');
      render();
      g.classList.add('grid-zoom-in');
      g.addEventListener('animationend', () => g.classList.remove('grid-zoom-in'), { once: true });
    }, 130);
  });
  $('#btnAdd').addEventListener('click', () => openEdit(null));
  $('#btnSaveCourse').addEventListener('click', saveCourse);
  $('#btnCancelEdit').addEventListener('click', () => { $('#editMask').hidden = true; });
  $('#detailMask').addEventListener('click', (e) => { if (e.target === $('#detailMask')) $('#detailMask').hidden = true; });
  $('#editMask').addEventListener('click', (e) => { if (e.target === $('#editMask')) $('#editMask').hidden = true; });

  // 手势：左右滑动切换周（1:1 跟手 + 叠化出场 + 连续滑动串行接管）
  const gw = gridWrapEl();
  gw.addEventListener('touchstart', (e) => {
    cancelPending();                       // 取消上次未完成的切换，立即接管
    const g = gridEl();
    g.classList.remove('grid-in');
    cleanupDrag();
    velX = 0; lastMoveX = 0; lastMoveT = 0;
    const t = e.touches[0];
    tX = t.clientX; tY = t.clientY; tOn = true; dragAxis = null;
  }, { passive: true });
  gw.addEventListener('touchmove', (e) => {
    if (!tOn) return;
    const t = e.touches[0];
    const dx = t.clientX - tX, dy = t.clientY - tY;
    if (dragAxis === null) {
      if (Math.abs(dx) > 10 || Math.abs(dy) > 10) dragAxis = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v';
    }
    if (dragAxis !== 'h') return;
    e.preventDefault();                       // 阻止浏览器水平滚动/返回手势
    const g = gridEl();
    const width = gw.clientWidth || 360;
    // 记录滑动速度（最后一段位移/时间，用于松手惯性）
    const now = performance.now();
    if (now - lastMoveT > 20) { velX = (dx - lastMoveX) / (now - lastMoveT); lastMoveX = dx; lastMoveT = now; }
    g.style.transition = 'none';
    g.style.transform = `translateX(${dx.toFixed(1)}px)`;
    g.style.opacity = String(Math.max(0.15, 1 - Math.abs(dx) / (width * 0.8)));  // 跟手滑动并逐渐变淡
    if (!dragEl) {
      const target = dx < 0 ? Math.min(S.totalWeeks, curWeek + 1) : Math.max(1, curWeek - 1);
      if (target !== curWeek) {
        dragDir = target - curWeek;
        dragEl = document.createElement('div');
        dragEl.className = 'grid drag-layer';
        buildGrid(dragEl, target);            // 预渲染目标周（一次性，仅 transform/opacity 动画，开销低）
        gw.appendChild(dragEl);
      }
    }
    if (dragEl) {
      dragEl.style.transition = 'none';
      dragEl.style.transform = `translateX(${(dx - dragDir * width).toFixed(1)}px)`;
      dragEl.style.opacity = String(Math.min(1, Math.abs(dx) / (width * 0.8) + 0.1));
    }
  }, { passive: false });
  gw.addEventListener('touchend', (e) => {
    if (!tOn) return;
    tOn = false;
    if (dragAxis !== 'h') return;
    const g = gridEl();
    const width = gw.clientWidth || 360;
    const t = e.changedTouches[0];
    const dx = t.clientX - tX;
    if (Math.abs(dx) > 55) {
      suppressClick = true;                     // 拖动后抑制误触点击
      const target = curWeek + (dx < 0 ? 1 : -1);
      if (target < 1 || target > S.totalWeeks) {
        // 已在首/末周：回弹
        g.style.transition = 'transform .25s cubic-bezier(.25,.1,.25,1), opacity .25s ease';
        g.style.transform = '';
        g.style.opacity = '';
        if (dragEl) { dragEl.remove(); dragEl = null; dragDir = 0; }
      } else {
        // 速度 + 位移双判据：快滑即使位移小也切换，惯性滑出更跟手
        const fast = Math.abs(velX) > 0.45;
        const dist = fast
          ? Math.min(Math.abs(velX) * 0.55 + Math.abs(dx) * 0.3, width * 0.92)
          : width * 0.45;
        const dirSign = dx < 0 ? -1 : 1;
        g.style.transition = 'transform .28s cubic-bezier(.25,.1,.25,1), opacity .28s ease';
        g.style.transform = `translateX(${(dirSign * dist).toFixed(0)}px)`;
        g.style.opacity = '0';                    // 划走的周：惯性滑出并淡出
        if (dragEl) {
          dragEl.style.transition = 'transform .28s cubic-bezier(.25,.1,.25,1), opacity .28s ease';
          dragEl.style.transform = 'translateX(0px)';
          dragEl.style.opacity = '1';             // 滑入的周：从同方向归位清晰
        }
        pendingSwitch = setTimeout(() => {
          pendingSwitch = null;
          curWeek = target;
          curDay = todayDay();
          const gg = gridEl();
          gg.style.transition = 'none';
          gg.style.transform = '';
          gg.style.opacity = '';
          if (dragEl) { dragEl.remove(); dragEl = null; dragDir = 0; }
          render();                               // 无缝重建新周（dragEl 已占据屏幕）
        }, 300);
      }
      setTimeout(() => { suppressClick = false; }, 450);
    } else {
      g.style.transition = 'transform .25s cubic-bezier(.25,.1,.25,1), opacity .25s ease';
      g.style.transform = '';
      g.style.opacity = '';
      if (dragEl) { dragEl.remove(); dragEl = null; dragDir = 0; }
    }
  }, { passive: true });
  gw.addEventListener('touchcancel', () => {
    if (tOn) { tOn = false; cleanupDrag(); }
  }, { passive: true });
  document.addEventListener('click', (e) => {
    if (suppressClick) { e.stopPropagation(); e.preventDefault(); suppressClick = false; }
  }, true);
}

/* ================= PWA ================= */
function initPWA() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js')
      .then((reg) => {
        // 每次打开主动检查更新；新版本接管后自动刷新一次，避免停留在旧版
        reg.update().catch(() => {});
        let refreshing = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (refreshing) return;
          refreshing = true;
          location.reload();
        });
      })
      .catch(() => {});
  }
}

/* ================= 启动 ================= */
document.addEventListener('DOMContentLoaded', () => {
  initNav();
  initImport();
  initSettings();
  render();
  initPWA();
});
