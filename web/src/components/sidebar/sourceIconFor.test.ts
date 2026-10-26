import { describe, it, expect } from 'vitest';
import { FileAudio, FileImage, FileSpreadsheet, FileText, FileType, Globe, Presentation, File } from 'lucide-react';
import { sourceIconFor, sourceTypeLabel } from './sourceIconFor';

// Oracle: hand-picked file names and the icon a reader expects for each.
describe('sourceIconFor', () => {
  it('picks by extension, case-insensitively', () => {
    expect(sourceIconFor({ name: 'Bericht.PDF', type: '', origin: 'upload' })).toBe(FileText);
    expect(sourceIconFor({ name: 'Zahlen.xlsx', type: '', origin: 'upload' })).toBe(FileSpreadsheet);
    expect(sourceIconFor({ name: 'Folien.pptx', type: '', origin: 'upload' })).toBe(Presentation);
    expect(sourceIconFor({ name: 'foto.jpeg', type: '', origin: 'upload' })).toBe(FileImage);
    expect(sourceIconFor({ name: 'interview.m4a', type: '', origin: 'upload' })).toBe(FileAudio);
    expect(sourceIconFor({ name: 'notes.md', type: '', origin: 'upload' })).toBe(FileType);
  });

  it('falls back to the MIME type, then the origin, then a plain file', () => {
    expect(sourceIconFor({ name: 'scan', type: 'image/png', origin: 'upload' })).toBe(FileImage);
    expect(sourceIconFor({ name: 'Startseite JLU', type: '', origin: 'crawl' })).toBe(Globe);
    expect(sourceIconFor({ name: 'unbekannt', type: '', origin: 'upload' })).toBe(File);
  });
});

describe('sourceTypeLabel', () => {
  it('labels known extensions, normalising long spellings', () => {
    expect(sourceTypeLabel({ name: 'Bericht.pdf' })).toBe('PDF');
    expect(sourceTypeLabel({ name: 'Plan.DOCX' })).toBe('DOCX');
    expect(sourceTypeLabel({ name: 'readme.markdown' })).toBe('MD');
    expect(sourceTypeLabel({ name: 'foto.jpeg' })).toBe('JPG');
  });

  // Oracle: the preview calls a crawled page or URL import a web page, so the
  // tile does too, whatever file the copy is stored as.
  it('labels a web page WEB with the globe, whatever its stored file', () => {
    expect(sourceTypeLabel({ name: 'Startseite_ab12cd34.md', origin: 'crawl' })).toBe('WEB');
    expect(sourceTypeLabel({ name: 'Seite_ab12cd34.html', origin: 'url' })).toBe('WEB');
    expect(sourceIconFor({ name: 'Startseite_ab12cd34.md', type: 'text/markdown', origin: 'crawl' })).toBe(Globe);
    expect(sourceTypeLabel({ name: 'Notiz.md', origin: 'upload' })).toBe('MD');
  });

  it('has no label for page titles or unknown extensions', () => {
    expect(sourceTypeLabel({ name: 'Startseite JLU' })).toBeNull();
    expect(sourceTypeLabel({ name: 'archiv.zip' })).toBeNull();
  });
});
