/**
 * 審核工作台：把一個階段（或一個模組）的內容，輸出成單一自足的 HTML 檔。
 *
 *   npm run review:workbench -- --stage eft [--module eft-attunement]
 *
 * 輸出 review/<stage>[-<module>].html。不連網、不需伺服器，雙擊就能開。
 * 用法見 docs/REVIEW-workbench.md。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse } from 'yaml';
import type { ZodType } from 'zod';
import {
  DrillsFileSchema,
  ModelsFileSchema,
  ModuleMetaSchema,
  StageFileSchema,
  WalkthroughFileSchema,
  isDecision,
  type Drill,
  type DecisionPoint,
  type Model,
  type ModuleMeta,
  type Session,
  type Turn,
} from '../src/content/schema';
import { CATEGORY_LABEL } from './review-forbidden-terms';
import {
  checkModelLength,
  compareDecision,
  compareDrill,
  findForbiddenTerms,
  parseReportRefs,
  type Flag,
} from './review-precheck';
import { PAGE_CSS, PAGE_JS } from './review-workbench-page';

type Loc = 'en' | 'zh-Hant';
const LOCS: Loc[] = ['en', 'zh-Hant'];
const LOC_NAME: Record<Loc, string> = { en: '英文', 'zh-Hant': '繁中' };
const LEVEL_NAME: Record<string, string> = { easy: '容易', medium: '中等', hard: '困難' };
const FIT_NAME: Record<string, string> = { strong: '貼切', workable: '可行', weak: '不貼切' };

export interface WorkbenchOptions {
  contentDir: string;
  reviewsDir: string;
  outDir: string;
  stage: string;
  module?: string;
}

export function workbenchFileName(stage: string, module?: string): string {
  return module ? `${stage}-${module}.html` : `${stage}.html`;
}

export function parseArgs(argv: string[]): { stage: string; module?: string } {
  const get = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const stage = get('--stage');
  if (!stage || stage.startsWith('--')) throw new Error('需要 --stage，例如：npm run review:workbench -- --stage eft');
  const module = get('--module');
  return { stage, module: module && !module.startsWith('--') ? module : undefined };
}

// ---- 讀內容 ------------------------------------------------------------------

function readYaml<T>(file: string, schema: ZodType<T, any, any>): T {
  const r = schema.safeParse(parse(readFileSync(file, 'utf8')));
  if (!r.success) {
    throw new Error(`${file}: ${r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  }
  return r.data;
}

interface ModData {
  meta: ModuleMeta;
  sessions: Session[];
  drills: Drill[];
  models: Record<string, Model>;
}

function loadModule(contentDir: string, loc: Loc, stage: string, slug: string): ModData | undefined {
  const dir = join(contentDir, loc, 'stages', stage, slug);
  if (!existsSync(join(dir, 'module.yaml'))) return undefined;
  return {
    meta: readYaml(join(dir, 'module.yaml'), ModuleMetaSchema),
    sessions: readYaml(join(dir, 'walkthrough.yaml'), WalkthroughFileSchema).sessions,
    drills: readYaml(join(dir, 'drills.yaml'), DrillsFileSchema),
    models: readYaml(join(dir, 'models.yaml'), ModelsFileSchema),
  };
}

// ---- HTML 小工具 -------------------------------------------------------------

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 先跳脫，再把命中的禁用字詞標出來。 */
function highlighter(terms: string[]): (s: string) => string {
  if (!terms.length) return escapeHtml;
  const re = new RegExp(terms.map(escapeRe).sort((a, b) => b.length - a.length).join('|'), 'gi');
  return (s) => {
    let out = '';
    let last = 0;
    for (const m of s.matchAll(re)) {
      out += escapeHtml(s.slice(last, m.index)) + `<mark>${escapeHtml(m[0])}</mark>`;
      last = m.index! + m[0].length;
    }
    return out + escapeHtml(s.slice(last));
  };
}

type Hl = (s: string) => string;

const langTag = (loc: Loc) =>
  loc === 'en' ? '<span class="lang">EN</span>' : '<span class="lang zh">繁中</span>';
const missing = (loc: Loc) => `${langTag(loc)}<p class="missing">（沒有${LOC_NAME[loc]}版本）</p>`;
const para = (hl: Hl, s: string, cls = '') => `<p${cls ? ` class="${cls}"` : ''}>${hl(s)}</p>`;
const labelled = (label: string, inner: string) => `<span class="label">${label}</span>${inner}`;

// ---- 項目 --------------------------------------------------------------------

interface Item {
  id: string;
  kind: 'module' | 'intro' | 'decision' | 'drill' | 'reflection';
  label: string;
  sub?: string;
  flags: Flag[];
  /** 兩欄內容。module 項目沒有兩欄的話，用 single。 */
  cols?: [string, string];
  single?: string;
}

const qualify = (slug: string, id: string) => (id.startsWith(`${slug}-`) ? id : `${slug}-${id}`);
const decisionId = (slug: string, session: Session, d: DecisionPoint) =>
  d.id.startsWith(`${slug}-`) ? d.id : `${session.id}-${d.id}`;

function termFlags(textsByLoc: Partial<Record<Loc, string[]>>): { flags: Flag[]; hl: Record<Loc, Hl> } {
  const flags: Flag[] = [];
  const hl = { en: escapeHtml as Hl, 'zh-Hant': escapeHtml as Hl };
  for (const loc of LOCS) {
    const texts = textsByLoc[loc];
    if (!texts) continue;
    const hits = findForbiddenTerms(texts.join('\n'));
    if (!hits.length) continue;
    flags.push({
      kind: 'forbidden-term',
      message: `${LOC_NAME[loc]}出現禁用字詞：${hits.map((h) => `${h.term}（${CATEGORY_LABEL[h.category]}）`).join('、')}`,
    });
    hl[loc] = highlighter(hits.map((h) => h.term));
  }
  return { flags, hl };
}

function drillTexts(d: Drill, m: Model | undefined): string[] {
  return [d.context, d.client, ...d.criteria, m?.model_response ?? '', m?.why ?? '', m?.avoid ?? ''];
}

function drillCol(loc: Loc, d: Drill | undefined, m: Model | undefined, hl: Hl): string {
  if (!d) return missing(loc);
  return (
    langTag(loc) +
    labelled('情境', para(hl, d.context)) +
    labelled('個案說', para(hl, d.client, 'voice who-client')) +
    labelled('標準', `<ol class="criteria">${d.criteria.map((c) => `<li>${hl(c)}</li>`).join('')}</ol>`) +
    (m
      ? labelled('示範回應', para(hl, m.model_response, 'voice who-therapist')) +
        labelled('為什麼符合', para(hl, m.why)) +
        labelled('要避免', para(hl, m.avoid))
      : labelled('示範回應', '<p class="missing">（沒有示範回應）</p>'))
  );
}

function decisionTexts(d: DecisionPoint): string[] {
  return [d.prompt, d.actual, d.rationale, ...(d.options ?? []).flatMap((o) => [o.text, o.note])];
}

function decisionCol(loc: Loc, d: DecisionPoint | undefined, hl: Hl): string {
  if (!d) return missing(loc);
  const opts = d.options?.length
    ? `<ul class="opts">${d.options
        .map(
          (o) =>
            `<li><span class="fit ${o.fit}">${o.id.toUpperCase()}・${FIT_NAME[o.fit]}（${o.fit}）</span><span class="voice who-therapist">${hl(o.text)}</span>` +
            `<div class="note">${hl(o.note)}</div></li>`,
        )
        .join('')}</ul>`
    : '<p class="note">（自由作答，沒有選項）</p>';
  return (
    langTag(loc) +
    labelled('問題', para(hl, d.prompt)) +
    labelled(`選項（${d.type}）`, opts) +
    labelled('治療師實際說的', para(hl, d.actual, 'voice who-therapist')) +
    labelled('理由', para(hl, d.rationale))
  );
}

function turnCol(loc: Loc, t: Turn | undefined, hl: Hl): string {
  if (!t) return missing(loc);
  const who = t.speaker === 'client' ? '個案' : '治療師';
  return `${langTag(loc)}<p class="voice"><span class="who-${t.speaker}">${who}：</span>${hl(t.text)}</p>`;
}

interface ModuleView {
  slug: string;
  version: string;
  title: { en: string; zh: string };
  items: Item[];
  /** 建立模組卡片以外的段落（走讀、題目、反思）要用的排版資料 */
  sections: string;
  flagCount: number;
}

function buildModule(
  slug: string,
  en: ModData | undefined,
  zh: ModData | undefined,
  refsFor: (id: string) => Flag[],
): ModuleView {
  const meta = en?.meta ?? zh!.meta;
  const items: Item[] = [];
  const addItem = (it: Item) => {
    it.flags.push(...refsFor(it.id));
    items.push(it);
    return it;
  };

  // --- 簡介 ---
  const introTerms = termFlags({
    en: en ? [en.meta.title, en.meta.intro] : undefined,
    'zh-Hant': zh ? [zh.meta.title, zh.meta.intro] : undefined,
  });
  addItem({
    id: `${slug}-intro`,
    kind: 'intro',
    label: '簡介',
    flags: [...introTerms.flags],
    cols: [
      en ? langTag('en') + `<p><strong>${introTerms.hl.en(en.meta.title)}</strong></p>` + para(introTerms.hl.en, en.meta.intro) : missing('en'),
      zh ? langTag('zh-Hant') + `<p><strong>${introTerms.hl['zh-Hant'](zh.meta.title)}</strong></p>` + para(introTerms.hl['zh-Hant'], zh.meta.intro) : missing('zh-Hant'),
    ],
  });

  // --- 走讀 ---
  const walk: string[] = [];
  const sessionIds = [...new Set([...(en?.sessions ?? []), ...(zh?.sessions ?? [])].map((s) => s.id))];
  for (const sid of sessionIds) {
    const es = en?.sessions.find((s) => s.id === sid);
    const zs = zh?.sessions.find((s) => s.id === sid);
    walk.push(
      `<h4 class="session-head">${escapeHtml(es?.title ?? '')}${es && zs ? ' ／ ' : ''}${escapeHtml(zs?.title ?? '')}</h4>`,
    );
    const turnIds: string[] = [];
    for (const t of [...(es?.turns ?? []), ...(zs?.turns ?? [])]) if (!turnIds.includes(t.id)) turnIds.push(t.id);
    // 照英文的次序；英文沒有的放後面
    const order = es ? [...es.turns.map((t) => t.id), ...turnIds.filter((i) => !es.turns.some((t) => t.id === i))] : turnIds;
    for (const tid of order) {
      const et = es?.turns.find((t) => t.id === tid);
      const zt = zs?.turns.find((t) => t.id === tid);
      const either = (et ?? zt)!;
      if (!isDecision(either)) {
        walk.push(
          `<div class="turn-row"><div class="pair"><div class="col" lang="en">${turnCol('en', et as Turn | undefined, escapeHtml)}</div>` +
            `<div class="col" lang="zh-Hant">${turnCol('zh-Hant', zt as Turn | undefined, escapeHtml)}</div></div></div>`,
        );
        continue;
      }
      const ed = et && isDecision(et) ? et : undefined;
      const zd = zt && isDecision(zt) ? zt : undefined;
      const sess = es ?? zs!;
      const id = decisionId(slug, sess, either);
      const tf = termFlags({ en: ed && decisionTexts(ed), 'zh-Hant': zd && decisionTexts(zd) });
      const it = addItem({
        id,
        kind: 'decision',
        label: '走讀決策點',
        sub: sess.title,
        flags: [...tf.flags, ...compareDecision(ed, zd)],
        cols: [decisionCol('en', ed, tf.hl.en), decisionCol('zh-Hant', zd, tf.hl['zh-Hant'])],
      });
      walk.push(`@@ITEM:${it.id}@@`);
    }
    const noteCol = (loc: Loc, s: Session | undefined) =>
      s
        ? langTag(loc) +
          `<p class="note">${(['goals', 'alliance', 'formulation_update'] as const)
            .map((k) => `<strong>${{ goals: '目標', alliance: '同盟', formulation_update: '概念化更新' }[k]}：</strong>${escapeHtml(s.notes[k])}`)
            .join('<br>')}</p>`
        : missing(loc);
    walk.push(
      `<div class="turn-row"><div class="pair"><div class="col" lang="en">${noteCol('en', es)}</div><div class="col" lang="zh-Hant">${noteCol('zh-Hant', zs)}</div></div></div>`,
    );
  }

  // --- 題目 ---
  const drillIds = [...new Set([...(en?.drills ?? []), ...(zh?.drills ?? [])].map((d) => d.id))];
  const byLevel: Record<string, string[]> = { easy: [], medium: [], hard: [] };
  for (const id of drillIds) {
    const ed = en?.drills.find((d) => d.id === id);
    const zd = zh?.drills.find((d) => d.id === id);
    const em = en?.models[id];
    const zm = zh?.models[id];
    const d = (ed ?? zd)!;
    const tf = termFlags({ en: ed && drillTexts(ed, em), 'zh-Hant': zd && drillTexts(zd, zm) });
    const flags: Flag[] = [...tf.flags];
    if (ed && em) { const f = checkModelLength(ed, em.model_response, 'en'); if (f) flags.push({ ...f, message: `英文：${f.message}` }); }
    if (zd && zm) { const f = checkModelLength(zd, zm.model_response, 'zh-Hant'); if (f) flags.push({ ...f, message: `繁中：${f.message}` }); }
    if (ed && zd) flags.push(...compareDrill({ ...em, client: ed.client }, { ...zm, client: zd.client }));
    else flags.push(...compareDrill(ed && { ...em, client: ed.client }, zd && { ...zm, client: zd.client }));
    if (ed && !em) flags.push({ kind: 'structure', message: '英文沒有示範回應。' });
    if (zd && !zm) flags.push({ kind: 'structure', message: '繁中沒有示範回應。' });
    const it = addItem({
      id,
      kind: 'drill',
      label: '題目',
      sub: `${LEVEL_NAME[d.level] ?? d.level}・${d.skill}`,
      flags,
      cols: [drillCol('en', ed, em, tf.hl.en), drillCol('zh-Hant', zd, zm, tf.hl['zh-Hant'])],
    });
    byLevel[d.level]?.push(`@@ITEM:${it.id}@@`);
  }

  // --- 反思題 ---
  const refl: string[] = [];
  const rIds = [...new Set([...(en?.meta.reflection_prompts ?? []), ...(zh?.meta.reflection_prompts ?? [])].map((r) => r.id))];
  for (const rid of rIds) {
    const er = en?.meta.reflection_prompts.find((r) => r.id === rid);
    const zr = zh?.meta.reflection_prompts.find((r) => r.id === rid);
    const tf = termFlags({ en: er && [er.text], 'zh-Hant': zr && [zr.text] });
    const flags = [...tf.flags];
    if (!er || !zr) flags.push({ kind: 'structure', message: `只有${er ? '英文' : '繁中'}，沒有${er ? '繁中' : '英文'}。` });
    const it = addItem({
      id: qualify(slug, rid),
      kind: 'reflection',
      label: '反思題',
      flags,
      cols: [
        er ? langTag('en') + para(tf.hl.en, er.text, 'voice') : missing('en'),
        zr ? langTag('zh-Hant') + para(tf.hl['zh-Hant'], zr.text, 'voice') : missing('zh-Hant'),
      ],
    });
    refl.push(`@@ITEM:${it.id}@@`);
  }

  // --- 模組層級的結構檢查 ---
  const modFlags: Flag[] = [];
  if (!en || !zh) {
    modFlags.push({ kind: 'structure', message: `這個模組只有${en ? '英文' : '繁中'}，沒有${en ? '繁中' : '英文'}。` });
  } else {
    const n = (k: string, a: number, b: number) =>
      a !== b && modFlags.push({ kind: 'structure', message: `${k}數量不一致：英文 ${a}、繁中 ${b}。` });
    n('題目', en.drills.length, zh.drills.length);
    n('走讀會談', en.sessions.length, zh.sessions.length);
    n('反思題', en.meta.reflection_prompts.length, zh.meta.reflection_prompts.length);
    if (en.meta.skills.join() !== zh.meta.skills.join()) {
      modFlags.push({ kind: 'structure', message: `技能代碼不一致：英文 ${en.meta.skills.join('、')}、繁中 ${zh.meta.skills.join('、')}。` });
    }
  }

  const moduleItem: Item = {
    id: slug,
    kind: 'module',
    label: '整個模組',
    flags: modFlags,
    single: '',
  };
  items.unshift(moduleItem);

  const flagCount = items.reduce((n, i) => n + loud(i.flags).length, 0);
  const render = (id: string) => renderItem(items.find((i) => i.id === id)!, slug);

  const sections: string[] = [];
  sections.push(
    renderModuleCard(moduleItem, slug, meta, en, zh, flagCount),
    render(`${slug}-intro`),
    '<h3>走讀</h3>',
    ...walk.map((w) => (w.startsWith('@@ITEM:') ? render(w.slice(7, -2)) : w)),
    '<h3>題目</h3>',
  );
  for (const level of ['easy', 'medium', 'hard']) {
    if (!byLevel[level].length) continue;
    sections.push(`<h4>${LEVEL_NAME[level]}（${byLevel[level].length} 題）</h4>`, ...byLevel[level].map((w) => render(w.slice(7, -2))));
  }
  sections.push('<h3>反思題</h3>', ...refl.map((w) => render(w.slice(7, -2))));

  return {
    slug,
    version: meta.version,
    title: { en: en?.meta.title ?? '', zh: zh?.meta.title ?? '' },
    items,
    sections: sections.join('\n'),
    flagCount,
  };
}

// ---- 顯示 --------------------------------------------------------------------

/** 要擁有人注意的標記：自動預檢警告，和預審報告留給擁有人判斷的項目。其餘（已修正、說明）收合成灰色。 */
const isQuiet = (f: Flag) => f.kind === 'report-ref' && f.ref?.status !== 'judgment';
const isAuto = (f: Flag) => f.kind !== 'report-ref';
const loud = (flags: Flag[]) => flags.filter((f) => !isQuiet(f));

function renderQuiet(flags: Flag[]): string {
  const quiet = flags.filter(isQuiet);
  if (!quiet.length) return '';
  const fixed = quiet.filter((f) => f.ref!.status === 'resolved').length;
  const label = `預審已修正或只是說明（${quiet.length} 則${fixed ? `，其中 ${fixed} 則報告說已處理` : ''}）`;
  return (
    `<details class="prenote"><summary>${label}</summary>` +
    quiet
      .map(
        (f) =>
          `<blockquote>${escapeHtml(f.ref!.text)}</blockquote><div class="src">${escapeHtml(f.ref!.report)}・第 ${f.ref!.line} 行・${escapeHtml(f.ref!.heading)}・${f.ref!.status === 'resolved' ? '報告說已處理' : '說明'}</div>`,
      )
      .join('') +
    `</details>`
  );
}

function renderFlags(flags: Flag[]): string {
  const l = loud(flags);
  const q = renderQuiet(flags);
  return l.length || q ? `<div class="flags">${l.map(renderFlag).join('')}${q}</div>` : '';
}

function renderFlag(f: Flag): string {
  if (f.kind === 'report-ref' && f.ref) {
    return (
      `<details class="flag judge" data-flag="report-ref" open><summary>預審留給你判斷（${escapeHtml(f.ref.report)} 第 ${f.ref.line} 行）</summary>` +
      `<blockquote>${escapeHtml(f.ref.text)}</blockquote>` +
      `<div class="src">${escapeHtml(f.ref.report)}・第 ${f.ref.line} 行・${escapeHtml(f.ref.heading)}</div></details>`
    );
  }
  return `<div class="flag" data-flag="${f.kind}">⚠ ${escapeHtml(f.message)}</div>`;
}

function decideBar(slug: string, extra = ''): string {
  void slug;
  return (
    `<footer class="decide"><button type="button" class="agree" data-act="agree" aria-pressed="false">同意</button>` +
    `<button type="button" class="revise" data-act="revise" aria-pressed="false">要修改</button>` +
    `<input type="text" aria-label="備註" maxlength="300" disabled placeholder="先按「同意」或「要修改」" autocomplete="off">${extra}</footer>`
  );
}

function renderItem(it: Item, slug: string): string {
  const flagged = loud(it.flags).length ? ' data-flagged' : '';
  return (
    `<article class="item" data-id="${escapeHtml(it.id)}" data-module="${escapeHtml(slug)}" data-kind="${it.kind}"${flagged}>` +
    `<header><span class="kind">${it.label}${it.sub ? `・${escapeHtml(it.sub)}` : ''}</span><code>${escapeHtml(it.id)}</code></header>` +
    renderFlags(it.flags) +
    `<div class="pair"><div class="col" lang="en">${it.cols![0]}</div><div class="col" lang="zh-Hant">${it.cols![1]}</div></div>` +
    decideBar(slug) +
    `</article>`
  );
}

function renderModuleCard(it: Item, slug: string, meta: ModuleMeta, en?: ModData, zh?: ModData, flagCount = 0): string {
  const counts = (m?: ModData) =>
    m ? `${m.sessions.reduce((n, s) => n + s.turns.filter(isDecision).length, 0)} 個決策點・${m.drills.length} 題・${m.meta.reflection_prompts.length} 個反思題` : '沒有';
  const body =
    `<div class="pair"><div class="col" lang="en">${langTag('en')}<p><strong>${escapeHtml(en?.meta.title ?? '—')}</strong></p><p class="stats">${counts(en)}</p></div>` +
    `<div class="col" lang="zh-Hant">${langTag('zh-Hant')}<p><strong>${escapeHtml(zh?.meta.title ?? '—')}</strong></p><p class="stats">${counts(zh)}</p></div></div>`;
  const copy = `<button type="button" class="copy mod-copy" data-copy-module="${escapeHtml(slug)}">複製這個模組的決定</button>`;
  return (
    `<article class="item module-item" data-id="${escapeHtml(slug)}" data-module="${escapeHtml(slug)}" data-kind="module"${loud(it.flags).length ? ' data-flagged' : ''}>` +
    `<header><span class="kind">整個模組（${escapeHtml(meta.skills.join('、'))}）・版本 ${escapeHtml(meta.version)}</span><code>${escapeHtml(slug)}</code>` +
    `<span class="stats">預檢標記共 ${flagCount} 個</span></header>` +
    renderFlags(it.flags) +
    body +
    `<p class="hint">這一格是對「整個模組」的決定。下面每一項各有自己的按鈕。</p>` +
    decideBar(slug, copy) +
    `</article>`
  );
}

// ---- 主程式 ------------------------------------------------------------------

export interface BuildResult {
  file: string;
  html: string;
  itemCount: number;
  flagCount: number;
  judgeItems: number;
  autoItems: number;
  quietNotes: number;
  summaryLine: string;
  perModule: { slug: string; items: number; flags: number }[];
}

function safeJson(v: unknown): string {
  return JSON.stringify(v)
    .replace(/</g, '\\u003c')
    .replace(new RegExp(String.fromCharCode(0x2028), 'g'), '\\u2028')
    .replace(new RegExp(String.fromCharCode(0x2029), 'g'), '\\u2029');
}

export function buildWorkbench(opts: WorkbenchOptions): BuildResult {
  const stageDirOf = (loc: Loc) => join(opts.contentDir, loc, 'stages', opts.stage, 'stage.yaml');
  if (!existsSync(stageDirOf('en'))) {
    const stages = existsSync(join(opts.contentDir, 'en', 'stages'))
      ? readdirSync(join(opts.contentDir, 'en', 'stages')).sort()
      : [];
    throw new Error(`找不到階段「${opts.stage}」。有這些階段：${stages.join('、') || '（沒有）'}`);
  }
  const stageEn = readYaml(stageDirOf('en'), StageFileSchema);
  const stageZh = existsSync(stageDirOf('zh-Hant')) ? readYaml(stageDirOf('zh-Hant'), StageFileSchema) : undefined;
  const allSlugs = stageEn.modules;
  let slugs = allSlugs;
  if (opts.module) {
    if (!allSlugs.includes(opts.module)) {
      throw new Error(`階段「${opts.stage}」沒有模組「${opts.module}」。有這些模組：${allSlugs.join('、')}`);
    }
    slugs = [opts.module];
  }

  const data = new Map(
    allSlugs.map((slug) => [slug, { en: loadModule(opts.contentDir, 'en', opts.stage, slug), zh: loadModule(opts.contentDir, 'zh-Hant', opts.stage, slug) }]),
  );

  // 預審報告：只看寫到這個階段的模組（用反引號寫 slug）的報告。
  const idsByModule = new Map<string, Set<string>>();
  for (const [slug, { en, zh }] of data) {
    const ids = new Set<string>();
    for (const m of [en, zh]) {
      if (!m) continue;
      m.drills.forEach((d) => ids.add(d.id));
      m.meta.reflection_prompts.forEach((r) => ids.add(qualify(slug, r.id)));
      m.sessions.forEach((s) => s.turns.filter(isDecision).forEach((d) => ids.add(decisionId(slug, s, d))));
    }
    idsByModule.set(slug, ids);
  }
  const refs = new Map<string, Flag[]>();
  if (existsSync(opts.reviewsDir)) {
    for (const f of readdirSync(opts.reviewsDir).filter((n) => n.endsWith('.md')).sort()) {
      const md = readFileSync(join(opts.reviewsDir, f), 'utf8');
      if (!allSlugs.some((s) => md.includes(`\`${s}\``))) continue;
      for (const [id, list] of parseReportRefs(md, f, allSlugs, idsByModule)) {
        const flags = refs.get(id) ?? [];
        for (const ref of list) flags.push({ kind: 'report-ref', message: `預審報告提到（${f} 第 ${ref.line} 行）`, ref });
        refs.set(id, flags);
      }
    }
  }

  const views = slugs.map((slug) => {
    const { en, zh } = data.get(slug)!;
    if (!en && !zh) throw new Error(`模組「${slug}」在 content/ 下沒有檔案。`);
    return buildModule(slug, en, zh, (id) => refs.get(id) ?? []);
  });

  const title = `${stageEn.title}${stageZh ? `／${stageZh.title}` : ''}${opts.module ? ` — ${opts.module}` : ''}`;
  const pageData = {
    stage: opts.stage,
    modules: views.map((v) => ({ slug: v.slug, version: v.version, ids: v.items.map((i) => i.id) })),
  };
  const totalFlags = views.reduce((n, v) => n + v.flagCount, 0);
  const allItems = views.flatMap((v) => v.items);
  const judgeItems = allItems.filter((i) => i.flags.some((f) => f.kind === 'report-ref' && !isQuiet(f))).length;
  const autoItems = allItems.filter((i) => i.flags.some(isAuto)).length;
  const quietNotes = allItems.reduce((n, i) => n + i.flags.filter(isQuiet).length, 0);
  const summaryLine = `要你判斷的 ${judgeItems} 項；自動預檢警告 ${autoItems} 項；其餘是說明（${quietNotes} 則，已收合）`;
  const itemCount = views.reduce((n, v) => n + v.items.length, 0);

  const html = `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>審核工作台：${escapeHtml(title)}</title>
<style>${PAGE_CSS}</style>
</head>
<body>
<div class="top">
  <div class="top-row">
    <h1>審核工作台：${escapeHtml(title)}</h1>
    <div class="progress" aria-live="polite"><span>已看 <span id="seen">0</span>／全部 <span id="total">${itemCount}</span></span><div class="bar"><i id="bar"></i></div></div>
    <label><input type="checkbox" id="only-flagged"> 只看有預檢標記的</label>
    <label><input type="checkbox" id="only-undecided"> 只看還沒決定的</label>
    <button type="button" class="copy" id="copy-all">複製決定</button>
  </div>
  <div id="toast" role="status"></div>
  <div id="fallback"><textarea readonly aria-label="決定的 JSON"></textarea></div>
  <div class="top-row" id="storage-warning" hidden><span class="flag">這個瀏覽器不讓網頁存資料，所以重新整理後決定會消失。請審完後立刻按「複製決定」。</span></div>
</div>
<main>
  <section class="intro">
    <p>每一項左邊是英文，右邊是繁中（手機上改為上下排列）。每項按「同意」或「要修改」，要修改的寫一句備註。</p>
    <p class="summary-line" id="summary-line"><strong>${summaryLine}</strong></p>
    <p>⚠ 標記是電腦自動預檢的提示，<strong>不取代你的臨床判斷</strong>：有標記不一定要改，沒標記也不代表沒問題。醒目的標記共 ${totalFlags} 個；灰色、收合的是預審已修正或只是說明。</p>
    <p>全部看完後，按上方「複製決定」，到 Claude 的對話框貼上。</p>
    <ul class="navlist">${views
      .map((v) => `<li><a href="#mod-${escapeHtml(v.slug)}">${escapeHtml(v.title.zh || v.title.en)} <span class="n">（<span data-nav-count="${escapeHtml(v.slug)}">0／${v.items.length}</span>）</span></a></li>`)
      .join('')}</ul>
  </section>
${views
  .map((v) => `<section class="module" id="mod-${escapeHtml(v.slug)}"><h2>${escapeHtml(v.title.en)}${v.title.zh ? ` ／ ${escapeHtml(v.title.zh)}` : ''}</h2>\n${v.sections}\n</section>`)
  .join('\n')}
</main>
<script type="application/json" id="wb-data">${safeJson(pageData)}</script>
<script>${PAGE_JS}</script>
</body>
</html>
`;

  mkdirSync(opts.outDir, { recursive: true });
  const file = join(opts.outDir, workbenchFileName(opts.stage, opts.module));
  writeFileSync(file, html);
  return {
    file,
    html,
    itemCount,
    flagCount: totalFlags,
    judgeItems,
    autoItems,
    quietNotes,
    summaryLine,
    perModule: views.map((v) => ({ slug: v.slug, items: v.items.length, flags: v.flagCount })),
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = resolve('.');
  try {
    const r = buildWorkbench({
      contentDir: join(root, 'content'),
      reviewsDir: join(root, 'docs', 'reviews'),
      outDir: join(root, 'review'),
      ...args,
    });
    console.log(`已產生：${r.file}`);
    console.log(`共 ${r.itemCount} 項，${r.flagCount} 個醒目標記。${r.summaryLine}`);
    for (const m of r.perModule) console.log(`  ${m.slug}：${m.items} 項，${m.flags} 個標記`);
    console.log('用瀏覽器開這個檔案（雙擊）。');
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
