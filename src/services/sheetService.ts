/**
 * Sheet Service - Kết nối với Google Apps Script Backend
 * LMS Thầy Phúc - Toán Đồng Nai
 * Version 3.2 - Restored GAS OCR
 */

import { 
  User, 
  Question, 
  Theory,
  QuizResult, 
  Session, 
  SessionValidation,
  LeaderboardEntry,
  TopicProgress,
  OCRResult
} from '../types';

// ==================== CONFIGURATION ====================

// 🔴 QUAN TRỌNG: Thay URL này bằng URL Web App của bạn sau khi deploy code.gs
export const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxtTDnbJf5J1V7SdFCYL604AtrL20ESIQEXPxIqG3ZoJXv5U9-QN2m19xvAzu7bDWmt/exec';

// API Response interface
interface APIResponse<T = unknown> {
  status: 'success' | 'error';
  data: T;
  message?: string;
  timestamp?: string;
}

// ==================== CORE API HELPER ====================

/**
 * Gọi API bằng GET request để tránh CORS preflight
 * Tất cả data được gửi qua URL params
 */
async function callAPI<T>(action: string, data: Record<string, unknown> = {}): Promise<APIResponse<T>> {
  try {
    // Build URL với params
    const params = new URLSearchParams({
      action,
      payload: JSON.stringify(data)
    });
    
    const url = `${GOOGLE_SCRIPT_URL}?${params.toString()}`;
    
    // console.log(`[API] ${action}:`, data);
    
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow' // Quan trọng: Google Apps Script redirect response
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const json: APIResponse<T> = await response.json();
    
    // console.log(`[API] ${action} response:`, json);
    
    return json;
  } catch (error) {
    console.error(`[API] ${action} error:`, error);
    return {
      status: 'error',
      data: null as T,
      message: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Gọi API với retry logic
 */
async function callAPIWithRetry<T>(
  action: string, 
  data: Record<string, unknown> = {}, 
  maxRetries: number = 2
): Promise<APIResponse<T>> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await callAPI<T>(action, data);
      
      // Nếu thành công hoặc lỗi logic (không phải network error), return ngay
      if (result.status === 'success' || !result.message?.includes('fetch')) {
        return result;
      }
      
      lastError = new Error(result.message);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Unknown error');
    }
    
    // Đợi trước khi retry (exponential backoff)
    if (attempt < maxRetries) {
      await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
      console.log(`[API] Retrying ${action} (attempt ${attempt + 2}/${maxRetries + 1})`);
    }
  }
  
  return {
    status: 'error',
    data: null as T,
    message: lastError?.message || 'Max retries exceeded'
  };
}

// ... (Existing Device, Session Storage - Keep implementation) ...
const getDeviceId = (): string => {
  const key = 'lms_device_id';
  let deviceId = localStorage.getItem(key);
  if (!deviceId) {
    deviceId = 'device_' + Math.random().toString(36).substring(2) + '_' + Date.now().toString(36);
    localStorage.setItem(key, deviceId);
  }
  return deviceId;
};
export const saveSession = (session: Session): void => localStorage.setItem('lms_session', JSON.stringify(session));
export const getSession = (): Session | null => { try { const stored = localStorage.getItem('lms_session'); return stored ? JSON.parse(stored) : null; } catch { return null; } };
export const getStoredSession = getSession;
export const clearSession = (): void => localStorage.removeItem('lms_session');
export const isLoggedIn = (): boolean => !!getSession()?.sessionToken;
export const getCurrentUser = (): User | null => getSession()?.user || null;

// ==================== AUTH API ====================

export const loginUser = async (email: string, password: string): Promise<Session | null> => {
  const deviceId = getDeviceId();
  const result = await callAPI<{ user: User; sessionToken: string }>('login', { email: email.trim().toLowerCase(), password, deviceId });
  if (result.status === 'success' && result.data) {
    const session: Session = { user: result.data.user, sessionToken: result.data.sessionToken, deviceId, loginTime: new Date().toISOString() };
    saveSession(session);
    return session;
  }
  return null;
};

export const validateSession = async (): Promise<SessionValidation> => {
  const session = getSession();
  if (!session) return { valid: false, reason: 'no_session' };
  const result = await callAPI<SessionValidation>('validateSession', { email: session.user.email, sessionToken: session.sessionToken });
  if (result.status === 'success' && result.data) return result.data;
  return { valid: false, reason: 'invalid_token' };
};

export const sendHeartbeat = async (): Promise<SessionValidation> => {
  const session = getSession();
  if (!session) return { valid: false, reason: 'no_session' };
  const result = await callAPI<SessionValidation>('heartbeat', { email: session.user.email, sessionToken: session.sessionToken });
  if (result.status === 'success' && result.data) return result.data;
  if (result.message?.includes('fetch') || result.message?.includes('network')) return { valid: true };
  return { valid: false, reason: 'session_conflict' };
};

export const logoutUser = async (): Promise<boolean> => {
  const session = getSession();
  if (session) await callAPI('logout', { email: session.user.email, sessionToken: session.sessionToken });
  clearSession();
  return true;
};

// ==================== QUIZ API ====================

export const fetchTopics = async (grade: number = 12): Promise<string[]> => {
  const result = await callAPIWithRetry<string[]>('getTopics', { grade });
  return result.status === 'success' && Array.isArray(result.data) ? result.data : [];
};

export const fetchQuestions = async (grade: number, topic: string, level: number = 1): Promise<Question[]> => {
  const result = await callAPIWithRetry<Question[]>('getQuestions', { grade, topic, level });
  return result.status === 'success' && Array.isArray(result.data) ? result.data : [];
};

export const fetchTheory = async (grade: number, topic: string, level: number): Promise<Theory | null> => {
  const result = await callAPI<Theory>('getTheory', { grade, topic, level });
  return result.status === 'success' && result.data ? result.data : null;
};

export const fetchUserProgress = async (email?: string): Promise<{ totalScore: number; currentLevel: number; progress: Record<string, number>; } | null> => {
  const session = getSession();
  const userEmail = email || session?.user?.email;
  if (!userEmail) return null;
  const result = await callAPI<{ totalScore: number; currentLevel: number; progress: Record<string, number>; }>('getUserProgress', { email: userEmail });
  return result.status === 'success' && result.data ? result.data : null;
};

export const submitQuiz = async (quizData: any): Promise<QuizResult | null> => {
  try {
    const params = new URLSearchParams({ action: 'submitQuiz', payload: JSON.stringify(quizData) });
    const url = `${GOOGLE_SCRIPT_URL}?${params.toString()}`;
    const response = await fetch(url, { method: 'GET', redirect: 'follow' });
    const json = await response.json();
    if (json.status === 'success') return json.data;
    return null;
  } catch (error) { return null; }
};

// ==================== INSTANT EXAM API (DRIVE STORAGE) ====================

export const createInstantExam = async (title: string, grade: number, questions: Question[]): Promise<{ examId: string; message: string } | null> => {
  try {
    const payload = { action: 'createInstantExam', title, grade, questions };
    const response = await fetch(GOOGLE_SCRIPT_URL, {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    });
    if (!response.ok) throw new Error('Server response not ok');
    const json = await response.json();
    if (json.status === 'success' && json.data) return json.data;
    console.error('Create Exam Failed:', json);
    return null;
  } catch (error) {
    console.error('Create Exam Error:', error);
    return null;
  }
};

export const fetchExamByLink = async (examId: string): Promise<{ title: string; grade: number; questions: Question[] } | null> => {
  const result = await callAPI<{ title: string; grade: number; questions: Question[] }>('getExamByLink', { examId });
  if (result.status === 'success' && result.data) return result.data;
  return null;
};

// ==================== OCR UPLOAD (OLD LOGIC RESTORED) ====================

/**
 * Upload PDF to Google Apps Script for OCR processing (Logic Cũ)
 * Note: GAS limit is 50MB, usually safe for exams.
 */
export const uploadPDFToGAS = async (file: File): Promise<OCRResult> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = async () => {
      try {
        const base64 = (reader.result as string).split(',')[1];
        
        // Sử dụng POST request vì body lớn
        const payload = {
            action: 'ocr',
            fileName: file.name,
            mimeType: file.type || 'application/pdf',
            fileContent: base64
        };

        // Gửi trực tiếp bằng fetch POST (không dùng callAPI helper vì cần POST)
        const response = await fetch(GOOGLE_SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify(payload),
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        });

        const json = await response.json();

        if (json.status === 'success') {
             resolve(json.data);
        } else {
             reject(new Error(json.message || 'OCR Failed'));
        }
      } catch (e) {
        reject(e);
      }
    };
    reader.onerror = error => reject(error);
  });
};

// ==================== UTILS ====================

export const reportViolation = async (email: string, type: string, details: any, quizInfo: any): Promise<boolean> => {
  try {
    const params = new URLSearchParams({ action: 'reportViolation', payload: JSON.stringify({ email, type, details, quizInfo }) });
    const url = `${GOOGLE_SCRIPT_URL}?${params.toString()}`;
    await fetch(url, { method: 'GET', redirect: 'follow' });
    return true;
  } catch (error) { return false; }
};

export const fetchLeaderboard = async (limit: number = 20): Promise<LeaderboardEntry[]> => {
  const result = await callAPI<LeaderboardEntry[]>('getLeaderboard', { limit });
  return result.status === 'success' && Array.isArray(result.data) ? result.data : [];
};

export const checkConnection = async (): Promise<boolean> => {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const url = `${GOOGLE_SCRIPT_URL}?action=ping&t=${Date.now()}`;
    const response = await fetch(url, { method: 'GET', redirect: 'follow', signal: controller.signal });
    clearTimeout(timeoutId);
    const json = await response.json();
    return json.status === 'success';
  } catch { return false; }
};

export const parseProgress = (progressStr: string | undefined): Record<string, number> => {
  if (!progressStr) return {};
  try { return JSON.parse(progressStr); } catch { return {}; }
};

export const getCurrentLevel = (progress: Record<string, number>, grade: number, topic: string): number => {
  const key = `${grade}_${topic}`;
  return progress[key] || 1;
};

export const isLevelUnlocked = (progress: Record<string, number>, grade: number, topic: string, level: number): boolean => {
  const currentLevel = getCurrentLevel(progress, grade, topic);
  return level <= currentLevel;
};

export const refreshUserData = async (): Promise<User | null> => {
  const session = getSession();
  if (!session) return null;
  const progressData = await fetchUserProgress(session.user.email);
  if (progressData) {
    const updatedUser: User = { ...session.user, totalScore: progressData.totalScore, currentLevel: progressData.currentLevel, progress: progressData.progress };
    saveSession({ ...session, user: updatedUser });
    return updatedUser;
  }
  return session.user;
};

export const testAPI = async (action: string, data: Record<string, unknown> = {}): Promise<unknown> => {
  const result = await callAPI(action, data);
  return result;
};

export const getAPIUrl = () => GOOGLE_SCRIPT_URL;