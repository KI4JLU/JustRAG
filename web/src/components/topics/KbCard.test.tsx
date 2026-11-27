import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { KbRoleBadge, PrivateKbCard } from './KbCard';
import { translations, type Language } from '../../i18n/translations';
import type { KnowledgeBase } from '../../types';

/* ---------------------------------------------------------------------------
 * The KB card's meta lines (card KI-848, developer mockup).
 *
 * ORACLES, independent of the code under test:
 *  - translations.ts for every label („Genutzt"/"Used", „Aktualisiert"/
 *    "Updated", „von {name}"/"by {name}"), looked up here;
 *  - the relative values written out BY HAND — CLDR's phrases as ICU renders
 *    them with `numeric: 'auto'` („gestern", „vor 7 Tagen") — against a FIXED
 *    clock (fake timers), so nothing depends on when the suite runs;
 *  - the DOM: which element holds the value (the bold part is its own element,
 *    separate from the label), and what the footer does and does not contain.
 * ------------------------------------------------------------------------- */

const NOW = new Date('2026-09-29T12:00:00Z');
const DAY = 86_400_000;
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

const tFor = (lang: Language) => (k: string) => (translations as Record<string, Record<Language, string>>)[k]?.[lang] ?? k;

function kb(over: Partial<KnowledgeBase> = {}): KnowledgeBase {
  return {
    id: 'kb-1', name: 'FAQ Test', description: null, userId: 'user-1', createdAt: '2026-01-05T09:00:00Z',
    isPro: false, aiConfigId: null, chatModel: null, embeddingModel: null, rerankModel: null, ttsModel: null,
    visibility: 'private', memberCount: 1, myRole: 'owner',
    ...over,
  };
}

function renderCard(item: KnowledgeBase, lang: Language = 'de') {
  return render(
    <PrivateKbCard
      kb={item}
      currentUserId="user-1"
      systemRole="user"
      removingKb={false}
      t={tFor(lang)}
      language={lang}
      onSelectKB={vi.fn()}
      onOpenShare={vi.fn()}
      onToggleFavorite={vi.fn()}
      onOpenSettings={vi.fn()}
      onRenameKB={vi.fn()}
      onDeleteKB={vi.fn()}
    />,
  );
}

/** The mockup card: 36 files, 53 messages, used yesterday, updated 7 days ago, „Privat". */
const MOCKUP = kb({ fileCount: 36, turnCount: 53, lastActivityAt: ago(DAY), lastIngestedAt: ago(7 * DAY), oldestFileAt: ago(400 * DAY) });

beforeEach(() => { vi.useFakeTimers({ now: NOW }); });
afterEach(() => { vi.useRealTimers(); });

describe('PrivateKbCard meta lines', () => {
  it.each([
    ['de', 'gestern', 'vor 7 Tagen'],
    ['en', 'yesterday', '7 days ago'],
  ] as const)('renders the mockup card in %s: used %s, updated %s', (lang, used, updated) => {
    renderCard(MOCKUP, lang);
    const t = tFor(lang);

    const usedLine = screen.getByTestId('kb-meta-used');
    expect(usedLine).toHaveTextContent(`${t('kbCardUsed')} ${used}`);
    // The value is its own (bold) element, not part of the label's text node.
    expect(within(usedLine).getByText(used).textContent).toBe(used);

    const updatedLine = screen.getByTestId('kb-meta-updated');
    expect(updatedLine).toHaveTextContent(`${t('kbCardUpdated')} ${updated}`);
    expect(within(updatedLine).getByText(updated).textContent).toBe(updated);

    // Own topic: no owner line.
    expect(screen.queryByTestId('kb-meta-owner')).toBeNull();
  });

  it('falls back to createdAt for „Genutzt" when there is no activity yet', () => {
    renderCard(kb({ createdAt: ago(3 * 3_600_000) }));
    expect(screen.getByTestId('kb-meta-used')).toHaveTextContent('Genutzt vor 3 Stunden');
  });

  it('omits the „Aktualisiert" line for a topic without files', () => {
    renderCard(kb({ lastActivityAt: ago(DAY) }));
    expect(screen.getByTestId('kb-meta-used')).toBeInTheDocument();
    expect(screen.queryByTestId('kb-meta-updated')).toBeNull();
  });

  it('adds the owner line for a topic somebody else owns, with the name as the value', () => {
    renderCard(kb({ userId: 'user-9', myRole: 'view', ownerFirstName: 'Ada', ownerLastName: 'Lovelace', memberCount: 3 }));
    const owner = screen.getByTestId('kb-meta-owner');
    expect(owner).toHaveTextContent(translations.sharedBy.de.replace('{name}', 'Ada Lovelace'));
    expect(within(owner).getByText('Ada Lovelace')).toBeInTheDocument();
  });

  it('keeps the footer to the count chips and the badge — no freshness chip', () => {
    const { container } = renderCard(MOCKUP);
    const footer = container.querySelector('[data-slot="card-footer"]') as HTMLElement;
    const chips = Array.from(footer.querySelectorAll('.home-view__chip'));
    // Two chips: files and messages (their sr-only phrases are the oracle).
    expect(chips.map((c) => c.querySelector('.sr-only')?.textContent)).toEqual([
      translations.kbFilesChip.de.replace('{n}', '36'),
      translations.kbMessagesChip.de.replace('{n}', '53'),
    ]);
    expect(within(footer).getByText(translations.visibilityPersonal.de)).toBeInTheDocument();
    // The oldest date (400 days ago) is shown nowhere any more.
    expect(container.textContent).not.toMatch(/letztes Jahr|Ältester/);
  });
});

/* ---------------------------------------------------------------------------
 * „Teilen" in the card menu.
 *
 * It opens the topic's Thema-Einstellungen on Mitglieder, so it is offered to
 * exactly the callers who may open that window: the effective KB roles admin
 * and owner (its routes sit on kbAdminChain) — a superadmin resolves to owner
 * on every KB — plus the legacy owner column for a row that arrives without a
 * membership role.
 *
 * ORACLE: the server's role ladder (kbaccess.EffectiveRole in
 * go-backend/internal/kbaccess/middleware.go) applied to each fixture by hand,
 * and translations.ts for the item's name. The caller is 'user-1' throughout;
 * every fixture but the legacy one is owned by 'user-9', so the owner column
 * decides nothing there.
 * ------------------------------------------------------------------------- */
describe('PrivateKbCard share item', () => {
  // Radix's dropdown measures and captures pointers, which jsdom lacks, and
  // its open path waits on real timers.
  beforeEach(() => {
    vi.useRealTimers();
    Element.prototype.hasPointerCapture = vi.fn(() => false);
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
    Element.prototype.scrollIntoView = vi.fn();
  });

  async function shareItem(item: KnowledgeBase, systemRole: string, onOpenShare = vi.fn()) {
    const t = tFor('en');
    render(
      <PrivateKbCard
        kb={item}
        currentUserId="user-1"
        systemRole={systemRole}
        removingKb={false}
        t={t}
        language="en"
        onSelectKB={vi.fn()}
        onOpenShare={onOpenShare}
        onToggleFavorite={vi.fn()}
        onOpenSettings={vi.fn()}
        onRenameKB={vi.fn()}
        onDeleteKB={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: new RegExp(`^${translations.kbActions.en}: `) }));
    // Delete/leave is ungated, so the menu opens in every case.
    const menu = within(await screen.findByRole('menu'));
    return menu.queryByRole('menuitem', { name: `${translations.share.en}…` });
  }

  const othersKb = (over: Partial<KnowledgeBase>) => kb({ userId: 'user-9', ...over });

  it.each(['owner', 'admin'] as const)('offers it to a caller whose myRole is %s', async (myRole) => {
    expect(await shareItem(othersKb({ myRole }), 'user')).not.toBeNull();
  });

  it.each(['edit', 'view'] as const)('withholds it from a caller whose myRole is %s', async (myRole) => {
    expect(await shareItem(othersKb({ myRole }), 'user')).toBeNull();
  });

  it('offers it to a superadmin whose own KB role is only view', async () => {
    expect(await shareItem(othersKb({ myRole: 'view' }), 'superadmin')).not.toBeNull();
  });

  it('offers it on a row without myRole whose owner column is the caller', async () => {
    expect(await shareItem(kb({ myRole: undefined }), 'user')).not.toBeNull();
  });

  it('hands the card\'s topic to onOpenShare', async () => {
    const onOpenShare = vi.fn();
    const item = othersKb({ myRole: 'admin' });
    await userEvent.click((await shareItem(item, 'user', onOpenShare))!);
    expect(onOpenShare).toHaveBeenCalledTimes(1);
    expect(onOpenShare).toHaveBeenCalledWith(item, expect.anything());
  });
});

// ORACLE: kbaccess.ResolveRole resolves a superadmin to owner on every topic;
// the badge names the role they hold, or „Superadmin" where they hold none.
describe('KbRoleBadge for a superadmin', () => {
  const t = tFor('de');
  const superadmin = { effectiveRole: 'owner', roleOrigin: 'superadmin' } as const;

  it('names the held viewer role, not Besitzer', () => {
    render(<KbRoleBadge kb={kb({ ...superadmin, myRole: 'view', userId: 'other' })} t={t} />);
    expect(screen.getByText(t('kbRoleView'))).toBeInTheDocument();
    expect(screen.queryByText(t('kbRoleOwner'))).toBeNull();
  });

  it('names a superadmin holding no role „Superadmin"', () => {
    render(<KbRoleBadge kb={kb({ ...superadmin, myRole: undefined, userId: 'other' })} t={t} />);
    expect(screen.getByText(t('kbRoleSuperadmin'))).toBeInTheDocument();
    expect(screen.queryByText(t('kbRoleOwner'))).toBeNull();
  });
});

// ORACLE: the developer ruling of 2026-11-27 (canvas variant A) — on the
// card the Berechtigung is the first meta line, „Du bist {role}", not a
// badge in the title band or on the hairline.
describe('PrivateKbCard role meta line', () => {
  it('shows the role as the first meta line, outside the band and the hairline', () => {
    const t = tFor('de');
    render(
      <PrivateKbCard
        kb={kb({ myRole: 'edit', effectiveRole: 'edit', userId: 'other', category: { id: 'c1', name: 'Beschaffung', colorSlot: 1 } as KnowledgeBase['category'] })}
        currentUserId="user-1" systemRole="user" removingKb={false} t={t} language="de" showRole
        onSelectKB={vi.fn()} onOpenShare={vi.fn()} onToggleFavorite={vi.fn()} onOpenSettings={vi.fn()} onRenameKB={vi.fn()} onDeleteKB={vi.fn()}
      />,
    );
    const line = screen.getByTestId('kb-meta-role');
    expect(line).toHaveTextContent(`${t('kbCardRole')} ${t('kbRoleEdit')}`);
    expect(within(screen.getByTestId('kb-card-band')).queryByText(t('kbRoleEdit'))).toBeNull();
    expect(line.closest('[data-slot="card-hairline"]')).toBeNull();
    expect(line.parentElement?.firstElementChild).toBe(line);
  });

  // ORACLE: kbaccess.ResolveRole resolves a superadmin to owner everywhere;
  // the line names the role they hold, or „Superadmin" where they hold none.
  it.each([
    ['holding the viewer role', { myRole: 'view' as const }, 'kbRoleView'],
    ['holding no role', { myRole: undefined }, 'kbRoleSuperadmin'],
  ])('names a superadmin %s by that role, never Besitzer', (_name, extra, key) => {
    const t = tFor('de');
    render(
      <PrivateKbCard
        kb={kb({ ...extra, effectiveRole: 'owner', roleOrigin: 'superadmin', userId: 'other' })}
        currentUserId="user-1" systemRole="superadmin" removingKb={false} t={t} language="de" showRole
        onSelectKB={vi.fn()} onOpenShare={vi.fn()} onToggleFavorite={vi.fn()} onOpenSettings={vi.fn()} onRenameKB={vi.fn()} onDeleteKB={vi.fn()}
      />,
    );
    expect(screen.getByTestId('kb-meta-role')).toHaveTextContent(`${t('kbCardRole')} ${t(key)}`);
    expect(screen.getByTestId('kb-meta-role')).not.toHaveTextContent(t('kbRoleOwner'));
  });

  it('has no role line where the view does not ask for it', () => {
    renderCard(kb({ myRole: 'edit', effectiveRole: 'edit', userId: 'other' }));
    expect(screen.queryByTestId('kb-meta-role')).toBeNull();
  });
});
