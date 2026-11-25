/**
 * 審核工作台的自動預檢規則。全部只是提示，不取代臨床判斷。
 * 純函式，沒有檔案存取，方便單元測試。
 */
import { FORBIDDEN_TERMS, type TermCategory } from './review-forbidden-terms';

export type FlagKind = 'forbidden-term' | 'sentence-count' | 'structure' | 'report-ref';

export interface Flag {
  kind: FlagKind;
  /** 一句話，給擁有人看（繁體中文）。 */
  message: string;
  /** 報告提到：報告原文那一行和位置。 */
  ref?: ReportRef;
}

export interface ReportRef {
  report: string;
  line: number;
  text: string;
  heading: string;
}

type Loc = 'en' | 'zh-Hant';

// ---- 禁用字詞 ---------------------------------------------------------------

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isLatin = (s: string) => /^[\x00-\x7f]+$/.test(s);
/** 全大寫的縮寫（DID、AUDIT、BDI）要分大小寫，否則 did、audit 這種一般的字也會命中。 */
const isAcronym = (s: string) => !/[a-z]/.test(s);

const MATCHERS = FORBIDDEN_TERMS.map((t) => ({
  ...t,
  // 英文：整個字詞（前後不是字母或數字）；中文：直接比對字串。
  re: isLatin(t.term)
    ? new RegExp(`(?<![A-Za-z0-9])${escapeRe(t.term)}(?![A-Za-z0-9])`, isAcronym(t.term) ? '' : 'i')
    : new RegExp(escapeRe(t.term)),
}));

export function findForbiddenTerms(text: string): { term: string; category: TermCategory }[] {
  const hits: { term: string; category: TermCategory }[] = [];
  const taken: string[] = [];
  // 長的詞先比，這樣「創傷後壓力症候群」不會同時又報「創傷後壓力症」。
  for (const m of [...MATCHERS].sort((a, b) => b.term.length - a.term.length)) {
    if (!m.re.test(text)) continue;
    if (taken.some((t) => t.toLowerCase().includes(m.term.toLowerCase()))) continue;
    taken.push(m.term);
    hits.push({ term: m.term, category: m.category });
  }
  return hits;
}

// ---- 句數 -------------------------------------------------------------------

/** 數句子。句號、問號、驚嘆號（含中文全形）後面接空白、引號或結尾，才算句尾。 */
export function countSentences(text: string): number {
  const cleaned = text
    .replace(/\b(e\.g|i\.e|etc|vs|Mr|Mrs|Ms|Dr)\./gi, '$1')
    .replace(/\.{2,}|…+/g, '…')
    .trim();
  if (!cleaned) return 0;
  const parts = cleaned
    .split(/(?:[.!?]+(?=["'”’)\]」』]*(?:\s|$))|[。！？]+)["'”’)\]」』]*/u)
    .map((p) => p.trim())
    .filter((p) => /[\p{L}\p{N}]/u.test(p));
  return parts.length;
}

const EN_NUM: Record<string, number> = { a: 1, one: 1, two: 2, three: 3, four: 4, five: 5 };
const ZH_NUM: Record<string, number> = { 一: 1, 兩: 2, 二: 2, 三: 3, 四: 4, 五: 5 };

/** 從題目文字讀出要求的句數上限（例如「一至兩句話」→ 2）。沒有寫就回傳 undefined。 */
export function maxSentencesRequested(text: string): number | undefined {
  let best: number | undefined;
  const take = (n: number | undefined) => {
    if (n !== undefined && (best === undefined || n < best)) best = n;
  };
  for (const m of text.matchAll(/\b(?:(?:no more than|at most|up to|a maximum of)\s+)?(a|one|two|three|four|five)(?:\s+(?:or|to)\s+(one|two|three|four|five))?[\s-]+(?:short\s+)?sentences?\b/gi)) {
    take(EN_NUM[(m[2] ?? m[1]).toLowerCase()]);
  }
  for (const m of text.matchAll(/([一二兩三四五])(?:[至到或]([一二兩三四五]))?句/g)) {
    take(ZH_NUM[m[2] ?? m[1]]);
  }
  return best;
}

export function checkModelLength(
  drill: { context: string; criteria: readonly string[] },
  modelResponse: string,
  _loc: Loc,
): Flag | undefined {
  const max = maxSentencesRequested([drill.context, ...drill.criteria].join('\n'));
  if (max === undefined) return undefined;
  const n = countSentences(modelResponse);
  if (n <= max) return undefined;
  return { kind: 'sentence-count', message: `示範回應有 ${n} 句，題目要求至多 ${max} 句。` };
}

// ---- 中英結構 ---------------------------------------------------------------

const hasQuestion = (s: string) => /[?？]/.test(s);

interface DrillSide {
  model_response?: string;
  why?: string;
  avoid?: string;
  client?: string;
}

export function compareDrill(en: DrillSide | undefined, zh: DrillSide | undefined): Flag[] {
  const flag = (message: string): Flag => ({ kind: 'structure', message });
  if (!en) return [flag('只有繁中，沒有英文。')];
  if (!zh) return [flag('只有英文，沒有繁中。')];
  const out: Flag[] = [];
  const a = en.model_response ?? '';
  const b = zh.model_response ?? '';
  if (Math.abs(countSentences(a) - countSentences(b)) >= 2) {
    out.push(flag(`示範回應句數差很多：英文 ${countSentences(a)} 句、繁中 ${countSentences(b)} 句。`));
  }
  if (hasQuestion(a) !== hasQuestion(b)) {
    out.push(flag(`示範回應的問句不一致：${hasQuestion(a) ? '英文有問句、繁中沒有' : '繁中有問句、英文沒有'}。`));
  }
  if (hasQuestion(en.client ?? '') !== hasQuestion(zh.client ?? '')) {
    out.push(flag('個案的話：問句在英文和繁中不一致。'));
  }
  for (const k of ['why', 'avoid'] as const) {
    if (!!en[k]?.trim() !== !!zh[k]?.trim()) out.push(flag(`「${k === 'why' ? '為什麼' : '避免'}」只有一種語言有寫。`));
  }
  return out;
}

interface DecisionSide {
  type?: string;
  options?: { id: string; fit: string }[];
}

export function compareDecision(en: DecisionSide | undefined, zh: DecisionSide | undefined): Flag[] {
  const flag = (message: string): Flag => ({ kind: 'structure', message });
  if (!en) return [flag('只有繁中，沒有英文。')];
  if (!zh) return [flag('只有英文，沒有繁中。')];
  if (en.type !== zh.type) return [flag(`決策點類型不一致：英文 ${en.type}、繁中 ${zh.type}。`)];
  const out: Flag[] = [];
  const eo = en.options ?? [];
  const zo = zh.options ?? [];
  if (eo.map((o) => o.id).join() !== zo.map((o) => o.id).join()) {
    out.push(flag(`選項 id 不一致：英文 [${eo.map((o) => o.id)}]、繁中 [${zo.map((o) => o.id)}]。`));
  } else {
    eo.forEach((o, i) => {
      if (o.fit !== zo[i].fit) out.push(flag(`選項 ${o.id} 的 fit 不一致：英文 ${o.fit}、繁中 ${zo[i].fit}。`));
    });
  }
  return out;
}

// ---- 預審報告提到的題目 id --------------------------------------------------

/**
 * 在預審報告（Markdown）裡找出提到的題目／決策點 id。
 *
 * 認得的寫法：
 * - 完整 id：`eft-attunement-e02`、`eft-attunement-s1-d3`
 * - 簡寫：`e02`、`m10`、`h07`、`s1-d3`。屬於哪個模組，依序看：同一行的「模組 N」或「M N」→
 *   最近的標題裡寫了模組 slug → 都沒有就略過。
 * - 範圍：`h01–h05`、`h01-05`
 * 只保留內容裡真的存在的 id。
 *
 * @param moduleSlugs 這個階段的模組，照階段順序（「模組 N」就是第 N 個）。
 * @param idsByModule 每個模組裡存在的 id。
 */
export function parseReportRefs(
  markdown: string,
  report: string,
  moduleSlugs: string[],
  idsByModule: Map<string, Set<string>>,
): Map<string, ReportRef[]> {
  const out = new Map<string, ReportRef[]>();
  const lines = markdown.split('\n');
  let heading = '';
  let sectionModule: string | undefined;
  const add = (id: string, ref: ReportRef) => {
    const list = out.get(id) ?? [];
    if (!list.some((r) => r.line === ref.line)) list.push(ref);
    out.set(id, list);
  };
  const exists = (slug: string | undefined, id: string) => !!slug && !!idsByModule.get(slug)?.has(id);
  const slugOfId = (id: string) => moduleSlugs.find((s) => id.startsWith(`${s}-`));

  lines.forEach((text, i) => {
    const line = i + 1;
    const h = /^#{1,6}\s+(.*)$/.exec(text);
    if (h) {
      heading = h[1].trim();
      sectionModule = moduleSlugs.find((s) => heading.includes(`\`${s}\``)) ?? (/^模組|^Module/.test(heading) ? undefined : sectionModule);
      // 標題不是模組標題（例如「摘要」「驗證」）就不繼承上一個模組。
      if (!moduleSlugs.some((s) => heading.includes(`\`${s}\``))) sectionModule = undefined;
    }
    const ref: ReportRef = { report, line, text: text.trim(), heading };

    // 1. 完整 id
    const full = new Set<string>();
    for (const slug of moduleSlugs) {
      const re = new RegExp(`${escapeRe(slug)}-(?:[emh]\\d{2}|s\\d+-d\\d+|r\\d+)(?![A-Za-z0-9])`, 'g');
      for (const m of text.matchAll(re)) full.add(m[0]);
    }
    for (const id of full) if (exists(slugOfId(id), id)) add(id, ref);

    // 2. 簡寫：先決定這一行屬於哪個模組
    let slug: string | undefined;
    const mention = /模組\s*(\d+)|\bM\s?(\d+)\b/.exec(text);
    if (mention) slug = moduleSlugs[Number(mention[1] ?? mention[2]) - 1];
    slug ??= sectionModule;
    if (!slug) return;

    // 簡寫要整段去掉完整 id 之後再找，避免 `eft-x-e02` 又被當成 e02 配到別的模組
    const stripped = text.replace(/[a-z0-9]+(?:-[a-z0-9]+)*-(?:[emh]\d{2}|s\d+-d\d+|r\d+)/g, ' ');
    for (const m of stripped.matchAll(/(?<![A-Za-z0-9-])([emh])(\d{2})(?:\s*[–\-~～至到]\s*(?:([emh]))?(\d{2}))?(?![A-Za-z0-9])/g)) {
      const letter = m[1];
      const from = Number(m[2]);
      const to = m[4] !== undefined && (m[3] === undefined || m[3] === letter) ? Number(m[4]) : from;
      for (let n = from; n <= Math.max(from, to) && n - from < 30; n++) {
        const id = `${slug}-${letter}${String(n).padStart(2, '0')}`;
        if (exists(slug, id)) add(id, ref);
      }
    }
    for (const m of stripped.matchAll(/(?<![A-Za-z0-9-])(s\d+-d\d+)(?![A-Za-z0-9])/g)) {
      const id = `${slug}-${m[1]}`;
      if (exists(slug, id)) add(id, ref);
    }
  });
  return out;
}
