import { useState, useCallback } from 'react';
import axios from 'axios';
import type { SafeAIConfig } from '../types';
import { API_BASE_URL } from '../api';
import { useTheme } from '../contexts/ThemeContext';
import { useToast } from '../contexts/ToastContext';
import { userErrorMessage } from '../utils/userErrors';

export function useKbSettings() {
  const { t } = useTheme();
  const toast = useToast();

  const [isPro, setIsPro] = useState(false);
  const [enhance, setEnhance] = useState<'rewrite' | 'expand' | 'spell' | null>(null);
  const [availableConfigs, setAvailableConfigs] = useState<SafeAIConfig[]>([]);
  const [reasoningEnabled, setReasoningEnabled] = useState(false);
  // Per-turn web search (composer + menu → badge); sent as `webSearch`.
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [reasoningLevel, setReasoningLevel] = useState<'low' | 'medium' | 'high'>('low');

  const fetchAvailableConfigs = useCallback(async () => {
    try {
      const res = await axios.get(`${API_BASE_URL}/api/public/configs`);
      setAvailableConfigs(res.data);
    } catch (err: unknown) {
      console.error('Failed to fetch configs:', err);
      toast.error(userErrorMessage(err, t, { fallbackKey: 'configsFetchError' }));
    }
  }, [t, toast]);

  return {
    isPro, setIsPro,
    enhance, setEnhance,
    availableConfigs,
    reasoningEnabled, setReasoningEnabled,
    webSearchEnabled, setWebSearchEnabled,
    reasoningLevel, setReasoningLevel,
    fetchAvailableConfigs,
  };
}
