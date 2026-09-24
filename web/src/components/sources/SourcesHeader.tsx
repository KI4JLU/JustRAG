import React, { memo } from 'react';
import { Button } from '@ki4jlu/design-system';
import { RefreshCw } from 'lucide-react';
import { useTheme } from '../../contexts/ThemeContext';
import { useKbData } from '../../contexts/KbDataContext';
import '../sidebar-primitives.css';
import './SourcesPanel.css';

/* ---------------------------------------------------------------------------
 * „Alle fehlgeschlagenen erneut verarbeiten" — eine Zeile zwischen „Quellen
 * hinzufügen" und der Quellenliste in der rechten Spalte.
 *
 * WO ES STEHT, UND WARUM NICHT MEHR IN DER KOPFZEILE. Am 21.09.2026 stand der
 * Block kurz in `AppShellPanel.header`, der h-16-Zeile neben dem
 * Einklapp-Knopf. Der Entwickler hat ihn zurück in den Inhalt geholt: in der
 * Kopfzeile war er im eingeklappten Zustand unerreichbar (`SidePanel` rendert
 * die Kopfzeile in der Schiene nicht) und stand ohne Bezug zur Liste, deren
 * Einträge er wiederholt. Jetzt steht er direkt über ihr.
 *
 * EIGENE DATEI, weil er seine zwei Werte selbst aus dem Kontext holt statt
 * sie als Props durch `SourcesSection` gereicht zu bekommen: `files` und
 * `retryAllFailed` aus demselben `fileMgmt`, das `SourcesPanel` liest — eine
 * zweite Quelle könnte eine andere Zahl zeigen als die Liste darunter.
 *
 * KEINE ÜBERSCHRIFT: „Quellen" ist bereits `AppShellPanel.label`, der Name
 * des complementary-Landmarks; ein <h2> daneben schriebe ihn zweimal.
 *
 * KURZES LABEL, LANGER TOOLTIP: „Fehlgeschlagene erneut verarbeiten (2)"
 * brach in einer 320px-Spalte um. Sichtbar steht `retryAllFailedShort`
 * („Erneut versuchen (2)"); die Zahl sagt bereits, dass es um Fehlgeschlagene
 * geht, und `title` trägt den vollen Satz.
 *
 * DER KNOPF IST EIN `Button` DES DESIGN-SYSTEMS (`variant="outline"
 * size="sm"`), kein `.text-button`: der las sich wie ein Link, nicht wie eine
 * Aktion. Rahmen ja, Betonung einer Primäraktion nein.
 * ------------------------------------------------------------------------- */
const SourcesHeaderComp: React.FC = () => {
    const { t } = useTheme();
    const { fileMgmt } = useKbData();
    const { files, retryAllFailed } = fileMgmt;

    const failedCount = files.filter(f => f.status === 'error').length;

    // Only when something failed — an empty row would add height to the head.
    if (failedCount === 0) return null;
    return (
        <div className="sidebar-left__files-header">
            {(
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={retryAllFailed}
                    title={t('retryAllFailed')}
                    className="shrink-0"
                >
                    <RefreshCw size={14} aria-hidden="true" />
                    {t('retryAllFailedShort')} ({failedCount})
                </Button>
            )}
        </div>
    );
};

export const SourcesHeader = memo(SourcesHeaderComp);
