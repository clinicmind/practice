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

/**
 * 報告提到這一項的性質：
 * - resolved：報告說已處理或已修正（只是說明）
 * - judgment：報告把它留給擁有人判斷（沒有處理、請擁有人定、建議）
 * - note：只是提到，沒有說已處理也沒有要判斷（例如「符合標準」）
 */
export type RefStatus = 'resolved' | 'judgment' | 'note';

export interface ReportRef {
  report: string;
  line: number;
  text: string;
  heading: string;
  status: RefStatus;
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

const QUOTE_PATTERNS: RegExp[] = [
  /「([^「」]*)」/g,
  /『([^『』]*)』/g,
  /“([^“”]*)”/g,
  /‘([^‘’]*)’(?![A-Za-z])/g,
  /"([^"]*)"/g,
  // 英文單引號：前後不是字母，裡面的撇號（she'd）不算結尾
  /(?<![A-Za-z0-9])'((?:[^']|(?<=[A-Za-z])'(?=[A-Za-z]))*)'(?![A-Za-z0-9])/g,
];
const TERMINATORS = /[.!?。！？]/g;

/**
 * 夾在句子中間的引文（例如：你聽到「笨。又來了。」然後……），引文裡的句號、問號不是句尾。
 * - 引文裡面的終結符號一律拿掉。
 * - 引文最後的終結符號：後面還接著同一句的文字（逗號、小寫字、中文字）才拿掉；後面是空白加大寫字或結尾，照舊算句尾。
 * - 引文放在句首（前面沒有字，或前面剛結束一句）是獨立的一句，不處理。
 */
function flattenQuotes(text: string): string {
  let out = text;
  for (const re of QUOTE_PATTERNS) {
    out = out.replace(re, (whole: string, inner: string, offset: number, all: string) => {
      const before = all.slice(0, offset).trimEnd();
      if (!before || /[.!?。！？…]["'”’)\]」』]*$/.test(before)) return whole;
      const open = whole[0];
      const close = whole[whole.length - 1];
      const after = all.slice(offset + whole.length);
      const continues = /^(?:[,;:，；：、]|\s*[a-z]|[\p{Script=Han}])/u.test(after);
      const body = inner.replace(/\s+$/, '');
      const flat = continues ? body.replace(TERMINATORS, '') : body.replace(/[.!?。！？]+(?=\s*\S)/g, '');
      return `${open}${flat}${close}`;
    });
  }
  return out;
}

/** 數句子。句號、問號、驚嘆號（含中文全形）後面接空白、引號或結尾，才算句尾。 */
export function countSentences(text: string): number {
  const cleaned = flattenQuotes(text)
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
    // "in the middle of a sentence" 只是描述情境；「a」要接在 write／say／in 這類字後面才是句數上限。
    if (m[1].toLowerCase() === 'a' && !m[2]) {
      const prev = /([A-Za-z]+)\s+$/.exec(text.slice(0, m.index!))?.[1]?.toLowerCase();
      if (!prev || !['write', 'say', 'reply', 'respond', 'give', 'offer', 'use', 'using', 'in', 'with', 'than', 'most', 'to'].includes(prev)) continue;
    }
    take(EN_NUM[(m[2] ?? m[1]).toLowerCase()]);
  }
  // 「寫一句回應」的「句」是「一個」的量詞（英文是 one response），不是句數上限；
  // 「一句簡短的回應」同理。「一句話」「兩句短句」才是句數。
  for (const m of text.matchAll(/([一二兩三四五])(?:[至到或]([一二兩三四五]))?句(?!回應|簡短的?回應)/g)) {
    take(ZH_NUM[m[2] ?? m[1]]);
  }
  return best;
}

/**
 * 評分標準裡的「用一句話回應她的擔心，再說其他的」「in one sentence, before it says anything else」
 * 只是在規定其中一部分要多短，不是整個回應的句數上限。題目的情境（context）裡寫的「寫一句話」才是上限。
 */
export function stripScopedOneSentence(criterion: string): string {
  return criterion
    .replace(/,\s*(?:first,\s*)?in (?:a|one) sentence\b/gi, '')
    .replace(/(?:先)?用[一二兩三四五]句話/g, '');
}

export function checkModelLength(
  drill: { context: string; criteria: readonly string[] },
  modelResponse: string,
  _loc: Loc,
): Flag | undefined {
  const max = maxSentencesRequested([drill.context, ...drill.criteria.map(stripScopedOneSentence)].join('\n'));
  if (max === undefined) return undefined;
  const n = countSentences(modelResponse);
  if (n <= max) return undefined;
  return { kind: 'sentence-count', message: `示範回應有 ${n} 句，題目要求至多 ${max} 句。` };
}

// ---- 中英結構 ---------------------------------------------------------------

/** 引號裡的問句是個案或第三者的話，不算示範回應自己有問句。 */
const stripQuoted = (s: string) =>
  s
    .replace(/「[^「」]*」|『[^『』]*』|“[^“”]*”|‘[^‘’]*’(?![A-Za-z])|"[^"]*"/g, ' ')
    .replace(/(?<![A-Za-z0-9])'(?:[^']|(?<=[A-Za-z])'(?=[A-Za-z]))*'(?![A-Za-z0-9])/g, ' ');
const hasQuestion = (s: string) => /[?？]/.test(stripQuoted(s));

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

// ---- 預審報告：已處理還是留給擁有人 ------------------------------------------

const RESOLVED_HEADING = /已處理|已修正|已完成/;
const UNRESOLVED_HEADING = /沒有處理|未處理|需要擁有人|臨床判斷|待確認|擁有人判斷/;
/** 這些字出現在一行裡，就是在請擁有人看或表示沒動。 */
const JUDGMENT_WORDS = /沒有改|沒有動|沒有處理|未處理|請擁有人|擁有人(?:決定|判斷|確認|定)|待確認|臨床判斷|審核人|是否|建議|我判斷|請留意|請確認|請決定/;
/** 在「已處理」的段落裡，只有這些才算還要擁有人看。 */
const STILL_OPEN_WORDS = /沒有改|沒有動|沒有處理|未處理|請擁有人|待確認|請留意|請確認|請決定/;
const RESOLVED_WORDS = /已處理|已修正|已改|已完成|已補|已刪|已同步/;

/** 預審報告的「摘要第 N 點」在已處理的段落被處理了，回傳那些 N。 */
function resolvedSummaryPoints(lines: string[], paths: string[][]): Set<number> {
  const done = new Set<number>();
  lines.forEach((text, i) => {
    const path = paths[i];
    const inResolved = path.some((h) => RESOLVED_HEADING.test(h)) && !UNRESOLVED_HEADING.test(path[path.length - 1] ?? '');
    if (!inResolved) return;
    const heading = /^#{1,6}\s+摘要第\s*(\d+)\s*點/.exec(text);
    if (heading) done.add(Number(heading[1]));
    const range = /處理摘要第\s*(\d+)\s*[–\-~至到]\s*(\d+)\s*點/.exec(text);
    if (range) for (let n = Number(range[1]); n <= Number(range[2]); n++) done.add(n);
  });
  return done;
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

  // 先掃一遍：每一行的標題路徑，和摘要裡每一行屬於第幾點。
  const paths: string[][] = [];
  const stack: string[] = [];
  const summaryPoint: (number | undefined)[] = [];
  let point: number | undefined;
  lines.forEach((text) => {
    const h = /^(#{1,6})\s+(.*)$/.exec(text);
    if (h) {
      stack.length = h[1].length - 1;
      stack[h[1].length - 1] = h[2].trim();
      point = undefined;
    }
    paths.push(stack.filter((x) => x !== undefined));
    const inSummary = stack.some((x) => x && /^摘要/.test(x));
    const n = /^(\d+)\.\s/.exec(text);
    if (inSummary && n) point = Number(n[1]);
    summaryPoint.push(inSummary ? point : undefined);
  });
  const handledPoints = resolvedSummaryPoints(lines, paths);
  const summaryItemText = (p: number, from: number) => {
    const out: string[] = [];
    for (let j = from; j >= 0 && summaryPoint[j] === p; j--) out.unshift(lines[j]);
    for (let j = from + 1; j < lines.length && summaryPoint[j] === p; j++) out.push(lines[j]);
    return out.join('\n');
  };
  const classify = (i: number): RefStatus => {
    const text = lines[i];
    const path = paths[i];
    const nearest = path[path.length - 1] ?? '';
    const p = summaryPoint[i];
    if (p !== undefined) {
      if (handledPoints.has(p)) return 'resolved';
      const item = summaryItemText(p, i);
      if (/請擁有人|擁有人(?:決定|判斷|確認|定)|臨床判斷/.test(item) && !/\*\*已處理\*\*/.test(item)) return 'judgment';
      return RESOLVED_WORDS.test(item) ? 'resolved' : 'judgment';
    }
    if (UNRESOLVED_HEADING.test(nearest)) return 'judgment';
    if (path.some((h) => RESOLVED_HEADING.test(h))) return STILL_OPEN_WORDS.test(text) ? 'judgment' : 'resolved';
    if (JUDGMENT_WORDS.test(text)) return 'judgment';
    if (RESOLVED_WORDS.test(text)) return 'resolved';
    return 'note';
  };

  lines.forEach((text, i) => {
    const line = i + 1;
    const h = /^#{1,6}\s+(.*)$/.exec(text);
    if (h) {
      heading = h[1].trim();
      sectionModule = moduleSlugs.find((s) => heading.includes(`\`${s}\``)) ?? (/^模組|^Module/.test(heading) ? undefined : sectionModule);
      // 標題不是模組標題（例如「摘要」「驗證」）就不繼承上一個模組。
      if (!moduleSlugs.some((s) => heading.includes(`\`${s}\``))) sectionModule = undefined;
    }
    const ref: ReportRef = { report, line, text: text.trim(), heading, status: classify(i) };

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
