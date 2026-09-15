// 拍完照後的問題引導：每種問題一句原因、一句怎麼修、一張「錯 vs 對」示意圖
// 圖都是固定字串，沒有外部資料

const SKIN = 'fill="#f2c9a5" stroke="#c98f68" stroke-width="1.5"';
const FOOT_D = 'M100 112c-11 0-12.5-10-11.5-20 1-10-3.5-20-4-32-.5-12 4-23 12.5-24 8.5-1 18 4 19.5 14 1.5 10-4.5 24-5.5 40-1 11.5.5 22-11 22z';

const foot = (cx, heelY, s = 0.68, attrs = SKIN) =>
  `<g transform="translate(${cx} ${heelY}) scale(${s}) translate(-100 -112)"><path d="${FOOT_D}" ${attrs}/></g>`;
const floor = (color = '#6b5a4e') => `<rect width="92" height="98" rx="6" fill="${color}"/>`;
const paper = (x = 24, y = 10, w = 44, h = 62, stroke = 'none') => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#fff" stroke="${stroke}"/>`;
const bad = '<circle r="9" fill="#EB5757"/><path d="M-4-4l8 8M4-4l-8 8" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>';
const good = '<circle r="9" fill="#27AE60"/><path d="M-4.5 0l3.5 3.5 6.5-7" stroke="#fff" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>';

function twoPanel(left, right, label) {
  return `<svg viewBox="0 0 200 130" role="img" aria-label="${label}">
    <defs>
      <clipPath id="gp-l"><rect width="92" height="98" rx="6"/></clipPath>
      <clipPath id="gp-r"><rect width="92" height="98" rx="6"/></clipPath>
    </defs>
    <g transform="translate(4 4)"><g clip-path="url(#gp-l)">${left}</g></g>
    <g transform="translate(104 4)"><g clip-path="url(#gp-r)">${right}</g></g>
    <g transform="translate(50 116)">${bad}</g>
    <g transform="translate(150 116)">${good}</g>
  </svg>`;
}

const clean = () => floor() + paper() + foot(46, 72);

export const ISSUES = {
  white_floor: {
    kind: 'paper',
    title: '地板太白，分不出紙在哪',
    fix: '在紙下面墊一塊深色布或毛巾，再拍一次。',
    svg: twoPanel(
      floor('#ececec') + paper(24, 10, 44, 62, '#e2e2e2') + foot(46, 72),
      floor('#ececec') + '<rect x="12" y="2" width="68" height="80" rx="5" fill="#4a4a55"/>' + paper() + foot(46, 72),
      '白色地板上的紙分不出來，墊深色布就可以'),
  },
  cut_off: {
    kind: 'paper',
    title: '紙的角沒有拍進去',
    fix: '手機拿高一點，讓紙的四個角都在畫面裡。',
    svg: twoPanel(
      floor() + paper(36, -14, 60, 86) + foot(66, 72, 0.8) + '<circle cx="90" cy="2" r="14" fill="none" stroke="#EB5757" stroke-width="2.5" stroke-dasharray="4 3"/>',
      floor() + paper(30, 18, 32, 45) + foot(46, 63, 0.48) +
        '<g stroke="#FF5353" stroke-width="2.5" fill="none"><path d="M27 25v-10h10M55 15h10v10M65 56v10H55M37 66H27V56"/></g>',
      '紙角被切掉不行，四個角都要在畫面裡'),
  },
  not_found: {
    kind: 'paper',
    title: '照片裡找不到 A4 白紙',
    fix: '紙要攤平、四個角都拍到、影子不要蓋住紙。也可以不重拍，直接點出紙的四個角。',
    svg: twoPanel(
      floor() + paper() + foot(46, 72) + '<ellipse cx="30" cy="40" rx="22" ry="34" fill="rgba(0,0,0,.45)"/>',
      clean(),
      '影子蓋住紙不行，紙要清楚完整'),
  },
  aspect: {
    kind: 'paper',
    title: '紙好像被擋住了',
    fix: '腳和褲管不要蓋到紙角，而且要用 A4 紙。',
    svg: twoPanel(
      floor() + paper() + foot(46, 72) + '<rect x="8" y="54" width="36" height="30" rx="6" fill="#34495e"/>',
      clean(),
      '褲管蓋到紙角不行，紙角要露出來'),
  },
  no_foot: {
    kind: 'foot',
    title: '紙上找不到腳',
    fix: '腳要整個踩在紙上。白襪跟紙分不出來，請赤腳或穿深色襪子。',
    svg: twoPanel(
      floor() + paper() + foot(46, 72, 0.68, 'fill="#fafafa" stroke="#e6e6e6" stroke-width="1.5"'),
      clean(),
      '白襪分不出來，赤腳或深色襪子才可以'),
  },
  heel_gap: {
    kind: 'foot',
    title: '腳跟沒有貼齊紙邊',
    fix: '紙貼牆、腳跟也貼牆踩上去，腳跟就會切齊紙邊。',
    svg: twoPanel(
      floor() + '<rect y="84" width="92" height="14" fill="#c9c9c9"/>' + paper(24, 22, 44, 62) + foot(46, 72, 0.6) +
        '<path d="M60 72v12M56 72h8M56 84h8" stroke="#EB5757" stroke-width="2"/>',
      floor() + '<rect y="84" width="92" height="14" fill="#c9c9c9"/>' + paper(24, 22, 44, 62) + foot(46, 84, 0.6),
      '腳跟和紙邊之間有空隙不行，要貼齊'),
  },
  foot_side: {
    kind: 'foot',
    title: '腳太靠近紙的側邊',
    fix: '把腳放在紙的正中間，再拍一次。',
    svg: twoPanel(floor() + paper() + foot(64, 72), clean(), '腳靠在紙邊不行，要放中間'),
  },
  toe_edge: {
    kind: 'foot',
    title: '腳尖碰到紙邊了',
    fix: '紙要直放，腳跟貼著紙的短邊。',
    svg: twoPanel(floor() + paper(10, 26, 72, 51) + foot(46, 77), clean(), '紙橫放腳會超出去，要直放'),
  },
};

// 由量測旗標挑出最該先處理的問題
export function footIssue(flags) {
  if (!flags) return null;
  if (flags.noFoot) return 'no_foot';
  if (!flags.heelAligned) return 'heel_gap';
  if (flags.toeAtMargin) return 'toe_edge';
  if (flags.widthAtMargin) return 'foot_side';
  return null;
}
