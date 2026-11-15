/** Common Chinese surnames. Characters that are very frequent in ordinary words are left out on purpose. */
export const CJK_SURNAMES =
  '陳林黃張李王吳劉蔡楊許鄭謝郭洪曾邱廖賴徐周葉蘇莊呂江何蕭羅趙朱鍾彭游詹胡施沈余盧梁顏柯翁魏孫戴范宋鄧杜傅侯曹薛丁卓馬阮董唐溫藍蔣石古紀姚連馮歐程湯田康姜汪白鄒尤巫鐘黎涂龔嚴韓袁金童陸夏柳邵錢伍倪譚駱熊任甘秦顧毛潘麥區關霍';

/** Two-character words that start with a surname character and are not names. */
export const CJK_STOPWORDS = new Set(
  (
    '陳述 陳舊 陳列 林木 林立 黃色 黃金 黃昏 張開 張力 張貼 李子 王牌 王國 王子 劉海 楊柳 許多 許可 許久 鄭重 謝謝 謝絕 謝意 ' +
    '洪水 曾經 徐徐 周末 周圍 周期 周邊 周全 周到 葉子 蘇醒 江湖 何時 何必 何況 何以 何處 何謂 蕭條 羅列 趙? 朱紅 ' +
    '游泳 游戲 胡亂 胡說 施加 施行 施壓 沈默 沈重 沈悶 余下 梁柱 顏色 顏面 孫子 孫女 戴上 范圍 丁點 卓越 ' +
    '馬上 馬路 董事 唐突 溫和 溫柔 溫暖 溫度 溫習 藍色 藍天 石頭 古代 古老 古怪 紀錄 紀念 紀律 連續 連接 連結 連忙 連同 連帶 ' +
    '歐洲 程度 程序 程式 湯匙 田野 康復 白天 白色 白費 白白 尤其 鐘頭 鐘聲 黎明 嚴重 嚴格 嚴肅 嚴厲 韓國 金錢 金額 金融 ' +
    '童年 陸續 夏天 夏季 錢包 熊貓 任何 任務 任性 任由 任意 甘願 甘心 顧慮 顧及 顧客 毛病 區域 區別 區分 ' +
    '關係 關於 關心 關鍵 關閉 關注 關懷 關聯 霍然 莊重 莊嚴 呂? 賴以 邱? 廖? 彭? 詹? 盧? 柯? 翁? 魏? 宋朝 鄧? 杜絕 傅? 侯? 曹? 薛? ' +
    '阮? 蔣? 姚? 馮? 姜? 汪洋 鄒? 巫術 涂? 龔? 袁? 柳樹 邵? 伍? 倪? 譚? 駱駝 秦? 潘? 麥? 蔡? 吳? 郭? 鍾情 鍾愛 蘇打'
  )
    .split(/\s+/)
    .filter((w) => w.length === 2 && !w.includes('?')),
);

/** Characters that rarely appear inside a given name. If one follows a surname, it is ordinary text. */
export const CJK_NON_NAME =
  '的了是在有和與及或但也都就還而被把對從向到於以為裡內外上下中前後時候個們這那些很更最不沒無要會能可' +
  '說話問想做去來看聽講叫給讓跟同住回等用因所如果雖然已經曾將並且則卻才只又再太過著呢嗎吧啊嘛喔哦呀' +
  '一二三四五六七八九十百千萬兩幾多少每各某其他她它你我您誰什麼哪怎';

/** Words that make a Chinese institution phrase generic, for example 一間公立醫院. */
export const CJK_GENERIC_PREFIX = [
  '一間', '一所', '一家', '這間', '那間', '該', '某', '某間', '某所', '本地', '當地', '公立', '私立', '私家', '政府',
  '大型', '小型', '社區', '地區', '同一', '另一', '附近', '普通', '日間', '精神科', '兒童', '長者', '青年', '家庭', '綜合',
  '一', '間', '所', '家', '的', '在', '到', '去', '於', '入', '住', '讀', '就讀', '轉介至', '轉介', '送往', '前往',
  // Function words and time words that can sit directly before a name when there is no word boundary.
  '由', '從', '自', '經', '被', '向', '往', '至', '和', '與', '及', '並', '曾', '已', '現', '日', '月', '年', '後', '前', '時',
  '了', '是', '有', '給', '跟', '同', '回', '離開', '出院', '入院', '來自',
];

export const EN_GENERIC_PREFIX = new Set([
  'The', 'A', 'An', 'My', 'Our', 'His', 'Her', 'Their', 'This', 'That', 'Public', 'Private', 'Local', 'General',
  'Community', 'Day', 'High', 'Primary', 'Secondary', 'Middle', 'Medical', 'Mental', 'Health', 'Psychiatric',
  'Outpatient', 'At', 'In', 'To', 'From', 'And', 'Or', 'But', 'When', 'After', 'Before', 'Law', 'Business', 'Art',
  'Summer', 'Night', 'Sunday', 'Nursing', 'Boarding', 'Training', 'Counselling', 'Family', 'Youth', 'Elderly',
]);

export const INSTITUTION_ABBREVIATIONS = [
  'QMH', 'PWH', 'QEH', 'PMH', 'TMH', 'KWH', 'UCH', 'PYNEH', 'KCH', 'CMC', 'NDH', 'TKOH', 'CHCSJ',
  'HKU', 'CUHK', 'HKUST', 'PolyU', 'CityU', 'HKBU', 'EdUHK', 'LingU', 'HKMU', 'MUST', 'UMac', 'MPU', 'USJ', 'CUM',
];

/** Romanised Chinese surnames. Ones that are also common English words (So, To, Man, Law, Young, Long) are left out. */
export const ROMAN_SURNAMES = [
  'Chan', 'Wong', 'Lee', 'Cheung', 'Lau', 'Ng', 'Leung', 'Ho', 'Lam', 'Chow', 'Cheng', 'Yeung', 'Tang', 'Tsang',
  'Fung', 'Yip', 'Kwok', 'Chiu', 'Poon', 'Lai', 'Mak', 'Tam', 'Lo', 'Liu', 'Chen', 'Lin', 'Wang', 'Zhang', 'Huang',
  'Vong', 'Lei', 'Ieong', 'Kuok', 'Leong', 'Fong', 'Cheong', 'Choi', 'Chu', 'Tse', 'Siu', 'Kwan', 'Luk', 'Pang',
  'Yuen', 'Tong', 'Mok', 'Ko', 'Tsui', 'Chung', 'Suen', 'Shum', 'Ip', 'Kam', 'Kwong', 'Lui', 'Ngai', 'Shek', 'Sze',
  'Szeto', 'Yau', 'Yim', 'Yiu', 'Wu', 'Yu', 'Li', 'Ma', 'Hui', 'Sou', 'Ao', 'Chao', 'Iu', 'Hoi', 'Che', 'Lok',
];

/** Common given names. Ones that are also ordinary words (Mark, Grace, May, Rose, Will) are left out. */
export const GIVEN_NAMES = [
  'John', 'Mary', 'David', 'Peter', 'Paul', 'Michael', 'Sarah', 'Emily', 'James', 'Anna', 'Amy', 'Kevin', 'Jason',
  'Eric', 'Alex', 'Chris', 'Daniel', 'Jenny', 'Karen', 'Mandy', 'Vivian', 'Winnie', 'Kelvin', 'Raymond', 'Tony',
  'Andy', 'Sam', 'Joe', 'Jo', 'Tom', 'Ben', 'Jack', 'Emma', 'Alice', 'Helen', 'Susan', 'Linda', 'Lisa', 'Nancy',
  'Betty', 'Ruth', 'Carol', 'Sandra', 'Donna', 'Laura', 'Kate', 'Katie', 'Rachel', 'Rebecca', 'Hannah', 'Sophie',
  'Chloe', 'Lucy', 'Steven', 'Andrew', 'Brian', 'George', 'Edward', 'Henry', 'Simon', 'Martin', 'Stephen',
  'Jonathan', 'Matthew', 'Thomas', 'William', 'Robert', 'Richard', 'Charles', 'Joseph', 'Anthony', 'Ryan', 'Jacob',
  'Nicholas', 'Tiffany', 'Jessica', 'Michelle', 'Stephanie', 'Nicole', 'Angela', 'Cindy', 'Fiona', 'Joyce', 'Carmen',
  'Ada', 'Elaine', 'Eva', 'Queenie', 'Kitty', 'Maggie', 'Wendy', 'Peggy', 'Doris', 'Gloria', 'Kelly', 'Jennifer',
  'Elizabeth', 'Margaret', 'Patrick', 'Sean', 'Adam', 'Luke', 'Oliver', 'Harry', 'Charlie', 'Amanda', 'Natalie',
];
