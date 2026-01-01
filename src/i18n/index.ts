/**
 * @fileoverview i18n (국제화) 시스템
 * 한국어/영어 언어 전환 지원
 */

import { en } from './translations/en';
import { ko } from './translations/ko';

export type Language = 'en' | 'ko';
export type Translations = typeof en;

const translations: Record<Language, Translations> = { en, ko };

let currentLanguage: Language = 'ko';
const listeners: Set<() => void> = new Set();

/**
 * 번역 키로 현재 언어의 텍스트를 가져옴
 * @param key 점(.)으로 구분된 키 (예: 'gui.simulation')
 */
export function t(key: string): string {
  const keys = key.split('.');
  let value: unknown = translations[currentLanguage];

  for (const k of keys) {
    if (value && typeof value === 'object' && k in value) {
      value = (value as Record<string, unknown>)[k];
    } else {
      console.warn(`Missing translation: ${key}`);
      return key;
    }
  }

  return typeof value === 'string' ? value : key;
}

/**
 * 현재 언어 반환
 */
export function getLanguage(): Language {
  return currentLanguage;
}

/**
 * 언어 변경
 */
export function setLanguage(lang: Language): void {
  if (lang === currentLanguage) return;
  currentLanguage = lang;
  localStorage.setItem('ecosim-language', lang);
  listeners.forEach(cb => cb());
}

/**
 * 언어 변경 이벤트 리스너 등록
 * @returns 리스너 해제 함수
 */
export function onLanguageChange(callback: () => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

/**
 * localStorage에서 저장된 언어 설정 불러오기
 */
export function initLanguage(): void {
  const saved = localStorage.getItem('ecosim-language') as Language | null;
  if (saved && (saved === 'en' || saved === 'ko')) {
    currentLanguage = saved;
  }
}
