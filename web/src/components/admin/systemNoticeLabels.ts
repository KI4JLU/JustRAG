import type { SystemNoticePlacement, SystemNoticeTone } from '../../utils/systemNotice';

/* The translation keys the admin's „Systemmeldung" section names tones and placements with. */

export const TONE_LABEL_KEYS: Record<SystemNoticeTone, string> = {
    info: 'systemNoticeToneInfo',
    warning: 'systemNoticeToneWarning',
    error: 'systemNoticeToneError',
    neutral: 'systemNoticeToneNeutral',
};

export const PLACEMENT_LABEL_KEYS: Record<SystemNoticePlacement, string> = {
    banner: 'systemNoticePlacementBanner',
    inline: 'systemNoticePlacementInline',
    toast: 'systemNoticePlacementToast',
};

export const PLACEMENT_HELP_KEYS: Record<SystemNoticePlacement, string> = {
    banner: 'systemNoticePlacementBannerHelp',
    inline: 'systemNoticePlacementInlineHelp',
    toast: 'systemNoticePlacementToastHelp',
};

export const POSITION_KEYS: Record<SystemNoticePlacement, string> = {
    banner: 'systemNoticePositionBanner',
    inline: 'systemNoticePositionInline',
    toast: 'systemNoticePositionToast',
};
