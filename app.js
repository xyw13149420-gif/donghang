/* 懂行 · 电商助手 —— 逻辑层
   GMV、利润、敏感度全部由 data.js 里的乘数实时算出，页面不写死任何结果。 */

var $ = function (s, r) { return (r || document).querySelector(s); };

function money(n, d) {
  if (n === null || n === undefined || !isFinite(n)) return '—';
  var dec = d === undefined ? 0 : d;
  return '¥' + n.toLocaleString('zh-CN', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
function num(n, d) {
  if (n === null || n === undefined || !isFinite(n)) return '—';
  var dec = d === undefined ? 0 : d;
  return n.toLocaleString('zh-CN', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
function pct(n, d) {
  if (n === null || n === undefined || !isFinite(n)) return '—';
  return n.toFixed(d === undefined ? 1 : d) + '%';
}
function signed(n, d, suffix) {
  if (n === null || n === undefined || !isFinite(n)) return '—';
  return (n >= 0 ? '+' : '') + n.toFixed(d === undefined ? 1 : d) + (suffix || '');
}
function esc(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function cls(n) { if (n === null || n === undefined || !isFinite(n)) return ''; return n >= 0 ? 'up' : 'down'; }

/* =========================================================
   可视化 · Tooltip 数据提示
   只认 data-vtip 属性，不碰任何已有结构与动效。
   自绘一层 fixed 浮层，代替原生 title（原生那个慢、不可样式化）
   ========================================================= */
var vtipEl = null, vtipTimer = 0;

function vtipAttr(html) { return ' data-vtip="' + esc(html) + '"'; }

function vtipShow(t) {
  var html = t.getAttribute('data-vtip');
  if (!html) return;
  clearTimeout(vtipTimer);
  /* 80ms 延迟：鼠标划过一排乘数时不至于每个都闪一下 */
  vtipTimer = setTimeout(function () {
    if (!vtipEl) {
      vtipEl = document.createElement('div');
      vtipEl.className = 'vtip';
      vtipEl.setAttribute('role', 'tooltip');
      document.body.appendChild(vtipEl);
    }
    vtipEl.innerHTML = html;
    vtipEl.classList.add('on');
    var r = t.getBoundingClientRect(), b = vtipEl.getBoundingClientRect();
    var vw = window.innerWidth;
    var left = Math.round(r.left + r.width / 2 - b.width / 2);
    left = Math.max(8, Math.min(left, vw - b.width - 8));
    var top = Math.round(r.top - b.height - 8);
    if (top < 8) top = Math.round(r.bottom + 8);   /* 上面放不下就翻到下面 */
    vtipEl.style.left = left + 'px';
    vtipEl.style.top = top + 'px';
  }, 80);
}

function vtipHide() {
  clearTimeout(vtipTimer);
  if (vtipEl) vtipEl.classList.remove('on');
}

(function () {
  document.addEventListener('pointerover', function (e) {
    var t = e.target && e.target.closest ? e.target.closest('[data-vtip]') : null;
    if (t) vtipShow(t);
  });
  document.addEventListener('pointerout', function (e) {
    var t = e.target && e.target.closest ? e.target.closest('[data-vtip]') : null;
    if (!t) return;
    /* 在同一个元素内部的子节点之间移动也会触发 pointerout，
       这种情况不算离开，否则延迟显示会被自己取消掉 */
    var to = e.relatedTarget;
    if (to && to.nodeType === 1 && t.contains(to)) return;
    vtipHide();
  });
  window.addEventListener('scroll', vtipHide, { passive: true });
})();

/* =========================================================
   一、拆解：一个乘法树算出全部结论
   GMV = 曝光 × 点击率 × 进店率 × 加购率 × 下单率 × 支付率 × 客单价
   ========================================================= */
function buildTree() {
  var keys = STORE.nodes.map(function (x) { return x.k; });

  function product(m) {
    var g = 1;
    for (var i = 0; i < keys.length; i++) g *= m[keys[i]];
    return g;
  }
  function pick(fn) {
    var o = {};
    STORE.nodes.forEach(function (x) { o[x.k] = fn(x); });
    return o;
  }

  /* p（上期）和 b（类目均值）可能没填。缺失时退回本期值参与计算，
     但另外记下 hasPrev / hasBm —— 否则「没填」会被当成「没变化」，
     页面就会说「环比持平」「已达标」，那是假话。 */
  var hasPrev = false, hasBm = false;
  STORE.nodes.forEach(function (x) {
    if (x.p !== null && x.p !== undefined && isFinite(x.p)) hasPrev = true;
    if (x.b !== null && x.b !== undefined && isFinite(x.b)) hasBm = true;
  });

  var cur = pick(function (x) { return x.v; });
  var prev = pick(function (x) { return x.p == null ? x.v : x.p; });
  var bm = pick(function (x) { return x.b == null ? x.v : x.b; });

  var gmv = product(cur);
  var gmvPrev = product(prev);
  var gmvBm = product(bm);

  /* 逐项单独拉到类目均值能多卖多少（乘法可交换，顺序不影响结论） */
  var lifts = STORE.nodes.filter(function (x) {
    return x.b !== null && x.b !== undefined && isFinite(x.b);
  }).map(function (x) {
    var t = {};
    keys.forEach(function (k) { t[k] = cur[k]; });
    t[x.k] = x.b;
    var g = product(t);
    return { k: x.k, n: x.n, from: x.v, to: x.b, g: g, d: g - gmv };
  }).sort(function (a, b) { return b.d - a.d; });

  var liftsSum = 0;
  lifts.forEach(function (l) { liftsSum += l.d; });

  var paid = cur.imp * cur.ctr * cur.instore * cur.cart * cur.order * cur.pay;
  var rev = gmv * (1 - STORE.refundRate);
  var gp = rev * STORE.grossMargin;
  var ship = paid * STORE.shipPerOrder;
  var comm = gmv * STORE.commRate;
  var net = gp - STORE.adSpend - ship - comm - STORE.fixedCost;

  return {
    cur: cur, prev: prev,
    gmv: gmv, gmvPrev: gmvPrev, gmvBm: gmvBm,
    hasPrev: hasPrev, hasBm: hasBm,
    dGmv: hasPrev && gmvPrev > 0 ? (gmv / gmvPrev - 1) * 100 : null,
    lifts: lifts, liftsSum: liftsSum, liftsTotal: gmvBm - gmv,
    paid: paid, rev: rev, gp: gp, ship: ship, comm: comm, net: net,
    refund: gmv - rev, cogs: rev - gp,
    netRate: gmv > 0 ? net / gmv * 100 : null,
    adRate: gmv > 0 ? STORE.adSpend / gmv * 100 : null,
    roi: STORE.adSpend > 0 ? gmv / STORE.adSpend : null,
    gpRoi: STORE.adSpend > 0 ? gp / STORE.adSpend : null
  };
}
var TREE = buildTree();

function chainNode(x) {
  var val = x.t === 'pct' ? (x.v * 100).toFixed(x.v * 100 % 1 === 0 ? 0 : 1) + '%'
    : x.t === 'money' ? '¥' + num(x.v, 0) : num(x.v, 0);
  var d, dt;
  if (x.t === 'pct') { d = (x.v - x.p) * 100; dt = signed(d, 2, 'pt'); }
  else { d = (x.v / x.p - 1) * 100; dt = signed(d, 1, '%'); }
  var bmTxt = x.b === null ? '不设上限'
    : '类目 ' + (x.t === 'pct' ? (x.b * 100).toFixed(1) + '%' : '¥' + num(x.b, 0));
  /* 悬停提示：把本期/上期/类目摊开，比原生 title 给的信息多，也不占布局 */
  var vt = '<b>' + esc(x.n) + '</b>'
    + '<span class="vt-r"><span>本期</span><span>' + fmtNodeVal(x.k, x.v) + '</span></span>'
    + (x.p !== null && x.p !== undefined ? '<span class="vt-r"><span>上期</span><span>' + fmtNodeVal(x.k, x.p) + '</span></span>' : '')
    + (x.b !== null && x.b !== undefined ? '<span class="vt-r"><span>类目均值</span><span>' + fmtNodeVal(x.k, x.b) + '</span></span>' : '')
    + (x.tip ? '<span class="vt-tip">' + esc(x.tip) + '</span>' : '');
  return '<div class="nd" data-drill="' + x.k + '"' + vtipAttr(vt) + '>'
    + '<div class="nd-n">' + esc(x.n) + '</div>'
    + '<div class="nd-v">' + val + '</div>'
    + '<div class="nd-d ' + cls(d) + '">' + dt + '</div>'
    + '<div class="nd-b">' + bmTxt + '</div>'
    + '</div>';
}

/* =========================================================
   结论文案：全部由数据推导
   原先这些句子是照示例数据写的（「曝光涨了、点击率掉到 3.20%」），
   换成别人的数据就说错了。这里改成先算再说话。
   ========================================================= */

/* 一个节点相对上期怎么变的 */
function nodeChange(x) {
  var from = (x.p === null || x.p === undefined) ? x.v : x.p;
  var to = x.v;
  return {
    from: from, to: to,
    pt: x.t === 'pct' ? (to - from) * 100 : null,
    rel: from > 0 ? (to / from - 1) * 100 : 0,
    txt: (x.t === 'pct' ? pct(from * 100, 2) + ' → ' + pct(to * 100, 2)
      : (x.t === 'money' ? money(from, 0) : num(from, 0)) + ' → ' + (x.t === 'money' ? money(to, 0) : num(to, 0)))
  };
}

/* 相对变化最负的一项（不掉就不返回） */
function worstNode() {
  var best = null;
  STORE.nodes.forEach(function (x) {
    if (x.p == null || !(x.p > 0) || !(x.v > 0)) return;
    var r = x.v / x.p;
    if (!best || r < best.r) best = { x: x, r: r };
  });
  return (best && best.r < 0.998) ? best : null;
}

/* 主结论那句话 */
function leadNarrative(d) {
  if (!d.hasPrev) {
    return '这份数据<b>没有上期</b>，看不出环比。把上一期的曝光、点击率这些补上，'
      + '才知道哪一项在变好、哪一项在漏。现在能看的是结构：钱花在哪、短板在哪。';
  }
  var c = d.cur, p = d.prev;
  var impG = (c.imp / p.imp - 1) * 100;
  var ctrPt = (c.ctr - p.ctr) * 100;
  var diff = d.gmv - d.gmvPrev;

  var out = '曝光' + (impG >= 0 ? '多买了 ' : '少了 ') + '<b>' + Math.abs(impG).toFixed(1) + '%</b>，';
  if (Math.abs(ctrPt) < 0.02) {
    out += '点击率基本没动。';
  } else {
    out += '点击率' + (ctrPt < 0 ? '从 ' + pct(p.ctr * 100, 2) + ' 掉到 ' + pct(c.ctr * 100, 2)
      : '从 ' + pct(p.ctr * 100, 2) + ' 升到 ' + pct(c.ctr * 100, 2)) + '。';
  }
  out += '两下一抵，GMV ' + (diff >= 0 ? '多了 ' : (impG > 0.5 ? '反而少了 ' : '少了 '))
    + '<b>' + money(Math.abs(diff)) + '</b>。';

  var w = worstNode();
  if (w) {
    var gain = d.gmv * (1 / w.r - 1);
    out += '只把' + esc(w.x.n) + '拉回上月水平，就能补回 <b>' + money(gain) + '</b>。';
  }
  return out;
}

/* 三条结论里第一条：环比最差的那项 */
function insightPrev(d) {
  if (!d.hasPrev) {
    return { h: '01 · 先补上期数据', p: '没有上期就判断不了趋势。这一栏现在只能告诉你结构，' +
      '告诉不了「比上个月好了还是差了」—— 而这往往才是老板第一个要问的。' };
  }
  var w = worstNode();
  if (!w) {
    return { h: '01 · 这个月没有掉队项', p: '七个乘数没有一个比上月差。这种时候别急着加预算，' +
      '先把现在这套主图和详情页为什么有效搞清楚，能复制比能放大更值钱。' };
  }
  var ch = nodeChange(w.x);
  var gain = d.gmv * (1 / w.r - 1);
  return {
    h: '01 · 先修' + esc(w.x.n),
    p: esc(w.x.n) + '从 ' + ch.txt + '，是七个乘数里掉得最多的一项，单独吃掉 <b>' + money(gain) + '</b>。'
      + '把它拉回上月，等于 GMV 多出 ' + pct(gain / d.gmv * 100, 1) + '，而这件事不用多花一分钱买流量。'
  };
}

/* 第二条：离类目均值最远、增量最大的那项 */
function insightGap(d) {
  if (!d.hasBm || !d.lifts.length) {
    return { h: '02 · 没有类目均值', p: '这一块要拿同行做标尺才成立。把类目的平均点击率、加购率填进来，' +
      '就会算出「一分曝光不加，只把链路拉齐能多卖多少」—— 那是真正的增长空间。' };
  }
  /* 第一条已经点了环比最差项，这里跳过它，免得两条说同一件事 */
  var w = worstNode();
  var pool = d.lifts.filter(function (l) { return !w || l.k !== w.x.k; });
  var top = pool[0] || d.lifts[0];
  return {
    h: '02 · 然后是' + esc(top.n),
    p: '按类目均值衡量，' + esc(top.n)
      + (top.to > top.from ? '还差一截，补上来能多 ' : '已经比同行好，再往上还能多 ')
      + '<b>' + money(top.d) + '</b>。这类改进多是改素材、改页面、改运费门槛，不花钱。'
  };
}

/* 第三条：成本结构，找最大的一笔非货品支出 */
function insightCost(d) {
  if (!(d.gmv > 0)) return { h: '03 · 数据不足', p: '成交额为零，成本结构算不出来。' };
  var items = [
    { n: '商品成本', v: d.cogs },
    { n: '推广费', v: STORE.adSpend },
    { n: '固定成本', v: STORE.fixedCost },
    { n: '退款损耗', v: d.refund },
    { n: '快递包材', v: d.ship },
    { n: '平台佣金', v: d.comm }
  ].filter(function (x) { return x.v > 0; }).sort(function (a, b) { return b.v - a.v; });

  var nonGoods = null;
  for (var i = 0; i < items.length; i++) if (items[i].n !== '商品成本') { nonGoods = items[i]; break; }

  var keep = d.net / d.gmv * 100;
  var p1 = '每 100 元 GMV，扣完退款、货品、推广、履约、佣金和固定成本，最后剩 <b>'
    + keep.toFixed(1) + ' 元</b>。';
  var p2 = nonGoods
    ? '除货品外最大的一笔是' + esc(nonGoods.n) + '，占 <b>' + (nonGoods.v / d.gmv * 100).toFixed(1) + ' 元</b>。'
      + (nonGoods.n === '推广费' && STORE.adSpend / d.gmv * 100 > STORE.grossMargin * 100
        ? '推广费已经高过毛利率，现在每卖一件都在亏。' : '')
    : '';
  return { h: '03 · 钱是这样没的', p: p1 + p2 };
}

/* 钱去哪了：数据拆成三组，图例可逐组隐藏；金额与占比口径不随筛选变化 */
var wfOff = { rev: false, cost: false, res: false };

function wfRowsHtml() {
  var d = TREE;
  var rows = [
    { l: 'GMV', v: d.gmv, k: 'base', g: 'rev' },
    { l: '退款 ' + pct(STORE.refundRate * 100, 1), v: -d.refund, k: 'neg', g: 'cost' },
    { l: '商品成本', v: -d.cogs, k: 'neg', g: 'cost' },
    { l: '毛利', v: d.gp, k: 'sub', g: 'res' },
    { l: '推广费', v: -STORE.adSpend, k: 'neg', g: 'cost' },
    { l: '履约（快递包材）', v: -d.ship, k: 'neg', g: 'cost' },
    { l: '平台佣金', v: -d.comm, k: 'neg', g: 'cost' },
    { l: '固定成本', v: -STORE.fixedCost, k: 'neg', g: 'cost' },
    { l: '净利', v: d.net, k: 'net', g: 'res' }
  ].filter(function (r) { return !wfOff[r.g]; });
  if (!rows.length) return '<div class="wf-empty">三组都隐藏了，点上面的图例恢复</div>';
  var h = '';
  rows.forEach(function (r) {
    /* GMV 为 0 时除法会得 NaN，Math.max(1.5, NaN) 会写出非法的 width:NaN% */
    var w = d.gmv > 0 ? Math.abs(r.v) / d.gmv * 100 : 0;
    var share = d.gmv > 0 ? pct(Math.abs(r.v) / d.gmv * 100, 1) : '—';
    var vt = '<b>' + esc(r.l) + '</b>'
      + '<span class="vt-r"><span>金额</span><span>' + (r.v < 0 ? '−' : '') + money(Math.abs(r.v)) + '</span></span>'
      + '<span class="vt-r"><span>占 GMV</span><span>' + share + '</span></span>';
    h += '<div class="wf-r ' + r.k + '"' + vtipAttr(vt) + '>'
      + '<span class="wf-l">' + esc(r.l) + '</span>'
      + '<span class="wf-t"><span class="wf-f" style="width:' + Math.max(1.5, w).toFixed(2) + '%"></span></span>'
      + '<span class="wf-v">' + (r.v < 0 ? '−' : '') + money(Math.abs(r.v)) + '</span>'
      + '<span class="wf-p">' + share + '</span></div>';
  });
  return h;
}

function wfLegendHtml() {
  return [['rev', '收入'], ['cost', '成本与费用'], ['res', '毛利与净利']].map(function (x) {
    return '<button type="button" class="wf-lgi ' + x[0] + (wfOff[x[0]] ? ' off' : '') + '" data-g="' + x[0] + '">'
      + '<i class="wf-dot"></i>' + x[1] + '</button>';
  }).join('');
}

/* 下钻：乘数 → 算账页里对应的那条公式 */
var DRILL_KEY = {
  imp: ['曝光'], ctr: ['点击率'], instore: ['进店'],
  cart: ['加购率'], order: ['下单率'], pay: ['支付率'], aov: ['客单价']
};

function drillTo(k) {
  var keys = DRILL_KEY[k];
  if (!keys) return;
  for (var i = 0; i < FORMULAS.length; i++) {
    for (var j = 0; j < keys.length; j++) {
      if (FORMULAS[i].t.indexOf(keys[j]) > -1) {
        fxState.idx = i; fxState.vals = {}; fxState.q = '';
        render('formula');
        return;
      }
    }
  }
}

function viewTree() {
  var d = TREE;
  var c = d.cur;

  var h = '';
  h += '<div class="head"><div><h1>拆解</h1>'
    + '<div class="sub">' + esc(STORE.name) + ' · ' + esc(STORE.period) + ' · '
      + (IS_CUSTOM ? '<b class="mine">你自己的数据</b>' : '示例数据') + '，每个乘数 hover 可看改法</div></div>'
    + '<div class="legend"><i class="sw up"></i>上升<i class="sw down"></i>下降</div></div>';

  /* 主结论 */
  h += '<div class="card lead">';
  h += '<div class="lead-a"><div class="lb">成交总额 GMV</div>'
    + '<div class="big">' + money(d.gmv) + '</div>'
    + '<div class="lead-s"><span class="' + cls(d.dGmv) + '">' + signed(d.dGmv, 1, '%') + '</span> 环比'
    + '<span class="sep">·</span>净利 ' + money(d.net) + '<span class="sep">·</span>净利率 ' + pct(d.netRate, 1) + '</div></div>';
  h += '<div class="lead-b"><div class="lb">' + (d.hasPrev ? '这个月发生了什么' : '这份数据说了什么') + '</div>'
    + '<p>' + leadNarrative(d) + '</p></div>';
  h += '</div>';

  /* 七个乘数 */
  h += '<div class="card">';
  h += '<div class="card-h"><span class="card-t">七个乘数</span>'
    + '<span class="card-s">任何一个掉一半，结果就掉一半 —— 点任一乘数可下钻到它的公式</span></div>';
  h += '<div class="chain">';
  STORE.nodes.forEach(function (x, i) {
    if (i) h += '<span class="x">×</span>';
    h += chainNode(x);
  });
  h += '</div>';
  h += '<div class="chain-out"><span class="co-l">相乘得到</span>'
    + '<span class="co-v">' + money(d.gmv) + '</span>'
    + '<span class="co-s">＝ 支付订单 ' + num(d.paid, 0) + ' 单 × 客单价 ' + money(c.aov) + '</span></div>';
  h += '</div>';

  /* 不花钱能涨多少 */
  if (!d.hasBm || !d.lifts.length) {
    h += '<div class="card"><div class="card-h"><span class="card-t">一分曝光都不加，能多卖多少</span>'
      + '<span class="card-s">需要类目均值才能算</span></div>'
      + '<div class="gap-f" style="border-top:none;margin-top:0;padding-top:0">'
      + '这一块要比着同行才有意义。把类目的平均点击率、进店率、加购率填进上期/均值那两列，'
      + '它会算出每个环节各自能带来多少增量，并按大小排序 —— 告诉你先改哪个最划算。</div></div>';
  } else {
  var maxD = d.lifts[0].d;
  h += '<div class="card gapc">';
  h += '<div class="card-h"><span class="card-t">一分曝光都不加，只把链路拉到类目均值</span>'
    + '<span class="card-s">这才是真正的增长空间</span></div>';
  h += '<div class="gap-num">' + money(d.gmv) + '<span class="arr">→</span>' + money(d.gmvBm)
    + '<span class="up">' + (d.gmv > 0 ? signed((d.gmvBm / d.gmv - 1) * 100, 1, '%') : '—') + '</span></div>';
  h += '<div class="gap-bars">';
  d.lifts.forEach(function (l) {
    var w = Math.max(3, l.d / maxD * 100);
    var lab = l.from < 1 ? (l.from * 100).toFixed(1) + '% → ' + (l.to * 100).toFixed(1) + '%'
      : '¥' + num(l.from, 0) + ' → ¥' + num(l.to, 0);
    var vt = '<b>' + esc(l.n) + '</b>'
      + '<span class="vt-r"><span>从 → 类目</span><span>' + lab + '</span></span>'
      + '<span class="vt-r"><span>单独补足能多</span><span>' + money(l.d) + '</span></span>';
    h += '<div class="bar-wrap"' + vtipAttr(vt) + '><span class="bar-l">' + esc(l.n) + '</span>'
      + '<span class="bar-t"><span class="bar-f" style="width:' + w.toFixed(1) + '%;background:var(--brand)"></span></span>'
      + '<span class="bar-v">' + money(l.d) + '</span>'
      + '<span class="bar-x">' + lab + '</span></div>';
  });
  h += '</div>';
  h += '<div class="gap-f">这 ' + d.lifts.length + ' 项都是改素材、改页面、改运费门槛这类不花钱的动作，'
    + '合计能多出 <b>' + money(d.liftsTotal) + '</b>。买曝光要预算，改主图不要钱。'
    + '<br>上面几项单独相加是 ' + money(d.liftsSum) + '，比合计少 —— 因为几处同时变好会互相放大。'
    + '所以单点提升的账面数字偏保守，真实空间只会更大。</div>';
  h += '</div>';
  }

  /* 钱去哪了：三组可筛选（收入 / 成本费用 / 毛利净利），筛选只影响显示，不改金额口径 */
  h += '<div class="card" id="wfc">';
  h += '<div class="card-h"><span class="card-t">钱去哪了</span>'
    + '<span class="card-s">GMV ' + money(d.gmv) + ' 走完一圈，剩下 ' + money(d.net) + '，净利率 ' + pct(d.netRate, 1) + '</span></div>';
  h += '<div class="wf-lg">' + wfLegendHtml() + '</div>';
  h += '<div class="wf" id="wfr">' + wfRowsHtml() + '</div></div>';

  /* 三条结论 */
  h += '<div class="card ins-c">';
  h += '<div class="card-h"><span class="card-t">所以该先做什么</span></div>';
  [insightPrev(d), insightGap(d), insightCost(d)].forEach(function (it) {
    h += '<div class="insight"><div class="h">' + it.h + '</div><p>' + it.p + '</p></div>';
  });
  h += '</div>';

  return h;
}

/* =========================================================
   二、算账：53 条公式，填数即算
   ========================================================= */
var fxState = { idx: 0, q: '', vals: {} };

/* 侧栏按业务环节分组：找公式的人通常是先想到「我要看库存」而不是「第 19 条」 */
var FX_ORDER = ['流量与转化', '用户与复购', '货与库存', '定价与利润', '投放效率', '交易与履约', '直播', '组织效率'];

function fxHit(f, q) {
  if (!q) return true;
  var hay = (f.t + ' ' + (f.w || '') + ' ' + f.x + ' ' + f.n + ' ' + (f.g || '')).toLowerCase();
  return hay.indexOf(q) > -1;
}

/* 默认值：按变量在真实店铺里的常见量级给，先匹配先赢。
   目的是让每个公式一打开就有一个说得通的结果，而不是一片 100%。 */
var DEFAULTS = [
  /* 先放容易误伤的特例，再放通用规则 */
  [/进店 UV/, 3000],
  [/库存周转率/, 5],
  [/总投入成本/, 24000],
  [/支付金额/, 36000],
  [/员工/, 2],
  [/门店面积|面积/, 30],
  [/LTV/, 187],
  [/CAC/, 60],
  [/月均贡献毛利/, 8],
  [/年购买次数/, 2],
  [/平均留存年数/, 3],
  [/停留时长/, 1080000],
  [/Σ|小时/, 24000],
  [/存货周转天数|应收账期/, 30],
  [/应付账期/, 40],

  /* 链路人数：越往后越小 */
  [/曝光 UV|曝光数|曝光/, 50000],
  [/点击/, 1600],
  [/加购人数/, 1080],
  [/下单人数/, 420],
  [/下单订单/, 460],
  [/发货订单/, 410],
  [/签收订单|支付订单/, 400],
  [/退款订单/, 26],
  [/客诉/, 1],
  [/退货件数/, 60],
  [/售出件数/, 1100],
  [/累计销量/, 500],
  [/备货量/, 600],
  [/有销量 SKU/, 120],
  [/新增 SKU/, 40],
  [/在架 SKU|期末在架/, 200],
  [/缺货/, 90],
  [/总 SKU/, 3000],
  [/订单数|单量/, 800],
  [/仍活跃/, 120],
  [/首日新增|新增付费|新增关注|新增/, 300],
  [/复购用户/, 120],
  [/购买用户/, 400],
  [/访客|观看人数|观看人次|活跃用户|人数/, 12000],
  [/离开会话/, 1800],
  [/会话数/, 4000],
  [/转化数/, 120],

  /* 金额 */
  [/净利润/, 4320],
  [/广告成交额/, 16000],
  [/广告花费|推广费|花费|获客总投入|投入|预算/, 5000],
  [/退款金额/, 2400],
  [/风控剔除/, 3000],
  [/固定成本/, 30000],
  [/销售成本/, 60000],
  [/平均库存/, 12000],
  [/单件成本|成本|进价/, 32],
  [/实付金额/, 79],
  [/原价/, 99],
  [/售价|客单价|单价|价格/, 89],
  [/成交额|销售额|GMV|营业收入|收入/, 36000],

  /* 比率 */
  [/进店率/, 25],
  [/加购率/, 9],
  [/下单率/, 3.5],
  [/支付率/, 86],
  [/留存率/, 40],
  [/毛利率|率|%/, 35],

  /* 兜底 */
  [/天数|周期/, 30]
];

function defVal(label) {
  var L = String(label);
  for (var i = 0; i < DEFAULTS.length; i++) if (DEFAULTS[i][0].test(L)) return DEFAULTS[i][1];
  return 10;
}

/* 只生成左栏列表的 HTML：搜索时局部替换这一块，不重建整页、不动滚动 */
function fxItems() {
  var h = '';
  var q = fxState.q.toLowerCase();
  var shown = 0;
  FX_ORDER.forEach(function (gname) {
    var list = FORMULAS.filter(function (f) { return f.g === gname && fxHit(f, q); });
    if (!list.length) return;
    h += '<div class="fx-g">' + esc(gname) + '</div>';
    list.forEach(function (f) {
      var i = FORMULAS.indexOf(f);
      shown++;
      h += '<div class="fx-item' + (i === fxState.idx ? ' on' : '') + '" data-fx="' + i + '"'
        + ' title="' + esc(f.w || f.t) + '">'
        + '<span class="no">' + f.n + '</span><span class="nm">' + esc(f.t) + '</span></div>';
    });
  });
  if (!shown) h += '<div class="empty">没找到这个说法。试试「ROAS」「坑产」「周转」这类词。</div>';
  return h;
}

function viewFormula() {
  var h = '';
  h += '<div class="head"><div><h1>算账</h1>'
    + '<div class="sub">' + FORMULAS.length + ' 条指标公式 · 每条先讲人话，再给算式，填数即算</div></div></div>';

  h += '<div class="fx">';
  h += '<div class="fx-list"><div class="fx-search">'
    + '<input id="fxq" placeholder="搜公式，如 ROAS、坑产、周转" value="' + esc(fxState.q) + '"></div>'
    + '<div class="fx-items" id="fxi">' + fxItems() + '</div></div>';
  h += '<div class="fx-main"><div class="fx-panel" id="fxp">' + fxPanel() + '</div>' + KOU + FX_TIP + '</div>';
  h += '</div>';
  return h;
}

/* 安全求值：公式只有 + - * / ( )，不需要 eval。
   原先用 new Function 从字符串编译 —— 公式文本一旦能被改写就是任意代码执行，
   也让严格 CSP 没法加。这里换成递归下降解析，结果按表达式缓存。 */
function fxCompile(src) {
  var s = String(src), i = 0;

  function ws() { while (i < s.length && /\s/.test(s.charAt(i))) i++; }
  function peek() { ws(); return s.charAt(i); }
  function fail(msg) { throw new Error(msg + ' @' + i); }

  function parseExpr() {
    var node = parseTerm();
    for (;;) {
      var c = peek();
      if (c !== '+' && c !== '-') return node;
      i++;
      node = { op: c, a: node, b: parseTerm() };
    }
  }
  function parseTerm() {
    var node = parseUnary();
    for (;;) {
      var c = peek();
      if (c !== '*' && c !== '/') return node;
      i++;
      node = { op: c, a: node, b: parseUnary() };
    }
  }
  function parseUnary() {
    var c = peek();
    if (c === '-') { i++; return { op: 'neg', a: parseUnary() }; }
    if (c === '+') { i++; return parseUnary(); }
    return parseAtom();
  }
  function parseAtom() {
    var c = peek();
    if (c === '(') {
      i++;
      var node = parseExpr();
      if (peek() !== ')') fail('缺少右括号');
      i++;
      return node;
    }
    if (c >= '0' && c <= '9' || c === '.') {
      var st = i;
      while (i < s.length && ((s.charAt(i) >= '0' && s.charAt(i) <= '9') || s.charAt(i) === '.')) i++;
      var v = Number(s.slice(st, i));
      if (!isFinite(v)) fail('数字不对');
      return { num: v };
    }
    if (/[A-Za-z_]/.test(c)) {
      var k = i;
      while (i < s.length && /[A-Za-z0-9_]/.test(s.charAt(i))) i++;
      return { id: s.slice(k, i) };
    }
    fail('不认识的字符「' + c + '」');
  }

  var ast = parseExpr();
  if (peek() !== '') fail('多余的字符');
  return ast;
}

function fxEval(node, env) {
  switch (node.op) {
    case '+': return fxEval(node.a, env) + fxEval(node.b, env);
    case '-': return fxEval(node.a, env) - fxEval(node.b, env);
    case '*': return fxEval(node.a, env) * fxEval(node.b, env);
    case '/': return fxEval(node.a, env) / fxEval(node.b, env);
    case 'neg': return -fxEval(node.a, env);
  }
  if (node.num !== undefined) return node.num;
  var v = env[node.id];
  return typeof v === 'number' ? v : NaN;
}

var FX_AST = {};   /* 表达式 → 编译结果，同一条公式只解析一次 */

function fxAst(expr) {
  var ast = FX_AST[expr];
  if (!ast) { ast = fxCompile(expr); FX_AST[expr] = ast; }
  return ast;
}

function fxCalc(f) {
  var env = {};
  f.v.forEach(function (v) {
    var val = fxState.vals[v[0]];
    env[v[0]] = val === undefined ? defVal(v[1]) : Number(val);
  });
  var r = null;
  try {
    r = fxEval(fxAst(f.x), env);
    if (!isFinite(r)) r = null;
    if (r !== null) r = Math.round(r * 100) / 100;
  } catch (e) { r = null; }
  return {
    shown: r === null ? '—' : (f.u === '%' ? pct(r, 2) : num(r, 2)),
    unit: r === null ? '' : (f.u === '%' ? '' : (f.u || '')),
    raw: r
  };
}

/* 把算式里的英文变量换成中文标签；useValues 为真时换成当前填的数字 */
function zhExpr(f, useValues) {
  var s = ' ' + f.x + ' ';
  var vars = f.v.slice().sort(function (a, b) { return b[0].length - a[0].length; });
  vars.forEach(function (v) {
    var label;
    if (useValues) {
      var val = fxState.vals[v[0]];
      if (val === undefined) val = defVal(v[1]);
      var nv = Number(val);
      label = Number.isInteger(nv) ? num(nv, 0) : num(nv, 2);
    } else {
      label = String(v[1]).replace(/\s*%\s*$/, '');
    }
    var key = v[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    s = s.replace(new RegExp('\\b' + key + '\\b', 'g'), label);
  });

  s = s.replace(/\s*\/\s*/g, ' ÷ ')
    .replace(/\s*\*\s*/g, ' × ')
    .replace(/\s*-\s*/g, ' − ')
    .replace(/\s*\+\s*/g, ' ＋ ')
    .replace(/\d{4,}/g, function (m) { return Number(m).toLocaleString('zh-CN'); });

  return s.replace(/\s{2,}/g, ' ').trim();
}



var KOU = '<div class="card kou"><div class="kou-h">口径三问 · 每个指标都该先问一遍</div>'
  + '<div class="kou-i"><b>分母是谁</b><span>转化率的分母是访客数还是浏览量？用订单数还是支付订单数？分母换一个，结论可能就反了。</span></div>'
  + '<div class="kou-i"><b>周期多长</b><span>自然日、自然周，还是滚动 7 天？月末三天的数据，换个口径能差出一个量级。</span></div>'
  + '<div class="kou-i"><b>含不含退款</b><span>GMV 含退款，销售收入不含。两个都叫「卖了多少钱」，差着退货率那一截。</span></div>'
  + '</div>';

var FX_TIP = '<div class="card kou"><div class="kou-h">不知道怎么填</div>'
  + '<div class="kou-i"><b>先看默认值</b><span>每一格都填了一个示例数，先看结果长什么样，再逐格换成你自己的。</span></div>'
  + '<div class="kou-i"><b>改一格看一次</b><span>数字一改，结果立刻跟着变。看哪个数最影响结论，就知道该先管哪件事。</span></div>'
  + '<div class="kou-i"><b>小英文是字段名</b><span>每格右侧那个灰色单词，就是它在后台报表里的名字，找数据时照着对。</span></div>'
  + '</div>';

function fxSubText(f, c) {
  if (f.v.length === 1 && /^[a-z_]+$/i.test(f.x.trim())) {
    return '这一个不用乘也不用除，填多少就是多少';
  }
  return zhExpr(f, true) + ' = ' + c.shown;
}

function fxPanel() {
  var f = FORMULAS[fxState.idx];

  var h = '<div class="fx-head">'
    + '<span class="fx-title">' + esc(f.t) + '</span>'
    + '<span class="fx-u">' + (f.u === '%' ? '结果是百分比' : '单位 ' + esc(f.u || '—')) + '</span>'
    + '</div>';

  /* 第一层：这句人话，决定小白看不看得懂 */
  if (f.w) h += '<div class="fx-w">' + esc(f.w) + '</div>';

  /* 第二层：中文算式在前，英文原式退到最后一行当对照 */
  h += '<div class="fx-exp">'
    + '<div class="fx-exp-zh">' + esc(zhExpr(f, false)) + '</div>'
    + '<div class="fx-exp-en">' + esc(f.x) + '</div></div>';

  h += '<div class="fx-fields">';
  f.v.forEach(function (v) {
    var key = v[0];
    var val = fxState.vals[key];
    if (val === undefined) val = defVal(v[1]);
    h += '<div class="field"><label>'
      + '<span class="fz">' + esc(v[1]) + '</span>'
      + '<span class="fe">' + esc(key) + '</span></label>'
      + '<div class="num">'
      + '<input type="number" step="any" data-k="' + key + '" value="' + val + '">'
      + '<span class="num-btns">'
      + '<button type="button" class="num-b" data-dir="1" data-k="' + key + '" tabindex="-1" aria-label="调大">'
      + '<svg viewBox="0 0 10 6" aria-hidden="true"><path d="M1 5 5 1l4 4"/></svg></button>'
      + '<button type="button" class="num-b" data-dir="-1" data-k="' + key + '" tabindex="-1" aria-label="调小">'
      + '<svg viewBox="0 0 10 6" aria-hidden="true"><path d="M1 1l4 4 4-4"/></svg></button>'
      + '</span></div></div>';
  });
  h += '</div>';

  var c = fxCalc(f);
  h += '<div class="fx-result"><span class="lb">算出来</span>'
    + '<span class="vl" id="fxres">' + c.shown + '</span>'
    + '<span class="un" id="fxun">' + esc(c.unit) + '</span></div>';

  h += '<div class="fx-sub" id="fxsub">' + esc(fxSubText(f, c)) + '</div>';

  if (f.d) h += '<div class="fx-note"><span class="fx-tag">口径</span>' + esc(f.d) + '</div>';
  if (f.eg) h += '<div class="fx-eg"><span class="fx-tag">算例</span>' + esc(f.eg) + '</div>';
  return h;
}

/* =========================================================
   三、认词：104 个术语
   ========================================================= */
var glState = { q: '', cat: -1, ti: -1 }; /* ti = 选中术语在 TERMS 里的下标，-1 = 没选 */

function viewGlossary() {
  var h = '';
  h += '<div class="head"><div><h1>认词</h1>'
    + '<div class="sub">' + TERMS.length + ' 个电商术语 · 中英对照 · 点卡片看大白话</div></div></div>';

  h += '<div class="gl-bar">'
    + '<div class="gl-search"><input id="glq" placeholder="搜术语，中英文都行，如 SKU、坑产、roas" value="' + esc(glState.q) + '"></div>'
    + glDropdown()
    + '</div>';

  h += '<div class="chips" id="glc">';
  h += '<span class="chip' + (glState.cat === -1 ? ' on' : '') + '" data-cat="-1">全部 ' + TERMS.length + '</span>';
  CATS.forEach(function (c, i) {
    h += '<span class="chip' + (glState.cat === i ? ' on' : '') + '" data-cat="' + i + '">' + esc(c) + '</span>';
  });
  h += '</div>';

  h += '<div class="gl-grid" id="glg">' + glCards() + '</div>';
  return h;
}

/* 分类下拉：打开按类别分组，组标题只看不点，点一个术语收回去并在卡片里定位到它 */
function glDropdown() {
  var h = '';
  h += '<div class="gl-dd" id="gldd">'
    + '<button type="button" class="gl-dd-btn" id="glddBtn" aria-haspopup="listbox" aria-expanded="false" aria-label="按分组展开术语列表" title="按分组展开术语列表">'
    + '<span class="gl-dd-x" id="glddX" role="button" aria-label="清除选择" hidden>&times;</span>'
    + '<span class="gl-dd-car" aria-hidden="true">&#9662;</span>'
    + '</button>'
    + '<div class="gl-dd-panel" id="glddPanel" role="listbox">' + ddItems() + '</div>'
    + '</div>';
  return h;
}

function ddItems() {
  var h = '';
  CATS.forEach(function (c, ci) {
    h += '<div class="gl-dd-g">' + esc(c) + '</div>';
    TERMS.forEach(function (t, ti) {
      if (t.c !== ci) return;
      h += '<div class="gl-dd-i" role="option" data-ti="' + ti + '" tabindex="0">'
        + '<span class="z">' + esc(t.z) + '</span>'
        + (t.a && t.a !== t.z ? '<span class="a">' + esc(t.a) + '</span>' : '')
        + '<span class="e">' + esc(t.e) + '</span></div>';
    });
  });
  return h;
}

/* 下拉的行为：开关、选术语、清除、点外面关、Esc 关。触发器只留箭头，不显示文字 */
function refreshGlCur() {
  var x = $('#glddX');
  if (x) x.hidden = glState.ti === -1;
}

function bindGlDropdown() {
  var dd = $('#gldd'), btn = $('#glddBtn'), panel = $('#glddPanel');
  if (!dd || !btn || !panel) return;

  function open() { dd.classList.add('open'); btn.setAttribute('aria-expanded', 'true'); }
  function close() { dd.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); }
  function isOpen() { return dd.classList.contains('open'); }

  refreshGlCur();

  btn.addEventListener('click', function (e) {
    if (e.target && e.target.id === 'glddX') return; /* × 自己有处理 */
    isOpen() ? close() : open();
  });

  /* 清除选中：回到分类视图，不关面板，方便接着挑 */
  $('#glddX').addEventListener('click', function (e) {
    e.stopPropagation();
    glState.ti = -1;
    refreshGlCur();
    $('#glg').innerHTML = glCards();
  });

  panel.addEventListener('click', function (e) {
    var it = e.target.closest ? e.target.closest('.gl-dd-i') : null;
    if (!it) return;
    pickTerm(Number(it.getAttribute('data-ti')));
    close();
  });
  panel.addEventListener('keydown', function (e) {
    var it = e.target.closest ? e.target.closest('.gl-dd-i') : null;
    if (it && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      pickTerm(Number(it.getAttribute('data-ti')));
      close();
    }
  });

  /* 点面板外面就收回去。document 级只绑一次：每次渲染都绑会在 document 上叠监听器，
     闭包还会一直攥着已经被 innerHTML 换掉的旧节点 */
  if (!bindGlDropdown._doc) {
    bindGlDropdown._doc = true;
    document.addEventListener('pointerdown', function (e) {
      var dd = $('#gldd');
      if (!dd || !dd.classList.contains('open') || dd.contains(e.target)) return;
      dd.classList.remove('open');
      var b = $('#glddBtn');
      if (b) b.setAttribute('aria-expanded', 'false');
    });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      var dd = $('#gldd');
      if (!dd || !dd.classList.contains('open')) return;
      dd.classList.remove('open');
      var b = $('#glddBtn');
      if (b) { b.setAttribute('aria-expanded', 'false'); b.focus(); }
    });
  }

  function pickTerm(ti) {
    var t = TERMS[ti];
    if (!t) return;
    glState.ti = ti;
    glState.cat = t.c;   /* 卡片区跟着切到它所属的分组 */
    glState.q = '';
    var gq = $('#glq');
    if (gq) gq.value = '';
    Array.prototype.forEach.call(document.querySelectorAll('#glc .chip'), function (x) {
      x.classList.toggle('on', Number(x.getAttribute('data-cat')) === t.c);
    });
    refreshGlCur();
    $('#glg').innerHTML = glCards();
    /* 定位到那张卡，亮一下 */
    var card = document.querySelector('.term[data-ti="' + ti + '"]');
    if (card) {
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      card.classList.add('sel');
      setTimeout(function () { card.classList.remove('sel'); }, 2000);
    }
  }
}

function glCards() {
  var q = glState.q.toLowerCase();
  var list = TERMS.filter(function (t) {
    if (glState.cat > -1 && t.c !== glState.cat) return false;
    if (!q) return true;
    return (t.z + ' ' + t.e + ' ' + t.a + ' ' + t.d).toLowerCase().indexOf(q) > -1;
  });
  if (!list.length) return '<div class="empty">没有匹配的术语，换个词试试</div>';
  return list.map(function (t) {
    var ti = TERMS.indexOf(t);
    return '<div class="term' + (ti === glState.ti ? ' sel' : '') + '" data-ti="' + ti + '"'
      + ' role="button" tabindex="0" aria-haspopup="dialog" aria-expanded="false"'
      + ' title="点开看大白话">'
      + '<div class="term-h"><span class="term-z">' + esc(t.z) + '</span>'
      + (t.a && t.a !== t.z ? '<span class="term-a">' + esc(t.a) + '</span>' : '')
      + '<span class="term-e">' + esc(t.e) + '</span></div>'
      + '<div class="term-d">' + esc(t.d) + '</div></div>';
  }).join('');
}

/* =========================================================
   认词 · 展开卡片
   点卡片：面板从这张卡的位置长出（left/top/width/height 过渡），
   标题钉在面板左上角、和卡片标题同一坐标，所以放大过程中不位移；
   面板撑到位后，图、大白话、状态信息依次渐显。
   只额外加一个 fixed 面板，不动既有卡片/光斑/回弹的任何规则。
   ========================================================= */
var XART = [
  /* 交易模式与角色：两方加一条链路 */
  '<rect x="13" y="33" width="25" height="30" rx="5"/><rect x="58" y="33" width="25" height="30" rx="5"/><path d="M38 48h20"/><circle cx="48" cy="48" r="2.4"/>',
  /* 流量与用户：漏斗 */
  '<path d="M14 22h68L57 50v22l-18 8V50z"/><path d="M26 32h44"/>',
  /* 营销推广与投放：扬声器 */
  '<path d="M24 40v16h12l20 14V26L36 40z"/><path d="M64 38c4 5 4 15 0 20"/><path d="M72 32c7 9 7 23 0 32"/>',
  /* 商品与供应链：立方体 */
  '<path d="M48 16l30 15v34L48 80 18 65V31z"/><path d="M18 31l30 15 30-15M48 46v34"/>',
  /* 定价与利润：吊牌 */
  '<path d="M50 14H82v32L49 79 17 47z"/><circle cx="68" cy="28" r="5"/>',
  /* 交易与履约：车厢 */
  '<path d="M12 34h40v30H12z"/><path d="M52 44h16l12 12v8H52z"/><circle cx="30" cy="70" r="6"/><circle cx="68" cy="70" r="6"/>',
  /* 直播：播放 + 声波 */
  '<circle cx="48" cy="48" r="26"/><path d="M42 36l18 12-18 12z"/>',
  /* 组织效率：网格 */
  '<rect x="18" y="18" width="26" height="26" rx="4"/><rect x="52" y="18" width="26" height="26" rx="4"/><rect x="18" y="52" width="26" height="26" rx="4"/><rect x="52" y="52" width="26" height="26" rx="4"/>'
];

function xArtSvg(c) {
  return '<svg class="xc-art" viewBox="0 0 96 96" fill="none" stroke="currentColor" stroke-width="1.6"'
    + ' stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (XART[c] || XART[0]) + '</svg>';
}

/* gen = 代次标记。开着的时候又点了别处、或关闭还没收完就又打开，
   旧的那批定时器不能再去动新面板的状态 —— 靠它作废。 */
var xc = { card: null, bg: null, ti: -1, busy: false, gen: 0 };

/* 清掉页面上所有面板/遮罩残留，并把状态归零。开场先跑一遍，连点也不会叠层 */
function xcPurge() {
  var nodes = document.querySelectorAll('.xc-card, .xc-bg');
  for (var i = 0; i < nodes.length; i++) if (nodes[i].parentNode) nodes[i].parentNode.removeChild(nodes[i]);
  var tags = document.querySelectorAll('.term[aria-expanded="true"]');
  for (var j = 0; j < tags.length; j++) tags[j].setAttribute('aria-expanded', 'false');
  xc.card = null; xc.bg = null; xc.ti = -1;
}

function xcMarkup(ti) {
  var t = TERMS[ti];
  return '<div class="xc-in">'
    + '<div class="term-h xc-h"><span class="term-z">' + esc(t.z) + '</span>'
    + (t.a && t.a !== t.z ? '<span class="term-a">' + esc(t.a) + '</span>' : '')
    + '<span class="term-e">' + esc(t.e) + '</span></div>'
    + '<div class="xc-b">'
    + '<div class="xc-plain"><span class="xc-tag">大白话</span>' + esc(t.p || t.d) + '</div>'
    + '<div class="xc-note">' + esc(t.d) + '</div>'
    + '<div class="xc-foot"><div class="xc-meta"><span>第 ' + (ti + 1) + ' / ' + TERMS.length + ' 条</span>'
    + '<span class="xc-dot">·</span><span>' + esc(CATS[t.c] || '') + '</span></div>'
    + xArtSvg(t.c) + '</div>'
    + '</div></div>'
    + '<button type="button" class="xc-x" aria-label="收起">&times;</button>';
}

function openTermCard(ti, cardEl) {
  if (xc.card) return;                  /* 已经开着，忽略重复点击 */
  var t = TERMS[ti];
  if (!t) return;
  vtipHide();                           /* 面板盖上来之前，先把悬停提示收掉 */
  xcPurge();                            /* 上一轮如果没收干净，先清掉，绝不叠层 */
  var gen = ++xc.gen;
  var r = cardEl.getBoundingClientRect();
  var vw = window.innerWidth, vh = window.innerHeight;
  var PAD = 16;

  /* 水平：优先贴着卡片左边缘长，这样标题不动；右边空间不够才左移 */
  var W = Math.min(560, vw - r.left - PAD);
  var left = r.left;
  if (W < 380) { W = Math.min(560, vw - PAD * 2); left = Math.max(PAD, vw - W - PAD); }
  /* 垂直：先按目标宽度排一遍，量出内容真实高度，别留一大截空白 */
  var maxH = Math.min(430, vh - r.top - PAD);
  var top = r.top;
  if (maxH < 300) { maxH = Math.min(430, vh - PAD * 2); top = Math.max(PAD, vh - maxH - PAD); }

  var bg = document.createElement('div');
  bg.className = 'xc-bg';

  var el = document.createElement('div');
  el.className = 'xc-card';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', t.z + ' 详解');
  el.style.left = r.left + 'px';
  el.style.top = r.top + 'px';
  el.style.width = r.width + 'px';
  el.style.height = r.height + 'px';
  el.style.borderRadius = 'var(--r)';
  el.innerHTML = xcMarkup(ti);
  /* 内容按目标宽度排版：面板变宽时文字不再回流，动画不抖 */
  el.querySelector('.xc-in').style.width = (W - 2) + 'px';

  xc.bg = bg; xc.card = el; xc.ti = ti; xc.busy = true;
  cardEl.setAttribute('aria-expanded', 'true');

  document.body.appendChild(bg);
  document.body.appendChild(el);
  xcLockScroll();
  /* 内容层已按目标宽度排版，直接量它的高度即可；
     不要去改面板宽度再量——那会强制一次布局，把过渡起点定成放大后的尺寸 */
  var H = Math.max(184, Math.min(maxH, Math.ceil(el.querySelector('.xc-in').getBoundingClientRect().height) + 2));
  void el.offsetWidth;                     /* 先落初始帧，避免第一次过渡从 0 开始 */

  requestAnimationFrame(function () {
    bg.classList.add('on');
    el.classList.add('on');
    el.style.left = left + 'px';
    el.style.top = top + 'px';
    el.style.width = W + 'px';
    el.style.height = H + 'px';
  });

  setTimeout(function () {
    if (gen !== xc.gen) return;         /* 这期间已经关掉或换了新的 */
    xc.busy = false;
    var x = el.querySelector('.xc-x');
    if (x) x.focus({ preventScroll: true });
  }, 440);

  bg.addEventListener('pointerdown', function (e) { e.preventDefault(); closeTermCard(); });
  el.addEventListener('click', function (e) {
    if (e.target && e.target.closest && e.target.closest('.xc-x')) closeTermCard();
  });
}

function closeTermCard() {
  var el = xc.card, bg = xc.bg, ti = xc.ti;
  if (!el) return;
  var gen = ++xc.gen;                   /* 作废进行中的 open 计时器 */
  /* 立刻置空：再点遮罩、再按 Esc 都进不来第二次，清理只跑一遍 */
  xc.card = null; xc.bg = null; xc.ti = -1; xc.busy = true;
  el.classList.remove('on');
  /* 关闭动画期间的点击要能穿透到底下的卡片，否则这 580ms 里点什么都没反应 */
  el.style.pointerEvents = 'none';
  if (bg) bg.style.pointerEvents = 'none';
  var card = document.querySelector('.term[data-ti="' + ti + '"]');
  var r = card ? card.getBoundingClientRect() : null;
  setTimeout(function () {
    if (bg) bg.classList.remove('on');
    if (r) {
      el.style.left = r.left + 'px';
      el.style.top = r.top + 'px';
      el.style.width = r.width + 'px';
      el.style.height = r.height + 'px';
    }
  }, 110);
  setTimeout(function () {
    if (el.parentNode) el.parentNode.removeChild(el);
    if (bg && bg.parentNode) bg.parentNode.removeChild(bg);
    if (gen !== xc.gen) return;          /* 期间又开了新的：别动新面板的状态 */
    xcUnlockScroll();
    xc.busy = false;
    if (card && card.parentNode) { card.setAttribute('aria-expanded', 'false'); card.focus({ preventScroll: true }); }
  }, 580);
}

/* 打开期间锁住页面滚动。
   不锁的话滚动后卡片已经挪走，关闭时面板会去追那个新位置 —— 看起来就是「被往上拽」，
   而不是原路缩回。锁住之后关闭必然回到同一处。 */
function xcLockScroll() {
  var sw = window.innerWidth - document.documentElement.clientWidth;
  document.documentElement.classList.add('xc-lock');
  if (sw > 0) document.body.style.paddingRight = sw + 'px';
}
function xcUnlockScroll() {
  document.documentElement.classList.remove('xc-lock');
  document.body.style.paddingRight = '';
}

/* 打开期间：Esc 收起；窗口尺寸变了就收起（面板是按像素定位的，尺寸一变会错位） */
(function () {
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && xc.card) closeTermCard();
  });
  window.addEventListener('resize', function () {
    if (xc.card && !xc.busy) closeTermCard();
  });
})();

/* =========================================================
   四、避坑：广告法禁用词自检
   ========================================================= */
var gdState = { text: GUARD_DEMO };

/* 最长优先匹配，命中区间不重叠 */
function scanBanned(text) {
  var used = [];
  for (var i = 0; i < text.length; i++) used.push(0);
  var dict = BANNED.slice().sort(function (a, b) { return b.w.length - a.w.length; });
  var hits = [];

  dict.forEach(function (item) {
    var from = 0, idx;
    while ((idx = text.indexOf(item.w, from)) !== -1) {
      var free = true;
      for (var i = idx; i < idx + item.w.length; i++) if (used[i]) { free = false; break; }
      if (free) {
        for (var j = idx; j < idx + item.w.length; j++) used[j] = 1;
        hits.push({ w: item.w, c: item.c, s: item.s, r: item.r, i: idx });
      }
      from = idx + item.w.length;
    }
  });
  hits.sort(function (a, b) { return a.i - b.i; });
  return { hits: hits, used: used };
}

function guardPreview(sc) {
  if (!gdState.text) return '<span class="gd-empty">上面输入文案，这里会实时标出不能用的词</span>';
  var out = '', i = 0, t = gdState.text;
  while (i < t.length) {
    if (sc.used[i]) {
      var j = i;
      while (j < t.length && sc.used[j]) j++;
      out += '<mark>' + esc(t.slice(i, j)) + '</mark>';
      i = j;
    } else {
      out += esc(t.charAt(i));
      i++;
    }
  }
  return out;
}

function guardHits(sc) {
  if (!sc.hits.length) {
    return '<div class="gd-ok">没检出禁用词。不过「真实、可举证」这一条仍然要自己把关 —— 词库管得住词，管不住事实。</div>';
  }
  var byCat = {};
  sc.hits.forEach(function (h) {
    if (!byCat[h.c]) byCat[h.c] = [];
    if (byCat[h.c].indexOf(h.w) === -1) byCat[h.c].push(h.w);
  });

  var out = '<div class="hit-top">检出 <b>' + sc.hits.length + '</b> 处风险表述，分布在 ' + Object.keys(byCat).length + ' 类</div>';
  out += '<div class="hit-cols">';
  Object.keys(byCat).sort().forEach(function (c) {
    out += '<div class="hit-c"><div class="hit-cat">' + RULES[c] + '<span>' + byCat[c].length + ' 处</span></div>';
    byCat[c].forEach(function (w) {
      var item = null;
      for (var i = 0; i < BANNED.length; i++) if (BANNED[i].w === w) { item = BANNED[i]; break; }
      if (!item) return;
      out += '<div class="hit"><b>' + esc(w) + '</b><span>' + esc(item.s) + '</span></div>';
    });
    out += '</div>';
  });
  out += '</div>';
  return out;
}

function viewGuard() {
  var h = '';
  h += '<div class="head"><div><h1>避坑</h1>'
    + '<div class="sub">粘贴标题或详情页文案，查广告法禁用词 · 词库 ' + BANNED.length + ' 条</div></div></div>';

  h += '<div class="g2">';
  h += '<div class="card"><div class="card-h"><span class="card-t">要检查的文案</span>'
    + '<span class="card-s">边打边查，不用点按钮</span></div>'
    + '<textarea id="gdta" spellcheck="false" placeholder="把标题、卖点、详情页第一段贴进来">' + esc(gdState.text) + '</textarea>'
    + '<div class="gd-act"><button id="gdrewrite">一键改成可用版本</button>'
    + '<span class="gd-tip">改写只替换能自动替换的，剩下的会标出来让你自己定</span></div>'
    + '</div>';

  var sc = scanBanned(gdState.text);
  h += '<div class="card"><div class="card-h"><span class="card-t">标记结果</span>'
    + '<span class="card-s">' + (sc.hits.length ? sc.hits.length + ' 处' : '干净') + '</span></div>'
    + '<div class="gd-prev" id="gdp">' + guardPreview(sc) + '</div></div>';
  h += '</div>';

  h += '<div class="card" id="gdh">' + guardHits(sc) + '</div>';
  return h;
}

function guardRewrite() {
  var sc = scanBanned(gdState.text);
  if (!sc.hits.length) return;
  var out = '', cur = 0, manual = 0;
  sc.hits.forEach(function (h) {
    out += gdState.text.slice(cur, h.i);
    if (h.r !== undefined) out += h.r;
    else { out += h.w; manual++; }
    cur = h.i + h.w.length;
  });
  out += gdState.text.slice(cur);
  gdState.text = out
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+([，。！？、；：,!.?）)（(])/g, '$1')
    .replace(/([，。！？、；：（(])[ \t]+/g, '$1')
    .replace(/([，。！？、；：])\1+/g, '$1')
    .replace(/^[ \t]+|[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n');
  render('guard', { keepScroll: true });
  var note = $('#gdh');
  if (note && manual) {
    var d = document.createElement('div');
    d.className = 'gd-manual';
    d.textContent = '有 ' + manual + ' 处没有通用替代写法，已原样保留 —— 这几处要按你的真实数据或实际活动来改，工具代劳不了。';
    note.appendChild(d);
  }
}

/* =========================================================
   五、试价：从售价倒推赚不赚
   ========================================================= */
var prState = { price: 89, cost: 32, comm: 5, ship: 6.5, ad: 18, refund: 5 };

function calcPrice() {
  var p = prState.price, c = prState.cost, k = prState.comm / 100;
  var s = prState.ship, a = prState.ad, r = prState.refund / 100;
  var rev = p * (1 - r);
  var commAmt = p * k;
  var gpNoAd = rev - c - commAmt - s;      /* 推广前毛利 = 每单能拿去买流量的上限 */
  var net = gpNoAd - a;
  return {
    rev: rev, commAmt: commAmt, gpNoAd: gpNoAd, net: net,
    rate: p > 0 ? net / p * 100 : 0,
    beRoas: gpNoAd > 0 ? p / gpNoAd : null,
    adMax: gpNoAd,
    bePrice: (1 - r - k) > 0 ? (c + s + a) / (1 - r - k) : null,
    roas: a > 0 ? p / a : null,
    cushion: null
  };
}

function priceOut() {
  var r = calcPrice();
  var ver = r.net < 0
    ? { t: 'bad', s: '每卖一单亏 ' + money(Math.abs(r.net), 2) + '。按现在这个成本结构，卖得越多亏得越多。' }
    : r.rate < 5 ? { t: 'bad', s: '薄得像纸：每单只赚 ' + money(r.net, 2) + '，退一单要 ' + num(prState.price / Math.max(r.net, 0.01), 1) + ' 单才能补回来。' }
      : r.rate < 15 ? { t: 'mid', s: '偏薄，但能跑量。净利率 ' + pct(r.rate, 1) + '，靠规模而非单均赚钱。' }
        : { t: 'ok', s: '健康。净利率 ' + pct(r.rate, 1) + '，有空间做活动和达人佣金。' };

  var h = '';
  h += '<div class="pr-big ' + ver.t + '">' + money(r.net, 2) + '</div>';
  h += '<div class="pr-sub">每单净利 · 净利率 ' + pct(r.rate, 1) + ' · 实收 ' + money(r.rev, 2) + '</div>';
  h += '<div class="pr-verdict ' + ver.t + '">' + esc(ver.s) + '</div>';

  h += '<div class="pr-grid">';
  h += '<div class="pr-i"><div class="lb">保本 ROAS</div><div class="v">' + (r.beRoas ? r.beRoas.toFixed(2) : '—') + '</div>'
    + '<div class="s">' + (r.beRoas ? '广告花 1 元，至少要带回 ' + money(r.beRoas, 2) + ' 的 GMV' : '推广前就没有毛利，无法买量') + '</div></div>';
  h += '<div class="pr-i"><div class="lb">每单推广费上限</div><div class="v">' + money(r.adMax, 2) + '</div>'
    + '<div class="s">当前 ' + money(prState.ad, 2) + (r.adMax > prState.ad ? '，还有 ' + money(r.adMax - prState.ad, 2) + ' 余量' : '，已超 ' + money(prState.ad - r.adMax, 2)) + '</div></div>';
  h += '<div class="pr-i"><div class="lb">保本售价</div><div class="v">' + (r.bePrice ? money(r.bePrice, 2) : '—') + '</div>'
    + '<div class="s">' + (r.bePrice ? (prState.price >= r.bePrice ? '当前售价高于保本线 ' + money(prState.price - r.bePrice, 2) : '当前售价低于保本线 ' + money(r.bePrice - prState.price, 2)) : '佣金率＋退货率已超过 100%') + '</div></div>';
  h += '<div class="pr-i"><div class="lb">实际 ROAS</div><div class="v">' + (r.roas ? r.roas.toFixed(2) : '—') + '</div>'
    + '<div class="s">' + (r.roas && r.beRoas ? (r.roas >= r.beRoas ? '高于保本线，投放是赚的' : '低于保本线，每单广告在亏') : '未填推广费') + '</div></div>';
  h += '</div>';

  return h;
}

function priceBars() {
  var r = calcPrice();
  var h = '';
  var rows = [
    ['售价', prState.price, 'base'],
    ['退款损耗 ' + pct(prState.refund, 1), -prState.price * prState.refund / 100, 'neg'],
    ['商品成本', -prState.cost, 'neg'],
    ['平台佣金', -r.commAmt, 'neg'],
    ['快递包材', -prState.ship, 'neg'],
    ['推广费', -prState.ad, 'neg'],
    ['每单净利', r.net, 'net']
  ];
  var den = prState.price > 0 ? prState.price : 1;
  rows.forEach(function (x) {
    var w = Math.abs(x[1]) / den * 100;
    h += '<div class="wf-r ' + x[2] + '"><span class="wf-l">' + esc(x[0]) + '</span>'
      + '<span class="wf-t"><span class="wf-f" style="width:' + Math.max(1.5, w).toFixed(1) + '%"></span></span>'
      + '<span class="wf-v">' + (x[1] < 0 ? '−' : '') + money(Math.abs(x[1]), 2) + '</span>'
      + '<span class="wf-p">' + pct(Math.abs(x[1]) / den * 100, 0) + '</span></div>';
  });
  return h;
}

function viewPrice() {
  var h = '';
  h += '<div class="head"><div><h1>试价</h1>'
    + '<div class="sub">从售价倒推：这单到底赚不赚，推广费最多能花到多少</div></div>'
    + '<button class="act" id="prreset">清空</button></div>';

  h += '<div class="g2">';
  h += '<div class="card"><div class="card-h"><span class="card-t">成本结构</span>'
    + '<span class="card-s">点商品名直接带入</span></div>';
  h += '<div class="chips" id="prc">';
  SKUS.forEach(function (s, i) {
    h += '<span class="chip" data-sku="' + i + '">' + esc(s.name) + '</span>';
  });
  h += '</div>';
  h += '<div class="fx-fields pr-fields">';
  var f = [
    ['price', '售价（元）', prState.price],
    ['cost', '采购成本（元）', prState.cost],
    ['comm', '平台佣金率（%）', prState.comm],
    ['ship', '快递包材（元/单）', prState.ship],
    ['ad', '推广费（元/单）', prState.ad],
    ['refund', '退货率（%）', prState.refund]
  ];
  f.forEach(function (x) {
    h += '<div class="field"><label>' + x[1] + '</label>'
      + '<input type="number" step="any" data-p="' + x[0] + '" value="' + x[2] + '"></div>';
  });
  h += '</div></div>';

  h += '<div class="card"><div class="card-h"><span class="card-t">结论</span></div>'
    + '<div id="prout">' + priceOut() + '</div></div>';
  h += '</div>';

  h += '<div class="card"><div class="card-h">'
    + '<span class="card-t">成本拆解</span>'
    + '<span class="card-s">从售价一路扣下去，看最后剩下多少</span></div>'
    + '<div id="prbar">' + priceBars() + '</div></div>';
  return h;
}

/* =========================================================
   六、关于：这本小册是什么，数字从哪来
   ========================================================= */
function viewAbout() {
  var h = '';
  h += '<div class="head"><div><h1>关于</h1>'
    + '<div class="sub">这本小册是什么，数字从哪来，哪里只能当示例</div></div></div>';

  h += '<div class="card abt-open">';
  h += '<p class="abt-lead">电商这行没有教科书。104 个术语、53 条公式，散在手册、后台报表和老员工的口头传授里。'
    + '新人卡住的往往不是「不知道这个词」，而是「不知道该先看哪个数」。</p>';
  h += '<p class="abt-lead">这本小册把它们按「先看懂，再动手」重排了一遍。每页都能单独用，'
    + '串起来是一条从看数、算数，到改文案、定价格的完整路子。</p>';
  h += '</div>';

  /* 六个页面 */
  var rows = [
    ['拆解', 'GMV 由七个乘数相乘而来', '哪个乘数最该改、改完能多多少、钱最后剩多少'],
    ['算账', '53 条指标公式', '每条一句人话、一个中文算式、一次代入计算'],
    ['认词', '104 个术语', '中英对照，按业务环节分八类'],
    ['避坑', '67 条广告法禁用词', '贴文案查风险词，能自动改的直接给改法'],
    ['试价', '一个商品的账', '从售价倒推净利、保本 ROAS、推广费还能花多少'],
    ['关于', '你正看的这一页', '数字哪来的、哪里只能当示例、怎么换成自己的']
  ];
  h += '<div class="card">';
  h += '<div class="card-h"><span class="card-t">六页分别解决什么</span>'
    + '<span class="card-s">看懂三页，动手两页，最后这一页交代底细</span></div>';
  rows.forEach(function (r) {
    h += '<div class="page-row"><span class="page-n">' + esc(r[0]) + '</span>'
      + '<span class="page-d">' + esc(r[1]) + '</span>'
      + '<span class="page-x">' + esc(r[2]) + '</span></div>';
  });
  h += '</div>';

  /* 数据来源 + 边界 */
  h += '<div class="g2">';

  h += '<div class="card"><div class="card-h"><span class="card-t">数字从哪来</span></div>';
  h += '<div class="abt-li"><span class="no">01</span><div><b>拆解、试价</b>'
    + '<p>示例店铺，家居日用类目，月 GMV 约 25.7 万。七个乘数和每项成本彼此自洽，能一路复算到净利，'
    + '但它不是任何一家店的真实经营数据。</p></div></div>';
  h += '<div class="abt-li"><span class="no">02</span><div><b>算账、认词</b>'
    + '<p>来自一份 104 条术语、53 条公式的行业手册，逐条结构化。公式全部可求值，'
    + '默认值是按常见量级填的示例数，不是标准答案。</p></div></div>';
  h += '<div class="abt-li"><span class="no">03</span><div><b>避坑</b>'
    + '<p>依据《广告法》第九条、第二十八条，以及各平台公开的违规案例归纳。'
    + '词库能覆盖常见的坑，但不等于法务审核。</p></div></div>';
  h += '</div>';

  h += '<div class="card"><div class="card-h"><span class="card-t">明确不做的事</span></div>';
  h += '<div class="abt-li"><span class="no">—</span><div><b>不自动同步后台</b>'
    + '<p>数是要你自己贴进来的：报表导出、复制、粘贴。不做接口对接 —— '
    + '那要企业资质、服务器和密钥，而且同步过来的数你还得核对一遍口径，省不了多少事。</p></div></div>';
  h += '<div class="abt-li"><span class="no">—</span><div><b>没有账号和协作</b>'
    + '<p>没有服务端，没有登录。默认数在 data.js，你贴进来的数在本机浏览器里，两者不会混。</p></div></div>';
  h += '<div class="abt-li"><span class="no">—</span><div><b>示例不能当结论</b>'
    + '<p>这些数字能证明算法是对的，不能证明生意好不好。换成自己的数，结论才有意义。</p></div></div>';
  h += '</div>';
  h += '</div>';

  /* 设计取舍 */
  var design = [
    ['品牌色用深青，不用红绿', '红涨绿跌是硬语义。品牌色一旦占了红色，报表里的「上涨」和「报错」就分不清了。'],
    ['暖纸底 + 标题宋体，正文无衬线', '纸的味道放在字上，精度放在数上。标题用宋体像一本册子，数字用无衬线加等宽才读得快。'],
    ['只留一层贴桌面的阴影', '阴影只用来把卡片和纸面分开，不做漂浮感。层数一多，界面立刻变回模板。'],
    ['金额和百分比全部等宽', 'tabular-nums 让小数点上下对齐。专业感来自对齐，不来自加粗。'],
    ['漏斗用横条，不用梯形', '梯形靠面积表示数值，人眼读不准；横条带百分比，能一眼定位流失环节。'],
    ['一屏只有一个主角', '拆解页的 GMV 是 44px，其余退到 12px。没有主次的界面，看的人不知道先看哪里。']
  ];
  h += '<div class="card">';
  h += '<div class="card-h"><span class="card-t">设计上做了哪些取舍</span>'
    + '<span class="card-s">每一条都是为了让人少想一步</span></div>';
  design.forEach(function (d, i) {
    h += '<div class="abt-li"><span class="no">' + (i + 1 < 10 ? '0' : '') + (i + 1) + '</span>'
      + '<div><b>' + esc(d[0]) + '</b><p>' + esc(d[1]) + '</p></div></div>';
  });
  h += '</div>';

  /* 换成自己的数据 */
  h += '<div class="card">';
  h += '<div class="card-h"><span class="card-t">换成你自己的数据</span>'
    + '<span class="card-s">不用改代码，贴一张报表就行</span></div>';
  h += '<div class="abt-li"><span class="no">01</span><div><b>在「我的数」里贴报表</b>'
    + '<p>从后台或 Excel 里选中那 13 个数，Ctrl+V 贴进去。'
    + '先给率（点击率 3.2%）也行，给原始计数（点击 59,200、曝光 1,850,000）也行 —— 后者会自己相除。</p></div></div>';
  h += '<div class="abt-li"><span class="no">02</span><div><b>对一遍再应用</b>'
    + '<p>每一项都标了「报表直接给」还是「由 59,200 ÷ 1,850,000 算出」，你能一眼看出哪一项认错了。'
    + '缺了关键项会拦住不让用 —— 宁可不让用，也不拿默认值糊一个假结论。</p></div></div>';
  h += '<div class="abt-li"><span class="no">03</span><div><b>想换个电脑接着用</b>'
    + '<p>「我的数」里点<b>导出数据</b>，会下载一个 JSON；到新电脑、新浏览器点<b>导入数据</b>选它，'
    + '店名、周期、七个乘数、六个财务参数一起还原。这份文件别随手发出去 —— 里面是你的经营数据。</p></div></div>';
  h += '<div class="abt-li"><span class="no">04</span><div><b>想改源码也行</b>'
    + '<p>不习惯贴表，就直接改 <span class="abt-code">data.js</span> 里的 <span class="abt-code">STORE</span>：'
    + '七个乘数加六个财务参数，改完全站重算，因为页面里不存任何算好的结果。</p></div></div>';
  h += '</div>';

  /* 数据在哪 */
  h += '<div class="card">';
  h += '<div class="card-h"><span class="card-t">你的数据去哪了</span>'
    + '<span class="card-s">这一条比功能更要紧</span></div>';
  h += '<div class="abt-lead">贴进来的数只写进<b>你这台电脑的浏览器</b>（localStorage），'
    + '不上传、不发请求、没有账号。换一台电脑、换一个浏览器，都得重贴一次。</div>';
  h += '<div class="abt-lead" style="color:var(--ink2)">反过来说：如果你把这份作品放到公网上给人看，'
    + '别人打开时看到的是<b>他自己浏览器里的数据</b>，看不到你的。这一点和直接把数写进源码正好相反 —— '
    + '写进源码的数是公开的，贴进去的数是本地的。</div>';
  h += '</div>';

  h += '<div class="abt-foot">纯静态：HTML + CSS + 原生 JS。无框架、无构建、无外部请求，'
    + '双击 index.html 就能跑，断网也一样。</div>';
  return h;
}

/* =========================================================
   路由
   ========================================================= */

/* =========================================================
   我的数：把真实报表接进来
   数据只存在这台电脑的浏览器里，不上传任何地方。
   注意：双击打开时是 file:// 源，同一浏览器里其它本地网页也能读到
   localStorage，所以默认可以选「不记住」，退化成只留到关页面。
   ========================================================= */

var STORE_KEY = 'donghang_store_v1';
var PERSIST_KEY = 'donghang_persist_v1';
var persistOn = true;          /* 记住这份数据：开=localStorage，关=sessionStorage */
var IS_CUSTOM = false;

/* 出厂值，用来「换回示例」 */
var STORE_BASE = JSON.parse(JSON.stringify({
  name: STORE.name,
  period: STORE.period,
  nodes: STORE.nodes,
  fin: {
    refundRate: STORE.refundRate, grossMargin: STORE.grossMargin, adSpend: STORE.adSpend,
    shipPerOrder: STORE.shipPerOrder, commRate: STORE.commRate, fixedCost: STORE.fixedCost
  }
}));

var FIN_KEYS = ['refundRate', 'grossMargin', 'adSpend', 'shipPerOrder', 'commRate', 'fixedCost'];

function readPersistPref() {
  try { if (localStorage.getItem(PERSIST_KEY) === '0') persistOn = false; } catch (e) { }
}
function writePersistPref() {
  try { localStorage.setItem(PERSIST_KEY, persistOn ? '1' : '0'); } catch (e) { }
}
function storePayload() {
  return JSON.stringify({
    name: STORE.name,
    period: STORE.period,
    nodes: STORE.nodes.map(function (n) { return { k: n.k, v: n.v, p: n.p, b: n.b }; }),
    fin: (function () {
      var o = {};
      FIN_KEYS.forEach(function (k) { o[k] = STORE[k]; });
      return o;
    })()
  });
}

function saveStore() {
  var json = storePayload();
  try {
    (persistOn ? localStorage : sessionStorage).setItem(STORE_KEY, json);
    /* 另一侧不留副本：关掉「记住」时旧的长效副本必须一起清掉 */
    try { (persistOn ? sessionStorage : localStorage).removeItem(STORE_KEY); } catch (e2) { }
    return true;
  } catch (e) { return false; }
}

/* 把一份数据对象写进 STORE：只认有限数字，类型不对的整条忽略。
   本地存储和导入的 JSON 都走这里，校验只有一处 */
function applyStoreObject(o) {
  if (!o || !o.nodes || !o.nodes.length) return false;
  o.nodes.forEach(function (sv) {
    if (!sv || typeof sv.k !== 'string') return;
    for (var i = 0; i < STORE.nodes.length; i++) {
      if (STORE.nodes[i].k !== sv.k) continue;
      if (typeof sv.v === 'number' && isFinite(sv.v)) STORE.nodes[i].v = sv.v;
      STORE.nodes[i].p = (typeof sv.p === 'number' && isFinite(sv.p)) ? sv.p : null;
      STORE.nodes[i].b = (typeof sv.b === 'number' && isFinite(sv.b)) ? sv.b : null;
    }
  });
  if (o.fin) FIN_KEYS.forEach(function (k) {
    if (typeof o.fin[k] === 'number' && isFinite(o.fin[k])) STORE[k] = o.fin[k];
  });
  if (typeof o.name === 'string' && o.name) STORE.name = o.name.slice(0, 40);
  if (typeof o.period === 'string' && o.period) STORE.period = o.period.slice(0, 60);
  return true;
}

function loadStore() {
  var raw = null;
  try {
    raw = sessionStorage.getItem(STORE_KEY) || localStorage.getItem(STORE_KEY);
  } catch (e) { return false; }
  if (!raw) return false;
  try {
    if (!applyStoreObject(JSON.parse(raw))) return false;
    IS_CUSTOM = true;
    return true;
  } catch (e) { return false; }
}

/* 导出：一份自带说明的 JSON，换电脑、重装、交给别人都能还原 */
function storeExportObject() {
  var o = JSON.parse(storePayload());
  o.app = '懂行 · 电商人的随身助手';
  o.version = 1;
  o.exportedAt = new Date().toISOString();
  return o;
}

function exportStore() {
  try {
    var blob = new Blob([JSON.stringify(storeExportObject(), null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'donghang-data-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(a.href);
      if (a.parentNode) a.parentNode.removeChild(a);
    }, 600);
    toast('已导出 JSON —— 里面有你的经营数据，别随手发出去');
  } catch (e) {
    toast('这台浏览器不让下载，可以改用「下载模板」那条路');
  }
}

function importStoreFile(f) {
  if (f.size > 262144) { toast('文件太大了，导出的数据一般不到 10 KB'); return; }
  var rd = new FileReader();
  rd.onload = function () {
    var o;
    try { o = JSON.parse(String(rd.result || '')); } catch (e) { toast('这不是导出的 JSON 文件'); return; }
    if (!applyStoreObject(o)) { toast('文件里没有能用的数据项'); return; }
    TREE = buildTree();
    IS_CUSTOM = true;
    saveStore();
    render('data', { keepScroll: true });
    toast('数据已导入 · 拆解页已按这份数重算');
  };
  rd.onerror = function () { toast('这个文件读不出来'); };
  rd.readAsText(f, 'utf-8');
}

function restoreDefault() {
  try { localStorage.removeItem(STORE_KEY); } catch (e) { }
  try { sessionStorage.removeItem(STORE_KEY); } catch (e) { }
  IS_CUSTOM = false;
  STORE.name = STORE_BASE.name;
  STORE.period = STORE_BASE.period;
  STORE.nodes.forEach(function (n) {
    STORE_BASE.nodes.forEach(function (b) {
      if (b.k === n.k) { n.v = b.v; n.p = b.p; n.b = b.b; }
    });
  });
  FIN_KEYS.forEach(function (k) { STORE[k] = STORE_BASE.fin[k]; });
  TREE = buildTree();
}

function toast(msg) {
  var d = document.createElement('div');
  d.className = 'toast';
  d.textContent = msg;
  document.body.appendChild(d);
  setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, 3400);
}

/* ---- 页面上用 ---- */
var dtState = { text: '' };
var dtTimer = 0;

/* ---- 统计周期 · 日期区间选择 ----
   点日期字段开日历；先点开始再点结束，中间连续高亮；确认后回填完整区间到 STORE.period */
var drState = { y: 0, m: 0, s: null, e: null, hover: null, init: false, docBound: false };

function drCmp(a, b) { return (a.y - b.y) || (a.m - b.m) || (a.d - b.d); }
function drFmt(o) { return o.y + ' 年 ' + (o.m + 1) + ' 月 ' + o.d + ' 日'; }
function drRangeText(s, e) {
  if (s.y === e.y && s.m === e.m) return s.y + ' 年 ' + (s.m + 1) + ' 月 ' + s.d + '–' + e.d + ' 日';
  if (s.y === e.y) return s.y + ' 年 ' + (s.m + 1) + ' 月 ' + s.d + ' 日 – ' + (e.m + 1) + ' 月 ' + e.d + ' 日';
  return drFmt(s) + ' – ' + drFmt(e);
}

/* 打开时播种：能从现有周期文字里认出完整日期就带上，认不出就落在今天那个月 */
function drSeed() {
  var now = new Date();
  drState.y = now.getFullYear(); drState.m = now.getMonth();
  drState.s = null; drState.e = null; drState.hover = null;
  var t = STORE.period || '', m, all = [];
  var re = /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/g;
  while ((m = re.exec(t))) all.push({ y: +m[1], m: +m[2] - 1, d: +m[3] });
  if (all.length) {
    drState.y = all[0].y; drState.m = all[0].m;
    if (all.length > 1) { drState.s = all[0]; drState.e = all[all.length - 1]; }
  } else {
    m = t.match(/(\d{4})\s*年\s*(\d{1,2})\s*月/);
    if (m) { drState.y = +m[1]; drState.m = +m[2] - 1; }
  }
  drState.init = true;
}

function drCalendar() {
  var y = drState.y, mo = drState.m;
  var startWd = (new Date(y, mo, 1).getDay() + 6) % 7;      /* 周一打头 */
  var days = new Date(y, mo + 1, 0).getDate();
  var h = '<div class="dr-hd">'
    + '<button type="button" class="dr-nav" id="drPrev" aria-label="上一月">&#8249;</button>'
    + '<span class="dr-tt">' + y + ' 年 ' + (mo + 1) + ' 月</span>'
    + '<button type="button" class="dr-nav" id="drNext" aria-label="下一月">&#8250;</button>'
    + '</div><div class="dr-wk">';
  '一二三四五六日'.split('').forEach(function (w) { h += '<span>' + w + '</span>'; });
  h += '</div><div class="dr-grid">';
  for (var i = 0; i < startWd; i++) h += '<span class="dr-d out"></span>';
  for (var d = 1; d <= days; d++) h += '<button type="button" class="dr-d" data-d="' + d + '">' + d + '</button>';
  var tail = (startWd + days) % 7;
  if (tail) for (var j = tail; j < 7; j++) h += '<span class="dr-d out"></span>';
  h += '</div><div class="dr-ft"><span class="dr-hint" id="drHint"></span>'
    + '<span class="dr-act"><button type="button" class="btn ghost dr-btn" id="drClear">清除</button>'
    + '<button type="button" class="btn dr-btn" id="drOk">确认</button></span></div>';
  return h;
}

/* 高亮单独算：月份切换重建格子，悬停预览只改类名不重建，避免闪烁 */
function drPaint() {
  var p = $('#drpanel');
  if (!p) return;
  var end = drState.e;
  if (!end && drState.s && drState.hover && drCmp(drState.hover, drState.s) > 0) end = drState.hover;
  Array.prototype.forEach.call(p.querySelectorAll('.dr-d:not(.out)'), function (b) {
    var o = { y: drState.y, m: drState.m, d: +b.getAttribute('data-d') };
    b.classList.remove('in', 's', 'e');
    if (!drState.s) return;
    var cs = drCmp(o, drState.s);
    if (end) {
      var ce = drCmp(o, end);
      if (cs >= 0 && ce <= 0) {
        b.classList.add('in');
        if (cs === 0) b.classList.add('s');
        if (ce === 0) b.classList.add('e');
      }
    } else if (cs === 0) {
      b.classList.add('in', 's');
    }
  });
  var hint = $('#drHint'), ok = $('#drOk');
  if (hint) hint.textContent = !drState.s ? '点一个开始日期'
    : (!drState.e ? '再点一个结束日期' : drRangeText(drState.s, drState.e));
  if (ok) ok.disabled = !(drState.s && drState.e);
}

function drRebuild() {
  var p = $('#drpanel');
  if (p) p.innerHTML = drCalendar();
  drPaint();
}
function drOpen() {
  if (!drState.init) drSeed();
  drRebuild();
  var w = $('#drange');
  if (w) w.classList.add('open');
  var pd = $('#dperiod');
  if (pd) pd.setAttribute('aria-expanded', 'true');
}
function drClose() {
  var w = $('#drange');
  if (w) w.classList.remove('open');
  var pd = $('#dperiod');
  if (pd) pd.setAttribute('aria-expanded', 'false');
}
function drConfirm() {
  if (!drState.s || !drState.e) return;
  var t = drRangeText(drState.s, drState.e);
  STORE.period = t;
  var pd = $('#dperiod');
  if (pd) pd.value = t;
  saveStore();
  drClose();
  toast('统计周期已更新');
}

/* 绑定：输入框开合；面板里用事件委托接月份切换、选日、清除、确认 */
function bindDateRange() {
  var w = $('#drange'), pd = $('#dperiod'), p = $('#drpanel');
  if (!w || !pd || !p) return;

  pd.addEventListener('click', function () {
    if (w.classList.contains('open')) drClose(); else drOpen();
  });

  p.addEventListener('click', function (e) {
    var t = e.target;
    if (t.id === 'drPrev' || t.id === 'drNext') {
      drState.m += (t.id === 'drNext' ? 1 : -1);
      if (drState.m < 0) { drState.m = 11; drState.y--; }
      if (drState.m > 11) { drState.m = 0; drState.y++; }
      drState.hover = null;
      drRebuild();
      return;
    }
    if (t.id === 'drClear') { drState.s = null; drState.e = null; drState.hover = null; drRebuild(); return; }
    if (t.id === 'drOk') { drConfirm(); return; }
    var d = t.closest ? t.closest('.dr-d') : null;
    if (d && !d.classList.contains('out')) {
      var o = { y: drState.y, m: drState.m, d: +d.getAttribute('data-d') };
      if (!drState.s || (drState.s && drState.e)) { drState.s = o; drState.e = null; }
      else if (drCmp(o, drState.s) < 0) { drState.s = o; }
      else { drState.e = o; }
      drState.hover = null;
      drRebuild();
    }
  });

  /* 先选了开始、还没选结束：悬停到哪，中间就预览到哪 */
  p.addEventListener('mouseover', function (e) {
    var d = e.target.closest ? e.target.closest('.dr-d') : null;
    if (!d || d.classList.contains('out')) return;
    if (drState.s && !drState.e) {
      drState.hover = { y: drState.y, m: drState.m, d: +d.getAttribute('data-d') };
      drPaint();
    }
  });
  p.addEventListener('mouseleave', function () {
    if (drState.hover) { drState.hover = null; drPaint(); }
  });

  /* 点外面 / Esc 收起：面板重建过就重新绑，绑一次就够 */
  if (!drState.docBound) {
    drState.docBound = true;
    document.addEventListener('pointerdown', function (e) {
      var w = $('#drange');
      if (w && w.classList.contains('open') && !w.contains(e.target)) drClose();
    });
    document.addEventListener('keydown', function (e) {
      var w = $('#drange');
      if (e.key === 'Escape' && w && w.classList.contains('open')) drClose();
    });
  }
}

function fmtNodeVal(k, v) {
  if (v === null || v === undefined || !isFinite(v)) return '—';
  var node = null;
  for (var i = 0; i < STORE.nodes.length; i++) if (STORE.nodes[i].k === k) node = STORE.nodes[i];
  if (!node) return num(v, 2);
  if (node.t === 'pct') return pct(v * 100, 2);
  if (node.t === 'money') return money(v, 2);
  return num(v, 0);
}

var FIN_ROWS = [
  ['refundRate', '退款率', 'rate'],
  ['grossMargin', '毛利率', 'rate'],
  ['adSpend', '推广费', 'money'],
  ['shipPerOrder', '单均运费', 'money'],
  ['commRate', '平台佣金率', 'rate'],
  ['fixedCost', '固定成本', 'money']
];

function dvPreview() {
  var open = '<div class="card"><div class="card-h"><span class="card-t">② 对一下认出来的数</span>';
  var tail = '</div>';

  if (!dtState.text.trim()) {
    return open + '<span class="card-s">贴完之后这里逐项列出来</span></div>'
      + '<div class="empty dt-empty">还没贴内容。贴进来以后，每一项都会标出是「报表直接给的」还是「两个数相除算出来的」，'
      + '你一眼能看出对不对。</div>' + tail;
  }

  var r = readReport(dtState.text);
  if (!r.ok) {
    return open + '<span class="card-s">一个都没认出来</span></div>'
      + '<div class="dt-warn">这份表里一个指标也没认出来。多半是<b>明细表</b>（一行一个商品，或者一行一天），'
      + '而看板要的是<b>汇总表</b> —— 13 个数各一行。点上面的「下载模板」，填完贴回来最快。</div>'
      + (r.skipped && r.skipped.length
        ? '<div class="dt-gap">没认出来的头几行：' + esc(r.skipped.join('、')) + '</div>' : '')
      + tail;
  }

  var v = buildValues(r.fields);
  var out = open + '<span class="card-s">认出 ' + r.matched + ' 项 · '
    + (r.sep === '制表符' ? '按制表符拆的（从 Excel 复制过来的）' : '按' + r.sep + '拆的') + '</span></div>';

  out += '<div class="dt-tbl">';
  out += '<div class="dt-tr dt-th"><span>指标</span><span>本期</span><span>上期</span><span>均值</span><span>怎么来的</span></div>';
  STORE.nodes.forEach(function (node) {
    var n = v.nodes[node.k];
    var ok = !!n;
    out += '<div class="dt-tr' + (ok ? '' : ' miss') + '">'
      + '<span class="dt-n">' + esc(node.n) + '</span>'
      + '<span class="dt-v">' + (ok ? fmtNodeVal(node.k, n.v) : '<i>缺</i>') + '</span>'
      + '<span class="dt-v2">' + (ok ? fmtNodeVal(node.k, n.p) : '—') + '</span>'
      + '<span class="dt-v2">' + (ok ? fmtNodeVal(node.k, n.b) : '—') + '</span>'
      + '<span class="dt-src">' + (ok ? esc(n.src) : '报表里没有，也推不出来') + '</span></div>';
  });
  out += '</div>';

  out += '<div class="dt-sub">财务假设</div><div class="dt-tbl fin">';
  FIN_ROWS.forEach(function (x) {
    var val = v.fin[x[0]];
    var src = v.finSrc[x[0]];
    var guess = src.indexOf('未提供') > -1;
    out += '<div class="dt-tr' + (guess ? ' guess' : '') + '">'
      + '<span class="dt-n">' + x[1] + '</span>'
      + '<span class="dt-v">' + (x[2] === 'rate' ? pct(val * 100, 1) : money(val, 2)) + '</span>'
      + '<span class="dt-src" style="grid-column:3 / -1">' + esc(src) + '</span></div>';
  });
  out += '</div>';

  if (v.missing.length) {
    out += '<div class="dt-warn">还缺 <b>' + esc(v.missing.join('、')) + '</b>。'
      + '缺这几项要么算不出 GMV，要么会把短板误判到别的环节上，所以先不放行 —— 补上再贴一次。</div>';
  } else {
    out += '<div class="dt-row"><button class="btn" id="dapply">用这份数据</button>'
      + '<span class="dt-hint">' + (persistOn
        ? '存进这台电脑的浏览器，下次打开还在；不会传到任何服务器'
        : '只留到关掉这个页面；不会传到任何服务器') + '</span></div>';
  }
  return out + tail;
}

function viewData() {
  var h = '';
  h += '<div class="head"><div><h1>我的数</h1>'
    + '<div class="sub">把你后台的报表贴进来，整页看板就换成你的店 · 数据只留在本机浏览器</div></div></div>';

  h += '<div class="card">';
  h += '<div class="card-h"><span class="card-t">现在用的是</span>'
    + '<span class="card-s">' + (IS_CUSTOM ? '你自己的数据' : '示例数据（不是真实经营）') + '</span></div>';
  h += '<div class="dt-meta">'
    + '<label><span>店铺名</span><input id="dname" maxlength="40" value="' + esc(STORE.name) + '"></label>'
    + '<label><span>统计周期</span><span class="dr" id="drange">'
    + '<input id="dperiod" readonly value="' + esc(STORE.period) + '" aria-haspopup="dialog" aria-expanded="false" title="点开选日期区间">'
    + '<span class="dr-panel" id="drpanel" role="dialog" aria-label="选择统计周期"></span>'
    + '</span></label>'
    + '</div>';
  h += '<div class="dt-priv"><label class="dt-chk">'
    + '<input type="checkbox" id="dpersist"' + (persistOn ? ' checked' : '') + '>'
    + '<span>记住这份数据</span></label>'
    + '<span class="dt-hint">' + (persistOn
      ? '存在这台电脑的浏览器里，下次打开还在。双击打开的方式下，同一台电脑上别的本地网页理论上也读得到 —— 介意就取消勾选。'
      : '只留到关掉这个页面为止，不写入本机存储。') + '</span></div>';
  h += '<div class="dt-row">'
    + '<button class="btn ghost" id="dexport">导出数据</button>'
    + '<label class="btn ghost" for="dfjson">导入数据</label>'
    + '<input type="file" id="dfjson" accept=".json,application/json" class="dt-file">'
    + '<span class="dt-hint">导出一份 JSON，换电脑或重装时导入就能还原；文件只留在你自己手里</span>'
    + '</div>';
  if (IS_CUSTOM) {
    h += '<div class="dt-row"><button class="btn ghost" id="dreset">换回示例数据</button></div>';
  }
  h += '</div>';

  h += '<div class="card">';
  h += '<div class="card-h"><span class="card-t">① 把报表贴进来</span>'
    + '<span class="card-s">从 Excel 或后台表格直接 Ctrl+V，也可以把 csv 拖进来</span></div>';
  h += '<div class="dt-drop" id="ddrop">'
    + '<textarea id="dtxt" spellcheck="false" placeholder="粘在这里，长这样：&#10;&#10;指标 本期 上期&#10;曝光量 1850000 1650000&#10;点击量 59200 62700&#10;进店访客 46176 48154&#10;加购人数 4340 4671&#10;…"></textarea>'
    + '</div>';
  h += '<div class="dt-row">'
    + '<button class="btn" id="dtpl">下载模板</button>'
    + '<button class="btn ghost" id="ddemo">贴一份看看</button>'
    + '<button class="btn ghost" id="dclear">清空</button>'
    + '<input type="file" id="dfile" accept=".csv,.txt,.tsv" class="dt-file">'
    + '<label class="btn ghost" for="dfile">选文件</label>'
    + '</div>';
  h += '</div>';

  h += '<div id="dvout">' + dvPreview() + '</div>';
  return h;
}

/* 把当前解析结果写进 STORE 并存下来 */
function applyImport() {
  var r = readReport(dtState.text);
  if (!r.ok) return;
  var v = buildValues(r.fields);
  if (v.missing.length) { toast('还缺 ' + v.missing.length + ' 项，补上再应用'); return; }
  if (!applyValues(v)) { toast('数据套用失败，检查一下表格格式'); return; }

  var nm = $('#dname'), pd = $('#dperiod');
  if (nm && nm.value.trim()) STORE.name = nm.value.trim();
  if (pd && pd.value.trim()) STORE.period = pd.value.trim();

  TREE = buildTree();
  var ok = saveStore();
  IS_CUSTOM = true;
  render('tree');
  toast(ok ? '已换成你的数据 · 店名和周期在「我的数」里改' : '已应用，但这个浏览器不让存本地，关掉就没了');
}

function downloadTemplate() {
  try {
    var blob = new Blob(['\ufeff' + templateCSV()], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '懂行-报表模板.csv';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(a.href);
      if (a.parentNode) a.parentNode.removeChild(a);
    }, 600);
    toast('模板已下载，用 Excel 填完再贴回来');
  } catch (e) {
    toast('这台浏览器不让下载，照着页面里的示例手填也一样');
  }
}

function readFileInto(f) {
  /* 汇总表通常不到 10 KB；超过 1 MB 基本是明细表，硬解析只会把页面卡死 */
  if (f.size > 1048576) {
    toast('这个文件 ' + (f.size / 1048576).toFixed(1) + ' MB，太大了。汇总表一般不到 10 KB，先裁一下再贴');
    return;
  }
  var rd = new FileReader();
  rd.onload = function () {
    dtState.text = String(rd.result || '');
    render('data', { keepScroll: true });
    toast('已读取 ' + f.name);
  };
  rd.onerror = function () { toast('这个文件读不出来，试试另存为 csv'); };
  rd.readAsText(f, 'utf-8');
}

var VIEWS = {
  tree: viewTree, formula: viewFormula, glossary: viewGlossary, guard: viewGuard,
  price: viewPrice, data: viewData, about: viewAbout
};

/* 页眉上方的小字：把七个页面串成一本册子，而不是七个独立工具 */
var EYEBROW = {
  tree: '看懂 · 01', formula: '看懂 · 02', glossary: '看懂 · 03',
  guard: '动手 · 04', price: '动手 · 05', data: '你的数据', about: '这本小册'
};

function render(view, opts) {
  var main = $('#main');
  var fn = VIEWS[view] || viewTree;
  main.innerHTML = fn();
  vtipHide();                           /* 换页时把悬停提示一起收掉，别留在新页面上 */
  /* 换页时若还开着展开面板，一并清掉并解锁，别让遮罩留在新页面上挡住点击 */
  if (typeof xc !== 'undefined' && (xc.card || document.querySelector('.xc-card'))) {
    xc.gen++; xcPurge(); xcUnlockScroll(); xc.busy = false;
  }
  var h1 = main.querySelector('.head h1');
  if (h1 && EYEBROW[view]) {
    var eb = document.createElement('div');
    eb.className = 'eyebrow';
    eb.textContent = EYEBROW[view];
    h1.parentNode.insertBefore(eb, h1);
  }
  bind(view);
  /* 链接直达时，侧栏也要跟着高亮 */
  Array.prototype.forEach.call(document.querySelectorAll('.nav'), function (x) {
    if (x.getAttribute('data-view') === view) x.classList.add('on');
    else x.classList.remove('on');
  });
  try { if (location.hash !== '#' + view) history.replaceState(null, '', '#' + view); } catch (e) { }
  syncTopbar(view);
  /* 换页才归零；原地重绘（搜索、改名、开关）不动滚动位置，否则视线被硬拽回顶部 */
  if (!opts || !opts.keepScroll) window.scrollTo(0, 0);
}

/* 顶条里的页面名：跟着当前页走，顺手接住极端窄屏下的超长标题 */
function syncTopbar(view) {
  var bar = document.getElementById('topbar');
  if (!bar) return;
  var h1 = document.querySelector('.head h1');
  var eb = bar.querySelector('.tb-eb');
  var tt = bar.querySelector('.tb-t');
  if (eb) eb.textContent = EYEBROW[view] || '';
  if (tt) tt.textContent = h1 ? h1.textContent : '';
}

function bindFxItems() {
  Array.prototype.forEach.call(document.querySelectorAll('#fxi .fx-item'), function (d) {
    d.onclick = function () {
      fxState.idx = Number(d.getAttribute('data-fx'));
      fxState.vals = {};
      render('formula', { keepScroll: true });
    };
  });
}

function bind(view) {
  if (view === 'tree') {
    /* 图例筛选：只换 #wfr 里的行，不重建整页 */
    var wfc = $('#wfc');
    if (wfc && !wfc._wfBound) {
      wfc._wfBound = true;
      wfc.addEventListener('click', function (e) {
        var b = e.target && e.target.closest ? e.target.closest('.wf-lgi') : null;
        if (!b) return;
        var g = b.getAttribute('data-g');
        if (!(g in wfOff)) return;
        wfOff[g] = !wfOff[g];
        b.classList.toggle('off', wfOff[g]);
        var box = $('#wfr');
        if (box) box.innerHTML = wfRowsHtml();
      });
    }
    /* 下钻：点乘数去算账页对应公式 */
    var main = $('#main');
    if (main && !main._drillBound) {
      main._drillBound = true;
      main.addEventListener('click', function (e) {
        var n = e.target && e.target.closest ? e.target.closest('.nd[data-drill]') : null;
        if (n) drillTo(n.getAttribute('data-drill'));
      });
    }
  }

  if (view === 'data') {
    var ta = $('#dtxt');
    if (ta) {
      ta.value = dtState.text;
      /* 解析是全量的，按键时防抖，别让每个字符都跑一遍整表 */
      ta.addEventListener('input', function (e) {
        dtState.text = e.target.value;
        clearTimeout(dtTimer);
        dtTimer = setTimeout(function () {
          var o = $('#dvout');
          if (o) o.innerHTML = dvPreview();
        }, 120);
      });
    }
    var dv = $('#dvout');
    if (dv) dv.addEventListener('click', function (e) {
      if (e.target && e.target.id === 'dapply') applyImport();
    });
    var nm = $('#dname');
    if (nm) nm.addEventListener('change', function (e) {
      STORE.name = e.target.value.trim().slice(0, 40) || '我的店';
      saveStore();
    });
    /* 记住这份数据：关掉就退化成只留本次会话，并把长效副本一起清掉 */
    var ps = $('#dpersist');
    if (ps) ps.addEventListener('change', function (e) {
      persistOn = !!e.target.checked;
      writePersistPref();
      saveStore();
      render('data', { keepScroll: true });
      toast(persistOn ? '已改为记住这份数据' : '已改为只留到关页面');
    });
    /* 统计周期：只读字段点开日历选区间，确认时直接写 STORE（不再走 change） */
    bindDateRange();
    var ex = $('#dexport');
    if (ex) ex.onclick = exportStore;
    var ipf = $('#dfjson');
    if (ipf) ipf.addEventListener('change', function (e) {
      var fl = e.target.files && e.target.files[0];
      if (fl) importStoreFile(fl);
      e.target.value = '';
    });
    var rs = $('#dreset');
    if (rs) rs.onclick = function () { restoreDefault(); render('data', { keepScroll: true }); toast('已换回示例数据'); };
    var tp = $('#dtpl');
    if (tp) tp.onclick = downloadTemplate;
    var dm = $('#ddemo');
    if (dm) dm.onclick = function () { dtState.text = demoTSV(); render('data', { keepScroll: true }); };
    var dc = $('#dclear');
    if (dc) dc.onclick = function () { dtState.text = ''; render('data', { keepScroll: true }); };
    var fi = $('#dfile');
    if (fi) fi.addEventListener('change', function (e) {
      var fl = e.target.files && e.target.files[0];
      if (fl) readFileInto(fl);
    });
    var drop = $('#ddrop');
    if (drop) {
      ['dragenter', 'dragover'].forEach(function (t) {
        drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add('over'); });
      });
      ['dragleave', 'drop'].forEach(function (t) {
        drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.remove('over'); });
      });
      drop.addEventListener('drop', function (e) {
        var fl = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (fl) readFileInto(fl);
      });
    }
  }

  if (view === 'formula') {
    bindFxItems();
    var fq = $('#fxq');
    if (fq) fq.addEventListener('input', function (e) {
      fxState.q = e.target.value.trim();
      /* 只换列表，不动输入框和滚动位置 */
      var box = $('#fxi');
      if (box) { box.innerHTML = fxItems(); bindFxItems(); }
    });
    var panel = $('#fxp');
    if (panel) panel.addEventListener('input', function (e) {
      var k = e.target && e.target.getAttribute ? e.target.getAttribute('data-k') : null;
      if (!k) return;
      fxState.vals[k] = e.target.value === '' ? 0 : Number(e.target.value);
      var c = fxCalc(FORMULAS[fxState.idx]);
      var res = $('#fxres'), un = $('#fxun'), sub = $('#fxsub');
      if (res) res.textContent = c.shown;
      if (un) un.textContent = c.unit;
      if (sub) sub.textContent = fxSubText(FORMULAS[fxState.idx], c);
    });
    /* 输入框右侧的上下调节：步长跟着量级走，改完复用上面那条 input 逻辑重算 */
    if (panel) panel.addEventListener('click', function (e) {
      var b = e.target && e.target.closest ? e.target.closest('.num-b') : null;
      if (!b) return;
      var k = b.getAttribute('data-k');
      var inp = panel.querySelector('input[data-k="' + k + '"]');
      if (!inp) return;
      var v = Number(inp.value);
      if (!isFinite(v)) v = 0;
      var abs = Math.abs(v);
      var step = abs >= 10000 ? 1000 : abs >= 1000 ? 100 : abs >= 100 ? 10 : 1;
      var nv = v + step * Number(b.getAttribute('data-dir'));
      if (nv < 0) nv = 0;
      inp.value = String(Math.round(nv * 100) / 100);
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  if (view === 'glossary') {
    var gq = $('#glq');
    if (gq) gq.addEventListener('input', function (e) {
      glState.q = e.target.value.trim();
      glState.ti = -1; /* 重新搜了，之前选中的术语不再成立 */
      refreshGlCur();
      $('#glg').innerHTML = glCards();
    });
    Array.prototype.forEach.call(document.querySelectorAll('#glc .chip'), function (el) {
      el.onclick = function () {
        glState.cat = Number(el.getAttribute('data-cat'));
        glState.ti = -1;
        Array.prototype.forEach.call(document.querySelectorAll('#glc .chip'), function (x) { x.classList.remove('on'); });
        el.classList.add('on');
        refreshGlCur();
        $('#glg').innerHTML = glCards();
      };
    });
    bindGlDropdown();
    /* 点卡片展开：事件委托挂在网格上，筛选用 innerHTML 换卡片也不会丢 */
    var grid = $('#glg');
    if (grid) {
      grid.addEventListener('click', function (e) {
        var c = e.target && e.target.closest ? e.target.closest('.term') : null;
        if (c) openTermCard(Number(c.getAttribute('data-ti')), c);
      });
      grid.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        var c = e.target && e.target.closest ? e.target.closest('.term') : null;
        if (!c) return;
        e.preventDefault();
        openTermCard(Number(c.getAttribute('data-ti')), c);
      });
    }
  }

  if (view === 'guard') {
    var ta = $('#gdta');
    function refresh() {
      var sc = scanBanned(gdState.text);
      $('#gdp').innerHTML = guardPreview(sc);
      $('#gdh').innerHTML = guardHits(sc);
      var head = $('.card-h .card-s', $('#gdp').parentNode);
      if (head) head.textContent = sc.hits.length ? sc.hits.length + ' 处' : '干净';
    }
    if (ta) ta.addEventListener('input', function (e) {
      gdState.text = e.target.value;
      refresh();
    });
    var rw = $('#gdrewrite');
    if (rw) rw.onclick = guardRewrite;
  }

  if (view === 'price') {
    Array.prototype.forEach.call(document.querySelectorAll('#prc .chip'), function (el) {
      el.onclick = function () {
        var s = SKUS[Number(el.getAttribute('data-sku'))];
        prState = { price: s.price, cost: s.cost, comm: s.comm * 100, ship: s.ship, ad: s.ad, refund: s.refund * 100 };
        Array.prototype.forEach.call(document.querySelectorAll('#prc .chip'), function (x) { x.classList.remove('on'); });
        el.classList.add('on');
        render('price');
      };
    });
    var pf = $('.pr-fields');
    if (pf) pf.addEventListener('input', function (e) {
      var k = e.target && e.target.getAttribute ? e.target.getAttribute('data-p') : null;
      if (!k) return;
      prState[k] = e.target.value === '' ? 0 : Number(e.target.value);
      $('#prout').innerHTML = priceOut();
      var pb = $('#prbar');
      if (pb) pb.innerHTML = priceBars();
    });
    var rs = $('#prreset');
    if (rs) rs.onclick = function () {
      prState = { price: 0, cost: 0, comm: 0, ship: 0, ad: 0, refund: 0 };
      render('price');
    };
  }
}

Array.prototype.forEach.call(document.querySelectorAll('.nav'), function (el) {
  function go() {
    Array.prototype.forEach.call(document.querySelectorAll('.nav'), function (x) { x.classList.remove('on'); });
    el.classList.add('on');
    render(el.getAttribute('data-view'));
  }
  el.onclick = go;
  el.onkeydown = function (e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
  };
});

readPersistPref();
if (loadStore()) TREE = buildTree();

var boot = 'tree';
try { boot = (location.hash || '').replace('#', ''); } catch (e) { }
render(VIEWS[boot] ? boot : 'tree');

/* =========================================================
   动效：跟随光斑 + 回弹 + 落点高亮
   只碰 transform / opacity，不改布局；触屏和「减少动态」直接不启动
   ========================================================= */
(function () {
  var reduce = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)').matches : false;
  var fine = window.matchMedia ? window.matchMedia('(hover: hover) and (pointer: fine)').matches : true;
  if (reduce || !fine) return;

  var glow = document.getElementById('glow');
  if (!glow) return;

  var tx = 0, ty = 0, gx = 0, gy = 0, raf = 0, live = false, idle = 0, actUntil = 0;
  /* 容器位置按元素缓存：同一张卡上移动不必每次读布局；滚动/改尺寸时失效 */
  var rectEl = null, rectBox = null;

  function frame() {
    raf = 0;
    /* 光斑落后指针一点点：跟手，但不粘手 */
    gx += (tx - gx) * 0.16;
    gy += (ty - gy) * 0.16;
    glow.style.transform = 'translate3d(' + gx.toFixed(1) + 'px,' + gy.toFixed(1) + 'px,0)';
    if (Math.abs(tx - gx) > 0.4 || Math.abs(ty - gy) > 0.4) raf = requestAnimationFrame(frame);
  }

  /* 停手后暗下去：整条链只用一条定时器，不随每次移动重建 */
  function goIdle() {
    idle = 0;
    var now = performance.now();
    if (now < actUntil) { idle = setTimeout(goIdle, Math.min(300, actUntil - now)); return; }
    glow.classList.remove('act');
  }

  var HOST = '.card,.kpi,.term,.nd,.fx-panel,.dt-drop';

  document.addEventListener('pointermove', function (e) {
    if (!live) {
      live = true;
      gx = tx = e.clientX;
      gy = ty = e.clientY;
      glow.classList.add('on');
    }
    /* 动着的时候是满亮，停手后自己暗下去，不抢阅读的注意力 */
    if (!glow.classList.contains('act')) glow.classList.add('act');
    actUntil = performance.now() + 900;
    if (!idle) idle = setTimeout(goIdle, 900);
    tx = e.clientX;
    ty = e.clientY;
    if (!raf) raf = requestAnimationFrame(frame);

    /* 卡片里那块光跟着走。只写当前这张卡，不遍历 */
    var t = e.target;
    var el = (t && t.nodeType === 1 && t.closest) ? t.closest(HOST) : null;
    if (!el) { rectEl = null; return; }
    if (el !== rectEl || !rectBox) { rectEl = el; rectBox = el.getBoundingClientRect(); }
    el.style.setProperty('--mx', (e.clientX - rectBox.left).toFixed(0) + 'px');
    el.style.setProperty('--my', (e.clientY - rectBox.top).toFixed(0) + 'px');
  }, { passive: true });

  function dropRect() { rectEl = null; rectBox = null; }
  window.addEventListener('scroll', dropRect, { passive: true });
  window.addEventListener('resize', dropRect);

  /* 点下去的那一点亮一圈 */
  document.addEventListener('pointerdown', function (e) {
    if (e.pointerType && e.pointerType !== 'mouse') return;
    var d = document.createElement('span');
    d.className = 'tap';
    d.style.left = e.clientX + 'px';
    d.style.top = e.clientY + 'px';
    document.body.appendChild(d);
    setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, 640);
  }, { passive: true });

  document.addEventListener('mouseleave', function () {
    live = false;
    glow.classList.remove('on');
  });
})();

/* =========================================================
   滚动时的避让
   ① 滚过大标题后，顶条出现并一直常驻（不再自动收起）
   ② 顶条露着的时候，左栏吸顶列表自动往下躲一个顶条的高度

   铁律：这里只允许切 class 和写 transform，绝不能改变任何元素的布局高度。
   之前让 .head 吸顶并改 padding/字号，布局高度在 135↔49px 之间反复横跳，
   浏览器的 scroll anchoring 会反向补偿 scrollTop，于是「显示→隐藏→显示」
   自激循环，标题就一直跳。现在负责让位的是脱离文档流的 #topbar，
   它怎么动都不占文档流，滚动位置永远不会被自己顶回去。
   ========================================================= */
(function () {
  var bar = document.getElementById('topbar');
  if (!bar) return;

  var raf = 0, on = false;
  var stickH = 0, lastStick = -1;

  function apply() {
    raf = 0;
    var y = window.pageYOffset || document.documentElement.scrollTop || 0;

    /* 滚过大标题（约 106px）就出现，之后一直常驻；回到页头才收回去 */
    var should = y > 96;
    if (should !== on) {
      on = should;
      bar.classList.toggle('on', on);
    }

    /* 顶条露着时，左栏吸顶列表往下躲一个顶条的高度。
       高度是常量：只在尺寸变化时量一次，别每帧读布局；
       --stick 只在实际变化时写，否则每帧都会让全文档样式失效 */
    if (!stickH) stickH = bar.offsetHeight || 46;
    var v = on ? stickH + 12 : 12;
    if (v !== lastStick) {
      lastStick = v;
      document.documentElement.style.setProperty('--stick', v + 'px');
    }
  }

  function onScroll() { if (!raf) raf = requestAnimationFrame(apply); }
  function onResize() { stickH = 0; onScroll(); }

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onResize);

  /* 换页：render() 会把 scrollTop 归零，这里把顶条状态一并复位 */
  document.addEventListener('click', function (e) {
    if (!e.target || !e.target.closest || !e.target.closest('.nav')) return;
    on = true; /* render 后 scrollTo(0,0)，下一帧 apply 会把它复位成 false */
    requestAnimationFrame(apply);
  });

  requestAnimationFrame(apply);
})();
