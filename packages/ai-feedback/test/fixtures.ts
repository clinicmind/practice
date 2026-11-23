// 虛構內容，只用於測試。
export const RESPONSE_ZH = '聽起來你這幾週真的很累。是什麼讓你覺得撐不下去了？我想先了解你最近睡得怎麼樣。';
export const RESPONSE_EN = 'It sounds like the last few weeks have been exhausting.  What made it feel unbearable?\nI would like to hear how you have been sleeping.';

export function output(over: Record<string, unknown> = {}) {
  return {
    criteria: [
      { met: true, evidence: '聽起來你這幾週真的很累' },
      { met: true, evidence: '是什麼讓你覺得撐不下去了？' },
      { met: false, evidence: '' },
    ],
    suggestion: '可以試試在問睡眠之前，先回應她說的疲累。',
    concern: 'none',
    ...over,
  };
}
