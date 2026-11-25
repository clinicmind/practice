/**
 * 審核工作台「預檢」用的禁用字詞。
 *
 * 內容規則（規格 §5）：不寫診斷名稱、藥物名稱、有版權的量表名稱。
 * 預檢只是提示，不取代臨床判斷：命中不代表一定要改（例如內容有意說明「這門課不教診斷」），
 * 沒命中也不代表沒問題。
 *
 * 怎樣維護：在對應的清單加一行字串就好。
 * - 英文：比對時不分大小寫，而且要整個字詞符合（`OCD` 不會命中 `ocdx`）。
 * - 中文：直接比對字串，所以不要放太短的詞（例如只放「憂鬱」會命中「他很憂鬱」這種一般的感受詞）。
 */
export type TermCategory = 'diagnosis' | 'medication' | 'scale';

export const CATEGORY_LABEL: Record<TermCategory, string> = {
  diagnosis: '診斷名稱',
  medication: '藥物名稱',
  scale: '有版權的量表',
};

/** 診斷名稱。只放病名，不放「憂鬱」「焦慮」這類一般的感受詞。 */
const DIAGNOSES = [
  // English
  'PTSD', 'C-PTSD', 'CPTSD', 'OCD', 'ADHD', 'ASD', 'BPD', 'GAD', 'MDD', 'DID',
  'major depressive disorder', 'major depression', 'clinical depression',
  'generalized anxiety disorder', 'social anxiety disorder', 'panic disorder',
  'post-traumatic stress disorder', 'posttraumatic stress disorder',
  'borderline personality disorder', 'narcissistic personality disorder',
  'antisocial personality disorder', 'bipolar disorder', 'bipolar',
  'schizophrenia', 'psychosis', 'obsessive-compulsive disorder',
  'attention-deficit', 'autism spectrum', 'anorexia nervosa', 'bulimia',
  'dissociative identity disorder', 'persistent depressive disorder', 'dysthymia',
  // 中文
  '憂鬱症', '重度憂鬱', '重鬱症', '焦慮症', '廣泛性焦慮', '社交焦慮症', '恐慌症', '恐慌發作',
  '創傷後壓力症', '創傷後壓力症候群', '創傷後壓力疾患', '創傷後壓力障礙',
  '邊緣型人格', '邊緣性人格', '邊緣人格', '自戀型人格', '自戀性人格', '反社會人格',
  '雙相情緒障礙', '雙相障礙', '躁鬱症', '思覺失調', '精神分裂', '精神病',
  '強迫症', '注意力不足過動', '過動症', '自閉症', '泛自閉症', '厭食症', '暴食症',
  '解離性身分疾患', '解離症', '持續性憂鬱症', '輕鬱症',
];

/** 藥物名稱（學名、商品名、常見類別縮寫）。 */
const MEDICATIONS = [
  // English
  'Prozac', 'Zoloft', 'Lexapro', 'Celexa', 'Paxil', 'Effexor', 'Cymbalta', 'Wellbutrin',
  'Xanax', 'Valium', 'Ativan', 'Klonopin', 'Ritalin', 'Adderall', 'Concerta', 'Abilify',
  'Seroquel', 'Zyprexa', 'Risperdal', 'Lamictal', 'Depakote', 'Ambien',
  'fluoxetine', 'sertraline', 'escitalopram', 'citalopram', 'paroxetine', 'venlafaxine',
  'duloxetine', 'bupropion', 'alprazolam', 'diazepam', 'lorazepam', 'clonazepam',
  'methylphenidate', 'aripiprazole', 'quetiapine', 'olanzapine', 'risperidone',
  'lamotrigine', 'lithium', 'zolpidem', 'benzodiazepine', 'benzodiazepines', 'SSRI', 'SSRIs',
  'antidepressant', 'antidepressants', 'antipsychotic', 'antipsychotics',
  // 中文
  '百憂解', '樂復得', '立普能', '速悅', '千憂解', '安非他酮', '贊安諾', '蝴蝶片', '利他能',
  '鋰鹽', '史蒂諾斯', '抗憂鬱劑', '抗憂鬱藥', '抗精神病藥', '抗焦慮藥', '鎮靜劑', '血清素再回收抑制劑',
];

/** 有版權的量表。 */
const SCALES = [
  // English
  'PHQ-9', 'PHQ9', 'PHQ-2', 'GAD-7', 'GAD7', 'BDI', 'BDI-II', 'BAI', 'Beck Depression Inventory',
  'Beck Anxiety Inventory', 'MMPI', 'MMPI-2', 'WAIS', 'WISC', 'CORE-OM', 'DERS', 'PCL-5',
  'PCL-C', 'HAM-D', 'HAM-A', 'Hamilton Rating Scale', 'DASS-21', 'DASS', 'CES-D', 'K10', 'K-10',
  'Rorschach', 'Rosenberg Self-Esteem Scale', 'Y-BOCS', 'AUDIT', 'C-SSRS', 'SCL-90', 'OQ-45',
  'Working Alliance Inventory', 'Edinburgh Postnatal Depression Scale', 'MoCA', 'MCMI',
  // 中文
  '貝克憂鬱量表', '貝克焦慮量表', '明尼蘇達多相人格', '魏氏智力', '魏氏成人智力', '漢密爾頓',
  '羅夏墨漬', '羅夏克', '台灣人憂鬱症量表', '愛丁堡產後憂鬱', '工作同盟量表',
];

export interface ForbiddenTerm {
  term: string;
  category: TermCategory;
}

export const FORBIDDEN_TERMS: ForbiddenTerm[] = [
  ...DIAGNOSES.map((term) => ({ term, category: 'diagnosis' as const })),
  ...MEDICATIONS.map((term) => ({ term, category: 'medication' as const })),
  ...SCALES.map((term) => ({ term, category: 'scale' as const })),
];
