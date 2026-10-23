/* Dates in the chat transcript: a day separator above the first message of
   each day („Mi., 7. Okt. um 11:47"), and the time of a question on hover. */

type Lang = 'de' | 'en';

const locale = (lang: Lang) => (lang === 'en' ? 'en-GB' : 'de-DE');

/** "11:47" — the 24-hour clock in both languages. */
export function formatMessageTime(iso: string, lang: Lang): string {
    return new Date(iso).toLocaleTimeString(locale(lang), { hour: '2-digit', minute: '2-digit', hour12: false });
}

/** „Mi., 7. Okt. um 11:47" / "Wed 7 Oct at 11:47"; the year only when it is not the current one. */
export function formatDaySeparator(iso: string, lang: Lang, now: Date = new Date()): string {
    const d = new Date(iso);
    const day = d.toLocaleDateString(locale(lang), {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
    });
    return `${day} ${lang === 'en' ? 'at' : 'um'} ${formatMessageTime(iso, lang)}`;
}

/** Whether two timestamps fall on the same local calendar day. */
export function sameLocalDay(a: string, b: string): boolean {
    const x = new Date(a);
    const y = new Date(b);
    return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
}
