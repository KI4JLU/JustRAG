import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

// ChatView.tsx enthält Nicht-UTF8-Bytes (deshalb 'latin1' statt 'utf8' —
// mit 'utf8' liefert Node Ersatzzeichen und die Suche ginge ins Leere).
//
// Absichtlich NICHT `new URL('./ChatView.tsx', import.meta.url)`: Vite
// erkennt genau dieses Muster statisch als Asset-URL und ersetzt es durch
// eine `http://localhost:.../ChatView.tsx`-Dev-Server-URL statt einer
// echten Datei-URL — `fileURLToPath` wirft dann "The URL must be of scheme
// file". `path.dirname(fileURLToPath(import.meta.url))` + `path.join`
// entgeht dieser Sonderbehandlung.
const here = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(here, 'ChatView.tsx'), 'latin1');

describe('ChatView-Composer', () => {
  it('bietet keinen Datei-Anhang mehr an', () => {
    for (const gone of ['Paperclip', 'ChatComparisonControls', 'comparisonAttach', 'attachmentUploading']) {
      expect(src).not.toContain(gone);
    }
  });

  it('liest die Datei überhaupt (sonst wäre der Wächter vakuum-grün)', () => {
    expect(src).toContain('const ChatViewComp');
    expect(src.length).toBeGreaterThan(10_000);
  });
});

// Der Zurückknopf saß bis 2026-08 in der Quellenleiste, dann in ChatViews
// eigener `chat-header`. Diese Kopfleiste gibt es nicht mehr: seit der Umzug
// auf `AppShellLayout` die Chrome-Leiste der Shell zur einzigen macht, steht
// der Knopf in `KbWorkspaceLayout.tsx` und wird als `pageLabel` eingehängt.
// Der Wächter zieht mit ihm um — bliebe er auf ChatView.tsx stehen, wäre er
// ab sofort dauerhaft rot, ohne dass am Knopf etwas fehlt.
//
// Textwächter, kein Render-Test: ChatView zieht ein gutes Dutzend Kontexte und
// hat deshalb repo-weit keinen Render-Harness. Die Vakuum-Assertion in jedem
// Block hält den Wächter davon ab, grün zu werden, weil er ins Leere liest.
const sourcesPanel = readFileSync(
  path.join(here, 'sources', 'SourcesPanel.tsx'),
  'utf8',
);
const workspaceLayout = readFileSync(
  path.join(here, 'KbWorkspaceLayout.tsx'),
  'utf8',
);

describe('Zurück-Knopf in der KB-Kopfleiste', () => {
  it('steht in der Chrome-Leiste der Shell und ist nicht mehr an isMobile gebunden', () => {
    // Der Knopf trägt backToOverview und ruft handleGoHome (nicht
    // handleViewHome — sonst bleibt kbView auf dem zuletzt gewählten Reiter
    // stehen und die KB öffnet sich beim nächsten Mal nicht im Chat).
    expect(workspaceLayout).toContain('ArrowLeft');
    expect(workspaceLayout).toContain("aria-label={t('backToOverview')}");
    expect(workspaceLayout).toContain('onClick={handleGoHome}');
    // Eine Sicht, ein Knopf: die alte Form war ein Ternär — Mobil Zurück ODER
    // Desktop Symbol —, und genau die darf nicht zurückkommen, sie ist der
    // Zustand, in dem der Desktop keinen Zurückknopf hat. In dieser Datei ist
    // die Assertion scharf, weil sie `isMobile` überhaupt nicht mehr kennt:
    // die Fallunterscheidung Desktop/Mobil gehört seit dem Umzug der Shell.
    expect(workspaceLayout).not.toContain('isMobile');
    // Vakuum-Schutz für DIESE Datei: sie wird wirklich gelesen.
    expect(workspaceLayout).toContain('export function KbWorkspaceLayout');
  });

  it('ist aus ChatViews eigener Kopfleiste verschwunden', () => {
    // Zwei Zurückknöpfe auf einem Bildschirm wären keine gemeldete Störung,
    // sie sähen nur nach Doppelung aus. Die ganze `chat-header` ist weg —
    // geprüft am Klassennamen, den nur sie trug.
    expect(src).not.toContain('chat-header');
    expect(src).not.toContain("aria-label={t('backToOverview')}");
    // Vakuum-Schutz: die Datei wird wirklich gelesen.
    expect(src).toContain('const ChatViewComp');
  });

  it('ist aus der Quellenleiste verschwunden', () => {
    // Ein zweiter Knopf an der alten Stelle wäre für Nutzer kein Fehler, den
    // jemand meldet — er sähe nur nach Doppelung aus und bliebe stehen.
    expect(sourcesPanel).not.toContain('backToOverview');
    expect(sourcesPanel).not.toContain('handleViewHome');
    // Vakuum-Schutz für DIESE Datei: sie wird wirklich gelesen.
    expect(sourcesPanel).toContain('const SourcesPanelComp');
  });
});
