// 샘플 HWPX 레이아웃을 HTML로 근사 렌더. section-builder의 집계 로직을 재사용.
import { aggregateItems, formatItem } from '../hwpx/section-builder.js';

function el(tag, props = {}, children = []) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k === 'html') e.innerHTML = v;
    else e.setAttribute(k, v);
  }
  for (const c of children) {
    if (c == null) continue;
    e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return e;
}

const KIND_ORDER = ['basic', 'natl_rnd', 'consign', 'etc'];
const KIND_LABEL = {
  basic: '기본사업',
  natl_rnd: '국가R&D',
  consign: '수탁사업',
  etc: '기타',
};

function buildBody(round, submissions, side) {
  const categories = round.categoriesSnapshot ?? [];
  const itemsByCat = aggregateItems(submissions, side);
  const existingKinds = KIND_ORDER.filter(k => categories.some(c => c.kind === k));

  const root = el('div', { class: 'body-inner' });
  root.appendChild(el('div', { class: 'org', text: round.orgName || '[철도AI융합연구실]' }));
  existingKinds.forEach((kind, idx) => {
    const cats = categories
      .filter(c => c.kind === kind)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    root.appendChild(el('div', { class: 'kind', text: `(${idx + 1}) ${KIND_LABEL[kind]}` }));
    for (const cat of cats) {
      const items = itemsByCat[cat.id] ?? [];
      if (kind !== 'etc') {
        const ownerSuffix = cat.owner ? `(${cat.owner})` : '';
        root.appendChild(el('div', { class: 'project', text: ` - ${cat.title}${ownerSuffix}` }));
      }
      if (items.length) {
        const ul = el('ul', { class: 'items' });
        for (const it of items) {
          const li = el('li', { text: formatItem(it) });
          if (it.important) li.className = 'important';
          ul.appendChild(li);
        }
        root.appendChild(ul);
      }
    }
    root.appendChild(el('div', { class: 'blank' }));
  });
  return root;
}

export function renderPreview(round, submissions) {
  const labelPast = round.form === 'monthly' ? '지난 달 실적' : '지난 주 실적';
  const labelNext = round.form === 'monthly' ? '이번 달 계획' : '이번 주 계획';
  const rangePast = `(${round.rangeStart} ~ ${round.rangeEnd})`;
  const rangeNext = `(${round.nextRangeStart} ~ ${round.nextRangeEnd})`;

  const tbl = el('table', { class: 'preview-table' }, [
    el('colgroup', {}, [
      el('col', { style: 'width:13.3%' }),
      el('col', { style: 'width:72.8%' }),
      el('col', { style: 'width:13.9%' }),
    ]),
    el('tbody', {}, [
      el('tr', {}, [
        el('td', { class: 'label' }, [
          el('div', { class: 'label-title', text: labelPast }),
          el('div', { class: 'label-range', text: rangePast }),
        ]),
        el('td', { class: 'body' }, [buildBody(round, submissions, 'past')]),
        el('td', { class: 'empty' }),
      ]),
      el('tr', {}, [
        el('td', { class: 'label' }, [
          el('div', { class: 'label-title', text: labelNext }),
          el('div', { class: 'label-range', text: rangeNext }),
        ]),
        el('td', { class: 'body' }, [buildBody(round, submissions, 'next')]),
        el('td', { class: 'empty' }),
      ]),
    ]),
  ]);
  const wrap = el('div', { class: 'preview-doc' }, [
    el('div', { class: 'preview-page' }, [tbl]),
    el('div', { class: 'preview-tail', text: '□ 일반 보고사항' }),
  ]);
  return wrap;
}
