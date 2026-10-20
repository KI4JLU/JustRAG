import React, { useRef } from 'react';
import {
    Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input,
} from '@ki4jlu/design-system';
import { useTheme } from '../contexts/ThemeContext';

export interface ModalState {
    show: boolean;
    type: 'alert' | 'confirm' | 'prompt';
    title: string;
    message: string;
    value?: string;
    /** The confirm button's label; default „Bestätigen" (OK for an alert). */
    confirmLabel?: string;
    /** `destructive`: the confirm button reads as the destructive action it starts. */
    tone?: 'default' | 'destructive';
    onConfirm: (value?: string) => void;
    onCancel: () => void;
}

export interface CustomModalProps {
    modal: ModalState;
    setModal: React.Dispatch<React.SetStateAction<ModalState>>;
}

/**
 * The app's alert / confirm / prompt dialog (`useModalContext().showConfirm`
 * and friends), on the DS `Dialog`.
 *
 * It used to be a hand-rolled overlay with its own focus trap and z-index. That
 * broke as soon as it was opened from inside a DS dialog (the members dialog's
 * "Widerrufen"): Radix makes everything outside its own layers inert
 * (`pointer-events: none` on body), so the confirm was visible but could not be
 * clicked. As a DS `Dialog` it is a Radix layer itself and stacks on top of the
 * one it was opened from; Radix also brings the focus trap, Escape, scroll lock
 * and focus return that the old component did by hand.
 */
export const Modal: React.FC<CustomModalProps> = ({ modal, setModal }) => {
    const { t } = useTheme();
    const confirmRef = useRef<HTMLButtonElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    return (
        <Dialog open={modal.show} onOpenChange={(open) => { if (!open) modal.onCancel(); }}>
            <DialogContent
                closeLabel={t('close')}
                className="max-w-sm"
                // Start on the input of a prompt, else on the confirm button.
                onOpenAutoFocus={(e) => {
                    e.preventDefault();
                    (modal.type === 'prompt' ? inputRef.current : confirmRef.current)?.focus();
                }}
            >
                <DialogHeader className="pr-8">
                    <DialogTitle>{modal.title}</DialogTitle>
                    <DialogDescription>{modal.message}</DialogDescription>
                </DialogHeader>

                {modal.type === 'prompt' && (
                    <form onSubmit={(e) => { e.preventDefault(); modal.onConfirm(modal.value); }}>
                        <Input
                            ref={inputRef}
                            aria-label={modal.message}
                            value={modal.value ?? ''}
                            onChange={e => setModal(prev => ({ ...prev, value: e.target.value }))}
                            placeholder={t('inputPlaceholder')}
                        />
                    </form>
                )}

                <DialogFooter>
                    {(modal.type === 'confirm' || modal.type === 'prompt') && (
                        <Button variant="outline" onClick={() => modal.onCancel()}>{t('cancel')}</Button>
                    )}
                    <Button
                        ref={confirmRef}
                        variant={modal.tone === 'destructive' ? 'destructive' : 'default'}
                        onClick={() => modal.onConfirm(modal.value)}
                    >
                        {modal.confirmLabel ?? (modal.type === 'alert' ? t('ok') : t('confirm'))}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
