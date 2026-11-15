import { test, expect } from 'vitest';
import { scan } from '../src/index';

const dirty = `個案陳大文，45歲，住彩虹邨3樓B室，於2026年3月12日由鏡湖醫院轉介。
電話 6612 3456，電郵 tm.chan@example.com。Mr Wong, his teacher at St Paul's College, called on 12/03/2026.
HKID A123456(3). He was born in 1981. MRN 20231234. His friend Mary visits weekly.`;

test('mixed report: every planted identifier is caught', () => {
  const got = scan(dirty).map((f) => `${f.rule}=${f.match}`);
  for (const want of [
    'cjk-name=陳大文', 'address=彩虹邨', 'address=3樓B室', 'full-date=2026年3月12日', 'institution=鏡湖醫院',
    'phone=6612 3456', 'email=tm.chan@example.com', 'title-name=Mr Wong', "institution=St Paul's College",
    'full-date=12/03/2026', 'hkid=A123456(3)', 'dob=born in 1981', 'cap-name=Mary',
    // An 8-digit record number that starts with 2 has the shape of a Hong Kong landline, so the stricter rule claims it.
    'phone=20231234',
  ]) expect(got, want).toContain(want);
});
test('ordinary clinical prose stays quiet', () => {
  const prose = `She reports low mood and poor sleep. We used Cognitive Behavioural Therapy ideas and a thought record.
The Client scored 3/10 on mood in Week 3. 她說自己很高興，周末會去跑步，也曾經向朋友求助。`;
  expect(scan(prose)).toEqual([]);
});
