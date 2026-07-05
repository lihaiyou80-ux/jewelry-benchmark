// ==== Global ====
let DATA = null;
let DROP_INDEX = null;
let CURRENT_CLIENT = null;
let CUSTOM_BENCHMARKS = [];

const COL_COLORS = {
  self: { bg: '#EEF5FF', border: '#1F4E79', text: '#1F4E79', tag: '#1F4E79' },
  top1: { bg: '#FFF3E0', border: '#E67E22', text: '#B8621A', tag: '#E67E22' },
  top2: { bg: '#F3E5F5', border: '#8E44AD', text: '#6B2E8A', tag: '#8E44AD' },
  top3: { bg: '#E8F5E9', border: '#2E7D32', text: '#1B5E20', tag: '#2E7D32' },
  custom: { bg: '#ECEFF1', border: '#546E7A', text: '#37474F', tag: '#546E7A' },
};

// ==== Decryption ====
function b64ToBytes(s) {
  const bin = atob(s);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

async function deriveKey(password, salt, iterations) {
  const enc = new TextEncoder();
  const keyMat = await crypto.subtle.importKey(
    'raw', enc.encode(password), { name: 'PBKDF2' }, false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMat,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );
}

async function decryptPayload(payload, password) {
  const salt = b64ToBytes(payload.salt);
  const iv = b64ToBytes(payload.iv);
  const ct = b64ToBytes(payload.ct);
  const key = await deriveKey(password, salt, payload.iter);
  const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  const text = new TextDecoder().decode(plainBuf);
  return JSON.parse(text);
}

async function unlock(password) {
  const [dataEnc, idxEnc] = await Promise.all([
    fetch('data.enc').then(r => { if (!r.ok) throw new Error('data.enc 加载失败'); return r.json(); }),
    fetch('drop_charts_index.enc').then(r => r.ok ? r.json() : null).catch(() => null),
  ]);
  DATA = await decryptPayload(dataEnc, password);
  DROP_INDEX = idxEnc ? await decryptPayload(idxEnc, password) : {};

  const meta = DATA.meta;
  document.getElementById('meta-info').textContent =
    `数据窗口 ${meta.date_range[0]} ~ ${meta.date_range[1]}  |  ${meta.total_clients} 个标品视频号  ·  ${meta.categories.length} 个品类`;

  // 保存口令到 sessionStorage
  sessionStorage.setItem('site_pwd', password);
  document.getElementById('lock-screen').classList.add('hidden');
}

// 首次加载：检查是否有口令缓存
(async function bootstrap() {
  const cached = sessionStorage.getItem('site_pwd');
  if (cached) {
    try {
      await unlock(cached);
      return;
    } catch (e) {
      sessionStorage.removeItem('site_pwd');
    }
  }
})();

// 解锁按钮
document.getElementById('lock-btn').addEventListener('click', async () => {
  const pwd = document.getElementById('lock-input').value.trim();
  const errBox = document.getElementById('lock-err');
  errBox.textContent = '';
  if (!pwd) { errBox.textContent = '请输入口令'; return; }
  document.getElementById('lock-btn').disabled = true;
  document.getElementById('lock-btn').textContent = '解锁中…';
  try {
    await unlock(pwd);
  } catch (e) {
    errBox.textContent = '口令错误，请重试';
    document.getElementById('lock-input').value = '';
    document.getElementById('lock-input').focus();
  } finally {
    document.getElementById('lock-btn').disabled = false;
    document.getElementById('lock-btn').textContent = '解锁';
  }
});
document.getElementById('lock-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('lock-btn').click();
});

// ==== Search ====
const searchInput = document.getElementById('search-input');
const searchBtn = document.getElementById('search-btn');
const emptyHint = document.getElementById('empty-hint');
searchBtn.addEventListener('click', doSearch);
searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });

function doSearch() {
  const q = searchInput.value.trim();
  emptyHint.textContent = '';
  emptyHint.className = 'empty-hint';
  if (!DATA) { showHint('数据尚未加载完成', 'error'); return; }
  if (!q) { showHint('请输入视频号名称', 'error'); return; }
  const c = DATA.clients[q];
  if (!c) {
    showHint(`未查询到「${q}」，请核对完整的视频号名称后重试（本系统仅覆盖标品视频号）`, 'error');
    document.getElementById('result').classList.add('hidden');
    document.getElementById('empty-state').classList.remove('hidden');
    return;
  }
  selectClient(q);
}
function showHint(text, level) {
  emptyHint.textContent = text;
  emptyHint.className = 'empty-hint ' + (level || '');
}

function selectClient(name) {
  CURRENT_CLIENT = DATA.clients[name];
  if (!CURRENT_CLIENT) return;
  searchInput.value = name;
  CUSTOM_BENCHMARKS = [];  // 重置自定义
  document.querySelectorAll('.bm-check').forEach(cb => cb.checked = cb.value === 'top1');
  document.getElementById('empty-state').classList.add('hidden');
  document.getElementById('result').classList.remove('hidden');
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ==== Benchmark picker ====
document.querySelectorAll('.bm-check').forEach(cb => {
  cb.addEventListener('change', () => { if (CURRENT_CLIENT) render(); });
});
document.getElementById('custom-bm-btn').addEventListener('click', addCustomBenchmark);
document.getElementById('custom-bm-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') addCustomBenchmark();
});

function addCustomBenchmark() {
  const q = document.getElementById('custom-bm-input').value.trim();
  if (!q || !CURRENT_CLIENT) return;
  if (q === CURRENT_CLIENT['视频号名称']) { alert('不能选自己作为对标'); return; }
  const c = DATA.clients[q];
  if (!c) { alert(`未查询到「${q}」，请核对完整名称`); return; }
  if (CUSTOM_BENCHMARKS.includes(q)) { alert('已添加过该对标对象'); return; }
  if (CUSTOM_BENCHMARKS.length >= 3) { alert('最多添加 3 个自定义对标'); return; }
  CUSTOM_BENCHMARKS.push(q);
  document.getElementById('custom-bm-input').value = '';
  render();
}
function removeCustomBenchmark(name) {
  CUSTOM_BENCHMARKS = CUSTOM_BENCHMARKS.filter(x => x !== name);
  render();
}

// ==== Build columns ====
// 返回列数组：[{key, label, tag, data, color}]
function buildColumns() {
  const client = CURRENT_CLIENT;
  const cat = client['品类'];
  const catData = DATA.categories[cat];
  const cols = [{
    key: 'self',
    label: '本客户',
    tag: `${client['视频号名称']}（#${client['品类内排名']}）`,
    data: client,
    color: COL_COLORS.self,
  }];
  document.querySelectorAll('.bm-check').forEach(cb => {
    if (cb.checked) {
      const rank = cb.value; // 'top1' / 'top2' / 'top3'
      const bm = catData[rank];
      if (bm && bm['视频号名称'] !== client['视频号名称']) {
        const num = rank === 'top1' ? 1 : rank === 'top2' ? 2 : 3;
        cols.push({
          key: rank,
          label: `品类 TOP${num}`,
          tag: `${cat} · TOP${num}（匿名）`,
          data: bm,
          color: COL_COLORS[rank],
        });
      }
    }
  });
  CUSTOM_BENCHMARKS.forEach((name, i) => {
    const c = DATA.clients[name];
    if (c) {
      cols.push({
        key: 'custom_' + i,
        label: name,
        tag: `自选 · ${c['品类']} 品类`,
        data: c,
        color: COL_COLORS.custom,
        removable: true,
        removeName: name,
      });
    }
  });
  return cols;
}

// ==== Formatters ====
function fmt(v, type='auto', digits=1) {
  if (v == null || Number.isNaN(v)) return '—';
  if (type === 'pct') return v.toFixed(digits) + '%';
  if (type === 'int') return Math.round(v).toLocaleString();
  if (type === 'sec') return v.toFixed(1) + 's';
  if (typeof v === 'number') return v.toFixed(digits);
  return String(v);
}

// 出价"高/低"标签
function bidTag(mine, base) {
  if (mine == null || base == null || base === 0) return { text: '—', cls: 'neutral' };
  const diff = (mine - base) / base;
  if (Math.abs(diff) < 0.05) return { text: '≈ 基准', cls: 'neutral' };
  return diff > 0
    ? { text: `高（+${(diff*100).toFixed(0)}%）`, cls: 'better' }
    : { text: `低（${(diff*100).toFixed(0)}%）`, cls: 'worse' };
}

// 对比数值
function diffTag(mine, base, higherBetter=true) {
  if (mine == null || base == null || base === 0) return null;
  const diff = (mine - base) / base * 100;
  const abs = Math.abs(diff);
  if (abs < 5) return { text: '≈', cls: 'neutral' };
  const better = higherBetter ? diff > 0 : diff < 0;
  const arrow = diff > 0 ? '↑' : '↓';
  return { text: `${arrow}${abs.toFixed(0)}%`, cls: better ? 'better' : 'worse' };
}

// ==== Render main ====
function render() {
  const client = CURRENT_CLIENT;
  const cat = client['品类'];
  const catData = DATA.categories[cat];

  document.getElementById('client-name').textContent = client['视频号名称'];
  document.getElementById('client-cat').textContent = cat + ' 品类';
  document.getElementById('client-rank').textContent = `品类内排名 #${client['品类内排名']} / 共 ${catData.total_count} 个视频号`;

  // 渲染自定义 tag
  const tagsBox = document.getElementById('custom-bm-tags');
  tagsBox.innerHTML = CUSTOM_BENCHMARKS.map(n =>
    `<span class="custom-tag"><span>${n}</span><button onclick="removeCustomBenchmark('${escStr(n)}')">×</button></span>`
  ).join('');

  const cols = buildColumns();

  // 一句话总结 + 核心归因
  renderSummary(client);

  // ① 诊断
  renderDiagnosis(cols);

  // ② 基础基建
  renderCompareTable('table-basic', cols, [
    { label: '投放账户数', type: 'metric', key: '有消耗的账户数', fmt: 'int', higherBetter: true },
    { label: '账户均广告数', type: 'metric', key: '账户平均广告数(个)', fmt: 'float1', higherBetter: true },
    { label: '广告均创意指纹数', type: 'metric', key: '广告均创意指纹数', fmt: 'float1', higherBetter: true },
    { label: '浅层出价（相对基准）', type: 'bid', key: '浅层目标出价(扣费类型加权)(元)' },
    { label: '日均新广告数', type: 'metric', key: '日均新广告数', fmt: 'float1', higherBetter: true },
    { label: '日均曝光唯一 ID 数', type: 'metric', key: '日均曝光唯一ID数', fmt: 'int', higherBetter: true },
    { label: '广告冷启动成功率', type: 'metric', key: '广告冷启动成功率(%)', fmt: 'pct1', higherBetter: true },
    { label: '下单 ROI', type: 'metric', key: '下单ROI', fmt: 'float2', higherBetter: true },
  ]);

  // ③ 产品
  renderCompareTable('table-product', cols, [
    { label: '全域通', type: 'bool_pct', boolKey: '是否开启全域通', pctKey: '全域通占比%' },
    { label: '小店链路', type: 'bool_pct', boolKey: '是否开启小店', pctKey: '小店占比%' },
    { label: '一键起量占比', type: 'metric', key: '天一键起量使用广告占比(%)', fmt: 'pct1', higherBetter: true },
    { label: '3.0MAX 开启率', type: 'metric', key: '3.0MAX开启率%', fmt: 'pct1', higherBetter: true },
    { label: '直播种草人群探索', type: 'bool_pct', boolKey: '是否开启种草', pctKey: '种草占比%' },
    { label: '4+M（多品/单品）', type: 'text_pct', textKey: '4M使用情况', pctKey: '4M占比%' },
  ]);

  // ④ 投放目标 & 智投 TOP3
  renderTargetTable('table-target', cols);

  // ⑤ 内容力
  renderCompareTable('table-content', cols, [
    { label: 'CTR（点击率）', type: 'metric', key: 'ctr(%)', fmt: 'pct2', higherBetter: true },
    { label: '平均播放时长', type: 'metric', key: '平均播放时长', fmt: 'sec', higherBetter: true },
    { label: '进播率', type: 'metric', key: '直播漏斗进播率(%)', fmt: 'pct2', higherBetter: true },
    { label: '商品点击率', type: 'metric', key: '直播漏斗商品点击率(%)', fmt: 'pct1', higherBetter: true },
    { label: '下单率', type: 'metric', key: '直播漏斗下单率(%)', fmt: 'pct1', higherBetter: true },
  ]);

  // ⑥ 趋势诊断
  renderTrendBlock(cols);

  // ⑦ 前后期指标对比表
  renderPhaseTable(client);
}

// ==== 一句话总结 + 核心归因 ====
function renderSummary(client) {
  const container = document.getElementById('summary-block');
  const drop = client.drop_info;
  if (!drop || !drop.metrics) {
    container.innerHTML = '';
    container.classList.add('hidden');
    return;
  }
  container.classList.remove('hidden');

  const chg = drop.chg_pct;
  const m = drop.metrics;

  // 计算各因子变化
  const factors = computeFactors(m);

  // 一句话总结
  const oneLiner = buildOneLiner(chg, factors, m);
  // 核心归因
  const causes = buildCauses(chg, factors, m);
  // 建议
  const suggestions = buildSuggestions(chg, factors);

  const trendClass = chg <= -30 ? 'summary-bad'
    : chg <= -15 ? 'summary-warn'
    : chg >= 15 ? 'summary-good'
    : 'summary-neutral';

  container.innerHTML = `
    <div class="summary-oneliner ${trendClass}">
      <span class="summary-tag">一句话总结</span>
      <span class="summary-text">${oneLiner}</span>
    </div>
    <div class="summary-body">
      <div class="summary-col">
        <div class="summary-subtitle">🔍 核心归因（对比近 7 日 vs 前 7 日）</div>
        ${causes.length === 0
          ? '<div class="summary-cause neutral"><span>👌 各项指标稳定，未发现明显异常波动</span></div>'
          : causes.map(c => `<div class="summary-cause ${c.level}"><span class="cause-num">${c.rank}</span><span class="cause-text">${c.text}</span></div>`).join('')
        }
      </div>
      <div class="summary-col">
        <div class="summary-subtitle">💡 建议</div>
        ${suggestions.length === 0
          ? '<div class="summary-sug"><span>保持当前节奏，可对照上方基建差距进一步优化。</span></div>'
          : suggestions.map(s => `<div class="summary-sug"><span class="sug-icon">✓</span><span>${s}</span></div>`).join('')
        }
      </div>
    </div>
  `;
}

// 计算各指标前后期变化率
function computeFactors(m) {
  const f = {};
  Object.keys(m).forEach(k => {
    const v = m[k];
    if (v.early == null || v.late == null || v.early === 0) {
      f[k] = { chg: null, early: v.early, late: v.late, unit: v.unit };
    } else {
      f[k] = {
        chg: (v.late - v.early) / v.early * 100,
        early: v.early,
        late: v.late,
        unit: v.unit
      };
    }
  });
  return f;
}

// 构造一句话总结
function buildOneLiner(chg, f, m) {
  const costPart = chg <= -30 ? `日耗<b>断崖式下跌 ${Math.abs(chg).toFixed(1)}%</b>`
    : chg <= -15 ? `日耗<b>下降 ${Math.abs(chg).toFixed(1)}%</b>`
    : chg <= -5 ? `日耗<b>小幅下降 ${Math.abs(chg).toFixed(1)}%</b>`
    : chg >= 30 ? `日耗<b>大幅上涨 +${chg.toFixed(1)}%</b>`
    : chg >= 15 ? `日耗<b>上涨 +${chg.toFixed(1)}%</b>`
    : chg >= 5 ? `日耗<b>小幅上涨 +${chg.toFixed(1)}%</b>`
    : `日耗<b>基本稳定（${chg >= 0 ? '+' : ''}${chg.toFixed(1)}%）</b>`;

  // 找主因（变化率绝对值最大的可解释因子）
  const roi = f['ROI'];
  const ctr = f['CTR'];
  const cpm = f['CPM'];
  const cold = f['冷启动成功率'];
  const yjql = f['一键起量占比'];
  const acc = f['有消耗账户数'];
  const ad = f['广告数'];

  let causeStem = '';
  if (chg <= -15) {
    // 掉量：找最负的驱动因子
    const candidates = [];
    if (ctr && ctr.chg != null && ctr.chg <= -15) candidates.push({ name: 'CTR', chg: ctr.chg, weight: 3 });
    if (cold && cold.chg != null && cold.chg <= -30) candidates.push({ name: '冷启动成功率', chg: cold.chg, weight: 3 });
    if (cpm && cpm.chg != null && cpm.chg >= 15) candidates.push({ name: 'CPM', chg: cpm.chg, weight: 2, direction: 'up' });
    if (yjql && yjql.late != null && yjql.late < 1 && yjql.early != null && yjql.early >= 2) candidates.push({ name: '一键起量', chg: yjql.chg, weight: 2, direction: 'down' });
    if (candidates.length > 0) {
      candidates.sort((a, b) => (b.weight * Math.abs(b.chg)) - (a.weight * Math.abs(a.chg)));
      const c = candidates[0];
      if (c.name === 'CPM') causeStem = `主因是 <b>CPM 上涨 ${c.chg.toFixed(1)}%</b>，竞价成本变高、系统分配流量减少`;
      else if (c.name === '一键起量') causeStem = `主因是 <b>一键起量占比大幅回落</b>（${(yjql.early || 0).toFixed(1)}% → ${(yjql.late || 0).toFixed(1)}%），失去买量救火工具`;
      else if (c.name === '冷启动成功率') causeStem = `主因是 <b>冷启动成功率下滑 ${Math.abs(c.chg).toFixed(1)}%</b>，新广告起不来`;
      else if (c.name === 'CTR') causeStem = `主因是 <b>CTR 下滑 ${Math.abs(c.chg).toFixed(1)}%</b>，素材吸引力衰退`;
    }

    // ROI 补充说明
    let roiTail = '';
    if (roi && roi.chg != null) {
      if (roi.chg >= 5) roiTail = `；但 ROI 反而上升 ${roi.chg.toFixed(1)}%，属"掉量不掉效"`;
      else if (roi.chg <= -10) roiTail = `；ROI 同步下滑 ${Math.abs(roi.chg).toFixed(1)}%，效果也在恶化`;
    }
    return `${costPart}${causeStem ? '，' + causeStem : ''}${roiTail}。`;
  } else if (chg >= 15) {
    // 上涨：找主要驱动
    let driver = '';
    if (acc && acc.chg != null && acc.chg >= 30) driver = `账户数扩张（+${acc.chg.toFixed(0)}%）`;
    else if (ad && ad.chg != null && ad.chg >= 30) driver = `广告数增加（+${ad.chg.toFixed(0)}%）`;
    else if (ctr && ctr.chg != null && ctr.chg >= 10) driver = `CTR 提升（+${ctr.chg.toFixed(1)}%）`;
    else if (cpm && cpm.chg != null && cpm.chg <= -10) driver = `CPM 下降（${cpm.chg.toFixed(1)}%）`;
    let roiTail = '';
    if (roi && roi.chg != null) {
      if (roi.chg <= -10) roiTail = `；但 ROI 下滑 ${Math.abs(roi.chg).toFixed(1)}%，需注意"起量不起效"`;
      else if (roi.chg >= 5) roiTail = `；ROI 同步上升 ${roi.chg.toFixed(1)}%，量效双升`;
    }
    return `${costPart}${driver ? '，主要由 <b>' + driver + '</b> 驱动' : ''}${roiTail}。`;
  } else {
    // 稳定
    return `${costPart}，各项核心指标未见明显异常，可参考下方基建差距诊断继续优化。`;
  }
}

// 核心归因（3-6 条，按重要性排序）
function buildCauses(chg, f, m) {
  const causes = [];

  function pushIf(cond, level, text) {
    if (cond) causes.push({ level, text });
  }

  // 变化文本
  function chgText(name, unit) {
    const v = f[name];
    if (!v || v.chg == null) return null;
    return {
      chg: v.chg,
      early: v.early,
      late: v.late,
      pretty: `${name} <b>${fmtVal(v.early, unit)} → ${fmtVal(v.late, unit)}</b>（${v.chg >= 0 ? '+' : ''}${v.chg.toFixed(1)}%）`
    };
  }

  // CTR
  const ctr = chgText('CTR', 'pct');
  if (ctr) {
    if (ctr.chg <= -20) causes.push({ level: 'critical', text: `<b>CTR 大幅下滑：</b>${ctr.pretty} —— 素材吸引力严重衰退，用户不再点击广告` });
    else if (ctr.chg <= -10) causes.push({ level: 'warning', text: `<b>CTR 下滑：</b>${ctr.pretty} —— 素材竞争力下降` });
    else if (ctr.chg >= 15) causes.push({ level: 'good', text: `<b>CTR 上升：</b>${ctr.pretty} —— 素材优化见效` });
  }

  // CPM
  const cpm = chgText('CPM', 'yuan');
  if (cpm) {
    if (cpm.chg >= 20) causes.push({ level: 'critical', text: `<b>CPM 大幅上涨：</b>${cpm.pretty} —— 竞价成本变高，若出价未同步跟涨会大量流失流量` });
    else if (cpm.chg >= 10) causes.push({ level: 'warning', text: `<b>CPM 上涨：</b>${cpm.pretty} —— 需关注竞价环境变化` });
    else if (cpm.chg <= -20 && chg <= -15) causes.push({ level: 'warning', text: `<b>CPM 反而下降：</b>${cpm.pretty} —— 通常意味系统在减少分发（广告卷不过对手），并非利好` });
  }

  // 冷启动成功率
  const cold = chgText('冷启动成功率', 'pct');
  if (cold) {
    if (cold.chg <= -50 || (cold.late != null && cold.late < 10 && cold.early != null && cold.early >= 30)) {
      causes.push({ level: 'critical', text: `<b>冷启动成功率崩塌：</b>${cold.pretty} —— 新广告几乎无法进入稳定期，只能靠老广告残存跑量` });
    } else if (cold.chg <= -25) {
      causes.push({ level: 'warning', text: `<b>冷启动成功率下滑：</b>${cold.pretty} —— 新广告起量变难` });
    }
  }

  // 一键起量
  const yjql = chgText('一键起量占比', 'pct');
  if (yjql) {
    if (yjql.late != null && yjql.late < 1 && yjql.early != null && yjql.early >= 5) {
      causes.push({ level: 'critical', text: `<b>一键起量弃用：</b>${yjql.pretty} —— 在最需要买量的时候关闭了救火工具` });
    } else if (yjql.chg <= -50 && yjql.early >= 3) {
      causes.push({ level: 'warning', text: `<b>一键起量大幅回落：</b>${yjql.pretty}` });
    } else if (yjql.late != null && yjql.late < 0.5 && chg <= -15) {
      causes.push({ level: 'warning', text: `<b>全程未使用一键起量</b>（占比 ${(yjql.late || 0).toFixed(1)}%）—— 未借助放量工具辅助新广告冷启动` });
    }
  }

  // 播放时长 / 素材质量
  const dur = chgText('播放时长', 'sec');
  if (dur) {
    if (dur.chg <= -15) causes.push({ level: 'warning', text: `<b>平均播放时长下滑：</b>${dur.pretty} —— 视频前几秒吸引力不足，用户快速划走` });
  }

  // 新广告扩张 / 收缩
  const newAd = chgText('新广告数', 'float');
  const ad = chgText('广告数', 'int');
  const acc = chgText('有消耗账户数', 'float');
  if (ad && ad.chg >= 100 && chg <= -10) {
    causes.push({ level: 'critical', text: `<b>广告数暴增但消耗反降：</b>${ad.pretty} —— 盲目铺量导致系统学习被稀释，大量新广告跑不出量` });
  } else if (ad && ad.chg <= -30 && chg <= -15) {
    causes.push({ level: 'warning', text: `<b>广告数大幅减少：</b>${ad.pretty} —— 投放规模在收缩` });
  }
  if (acc && acc.chg >= 50 && chg <= -10) {
    causes.push({ level: 'warning', text: `<b>账户数扩张但未产出：</b>${acc.pretty} —— 新开账户可能只是"占坑"未有效投放` });
  } else if (acc && acc.chg <= -30 && chg <= -15) {
    causes.push({ level: 'warning', text: `<b>有消耗账户数减半：</b>${acc.pretty} —— 需确认是主动停投还是账户异常` });
  }

  // 曝光唯一ID
  const cid = chgText('曝光唯一ID数', 'int');
  if (cid && cid.chg <= -30 && chg <= -15) {
    causes.push({ level: 'warning', text: `<b>曝光唯一 ID 数下滑：</b>${cid.pretty} —— 有效曝光的创意在减少` });
  }

  // 直播漏斗
  const enterRate = chgText('进播率', 'pct');
  const clickRate = chgText('商品点击率', 'pct');
  if (enterRate && enterRate.chg <= -15) {
    causes.push({ level: 'warning', text: `<b>直播进播率下滑：</b>${enterRate.pretty} —— 观众进不来直播间` });
  }
  if (clickRate && clickRate.chg <= -15) {
    causes.push({ level: 'warning', text: `<b>商品点击率下滑：</b>${clickRate.pretty} —— 直播间内的转化效率在下降` });
  }

  // ROI
  const roi = chgText('ROI', 'float');
  if (roi) {
    if (roi.chg <= -20) causes.push({ level: 'critical', text: `<b>ROI 显著下滑：</b>${roi.pretty} —— 投放效率恶化` });
    else if (roi.chg >= 20 && chg <= -15) causes.push({ level: 'good', text: `<b>ROI 逆势上升：</b>${roi.pretty} —— 属"掉量不掉效"，只有优质广告留下来` });
  }

  // 按 level 排序：critical > warning > good
  const order = { critical: 0, warning: 1, good: 2, neutral: 3 };
  causes.sort((a, b) => order[a.level] - order[b.level]);
  return causes.slice(0, 6).map((c, i) => ({ ...c, rank: i + 1 }));
}

function buildSuggestions(chg, f) {
  const sug = [];
  if (chg <= -15) {
    const ctr = f['CTR'];
    const cpm = f['CPM'];
    const cold = f['冷启动成功率'];
    const yjql = f['一键起量占比'];
    if (ctr && ctr.chg != null && ctr.chg <= -15) {
      sug.push('优化素材前 3 秒钩子（提升完播率）、批量测试新脚本，提升 CTR');
    }
    if (cpm && cpm.chg != null && cpm.chg >= 15) {
      sug.push('适当提高浅层出价（建议先加 10~20%）对冲 CPM 上涨');
    }
    if (cold && cold.late != null && cold.late < 15) {
      sug.push('提升素材质量以改善冷启动通过率；减慢新广告投放速度');
    }
    if (yjql && yjql.late != null && yjql.late < 1) {
      sug.push('重启一键起量，辅助新广告过冷启动（占比目标 5% 以上）');
    }
    if (sug.length === 0) {
      sug.push('对照上方"关键差距诊断"补齐产品基建（全域通、3.0MAX、种草、4+M）');
    }
  } else if (chg >= 15) {
    sug.push('巩固当前素材与投放策略，同步观察 ROI 是否保持');
    sug.push('若账户/广告数扩张较快，注意监控冷启动成功率，避免铺量稀释');
  } else {
    sug.push('对照"关键差距诊断"逐项补齐基建，向头部客户对齐');
  }
  return sug;
}

function fmtVal(v, unit) {
  if (v == null || Number.isNaN(v)) return '—';
  if (unit === 'pct') return v.toFixed(1) + '%';
  if (unit === 'yuan') {
    if (Math.abs(v) >= 10000) return (v/10000).toFixed(1) + '万';
    return v.toFixed(1);
  }
  if (unit === 'int') return Math.round(v).toLocaleString();
  if (unit === 'sec') return v.toFixed(1) + 's';
  if (unit === 'float') return v.toFixed(2);
  return String(v);
}

// ==== 前后期指标对比表 ====
function renderPhaseTable(client) {
  const container = document.getElementById('phase-table');
  const drop = client.drop_info;
  if (!drop || !drop.metrics) { container.innerHTML = ''; return; }
  const m = drop.metrics;
  const order = ['消耗', 'ROI', 'CTR', 'CPM', '下单单价', '播放时长', '冷启动成功率',
                 '新广告占比', '曝光唯一ID数', '一键起量占比', '有消耗账户数', '广告数', '新广告数',
                 '进播率', '商品点击率', '下单率'];
  let html = '<table class="phase-table"><thead><tr><th>指标</th><th>前 7 日均值</th><th>近 7 日均值</th><th>变化率</th></tr></thead><tbody>';
  order.forEach(k => {
    const v = m[k];
    if (!v || v.early == null || v.late == null) return;
    const chg = v.early === 0 ? null : (v.late - v.early) / v.early * 100;
    const arrow = chg == null ? '—' : chg > 0 ? '▲' : chg < 0 ? '▼' : '—';
    const cls = chg == null ? '' : chg > 0 ? 'up' : chg < 0 ? 'down' : '';
    // 变化率的正负颜色：对"下单单价/CPM"来说，涨不一定好；对其他大部分来说涨=好
    // 简单起见都用红↑/绿↓的相反色处理让 CPM 涨=红（不利），我们统一：涨绿降红为默认；除了 CPM 反过来
    const negativeIsBad = ['CPM'].includes(k);
    let colorCls;
    if (chg == null || Math.abs(chg) < 3) colorCls = 'neutral';
    else if (negativeIsBad) colorCls = chg > 0 ? 'bad' : 'good';
    else colorCls = chg > 0 ? 'good' : 'bad';
    html += `<tr>
      <td class="pt-label">${k}</td>
      <td>${fmtVal(v.early, v.unit)}</td>
      <td>${fmtVal(v.late, v.unit)}</td>
      <td class="pt-chg pt-${colorCls}">${arrow} ${chg == null ? '' : (chg >= 0 ? '+' : '') + chg.toFixed(1) + '%'}</td>
    </tr>`;
  });
  html += '</tbody></table>';
  container.innerHTML = html;
}

// ==== 对比表通用渲染 ====
function renderCompareTable(containerId, cols, rows) {
  const container = document.getElementById(containerId);
  // 表头
  let html = '<div class="ct-header ct-row">';
  html += '<div class="ct-cell ct-label">指标</div>';
  cols.forEach(c => {
    html += `<div class="ct-cell ct-col-head" style="background:${c.color.bg};border-color:${c.color.border};color:${c.color.text}">
      <div class="ct-col-label">${c.label}</div>
      <div class="ct-col-tag">${escHtml(c.tag)}${c.removable ? `<span class="ct-remove" onclick="removeCustomBenchmark('${escStr(c.removeName)}')">×</span>` : ''}</div>
    </div>`;
  });
  html += '</div>';

  // 行
  const baseData = cols[0].data;  // 客户自己
  rows.forEach(r => {
    html += '<div class="ct-row">';
    html += `<div class="ct-cell ct-label">${r.label}</div>`;
    cols.forEach((c, i) => {
      const d = c.data;
      const isSelf = i === 0;
      let cellHtml = '';
      const style = `background:${c.color.bg}; border-color:${c.color.border}`;
      if (r.type === 'metric') {
        const v = d[r.key];
        const vStr = fmtByType(v, r.fmt);
        let diffStr = '';
        if (!isSelf) {
          const dt = diffTag(v, baseData[r.key], r.higherBetter);
          if (dt) diffStr = `<span class="ct-diff ct-${dt.cls}">${dt.text}</span>`;
        }
        cellHtml = `<div class="ct-value" style="color:${c.color.text}">${vStr}</div>${diffStr}`;
      } else if (r.type === 'bid') {
        // 出价：客户列显示"—"或"基准"；对比列显示"高/低"
        if (isSelf) {
          cellHtml = `<div class="ct-value" style="color:${c.color.text}">（本客户实际出价）</div>`;
        } else {
          const tag = bidTag(d[r.key], baseData[r.key]);
          // 从对方视角看：如果我方(baseData)高于对方(d)，说明对方低；这里反过来
          // 我们希望展示"对方 vs 客户"，即 diff = (对方-客户)/客户
          const diff = d[r.key] != null && baseData[r.key] != null && baseData[r.key] !== 0
            ? (d[r.key] - baseData[r.key]) / baseData[r.key] : null;
          let text = '—', cls = 'neutral';
          if (diff != null) {
            if (Math.abs(diff) < 0.05) { text = '≈ 本客户'; cls = 'neutral'; }
            else if (diff > 0) { text = `高于本客户 ${(diff*100).toFixed(0)}%`; cls = 'higher'; }
            else { text = `低于本客户 ${Math.abs(diff*100).toFixed(0)}%`; cls = 'lower'; }
          }
          cellHtml = `<div class="ct-value bid-${cls}" style="color:${c.color.text}">${text}</div>`;
        }
      } else if (r.type === 'bool_pct') {
        const on = d[r.boolKey];
        const pct = d[r.pctKey];
        const badge = on
          ? `<span class="ct-badge ct-badge-on">✓ 开启</span>`
          : `<span class="ct-badge ct-badge-off">✗ 未开</span>`;
        const pctStr = on && pct != null ? `<span class="ct-sub">占比 ${pct.toFixed(1)}%</span>` : '';
        cellHtml = `<div class="ct-value">${badge}</div>${pctStr}`;
      } else if (r.type === 'text_pct') {
        const t = d[r.textKey] || '未使用';
        const on = t !== '未使用';
        const pct = d[r.pctKey];
        const badge = on
          ? `<span class="ct-badge ct-badge-on">✓ ${escHtml(t)}</span>`
          : `<span class="ct-badge ct-badge-off">✗ 未使用</span>`;
        const pctStr = on && pct != null ? `<span class="ct-sub">占比 ${pct.toFixed(1)}%</span>` : '';
        cellHtml = `<div class="ct-value">${badge}</div>${pctStr}`;
      }
      html += `<div class="ct-cell" style="${style}">${cellHtml}</div>`;
    });
    html += '</div>';
  });
  container.innerHTML = html;
}

function fmtByType(v, t) {
  if (v == null || Number.isNaN(v)) return '—';
  if (t === 'int') return Math.round(v).toLocaleString();
  if (t === 'float1') return v.toFixed(1);
  if (t === 'float2') return v.toFixed(2);
  if (t === 'pct1') return v.toFixed(1) + '%';
  if (t === 'pct2') return v.toFixed(2) + '%';
  if (t === 'sec') return v.toFixed(1) + 's';
  return String(v);
}

// ==== 投放目标/智投 TOP3 表 ====
function renderTargetTable(containerId, cols) {
  const container = document.getElementById(containerId);
  let html = '';

  // 4.1 投放目标 TOP3
  html += '<div class="ct-subtitle">🎯 投放目标 TOP3（按消耗排序）</div>';
  html += '<div class="ct-header ct-row">';
  html += '<div class="ct-cell ct-label">排名</div>';
  cols.forEach(c => {
    html += `<div class="ct-cell ct-col-head" style="background:${c.color.bg};border-color:${c.color.border};color:${c.color.text}">
      <div class="ct-col-label">${c.label}</div>
      <div class="ct-col-tag">${escHtml(c.tag)}${c.removable ? `<span class="ct-remove" onclick="removeCustomBenchmark('${escStr(c.removeName)}')">×</span>` : ''}</div>
    </div>`;
  });
  html += '</div>';

  for (let i = 0; i < 3; i++) {
    html += '<div class="ct-row">';
    html += `<div class="ct-cell ct-label">TOP ${i+1}</div>`;
    cols.forEach(c => {
      const tgs = c.data.targets_top3 || [];
      const t = tgs[i];
      const style = `background:${c.color.bg}; border-color:${c.color.border}`;
      if (t) {
        html += `<div class="ct-cell" style="${style}">
          <div class="ct-target-name" style="color:${c.color.text}">${escHtml(t.name)}</div>
          <div class="ct-sub">占比 ${t.pct.toFixed(1)}%</div>
        </div>`;
      } else {
        html += `<div class="ct-cell" style="${style}"><div class="ct-value">—</div></div>`;
      }
    });
    html += '</div>';
  }

  // 4.2 智投类型 TOP3
  html += '<div class="ct-subtitle" style="margin-top:20px;">🤖 智投使用 · 智投类型 TOP3</div>';
  html += '<div class="ct-row">';
  html += '<div class="ct-cell ct-label">是否智投</div>';
  cols.forEach(c => {
    const z = c.data['是否使用智投'];
    const pct = c.data['智投消耗占比%'];
    const style = `background:${c.color.bg}; border-color:${c.color.border}`;
    const badge = z
      ? `<span class="ct-badge ct-badge-on">✓ 已使用</span>`
      : `<span class="ct-badge ct-badge-off">✗ 未使用</span>`;
    const sub = z && pct != null ? `<span class="ct-sub">占比 ${pct.toFixed(1)}%</span>` : '';
    html += `<div class="ct-cell" style="${style}"><div class="ct-value">${badge}</div>${sub}</div>`;
  });
  html += '</div>';

  for (let i = 0; i < 3; i++) {
    html += '<div class="ct-row">';
    html += `<div class="ct-cell ct-label">智投类型 TOP ${i+1}</div>`;
    cols.forEach(c => {
      const zts = c.data.zt_types_top3 || [];
      const t = zts[i];
      const style = `background:${c.color.bg}; border-color:${c.color.border}`;
      if (t) {
        html += `<div class="ct-cell" style="${style}">
          <div class="ct-target-name" style="color:${c.color.text}">${escHtml(t.name)}</div>
          <div class="ct-sub">占比 ${t.pct.toFixed(1)}%</div>
        </div>`;
      } else {
        html += `<div class="ct-cell" style="${style}"><div class="ct-value">—</div></div>`;
      }
    });
    html += '</div>';
  }

  container.innerHTML = html;
}

// ==== 诊断（对每个对标分别诊断）====
function renderDiagnosis(cols) {
  const container = document.getElementById('diagnosis');
  const client = cols[0].data;
  const benchmarks = cols.slice(1);
  if (benchmarks.length === 0) {
    container.innerHTML = '<div class="diag-item neutral"><span class="diag-icon">ℹ</span><span>请勾选至少一个对标对象（品类 TOP1/TOP2/TOP3 或自定义）</span></div>';
    return;
  }

  let html = '';
  benchmarks.forEach(bm => {
    const bmData = bm.data;
    const gaps = [];
    const good = [];

    // 产品是否齐全
    const productChecks = [
      { key: '是否开启全域通', label: '全域通' },
      { key: '是否开启小店', label: '小店链路' },
      { key: '是否开启种草', label: '直播种草人群探索' },
      { key: '是否使用智投', label: '智投' },
    ];
    productChecks.forEach(c => {
      if (bmData[c.key] && !client[c.key]) {
        gaps.push({ level: 'critical', text: `未开启【${c.label}】—— 对标方已使用` });
      }
    });

    if ((bmData['天一键起量使用广告占比(%)'] || 0) >= 2 && (client['天一键起量使用广告占比(%)'] || 0) < 1) {
      gaps.push({ level: 'warning', text: `一键起量占比过低（${(client['天一键起量使用广告占比(%)'] || 0).toFixed(1)}% vs 对标 ${(bmData['天一键起量使用广告占比(%)'] || 0).toFixed(1)}%）` });
    }
    if ((bmData['3.0MAX开启率%'] || 0) >= 5 && (client['3.0MAX开启率%'] || 0) < 1) {
      gaps.push({ level: 'warning', text: `3.0MAX 未开或占比过低（${(client['3.0MAX开启率%'] || 0).toFixed(1)}% vs 对标 ${(bmData['3.0MAX开启率%'] || 0).toFixed(1)}%）` });
    }
    if ((bmData['4M使用情况'] || '未使用') !== '未使用' && (client['4M使用情况'] || '未使用') === '未使用') {
      gaps.push({ level: 'warning', text: `未使用 4+M（对标使用 ${bmData['4M使用情况']}）` });
    }

    const mineBid = client['浅层目标出价(扣费类型加权)(元)'];
    const bmBid = bmData['浅层目标出价(扣费类型加权)(元)'];
    if (mineBid && bmBid && (mineBid - bmBid) / bmBid < -0.2) {
      const pct = ((bmBid - mineBid) / bmBid * 100).toFixed(0);
      gaps.push({ level: 'warning', text: `浅层出价明显低于对标（低 ${pct}%）—— 竞价力可能不足` });
    }

    // 投放目标
    const myTops = (client.targets_top3 || []).map(x => x.name);
    const bmTops = (bmData.targets_top3 || []).map(x => x.name);
    const bmTop1 = bmTops[0];
    if (bmTop1 && !myTops.includes(bmTop1)) {
      gaps.push({ level: 'warning', text: `未使用对标主投目标【${bmTop1}】` });
    }

    // 内容力
    const mineCtr = client['ctr(%)'];
    const bmCtr = bmData['ctr(%)'];
    if (mineCtr && bmCtr && (mineCtr - bmCtr) / bmCtr < -0.3) {
      gaps.push({ level: 'critical', text: `CTR 显著低于对标：${mineCtr.toFixed(2)}% vs ${bmCtr.toFixed(2)}%（低 ${((bmCtr - mineCtr) / bmCtr * 100).toFixed(0)}%）—— 素材吸引力不足` });
    }
    const mineDur = client['平均播放时长'];
    const bmDur = bmData['平均播放时长'];
    if (mineDur && bmDur && (mineDur - bmDur) / bmDur < -0.2) {
      gaps.push({ level: 'warning', text: `平均播放时长偏低：${mineDur.toFixed(1)}s vs ${bmDur.toFixed(1)}s—— 视频前几秒吸引力弱` });
    }
    const mineCold = client['广告冷启动成功率(%)'];
    const bmCold = bmData['广告冷启动成功率(%)'];
    if (mineCold != null && bmCold != null && bmCold > 0 && (mineCold / bmCold) < 0.5) {
      gaps.push({ level: 'critical', text: `冷启动成功率仅 ${mineCold.toFixed(1)}%，远低于对标 ${bmCold.toFixed(1)}%—— 新广告起不来` });
    }

    // 好的地方
    if ((client['天一键起量使用广告占比(%)'] || 0) >= 5) {
      good.push({ level: 'good', text: `已积极使用一键起量（${(client['天一键起量使用广告占比(%)']).toFixed(1)}%）` });
    }
    if (client['是否使用智投']) {
      good.push({ level: 'good', text: `已使用智投（占比 ${(client['智投消耗占比%'] || 0).toFixed(1)}%）` });
    }
    if (mineCtr && bmCtr && mineCtr > bmCtr * 1.05) {
      good.push({ level: 'good', text: `CTR 高于对标（${mineCtr.toFixed(2)}% vs ${bmCtr.toFixed(2)}%），素材有优势` });
    }

    html += `
      <div class="diag-block" style="border-left-color:${bm.color.border}">
        <div class="diag-header">
          <span class="diag-title">vs ${bm.label}</span>
          <span class="diag-tag" style="background:${bm.color.bg};color:${bm.color.text}">${escHtml(bm.tag)}</span>
        </div>
        <div class="diag-body">
          <div class="diag-group">
            <div class="diag-subtitle">🔴 差距（${gaps.length}）</div>
            ${gaps.length === 0
              ? '<div class="diag-item good"><span class="diag-icon">✓</span><span>基建齐全，各项指标接近或优于对标</span></div>'
              : gaps.map(g => `<div class="diag-item ${g.level}"><span class="diag-icon">•</span><span>${g.text}</span></div>`).join('')
            }
          </div>
          ${good.length > 0 ? `
          <div class="diag-group">
            <div class="diag-subtitle">🟢 优势</div>
            ${good.map(g => `<div class="diag-item good"><span class="diag-icon">✓</span><span>${g.text}</span></div>`).join('')}
          </div>` : ''}
        </div>
      </div>
    `;
  });
  container.innerHTML = html;
}

// ==== 趋势诊断（图 + 结论） ====
function renderTrendBlock(cols) {
  const container = document.getElementById('trend-block');
  const client = cols[0].data;
  const name = client['视频号名称'];
  const drop = client.drop_info;
  const fname = DROP_INDEX[name];

  // 结论
  let conclusion = '';
  if (drop) {
    const chg = drop.chg_pct;
    if (chg <= -30) {
      conclusion = `<div class="trend-conclusion trend-bad">⚠️ 近 7 日消耗显著下降 <b>${chg.toFixed(1)}%</b>（前 7 日均耗 ${fmtYuan(drop.early)} → 近 7 日 ${fmtYuan(drop.late)}），属于严重掉量。建议：① 排查素材是否衰退（3秒完播率/CTR）；② 检查冷启动成功率并借助一键起量帮助新广告起量；③ 若 CPM 显著上涨，适当提高浅层出价对冲；④ 控制新广告投放速度，避免"广撒网"稀释系统学习。</div>`;
    } else if (chg <= -15) {
      conclusion = `<div class="trend-conclusion trend-warn">📉 近 7 日消耗下降 <b>${chg.toFixed(1)}%</b>（前 7 日均耗 ${fmtYuan(drop.early)} → 近 7 日 ${fmtYuan(drop.late)}），有掉量趋势。建议：关注新广告冷启动情况，并考虑开启一键起量与 3.0MAX 辅助起量。</div>`;
    } else if (chg >= 15) {
      conclusion = `<div class="trend-conclusion trend-good">📈 近 7 日消耗上涨 <b>+${chg.toFixed(1)}%</b>（前 7 日均耗 ${fmtYuan(drop.early)} → 近 7 日 ${fmtYuan(drop.late)}），保持良好增长势头。建议：巩固现有素材与投放策略，同时观察 ROI 是否同步保持。</div>`;
    } else {
      conclusion = `<div class="trend-conclusion trend-neutral">➡️ 近 7 日消耗基本稳定（前 7 日 ${fmtYuan(drop.early)} → 近 7 日 ${fmtYuan(drop.late)}，变化 ${chg >= 0 ? '+' : ''}${chg.toFixed(1)}%）。可对照上方基建差距诊断进一步提升。</div>`;
    }
  } else {
    conclusion = `<div class="trend-conclusion trend-neutral">近 14 日数据不足，暂无法生成趋势诊断结论。</div>`;
  }

  // 图
  let imgHtml = '';
  if (fname) {
    imgHtml = `<img class="trend-img" src="drop_charts/${fname}" alt="趋势诊断图">`;
  } else {
    imgHtml = `<div class="trend-noimg">该视频号数据不足，未生成诊断图</div>`;
  }
  container.innerHTML = conclusion + imgHtml;
}

function fmtYuan(v) {
  if (v == null) return '—';
  if (Math.abs(v) >= 10000) return (v/10000).toFixed(2) + '万';
  return Math.round(v).toLocaleString();
}

// ==== Modal（保留兼容） ====
function showDropChart() {
  if (!CURRENT_CLIENT) return;
  const name = CURRENT_CLIENT['视频号名称'];
  const fname = DROP_INDEX[name];
  const img = document.getElementById('drop-img');
  const modal = document.getElementById('drop-modal');
  document.getElementById('modal-title').textContent = name + ' · 消耗趋势诊断';
  img.src = fname ? 'drop_charts/' + fname : '';
  modal.classList.remove('hidden');
}
function closeDropChart(event) {
  if (event && event.target !== event.currentTarget && !event.target.classList.contains('modal-close')) return;
  document.getElementById('drop-modal').classList.add('hidden');
}

// ==== utils ====
function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function escStr(s) { return String(s).replace(/'/g, "\\'").replace(/"/g, '\\"'); }
