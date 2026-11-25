import axios from 'axios';
import { API_BASE_URL } from '../../api';
import type {
  DetectRequest,
  GlossaryDetail,
  GlossaryInput,
  GlossaryList,
  RephraseRequest,
  RephraseResponse,
  SuggestRequest,
  TranslateRequest,
  TranslateResponse,
  TranslatorConfig,
  TranslatorLanguage,
} from './types';
import { isTranslatorLanguage } from './types';

/*
 * The translator's routes. Each call takes an optional AbortSignal: live editing sends a request
 * per pause in typing, and a newer one aborts the older.
 */

const TRANSLATOR = `${API_BASE_URL}/api/translator`;
const GLOSSARIES = `${API_BASE_URL}/api/glossaries`;

export async function fetchTranslatorConfig(signal?: AbortSignal): Promise<TranslatorConfig> {
  const res = await axios.get<TranslatorConfig>(`${TRANSLATOR}/config`, { signal });
  return res.data;
}

export async function translateText(request: TranslateRequest, signal?: AbortSignal): Promise<TranslateResponse> {
  const res = await axios.post<TranslateResponse>(`${TRANSLATOR}/translate`, request, { signal });
  return res.data;
}

export async function rephraseText(request: RephraseRequest, signal?: AbortSignal): Promise<RephraseResponse> {
  const res = await axios.post<RephraseResponse>(`${TRANSLATOR}/rephrase`, request, { signal });
  return res.data;
}

/** The language of a sample; null when it is not one the translator offers. */
export async function detectLanguage(request: DetectRequest, signal?: AbortSignal): Promise<TranslatorLanguage | null> {
  const res = await axios.post<{ language: string | null }>(`${TRANSLATOR}/detect`, request, { signal });
  return isTranslatorLanguage(res.data.language) ? res.data.language : null;
}

export async function fetchSuggestions(request: SuggestRequest, signal?: AbortSignal): Promise<string[]> {
  const res = await axios.post<{ suggestions: string[] }>(`${TRANSLATOR}/suggest`, request, { signal });
  return res.data.suggestions ?? [];
}

export async function fetchGlossaries(signal?: AbortSignal): Promise<GlossaryList> {
  const res = await axios.get<GlossaryList>(GLOSSARIES, { signal });
  return { glossaries: res.data.glossaries ?? [], languages: res.data.languages ?? [] };
}

export async function fetchGlossary(id: string): Promise<GlossaryDetail> {
  const res = await axios.get<GlossaryDetail>(`${GLOSSARIES}/${id}`);
  return res.data;
}

export async function createGlossary(input: GlossaryInput): Promise<GlossaryDetail> {
  const res = await axios.post<GlossaryDetail>(GLOSSARIES, input);
  return res.data;
}

/** Replaces name, description, category and entries; an empty description clears it, an empty category keeps the old one. */
export async function updateGlossary(id: string, input: GlossaryInput): Promise<GlossaryDetail> {
  const res = await axios.put<GlossaryDetail>(`${GLOSSARIES}/${id}`, input);
  return res.data;
}

export async function setGlossaryVisibility(id: string, visibility: 'private' | 'global'): Promise<void> {
  await axios.patch(`${GLOSSARIES}/${id}`, { visibility });
}

export async function deleteGlossary(id: string): Promise<void> {
  await axios.delete(`${GLOSSARIES}/${id}`);
}

/** The caller leaves a glossary (DELETE …/membership); the owner cannot. */
export async function leaveGlossary(id: string): Promise<void> {
  await axios.delete(`${GLOSSARIES}/${id}/membership`);
}

export interface GlossaryImport {
  file: File;
  name: string;
  description: string;
  sourceLanguage: string;
  targetLanguage: string;
}

/** CSV import: a private glossary owned by the caller. */
export async function importGlossary(input: GlossaryImport): Promise<GlossaryDetail> {
  const form = new FormData();
  form.append('file', input.file);
  form.append('name', input.name);
  form.append('description', input.description);
  form.append('sourceLanguage', input.sourceLanguage);
  form.append('targetLanguage', input.targetLanguage);
  const res = await axios.post<GlossaryDetail>(`${GLOSSARIES}/import`, form);
  return res.data;
}
