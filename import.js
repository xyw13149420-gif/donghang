/* 懂行 · 报表接入层
   把后台导出的报表（CSV，或从 Excel 里直接复制的制表符文本）解析成看板要的 13 个数。
   全部在浏览器本地完成，不联网、不上传。

   两种报表都能认：
   ① 率表 —— 直接给「点击率 3.2%」「加购率 9.4%」
   ② 计数表 —— 给「曝光 1,850,000」「点击 59,200」，程序自己反算成率
   第二种更常见，因为没人会手算这些率。 */

/* ============ 一、认得哪些说法 ============
   同一件事，各平台叫法不一样，这里把常见写法都列上。
   匹配时长词优先，否则「点击率」会被「点击」抢走。 */
var FIELD_DEFS = [
  /* 链路原始计数 */
  { k: 'imp', n: '曝光量', t: 'count', alias: ['曝光量', '曝光次数', '展现次数', '商品曝光', '曝光人数', '曝光', '展现量', '展现'] },
  { k: 'click', n: '点击量', t: 'count', alias: ['点击量', '点击次数', '点击人数', '商品点击', '点击'] },
  { k: 'uv', n: '进店访客', t: 'count', alias: ['商品访客数', '进店访客', '入店访客', '商详访客', '店铺访客', '商品访客', '访客数', '访客'] },
  { k: 'cartU', n: '加购人数', t: 'count', alias: ['加购物车人数', '加购用户数', '加购人数', '加购件数', '加购'] },
  { k: 'orderU', n: '下单人数', t: 'count', alias: ['下单用户数', '提交订单', '下单订单', '下单人数', '下单数', '下单'] },
  { k: 'paidU', n: '支付订单', t: 'count', alias: ['支付订单数', '支付子订单', '成交订单', '付款订单', '支付人数', '成交人数', '支付订单'] },
  { k: 'gmv', n: '支付金额', t: 'money', alias: ['支付金额', '成交金额', '销售额', '成交额', 'gmv'] },

  /* 链路：报表已经算好率的情况 */
  { k: 'ctr', n: '点击率', t: 'rate', alias: ['点击转化率', '点击率'] },
  { k: 'instore', n: '进店率', t: 'rate', alias: ['进店转化率', '进店率', '入店率', '访客率'] },
  { k: 'cart', n: '加购率', t: 'rate', alias: ['加购转化率', '加购率'] },
  { k: 'order', n: '下单率', t: 'rate', alias: ['下单转化率', '成交转化率', '下单率'] },
  { k: 'pay', n: '支付率', t: 'rate', alias: ['支付转化率', '付款转化率', '支付率', '付款率'] },
  { k: 'aov', n: '客单价', t: 'money', alias: ['平均客单价', '客单价', '单均价', '客单'] },

  /* 财务 */
  { k: 'refundRate', n: '退款率', t: 'rate', alias: ['退款比例', '退款率', '退货率'] },
  { k: 'grossMargin', n: '毛利率', t: 'rate', alias: ['商品毛利率', '毛利率'] },
  { k: 'adSpend', n: '推广费', t: 'money', alias: ['推广费用', '推广花费', '广告花费', '投放费用', '营销费用', '推广费', '广告费'] },
  { k: 'shipPerOrder', n: '单均运费', t: 'money', alias: ['单均履约', '单均快递', '单均运费', '快递费', '物流费', '运费'] },
  { k: 'commRate', n: '平台佣金率', t: 'rate', alias: ['平台佣金率', '平台扣点', '佣金率', '扣点'] },
  { k: 'fixedCost', n: '固定成本', t: 'money', alias: ['人力与固定成本', '固定成本', '固定费用', '人力成本'] }
];

/* ============ 二、拆表 ============ */

function splitLines(text) {
  return String(text).replace(/\r\n?/g, '\n').split('\n').filter(function (l) {
    return l.trim() !== '';
  });
}

/* 制表符优先 —— 从 Excel 复制出来的是 TSV，不是 CSV */
function detectSep(line) {
  var tab = (line.match(/\t/g) || []).length;
  var comma = (line.match(/,/g) || []).length;
  var semi = (line.match(/;/g) || []).length;
  if (tab > 0 && tab >= comma && tab >= semi) return '\t';
  if (semi > comma) return ';';
  return ',';
}

function cleanCell(s) {
  return String(s === undefined || s === null ? '' : s)
    .replace(/\u00a0/g, ' ')
    .replace(/\u3000/g, ' ')
    .trim();
}

function splitRow(line, sep) {
  if (sep !== ',') return line.split(sep).map(cleanCell);
  /* 逗号分隔要处理引号，否则「1,850,000」会被拆成三段 */
  var out = [], cur = '', q = false;
  for (var i = 0; i < line.length; i++) {
    var ch = line.charAt(i);
    if (q) {
      if (ch === '"') {
        if (line.charAt(i + 1) === '"') { cur += '"'; i++; }
        else q = false;
      } else cur += ch;
    } else if (ch === '"') {
      q = true;
    } else if (ch === ',') {
      out.push(cur); cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map(cleanCell);
}

/* ============ 三、认字段 ============ */

function normName(s) {
  return String(s).toLowerCase()
    .replace(/[\s\u00a0\u3000:：()（）\[\]【】]/g, '');
}

function matchField(cell) {
  var s = normName(cell);
  if (!s) return null;
  var best = null;
  FIELD_DEFS.forEach(function (f) {
    f.alias.forEach(function (a) {
      var al = normName(a);
      if (s === al || s.indexOf(al) > -1) {
        if (!best || al.length > best.len) best = { k: f.k, len: al.length };
      }
    });
  });
  return best ? best.k : null;
}

/* 数字：容忍 ¥、千分位、百分号、万、单位后缀 */
function parseNum(cell) {
  var t = cleanCell(cell);
  if (!t || /^(—|-{1,2}|\/|n\/?a|null|无)$/i.test(t)) return null;
  var isPct = /%/.test(t);
  var wan = /万/.test(t);
  t = t.replace(/[¥$￥,\s]/g, '').replace(/[元次人单件个台套笔%]/g, '');
  if (!/^-?\d*\.?\d+$/.test(t)) {
    var m = t.match(/-?\d*\.?\d+/);
    if (!m) return null;
    t = m[0];
  }
  var v = parseFloat(t);
  if (!isFinite(v)) return null;
  if (wan) v *= 10000;
  return { v: v, pct: isPct };
}

/* 率统一成小数：3.2%、3.2、0.032 都收 */
function toRate(num) {
  if (!num) return null;
  if (num.pct) return num.v / 100;
  return num.v > 1 ? num.v / 100 : num.v;
}

/* ============ 四、读整张表 ============ */

function readReport(text) {
  var lines = splitLines(text);
  if (!lines.length) return { ok: false, err: 'empty', rows: 0, matched: 0, fields: {} };

  var sep = detectSep(lines[0]);
  var rows = lines.map(function (l) { return splitRow(l, sep); });

  var fields = {};
  var matched = 0;
  var skipped = [];

  rows.forEach(function (r) {
    if (!r.length || !r[0]) return;
    var k = matchField(r[0]);
    if (!k) { skipped.push(r[0]); return; }
    var cur = parseNum(r[1]);
    if (!cur) { skipped.push(r[0]); return; }
    fields[k] = [cur, parseNum(r[2]), parseNum(r[3])];
    matched++;
  });

  return {
    ok: matched > 0,
    sep: sep === '\t' ? '制表符' : (sep === ';' ? '分号' : '逗号'),
    rows: rows.length,
    matched: matched,
    skipped: skipped.slice(0, 8),
    fields: fields
  };
}

/* ============ 五、组装成看板能用的数 ============ */

/* 返回 { nodes: {k:{v,p,b,src}}, fin: {...}, missing: [...], derived: [...] }
   missing 里有东西就不能应用 —— 宁可拦住，也不拿默认值糊一个假结论 */
function buildValues(fields) {
  function raw(k) { return fields[k] ? fields[k][0] : null; }
  function rawAt(k, idx) {
    var a = fields[k];
    if (!a || !a[idx]) return null;
    return a[idx];
  }

  var imp = raw('imp');
  var click = raw('click');
  var uv = raw('uv');
  var cartU = raw('cartU');
  var orderU = raw('orderU');
  var paidU = raw('paidU');
  var gmv = raw('gmv');

  var missing = [];
  var derived = [];
  var nodes = {};

  /* 曝光：只能直接给 */
  if (imp && imp.v > 0) {
    nodes.imp = { v: imp.v, p: rawAt('imp', 1) ? rawAt('imp', 1).v : null, b: rawAt('imp', 2) ? rawAt('imp', 2).v : null, src: '报表直接给' };
  } else {
    missing.push('曝光量');
  }

  /* 每个率：报表给了就用报表的，没给就用两个计数相除 */
  function rateNode(key, label, numKey, denKey, numLabel, denLabel) {
    var direct = fields[key];
    var n1 = numKey ? raw(numKey) : null;
    var d1 = denKey ? raw(denKey) : null;

    if (direct) {
      var r = toRate(direct[0]);
      if (r !== null && isFinite(r)) {
        nodes[key] = {
          v: r,
          p: toRate(rawAt(key, 1)),
          b: toRate(rawAt(key, 2)),
          src: '报表直接给'
        };
        return;
      }
    }
    if (n1 && d1 && d1.v > 0) {
      nodes[key] = {
        v: n1.v / d1.v,
        p: (rawAt(numKey, 1) && rawAt(denKey, 1) && rawAt(denKey, 1).v > 0)
          ? rawAt(numKey, 1).v / rawAt(denKey, 1).v : null,
        b: (rawAt(numKey, 2) && rawAt(denKey, 2) && rawAt(denKey, 2).v > 0)
          ? rawAt(numKey, 2).v / rawAt(denKey, 2).v : null,
        src: '由 ' + fmtCell(n1.v) + ' ÷ ' + fmtCell(d1.v) + ' 算出'
      };
      derived.push(label);
      return;
    }
    missing.push(label);
  }

  function fmtCell(v) {
    return v.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
  }

  rateNode('ctr', '点击率', 'click', 'imp');
  rateNode('instore', '进店率', 'uv', 'click');
  rateNode('cart', '加购率', 'cartU', 'uv');
  rateNode('order', '下单率', 'orderU', 'cartU');
  rateNode('pay', '支付率', 'paidU', 'orderU');

  /* 客单价 */
  if (fields.aov && raw('aov').v > 0) {
    nodes.aov = {
      v: raw('aov').v,
      p: rawAt('aov', 1) ? rawAt('aov', 1).v : null,
      b: rawAt('aov', 2) ? rawAt('aov', 2).v : null,
      src: '报表直接给'
    };
  } else if (gmv && paidU && paidU.v > 0) {
    nodes.aov = {
      v: gmv.v / paidU.v,
      p: (rawAt('gmv', 1) && rawAt('paidU', 1) && rawAt('paidU', 1).v > 0) ? rawAt('gmv', 1).v / rawAt('paidU', 1).v : null,
      b: (rawAt('gmv', 2) && rawAt('paidU', 2) && rawAt('paidU', 2).v > 0) ? rawAt('gmv', 2).v / rawAt('paidU', 2).v : null,
      src: '由 ' + fmtCell(gmv.v) + ' ÷ ' + fmtCell(paidU.v) + ' 算出'
    };
    derived.push('客单价');
  } else {
    missing.push('客单价（或「支付金额 + 支付订单」）');
  }

  /* 财务六项：缺了沿用示例值，但逐条告诉用户 */
  var fin = {};
  var finSrc = {};

  function finRate(k, label, def) {
    if (fields[k]) { fin[k] = toRate(raw(k)); finSrc[k] = '报表直接给'; }
    else { fin[k] = def; finSrc[k] = '未提供，沿用示例 ' + (def * 100).toFixed(1) + '%'; }
  }
  function finMoney(k, label, def) {
    if (fields[k]) { fin[k] = raw(k).v; finSrc[k] = '报表直接给'; }
    else { fin[k] = def; finSrc[k] = '未提供，沿用示例 ¥' + def.toLocaleString('zh-CN'); }
  }

  finRate('refundRate', '退款率', STORE.refundRate);
  finRate('grossMargin', '毛利率', STORE.grossMargin);
  finMoney('adSpend', '推广费', STORE.adSpend);
  finMoney('shipPerOrder', '单均运费', STORE.shipPerOrder);
  finRate('commRate', '平台佣金率', STORE.commRate);
  finMoney('fixedCost', '固定成本', STORE.fixedCost);

  return { nodes: nodes, fin: fin, finSrc: finSrc, missing: missing, derived: derived };
}

/* ============ 六、套用到 STORE 上 ============ */

function applyValues(res) {
  if (res.missing.length) return false;

  STORE.nodes.forEach(function (node) {
    var n = res.nodes[node.k];
    if (!n) return;
    node.v = n.v;
    node.p = n.p;
    node.b = n.b;
  });

  ['refundRate', 'grossMargin', 'adSpend', 'shipPerOrder', 'commRate', 'fixedCost'].forEach(function (k) {
    if (res.fin[k] !== undefined && isFinite(res.fin[k])) STORE[k] = res.fin[k];
  });

  return true;
}

/* ============ 七、给用户一份能照着填的模板 ============ */

function templateCSV() {
  return [
    '指标,本期,上期,类目均值',
    '曝光量,1850000,1650000,',
    '点击量,59200,62700,',
    '进店访客,46176,48154,',
    '加购人数,4340,4671,',
    '下单人数,1779,1817,',
    '支付订单,1530,1639,',
    '支付金额,257120,259784,',
    '退款率,6.8%,7.2%,',
    '毛利率,42%,41%,',
    '推广费,32000,28000,',
    '单均运费,9.5,9.5,',
    '平台佣金率,5%,5%,',
    '固定成本,28000,28000,'
  ].join('\n');
}

/* 从 Excel 复制出的示例（制表符），让用户能看到粘贴后长什么样 */
function demoTSV() {
  return [
    '指标\t本期\t上期',
    '曝光量\t1850000\t1650000',
    '点击量\t59200\t62700',
    '进店访客\t46176\t48154',
    '加购人数\t4340\t4671',
    '下单人数\t1779\t1817',
    '支付订单\t1530\t1639',
    '支付金额\t257120\t259784',
    '退款率\t6.8%\t7.2%',
    '毛利率\t42%\t41%',
    '推广费\t32000\t28000',
    '单均运费\t9.5\t9.5',
    '平台佣金率\t5%\t5%',
    '固定成本\t28000\t28000'
  ].join('\n');
}
