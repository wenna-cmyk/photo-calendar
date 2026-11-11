// 回診單 / 檢查通知單 解析規則
// parse(text, { now: Date, s2t: [simplifiedChars, traditionalChars], sessions: {am:'08:30', pm:'13:30', ev:'18:00'} })
(function (root) {
  const HAN = '\\u3400-\\u9fff';
  const WEEK = { '日': 0, '天': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6 };
  const BAD_DATE_CTX = /列印|印表|列表|開立|開單|出生|生日|製表|發票|有效|截止|列印日|印製/;
  const DATE_CTX = /預約|約診|看診|就診|回診|門診|日\s*期|預約日|檢查|檢驗|報到|手術|治療|施打|注射|領藥/;

  let S2T = null;
  function setS2T(pair) { if (!pair) return; S2T = {}; for (let i = 0; i < pair[0].length; i++) S2T[pair[0][i]] = pair[1][i]; }

  function normalize(text) {
    let t = String(text || '');
    // full-width ASCII → half-width
    t = t.replace(/[！-～]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xfee0)).replace(/　/g, ' ');
    if (S2T) t = t.replace(/[㐀-鿿]/g, ch => S2T[ch] || ch);
    // common OCR confusions in labels / values
    t = t.replace(/[﹕︰∶]/g, ':')
      .replace(/上[年牛干]/g, '上午').replace(/下[年牛干]/g, '下午')
      .replace(/(\d)\s*號/g, '$1號')
      .replace(/[遇過]([一二三四五六日天])/g, '週$1')
      .replace(/醫\s+師/g, '醫師').replace(/科\s+別/g, '科別').replace(/地\s+點/g, '地點').replace(/姓\s+名/g, '姓名');
    return t.split(/\r?\n/).map(l => l.replace(/[ \t]+/g, ' ').trim()).filter(Boolean);
  }

  function pad(n) { return String(n).padStart(2, '0'); }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }

  function findWeekday(s) {
    const m = s.match(/(?:星期|週|周|禮拜)\s*([一二三四五六日天])|[(（]\s*([一二三四五六日])\s*[)）]/);
    return m ? WEEK[m[1] || m[2]] : null;
  }

  function findDates(lines, now) {
    const out = [];
    lines.forEach((line, i) => {
      const re = /(民國)?\s*(\d{2,4})\s*[年\/\.\-]\s*(\d{1,2})\s*[月\/\.\-]\s*(\d{1,2})(?!\d)\s*日?/g;
      let m;
      while ((m = re.exec(line))) {
        let y = +m[2]; const mo = +m[3], d = +m[4];
        if (m[2].length === 4 && y < 1990) continue;
        if (y < 200) y += 1911;
        if (y < 2000 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) continue;
        const dt = new Date(y, mo - 1, d);
        if (dt.getMonth() !== mo - 1) continue;
        out.push(score({ date: dt, line, i, idx: m.index, len: m[0].length, roc: !!m[1] || m[2].length <= 3 }));
      }
      // 月日 without year
      const re2 = /(?:^|[^\d\/年])(\d{1,2})\s*月\s*(\d{1,2})\s*日/g;
      while ((m = re2.exec(line))) {
        if (/\d\s*年\s*$/.test(line.slice(0, m.index + 1))) continue;
        const mo = +m[1], d = +m[2];
        if (mo < 1 || mo > 12 || d < 1 || d > 31) continue;
        let dt = new Date(now.getFullYear(), mo - 1, d);
        if (dt < new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30)) dt = new Date(now.getFullYear() + 1, mo - 1, d);
        out.push(score({ date: dt, line, i, idx: m.index, len: m[0].length, noYear: true }, -1));
      }
    });
    function score(c, base) {
      let s = base || 0;
      const ctx = c.line.slice(0, c.idx + c.len + 12);
      if (DATE_CTX.test(ctx)) s += 3;
      if (BAD_DATE_CTX.test(ctx)) s -= 6;
      const wd = findWeekday(c.line.slice(c.idx)) ?? (lines[c.i + 1] ? findWeekday(lines[c.i + 1]) : null);
      if (wd !== null) { s += wd === c.date.getDay() ? 4 : -1; c.weekdayOk = wd === c.date.getDay(); }
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      if (c.date >= today) s += 1;
      c.score = s;
      return c;
    }
    // de-duplicate same date, keep best score
    const map = {};
    for (const c of out) { const k = ymd(c.date); if (!map[k] || map[k].score < c.score) map[k] = c; }
    return Object.values(map).sort((a, b) => b.score - a.score || a.i - b.i);
  }

  function findTimes(lines) {
    const out = [];
    lines.forEach((line, i) => {
      const re = /(上午|下午|晚上|中午|早上)?\s*(\d{1,2})\s*[:：]\s*(\d{2})(?:\s*[:：]\s*\d{2})?/g;
      let m;
      while ((m = re.exec(line))) {
        let h = +m[2]; const mi = +m[3];
        if (h > 23 || mi > 59) continue;
        if ((m[1] === '下午' || m[1] === '晚上') && h < 12) h += 12;
        out.push(classify({ h, m: mi, line, i, idx: m.index }));
      }
      const re2 = /(上午|下午|晚上|中午|早上)?\s*(\d{1,2})\s*[點点時时]\s*(?:(\d{1,2})\s*分|半)?/g;
      while ((m = re2.exec(line))) {
        if (/[時时]\s*$/.test(m[0]) && !m[3]) continue; // avoid "8小時" style
        let h = +m[2]; const mi = m[0].includes('半') ? 30 : (+m[3] || 0);
        if (h > 23 || mi > 59) continue;
        if ((m[1] === '下午' || m[1] === '晚上') && h < 12) h += 12;
        out.push(classify({ h, m: mi, line, i, idx: m.index }));
      }
    });
    function classify(t) {
      const before = t.line.slice(0, t.idx);
      t.kind = /預估|估計|約\s*$|以前|之前/.test(t.line.slice(Math.max(0, t.idx - 12), t.idx + 14)) ? 'estimate'
        : /報到/.test(before) ? 'checkin'
        : /預約時間|看診時間|檢查時間|時\s*間|預約|約診/.test(before) ? 'explicit' : 'other';
      if (/禁食|空腹|禁水|前一天|前一晚|小時前/.test(t.line)) t.kind = 'other-fasting';
      return t;
    }
    return out;
  }

  function findSession(lines) {
    const txt = lines.join('\n');
    if (/上午|早上|早診|晨間/.test(txt)) return 'am';
    if (/下午|午診/.test(txt)) return 'pm';
    if (/晚上|夜診|晚診|夜間門診/.test(txt)) return 'ev';
    return null;
  }

  function cleanName(s) { return (s || '').replace(/醫師$|醫$|主任$|教授$/, ''); }

  function first(lines, re, pick) {
    for (const l of lines) { const m = l.match(re); if (m) { const v = pick ? pick(m) : m[1]; if (v) return v.trim(); } }
    return '';
  }

  function findHospital(lines) {
    const cands = [];
    lines.forEach((l, i) => {
      let s = l.replace(/^.*法人/, '').replace(/醫療院所\s*[:]?/g, ' ');
      const re = new RegExp('([' + HAN + ']{2,14}?(?:醫學中心|醫院|診所|衛生所|分院))', 'g');
      let m;
      while ((m = re.exec(s))) {
        let v = m[1].replace(/^(?:請至|請到|至|到|於|本|貴|回|在)/, '');
        if (v.length < 3 || /^(?:本院|貴院|醫院|診所)$/.test(v)) continue;
        cands.push({ v, i, score: (v.endsWith('醫院') || v.endsWith('醫學中心') ? 2 : 1) - i * 0.1 + Math.min(v.length, 8) * 0.05 });
      }
    });
    cands.sort((a, b) => b.score - a.score);
    return cands.length ? cands[0].v : '';
  }

  const EXAM_WORDS = '超音波|胃鏡|大腸鏡|內視鏡|電腦斷層|斷層掃描|核磁共振|磁振造影|X光|心電圖|心臟超音波|抽血|骨密度|乳房攝影|子宮頸抹片|肺功能|聽力|眼底|運動心電圖|骨骼掃描|正子|PET|CT|MRI|健康檢查|健檢|尿液';

  function parse(text, opts) {
    opts = opts || {};
    const now = opts.now || new Date();
    if (opts.s2t && !S2T) setS2T(opts.s2t);
    const sessions = Object.assign({ am: '08:30', pm: '13:30', ev: '18:00' }, opts.sessions || {});
    const lines = normalize(text);
    const all = lines.join('\n');

    const examScore = (all.match(new RegExp('檢查|檢驗|報到|' + EXAM_WORDS, 'g')) || []).length;
    const visitScore = (all.match(/回診|門診|掛號|看診|診間|科別|醫師|序號|領藥/g) || []).length;
    const type = examScore > visitScore ? 'exam' : 'visit';

    const dates = findDates(lines, now);
    const times = findTimes(lines);
    const session = findSession(lines);

    const dept = first(lines, new RegExp('科\\s*別\\s*[:]?\\s*(?:\\d+\\s*)?([' + HAN + ']{1,8}?科)'))
      || first(lines, new RegExp('(?:^|[^' + HAN + '])([' + HAN + ']{1,6}科)(?![別' + HAN + '])'), m => /^(預約|科)/.test(m[1]) ? '' : m[1]);
    const doctor = cleanName(first(lines, new RegExp('醫師\\s*[:]?\\s*([' + HAN + ']{2,4})'), m => /^(之|的|姓名|代號)/.test(m[1]) ? '' : m[1]));
    const room = first(lines, /(?:診間|約間|診室|診別)\s*[:]?\s*([A-Za-z]?\d{1,4})/)
      || first(lines, /(?:^|[^\d])([A-Za-z]?\d{1,4})\s*診(?!號|斷|療|所)/);
    let number = first(lines, /(?:看診號|看診序號|序號|號碼|燈號)\s*[:]?\s*(\d{1,4})(?!\d)/, m => /病歷|身分|電話/.test(m.input) ? '' : m[1]);
    if (!number) number = first(lines, /(?:^|[^\d\-])(\d{1,4})\s*號(?![碼專])/, m => /病歷|病例|身分|電話|專線|分機|健保|總機/.test(m.input) ? '' : m[1]);
    const hospital = findHospital(lines);
    const place = first(lines, /(?:診間位置|檢查地點|報到地點|報到處|地點|位置)\s*[:]?\s*(.+)/).replace(/\s*\d{1,4}號$/, '');
    const address = first(lines, /(?:院所地址|地址)\s*[:]?\s*(.+)/);
    const remark = first(lines, /備\s*註?\s*[:]\s*(.+)/);
    let examItem = first(lines, /(?:檢查項目|檢查名稱|檢查名目|檢查類別|預約項目)\s*[:]?\s*([^:，,。]{2,24})/);
    if (!examItem && type === 'exam') examItem = first(lines, new RegExp('([' + HAN + 'A-Za-z]{0,6}(?:' + EXAM_WORDS + ')[' + HAN + 'A-Za-z()（）]{0,6})'));
    examItem = examItem.replace(/\s+/g, ' ').replace(/(?:通知單|通知|預約單|單)$/, '').trim();
    const fastingLine = lines.find(l => /空腹|禁食|禁水/.test(l)) || '';

    // choose time
    const pickTime = k => times.find(t => t.kind === k);
    let time = null, timeSource = '';
    const ck = pickTime('checkin'), ex = pickTime('explicit'), es = pickTime('estimate');
    if (ck) { time = ck; timeSource = 'checkin'; }
    else if (ex) { time = ex; timeSource = 'explicit'; }
    else if (es) { time = es; timeSource = 'estimate'; }
    else if (pickTime('other')) { time = pickTime('other'); timeSource = 'other'; }
    else if (session) { const [h, m] = sessions[session].split(':').map(Number); time = { h, m }; timeSource = 'session'; }

    const sessionLabel = (type === 'exam' ? { am: '上午', pm: '下午', ev: '晚上' } : { am: '上午診', pm: '下午診', ev: '夜診' })[session] || '';
    let title;
    if (type === 'exam') title = '檢查｜' + (examItem || hospital || '醫院檢查') + (fastingLine ? '（需空腹）' : '');
    else title = '回診｜' + ([dept, doctor].filter(Boolean).join(' ') || hospital || '門診') + (number ? ' ' + number + '號' : '');

    const notes = [];
    if (hospital) notes.push('醫院：' + hospital);
    if (type === 'exam' && examItem) notes.push('檢查項目：' + examItem);
    if (dept) notes.push('科別：' + dept);
    if (doctor) notes.push('醫師：' + doctor);
    if (sessionLabel) notes.push('時段：' + sessionLabel);
    if (room) notes.push('診間：' + room);
    if (number) notes.push('看診號：' + number + '號');
    if (es) notes.push('預估到診時間：' + pad(es.h) + ':' + pad(es.m) + '（僅供參考）');
    if (ck && ex && ex !== ck) notes.push('檢查時間：' + pad(ex.h) + ':' + pad(ex.m));
    if (fastingLine) notes.push('注意：' + fastingLine.replace(/^注意事項\s*[:]?\s*/, ''));
    if (remark) notes.push('備註：' + remark);

    let location = hospital;
    const detail = place || address;
    if (detail && !location.includes(detail)) location = [hospital, detail].filter(Boolean).join(' ');

    return {
      type,
      title,
      date: dates[0] ? ymd(dates[0].date) : '',
      dateCandidates: dates.slice(0, 4).map(d => ymd(d.date)),
      time: time ? pad(time.h) + ':' + pad(time.m) : '',
      timeSource,
      session,
      hospital, dept, doctor, room, number, examItem,
      location,
      notes: notes.join('\n'),
      fasting: !!fastingLine,
      lines,
    };
  }

  const api = { parse, normalize, setS2T };
  if (typeof module !== 'undefined') module.exports = api; else root.SlipParser = api;
})(typeof self !== 'undefined' ? self : this);
