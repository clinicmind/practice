import { describe, expect, test } from 'vitest';
import { highlight } from './highlight';

describe('highlight', () => {
  test('marks a quoted span and leaves the rest', () => {
    expect(highlight('I wonder what brought you in today.', ['what brought you in'])).toEqual([
      { text: 'I wonder ', marked: false }, { text: 'what brought you in', marked: true }, { text: ' today.', marked: false },
    ]);
  });
  test('finds a quote whose runs of whitespace differ, as the server accepts', () => {
    const segs = highlight('what  brought\nyou in', ['what brought you in']);
    expect(segs).toEqual([{ text: 'what  brought\nyou in', marked: true }]);
  });
  test('Chinese text is marked by character position', () => {
    expect(highlight('你可以多說一點嗎？', ['多說一點'])).toEqual([
      { text: '你可以', marked: false }, { text: '多說一點', marked: true }, { text: '嗎？', marked: false },
    ]);
  });
  test('overlapping and repeated quotes merge; a quote not in the response is not marked', () => {
    expect(highlight('abcdef', ['abcd', 'cdef', 'zzz'])).toEqual([{ text: 'abcdef', marked: true }]);
    expect(highlight('abcdef', ['zzz', ''])).toEqual([{ text: 'abcdef', marked: false }]);
  });
  test('characters that mean something in a pattern are taken literally', () => {
    expect(highlight('is it (really) so?  yes', ['(really) so?'])).toEqual([
      { text: 'is it ', marked: false }, { text: '(really) so?', marked: true }, { text: '  yes', marked: false },
    ]);
  });
});
