import {
  CJK_GENERIC_PREFIX, CJK_NON_NAME, CJK_STOPWORDS, CJK_SURNAMES, EN_GENERIC_PREFIX, GIVEN_NAMES,
  INSTITUTION_ABBREVIATIONS, ROMAN_SURNAMES,
} from './lists';

export type Level = 'high' | 'medium' | 'low';
/** A match in normalised text: [start, end). */
export type Span = { start: number; end: number };
export type Rule = { id: string; level: Level; find: (text: string) => Span[] };

// Every quantifier that can run over arbitrary text is bounded, so no pattern is quadratic on hostile input.

function all(re: RegExp, text: string, keep?: (m: RegExpExecArray) => boolean | Span): Span[] {
  const out: Span[] = [];
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[0].length === 0) { re.lastIndex++; continue; }
    const k = keep ? keep(m) : true;
    if (k === true) out.push({ start: m.index, end: m.index + m[0].length });
    else if (k) out.push(k);
  }
  return out;
}

const CJK = '\\u3400-\\u9fff';
const isCjk = (ch: string | undefined) => !!ch && ch >= '㐀' && ch <= '鿿';

// --- high ---------------------------------------------------------------------------------------

function hkidValid(letters: string, digits: string, check: string): boolean {
  const L = letters.toUpperCase();
  const vals = L.length === 2 ? [L.charCodeAt(0) - 55, L.charCodeAt(1) - 55] : [36, L.charCodeAt(0) - 55];
  for (const d of digits) vals.push(Number(d));
  let sum = 0;
  for (let i = 0; i < 8; i++) sum += vals[i] * (9 - i);
  sum += check.toUpperCase() === 'A' ? 10 : Number(check);
  return sum % 11 === 0;
}
// A bracketed check digit ends the number by itself; only the unbracketed form needs a boundary after it.
const HKID = /(?<![A-Za-z0-9])([A-Za-z]{1,2})\s?(\d{6})\s?(?:\(\s?([0-9Aa])\s?\)|([0-9Aa])(?![A-Za-z0-9]))/g;
const MO_BIR = /(?<![\dA-Za-z])[1578]\s?\d{3}\s?\d{3}\s?\(\s?\d\s?\)/g;
const PHONE = /(?<![\dA-Za-z+])(?:\+?85[23][\s-]?)?([235679]\d{3})([\s-]?)(\d{4})(?!\d)/g;
const YEAR = /^(?:19|20)\d{2}$/;
const EMAIL = /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){1,6}/g;
const URL_RE = /https?:\/\/[^\s<>"'，。、）)]{1,500}|(?<![A-Za-z0-9@.])www\.[A-Za-z0-9-]{1,63}\.[^\s<>"'，。、）)]{1,500}/g;
const trimTrailingDot = (m: RegExpExecArray): Span => {
  const t = m[0].replace(/[.,;:!?]+$/, '');
  return { start: m.index, end: m.index + t.length };
};

// --- medium -------------------------------------------------------------------------------------

const MONTH = '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
const ORD = '(?:st|nd|rd|th)?';
const NUM_DATE = '\\d{1,2}[\\/.-]\\d{1,2}[\\/.-](?:\\d{4}|\\d{2})';
const ISO_DATE = '\\d{4}[\\/.-]\\d{1,2}[\\/.-]\\d{1,2}';
const FULL_DATE = new RegExp(
  `(?<!\\d)(?:${ISO_DATE}|${NUM_DATE})(?!\\d)` +
    `|\\b\\d{1,2}${ORD}\\s+${MONTH}\\.?,?\\s+\\d{4}\\b` +
    `|\\b${MONTH}\\.?\\s+\\d{1,2}${ORD},?\\s+\\d{4}\\b` +
    `|\\d{4}\\s?年\\s?\\d{1,2}\\s?月\\s?\\d{1,2}\\s?[日號号]`,
  'gi',
);
const DOB = new RegExp(
  `(?:\\bDOB\\b|\\bD\\.O\\.B\\.?|\\bdate of birth\\b|\\bborn\\b|出生日期|出生年份|出生於|出生|生於|生于)` +
    `[^\\n\\d]{0,15}?(?:${NUM_DATE}|${ISO_DATE}|(?:19|20)\\d{2}(?:\\s?年)?)(?!\\d)`,
  'gi',
);
const AGE = /\baged?\s+(?:9\d|1[0-2]\d)\b(?!\s?%)|(?<!\d)(?:9\d|1[0-2]\d)(?:\s?-?\s?years?[\s-]old\b|\s?(?:yo|y\/o)\b|\s?[歲岁])/gi;
const ADDRESS = new RegExp(
  `\\b(?:Flat|Room|Rm|Unit|Block|Blk|Tower)\\s+(?:\\d{1,4}[A-Za-z]?|[A-Z])\\b` +
    `|\\b\\d{1,4}[A-Za-z]?\\s+(?:[A-Z][a-z']{1,20}\\s+){1,3}(?:Road|Street|Avenue|Lane|Drive|Terrace|Path|Square)\\b` +
    `|\\b\\d{1,3}\\/F\\b|\\b\\d{1,3}(?:st|nd|rd|th)\\s+Floor\\b` +
    `|[${CJK}]{2,4}(?:新邨|新村|邨|苑|大廈)` +
    `|[${CJK}]{1,6}?(?:大馬路|馬路|街|道|路|巷|里)\\s?\\d{1,4}\\s?號` +
    `|\\d{1,3}\\s?樓\\s?[A-Za-z0-9]{0,3}\\s?[室座]?` +
    `|(?<![A-Za-z0-9])[A-Za-z0-9]{1,3}\\s?[室座]`,
  'g',
);
const INST_EN = /(?:[A-Z][A-Za-z'’.&-]{0,24}\s+){1,4}(?:Hospital|Clinic|College|School|University|Centre|Center|Academy|Institute)\b/g;
const INST_ZH = new RegExp(`[${CJK}]{2,8}(?:醫院|診所|中學|小學|大學|書院|學校|幼稚園|中心)`, 'g');
const INST_ABBR = new RegExp(`\\b(?:${INSTITUTION_ABBREVIATIONS.join('|')})\\b`, 'g');
const TITLE_EN = /\b(?:Mr|Mrs|Ms|Miss|Dr|Prof|Professor|Madam|Sir)\.?\s+[A-Z][a-z]{1,20}(?:\s+[A-Z][a-z]{1,20}){0,2}/g;
const TITLE_ZH = new RegExp(
  `[${CJK_SURNAMES}][${CJK}]{0,2}?(?:先生|小姐|太太|女士|醫生|姑娘|老師|教授|博士|院長|主任|社工|[Ss]ir|Miss)`,
  'g',
);

function institution(text: string): Span[] {
  const out: Span[] = [...all(INST_ABBR, text)];
  out.push(
    ...all(INST_EN, text, (m) => {
      const words = m[0].trim().split(/\s+/);
      // Drop leading generic words ("The", "Public"). If nothing specific is left, it is not a name.
      let i = 0;
      while (i < words.length - 1 && EN_GENERIC_PREFIX.has(words[i])) i++;
      if (i === words.length - 1) return false;
      const skipped = m[0].indexOf(words[i], words.slice(0, i).join(' ').length);
      return { start: m.index + skipped, end: m.index + m[0].length };
    }),
  );
  out.push(
    ...all(INST_ZH, text, (m) => {
      const suffixLen = /(?:幼稚園)$/.test(m[0]) ? 3 : 2;
      let prefix = m[0].slice(0, m[0].length - suffixLen);
      let cut = 0;
      let changed = true;
      while (changed && prefix.length > 0) {
        changed = false;
        for (const g of CJK_GENERIC_PREFIX) {
          if (prefix.startsWith(g)) { prefix = prefix.slice(g.length); cut += g.length; changed = true; break; }
        }
      }
      if (prefix.length < 2) return false;
      return { start: m.index + cut, end: m.index + m[0].length };
    }),
  );
  return out;
}

// --- low ----------------------------------------------------------------------------------------

function cjkName(text: string): Span[] {
  const out: Span[] = [];
  for (let i = 0; i < text.length; i++) {
    if (!CJK_SURNAMES.includes(text[i])) continue;
    const a = text[i + 1];
    if (!isCjk(a) || CJK_NON_NAME.includes(a)) continue;
    if (CJK_STOPWORDS.has(text[i] + a)) continue;
    const b = text[i + 2];
    const len = isCjk(b) && !CJK_NON_NAME.includes(b) && !isLikelyVerbStart(text, i + 2) ? 3 : 2;
    out.push({ start: i, end: i + len });
    i += len - 1;
  }
  return out;
}
/** A third character that begins a common two-character verb is more likely text than a name. */
const VERB_STARTS = new Set(['表示', '認為', '覺得', '指出', '提到', '報告', '形容', '描述', '同住', '同意', '表現', '開始', '出現', '感到', '希望', '需要', '知道', '發現', '決定', '告訴', '承認', '否認']);
function isLikelyVerbStart(text: string, i: number): boolean {
  return VERB_STARTS.has(text.slice(i, i + 2));
}

const CAP = '[A-Z][a-z]{1,20}';
const CAP_A = new RegExp(`\\b(?:${ROMAN_SURNAMES.join('|')})\\s+${CAP}(?:\\s+${CAP})?\\b`, 'g');
const CAP_B = new RegExp(`\\b(?:${GIVEN_NAMES.join('|')})\\s+${CAP}\\b`, 'g');
const CAP_C = new RegExp(`\\b(?:${GIVEN_NAMES.join('|')})\\b`, 'g');
const ID_LIKE = /\b[A-Z]{1,4}\s?\d{5,20}\b|(?<![\dA-Za-z])\d{6,20}(?!\d)/g;

export const RULE_SET: Rule[] = [
  { id: 'hkid', level: 'high', find: (t) => all(HKID, t, (m) => hkidValid(m[1], m[2], m[3] ?? m[4])) },
  { id: 'mo-bir', level: 'high', find: (t) => all(MO_BIR, t) },
  {
    id: 'phone',
    level: 'high',
    // "2024-2025" has the shape of a phone number; two plausible years joined by a hyphen are a range.
    find: (t) => all(PHONE, t, (m) => !(m[2] === '-' && YEAR.test(m[1]) && YEAR.test(m[3]))),
  },
  { id: 'email', level: 'high', find: (t) => all(EMAIL, t, trimTrailingDot) },
  { id: 'url', level: 'high', find: (t) => all(URL_RE, t, trimTrailingDot) },
  { id: 'full-date', level: 'medium', find: (t) => all(FULL_DATE, t) },
  { id: 'dob', level: 'medium', find: (t) => all(DOB, t) },
  { id: 'age-90', level: 'medium', find: (t) => all(AGE, t) },
  {
    id: 'address',
    level: 'medium',
    // A Chinese place name has no word boundary, so drop a leading verb or preposition such as 住 or 在.
    find: (t) =>
      all(ADDRESS, t, (m) => {
        const lead = /^[住在於到去往搬入回返從由自]+/.exec(m[0]);
        const cut = lead && m[0].length - lead[0].length >= 3 ? lead[0].length : 0;
        return { start: m.index + cut, end: m.index + m[0].length };
      }),
  },
  { id: 'institution', level: 'medium', find: institution },
  { id: 'title-name', level: 'medium', find: (t) => [...all(TITLE_EN, t), ...all(TITLE_ZH, t)] },
  { id: 'cjk-name', level: 'low', find: cjkName },
  { id: 'cap-name', level: 'low', find: (t) => [...all(CAP_A, t), ...all(CAP_B, t), ...all(CAP_C, t)] },
  { id: 'id-like', level: 'low', find: (t) => all(ID_LIKE, t) },
];
