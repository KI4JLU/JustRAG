import { describe, it, expect } from 'vitest';
import { splitLeadingEmoji } from './leadingEmoji';

// Oracle: hand-written titles and the split a reader expects.
describe('splitLeadingEmoji', () => {
  it('takes a simple leading emoji off the title', () => {
    expect(splitLeadingEmoji('🧪 Chemische Formelextraktion')).toEqual({ emoji: '🧪', text: 'Chemische Formelextraktion' });
  });

  it('keeps multi-codepoint emoji whole (ZWJ, variation selector, flag)', () => {
    expect(splitLeadingEmoji('👩‍💻 PPTX-Demo').emoji).toBe('👩‍💻');
    expect(splitLeadingEmoji('⚙️ Code-Interpreter').emoji).toBe('⚙️');
    expect(splitLeadingEmoji('🇩🇪 Deutsch').emoji).toBe('🇩🇪');
  });

  it('leaves titles without a leading emoji alone', () => {
    expect(splitLeadingEmoji('Budget? 📊')).toEqual({ emoji: null, text: 'Budget? 📊' });
    expect(splitLeadingEmoji('2026 Plan')).toEqual({ emoji: null, text: '2026 Plan' });
  });

  it('keeps a lone emoji as the text so the card is not blank', () => {
    expect(splitLeadingEmoji('🐈')).toEqual({ emoji: '🐈', text: '🐈' });
  });
});
