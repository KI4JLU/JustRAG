import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { TextSourceModal } from './TextSourceModal';

vi.mock('../../contexts/ThemeContext', () => ({
  useTheme: () => ({ t: (key: string) => key, language: 'de' }),
}));

// The editor is a Tiptap surface the jsdom suite cannot drive (and the pinned
// DS release predates it); a textarea stands in with the same value contract.
vi.mock('@ki4jlu/design-system', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@ki4jlu/design-system')>()),
  RichTextEditor: ({ value, onChange, 'aria-label': label, 'aria-invalid': invalid, 'aria-describedby': describedBy }: {
    value: string; onChange: (md: string) => void; 'aria-label'?: string; 'aria-invalid'?: boolean; 'aria-describedby'?: string;
  }) => (
    <textarea aria-label={label} aria-invalid={invalid} aria-describedby={describedBy} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

function Harness({ onAdd, title = '', content = '' }: { onAdd: () => void; title?: string; content?: string }) {
  const [tv, setTv] = useState(title);
  const [cv, setCv] = useState(content);
  return (
    <TextSourceModal
      show onClose={() => {}} onTextSourceAdd={onAdd}
      textSourceTitle={tv} setTextSourceTitle={setTv}
      textSourceContent={cv} setTextSourceContent={setCv}
    />
  );
}

// Oracle: `AddTextSource` in go-backend/internal/files/http_ingest.go answers a
// blank (whitespace-only) title or content with 400 — the dialog must refuse
// the same input before it closes, not after.
describe('TextSourceModal — required fields', () => {
  it('warns about a missing title and does not submit', async () => {
    const onAdd = vi.fn();
    render(<Harness onAdd={onAdd} content="Some body" />);
    await userEvent.click(screen.getByRole('button', { name: 'addTextSource' }));

    expect(screen.getByRole('alert')).toHaveTextContent('textTitleRequired');
    expect(screen.getByRole('alert')).not.toHaveTextContent('textContentRequired');
    const title = screen.getByRole('textbox', { name: 'textTitle' });
    expect(title).toHaveAttribute('aria-invalid', 'true');
    expect(title).toHaveAccessibleDescription('textTitleRequired');
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('treats a whitespace-only title as missing', async () => {
    const onAdd = vi.fn();
    render(<Harness onAdd={onAdd} title="   " content="Some body" />);
    await userEvent.click(screen.getByRole('button', { name: 'addTextSource' }));
    expect(screen.getByRole('alert')).toHaveTextContent('textTitleRequired');
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('names both fields when both are empty', async () => {
    render(<Harness onAdd={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'addTextSource' }));
    expect(screen.getByRole('alert')).toHaveTextContent('textTitleRequired · textContentRequired');
    expect(screen.getByRole('textbox', { name: 'textContent' })).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('textbox', { name: 'textContent' })).toHaveAccessibleDescription('textTitleRequired · textContentRequired');
  });

  it('clears the title warning on typing and submits once both are filled', async () => {
    const onAdd = vi.fn();
    render(<Harness onAdd={onAdd} content="Some body" />);
    await userEvent.click(screen.getByRole('button', { name: 'addTextSource' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'textTitle' }), 'Notes');

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'textTitle' })).not.toHaveAttribute('aria-invalid');
    await userEvent.click(screen.getByRole('button', { name: 'addTextSource' }));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });
});
