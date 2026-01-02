/**
 * Gemini AI Service - AI Tutor cho LMS
 * Hỗ trợ học sinh và Giáo viên
 */
import { GoogleGenAI } from "@google/genai";
import { TutorContext, TutorResponse, Question, Theory } from '../types';

// API Key từ environment
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

// Track hint levels per question
const hintLevels: Map<string, number> = new Map();

/**
 * Lấy hint level hiện tại cho một câu hỏi
 */
export const getHintLevel = (questionId: string): number => {
  return hintLevels.get(questionId) || 0;
};

/**
 * Tăng hint level cho một câu hỏi
 */
export const incrementHintLevel = (questionId: string): number => {
  const current = getHintLevel(questionId);
  const newLevel = Math.min(current + 1, 3);
  hintLevels.set(questionId, newLevel);
  return newLevel;
};

/**
 * Reset hint level cho một câu hỏi
 */
export const resetHintLevel = (questionId: string): void => {
  hintLevels.delete(questionId);
};

/**
 * Reset tất cả hint levels
 */
export const resetAllHints = (): void => {
  hintLevels.clear();
};

/**
 * Helper: Clean and Parse JSON safely
 */
function safeJSONParse(text: string): any {
  if (!text) return {};
  
  // 1. Remove Markdown code blocks
  let cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
  
  try {
    return JSON.parse(cleanText);
  } catch (error) {
    console.warn('First JSON parse attempt failed, trying to sanitize backslashes...', error);
    return null;
  }
}

/**
 * Helper: Tách ảnh base64 ra khỏi markdown để giảm token
 */
function extractImages(markdown: string): { cleanText: string; imageMap: Map<string, string> } {
  const imageMap = new Map<string, string>();
  let counter = 0;
  
  // Regex bắt pattern ![alt](data:image...)
  const cleanText = markdown.replace(/!\[(.*?)\]\((data:image\/[^)]+)\)/g, (match, alt, dataUri) => {
    const placeholder = `{{__IMG_${counter}__}}`;
    imageMap.set(placeholder, match); 
    counter++;
    return placeholder; 
  });

  return { cleanText, imageMap };
}

/**
 * Helper: Khôi phục lại ảnh từ placeholder
 */
function restoreImages(text: string, imageMap: Map<string, string>): string {
  let restoredText = text;
  imageMap.forEach((originalImageTag, placeholder) => {
    restoredText = restoredText.split(placeholder).join(originalImageTag);
  });
  return restoredText;
}

/**
 * Helper: Build system prompt for tutor
 */
function buildSystemPrompt(hintLevel: number, context?: TutorContext): string {
  const base = `Bạn là Trợ Lý Thầy Phúc. Hỗ trợ học sinh giải toán. Dùng LaTeX $...$ cho công thức.`;
  const contextInfo = context ? `\nBài toán: ${context.questionText || ''}\n` : '';
  const levelInfo = [
    "Chỉ gợi ý hướng đi, không giải bài.",
    "Gợi ý công thức cần dùng.",
    "Hướng dẫn từng bước, chưa ra đáp số.",
    "Giải chi tiết và ra đáp số."
  ];
  return `${base}\n${contextInfo}\nLevel hỗ trợ: ${levelInfo[hintLevel] || levelInfo[0]}`;
}

/**
 * Helper: Fallback response when AI fails
 */
function getFallbackResponse(hintLevel: number, context?: TutorContext): TutorResponse {
  return {
    message: "Hệ thống AI đang bận hoặc gặp sự cố. Em hãy thử lại sau nhé.",
    hintLevel,
    isFullSolution: false
  };
}

/**
 * Hỏi AI Tutor
 */
export const askAITutor = async (
  userMessage: string,
  context?: TutorContext
): Promise<TutorResponse> => {
  const hintLevel = context?.questionId ? getHintLevel(context.questionId) : 0;
  const systemPrompt = buildSystemPrompt(hintLevel, context);
  
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `Câu hỏi của học sinh: ${userMessage}`,
      config: {
        systemInstruction: systemPrompt,
        temperature: 0.7,
        topK: 40,
        topP: 0.95,
      },
    });
    
    const message = response.text;
    
    if (message) {
      if (context?.questionId && userMessage.toLowerCase().includes('gợi ý')) {
        incrementHintLevel(context.questionId);
      }
      return {
        message,
        hintLevel,
        isFullSolution: hintLevel >= 3
      };
    }
    return getFallbackResponse(hintLevel, context);
  } catch (error) {
    console.error('AI Tutor error:', error);
    return getFallbackResponse(hintLevel, context);
  }
};

/**
 * Tạo câu hỏi mới từ AI (Giáo viên)
 */
export const generateQuestionFromAI = async (
  grade: number,
  topic: string,
  level: string, 
  type: 'Trắc nghiệm' | 'Đúng/Sai' | 'Trả lời ngắn',
  sourceText?: string
): Promise<Partial<Question> | null> => {
  try {
    let prompt = `Tạo một câu hỏi toán học Lớp ${grade}, Chủ đề "${topic}", Mức độ "${level}", Dạng câu hỏi "${type}".\n`;
    
    if (sourceText) {
      const { cleanText } = extractImages(sourceText);
      prompt += `\n[QUAN TRỌNG] Dựa vào nội dung văn bản sau để tạo câu hỏi:\n"""${cleanText}"""\n`;
    }

    prompt += `
    \n[YÊU CẦU ĐỊNH DẠNG JSON & LATEX]:
    1. Output phải là một JSON Object hợp lệ.
    2. TẤT CẢ công thức toán phải viết dưới dạng LaTeX và đặt trong dấu $.
    3. QUAN TRỌNG: Trong chuỗi JSON, ký tự backslash (\\) của LaTeX phải được ESCAPE (viết thành \\\\).
    `;

    if (type === 'Trắc nghiệm') {
      prompt += `Yêu cầu output JSON format:
      {
        "question_text": "Nội dung câu hỏi (LaTeX $\\\\dots$)",
        "option_A": "Đáp án A",
        "option_B": "Đáp án B",
        "option_C": "Đáp án C",
        "option_D": "Đáp án D",
        "answer_key": "A",
        "solution": "Lời giải chi tiết"
      }`;
    } else if (type === 'Đúng/Sai') {
      prompt += `Yêu cầu output JSON format:
      {
        "question_text": "Nội dung câu hỏi chính",
        "option_A": "Mệnh đề a",
        "option_B": "Mệnh đề b",
        "option_C": "Mệnh đề c",
        "option_D": "Mệnh đề d",
        "answer_key": "Đ-S-Đ-S",
        "solution": "Giải thích từng mệnh đề"
      }`;
    } else {
      prompt += `Yêu cầu output JSON format:
      {
        "question_text": "Nội dung câu hỏi",
        "answer_key": "Giá trị số",
        "solution": "Lời giải chi tiết"
      }`;
    }

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        temperature: 0.7 
      }
    });

    const json = safeJSONParse(response.text || '{}');
    if (!json) return null;

    return { ...json, grade, topic, level, question_type: type };

  } catch (error) {
    console.error('Gen Question Error:', error);
    return null;
  }
};

/**
 * Thực hiện OCR (Trích xuất văn bản từ Ảnh hoặc PDF)
 */
export const performOCR = async (base64Data: string, mimeType: string): Promise<string | null> => {
  try {
    // QUAN TRỌNG: Cắt bỏ phần header (ví dụ: "data:application/pdf;base64,")
    // Gemini API chỉ nhận chuỗi base64 thô.
    const cleanBase64 = base64Data.includes('base64,') 
      ? base64Data.split('base64,')[1] 
      : base64Data;

    const prompt = `Hãy đóng vai trò là một công cụ OCR Toán học chuyên nghiệp. 
    Nhiệm vụ của bạn là trích xuất toàn bộ nội dung văn bản và công thức toán học từ tài liệu này (Ảnh hoặc PDF).
    
    Yêu cầu:
    1. Giữ nguyên định dạng công thức toán học, chuyển đổi chúng sang định dạng LaTeX chuẩn (đặt trong dấu $...$ hoặc $$...$$).
    2. Nếu có nhiều câu hỏi, hãy trích xuất tất cả.
    3. Không thêm lời bình luận, chỉ trả về nội dung thô đã trích xuất.
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview', // Dùng Gemini 3 Flash (hỗ trợ multimodal cực tốt)
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: mimeType,
              data: cleanBase64
            }
          },
          { text: prompt }
        ]
      }
    });

    return response.text || null;
  } catch (error) {
    console.error('OCR Error:', error);
    return null;
  }
};

/**
 * Parse Markdown to Questions
 */
export const parseQuestionsFromMarkdown = async (markdownText: string, grade: number, topic: string): Promise<Partial<Question>[]> => {
  const { cleanText, imageMap } = extractImages(markdownText);

  const prompt = `
    Bạn là hệ thống trích xuất đề thi Toán thông minh.
    Nhiệm vụ: Phân tích văn bản Markdown bên dưới và trích xuất TOÀN BỘ danh sách câu hỏi thành mảng JSON.

    [VĂN BẢN ĐỀ THI]:
    """
    ${cleanText}
    """

    [YÊU CẦU OUTPUT JSON]:
    - Output là một JSON Array: [ {...}, {...} ]
    - Trường "question_type" tự động nhận diện: "Trắc nghiệm" (có A,B,C,D), "Đúng/Sai" (có a,b,c,d), hoặc "Trả lời ngắn".
    - Các trường bắt buộc: "question_type", "question_text", "option_A", "option_B", "option_C", "option_D".
    - "answer_key": Nếu có đáp án, hãy điền. Nếu không, để trống.
    - "solution": Lời giải (nếu có).
    - LaTeX phải được double-escape (\\\\frac instead of \\frac).
  `;

  try {
    const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: prompt,
        config: {
            responseMimeType: 'application/json',
            temperature: 0.1,
            maxOutputTokens: 65536 
        }
    });
    
    const parsed = safeJSONParse(response.text || '[]');
    if (!Array.isArray(parsed)) return [];
    
    return parsed.map((q: any) => ({
        ...q,
        image_id: q.image_id && imageMap.has(q.image_id) ? imageMap.get(q.image_id) : q.image_id,
        grade,
        topic,
        level: 'Thông hiểu',
        quiz_level: 1
    }));
  } catch (error) {
    console.error("Error parsing questions:", error);
    return [];
  }
};

/**
 * Generate Theory
 */
export const generateTheoryFromAI = async (grade: number, topic: string, level: number): Promise<Partial<Theory> | null> => {
    // Logic tạo lý thuyết nếu cần, hiện tại trả về null hoặc implement
    return null; 
}