import React, { useState, useEffect } from 'react';
import { FileText, Trash2, Edit, Plus, CheckCircle, XCircle, Settings, Users, BrainCircuit, RefreshCw, Loader2, Sparkles, Database, Eye, Link as LinkIcon, Share2, Copy, Send, LayoutList, ChevronRight, GraduationCap, ClipboardList, UserCheck, FileUp, Save, FileType, Layers, AlertCircle } from 'lucide-react';
import { GOOGLE_SCRIPT_URL, createInstantExam, uploadPDFToGAS } from '../services/sheetService';
import { extractHtmlFromDocx, parseQuestionsFromHtml } from '../services/wordService';
import { performOCR, parseQuestionsFromMarkdown } from '../services/geminiService';
import MathText from './MathText';
import Button from './Button';
import Loading from './Loading';
import { Question } from '../types';

interface AdminProps {
  onLogout: () => void;
}

const GRADES = [6, 7, 8, 9, 10, 11, 12];
const LEVELS = ['Nhận biết', 'Thông hiểu', 'Vận dụng', 'Vận dụng cao'];

interface ExamStructureItem {
  id: string;
  topic: string;
  level: string;
  count: number;
}

export const AdminPanel: React.FC<AdminProps> = ({ onLogout }) => {
  const [activeTab, setActiveTab] = useState<'questions' | 'exam-creator' | 'students'>('questions');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{type: 'success' | 'error', text: string} | null>(null);
  
  // Data States
  const [questions, setQuestions] = useState<Question[]>([]);
  const [students, setStudents] = useState<any[]>([]);
  const [topics, setTopics] = useState<string[]>([]);
  
  // UI States
  const [editingQuestion, setEditingQuestion] = useState<Partial<Question> | null>(null);
  
  // OCR / Import States
  const [importMode, setImportMode] = useState(false);
  const [importedQuestions, setImportedQuestions] = useState<Partial<Question>[]>([]);
  const [isProcessingFile, setIsProcessingFile] = useState(false);
  const [importStatus, setImportStatus] = useState<string>('');
  
  // Exam Creator States
  const [examConfig, setExamConfig] = useState({
    grade: 12,
    generationMode: 'batch' as 'batch' | 'personalized',
    batchCount: 4
  });
  
  // New Matrix Builder States
  const [builderSelection, setBuilderSelection] = useState({
    topic: '',
    level: 'Thông hiểu',
    count: 1
  });
  const [examStructure, setExamStructure] = useState<ExamStructureItem[]>([]);
  
  const [isGeneratingBatch, setIsGeneratingBatch] = useState(false);
  const [generatedBatchResult, setGeneratedBatchResult] = useState<{name: string, link: string}[]>([]);

  useEffect(() => {
    // Luôn load câu hỏi để tính toán số lượng khả dụng cho Exam Creator
    if (questions.length === 0) loadQuestions();
    
    if (activeTab === 'students') loadStudents();
    if (activeTab === 'exam-creator') loadTopics(examConfig.grade);
  }, [activeTab]);

  const loadQuestions = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${GOOGLE_SCRIPT_URL}?action=getAllQuestions`);
      const data = await res.json();
      if (data.status === 'success') setQuestions(data.data);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  const loadStudents = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${GOOGLE_SCRIPT_URL}?action=getAllStudents`);
      const data = await res.json();
      if (data.status === 'success') setStudents(data.data);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  const loadTopics = async (grade: number) => {
    try {
      const res = await fetch(`${GOOGLE_SCRIPT_URL}?action=getTopics&grade=${grade}`);
      const data = await res.json();
      if (data.status === 'success') setTopics(data.data);
    } catch (e) { console.error(e); }
  };

  const handleSaveEdit = async () => {
    if (!editingQuestion) return;
    setLoading(true);
    try {
      const res = await fetch(GOOGLE_SCRIPT_URL, {
        method: 'POST',
        body: JSON.stringify({ action: 'saveQuestion', ...editingQuestion })
      });
      const data = await res.json();
      if (data.status === 'success') {
        setMessage({ type: 'success', text: 'Đã lưu câu hỏi thành công!' });
        setEditingQuestion(null);
        loadQuestions();
      }
    } catch (e) { setMessage({ type: 'error', text: 'Lỗi khi lưu câu hỏi' }); }
    setLoading(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Xác nhận xóa câu hỏi này?')) return;
    setLoading(true);
    await fetch(`${GOOGLE_SCRIPT_URL}?action=deleteQuestion&exam_id=${id}`);
    loadQuestions();
  };

  // ==================== FILE IMPORT HANDLERS (OCR) ====================

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = error => reject(error);
      reader.readAsDataURL(file);
    });
  };

  const handleFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessingFile(true);
    setImportedQuestions([]);
    setImportStatus('Đang phân tích file...');

    try {
      let extractedQs: Partial<Question>[] = [];

      if (file.name.endsWith('.docx')) {
        setImportStatus('Đang đọc file Word...');
        const html = await extractHtmlFromDocx(file);
        setImportStatus('Đang tách câu hỏi...');
        extractedQs = parseQuestionsFromHtml(html, 12, 'Tổng hợp');
      } 
      else if (file.name.toLowerCase().endsWith('.pdf')) {
        setImportStatus('Đang tải PDF lên Server OCR...');
        const ocrResult = await uploadPDFToGAS(file);
        setImportStatus('Đang xử lý kết quả OCR...');
        extractedQs = await parseQuestionsFromMarkdown(ocrResult.allMarkdownDataUri, 12, 'Tổng hợp');
      } 
      else if (file.type.startsWith('image/') || /\.(jpg|jpeg|png)$/i.test(file.name)) {
        setImportStatus('Đang nhận diện hình ảnh...');
        const base64 = await fileToBase64(file);
        const mime = file.type || (file.name.endsWith('.png') ? 'image/png' : 'image/jpeg');
        const text = await performOCR(base64, mime);
        if (text) {
          setImportStatus('Đang chuẩn hóa LaTeX...');
          extractedQs = await parseQuestionsFromMarkdown(text, 12, 'Tổng hợp');
        }
      }

      setImportedQuestions(extractedQs);
      if (extractedQs.length > 0) {
        setMessage({ type: 'success', text: `Đã trích xuất được ${extractedQs.length} câu hỏi!` });
      } else {
        setMessage({ type: 'error', text: 'Không tìm thấy câu hỏi nào hoặc cấu trúc file không hợp lệ.' });
      }
    } catch (err: any) {
      console.error(err);
      setMessage({ type: 'error', text: `Lỗi: ${err.message || 'Không thể đọc file'}` });
    } finally {
      setIsProcessingFile(false);
      setImportStatus('');
    }
  };

  const handleSaveImported = async () => {
    if (importedQuestions.length === 0) return;
    if (!confirm(`Xác nhận lưu ${importedQuestions.length} câu hỏi vào ngân hàng?`)) return;

    setLoading(true);
    let successCount = 0;
    
    for (const q of importedQuestions) {
       try {
         await fetch(GOOGLE_SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify({ action: 'saveQuestion', ...q })
         });
         successCount++;
       } catch (e) { console.error(e); }
    }

    setLoading(false);
    setMessage({ type: 'success', text: `Đã lưu thành công ${successCount}/${importedQuestions.length} câu hỏi!` });
    setImportMode(false);
    setImportedQuestions([]);
    loadQuestions();
  };

  const removeImportedQuestion = (index: number) => {
    const newQs = [...importedQuestions];
    newQs.splice(index, 1);
    setImportedQuestions(newQs);
  };

  // ==================== EXAM CREATOR HANDLERS (NEW MATRIX LOGIC) ====================

  // Helper: Đếm số câu hỏi khả dụng theo tiêu chí
  const getAvailableCount = (topic: string, level: string) => {
    return questions.filter(q => 
      Number(q.grade) === examConfig.grade && 
      q.topic === topic && 
      q.level === level
    ).length;
  };

  // Helper: Đếm tổng số câu hỏi của 1 chủ đề (bất kể level)
  const getTopicTotalCount = (topic: string) => {
    return questions.filter(q => 
      Number(q.grade) === examConfig.grade && 
      q.topic === topic
    ).length;
  };

  const handleAddStructure = () => {
    if (!builderSelection.topic) { alert('Vui lòng chọn chủ đề'); return; }
    
    const available = getAvailableCount(builderSelection.topic, builderSelection.level);
    if (available === 0) { alert('Không có câu hỏi nào trong kho cho lựa chọn này!'); return; }
    if (builderSelection.count > available) { alert(`Chỉ còn ${available} câu hỏi khả dụng!`); return; }
    if (builderSelection.count <= 0) { alert('Số lượng phải lớn hơn 0'); return; }

    const newItem: ExamStructureItem = {
      id: Date.now().toString(),
      topic: builderSelection.topic,
      level: builderSelection.level,
      count: Number(builderSelection.count)
    };

    setExamStructure([...examStructure, newItem]);
  };

  const handleRemoveStructure = (id: string) => {
    setExamStructure(examStructure.filter(item => item.id !== id));
  };

  const getTotalExamQuestions = () => examStructure.reduce((sum, item) => sum + item.count, 0);

  const generateExams = async () => {
    if (examStructure.length === 0) { alert('Vui lòng thêm ít nhất một nhóm câu hỏi vào cấu trúc đề.'); return; }
    
    setIsGeneratingBatch(true);
    setGeneratedBatchResult([]);

    try {
      const results: {name: string, link: string}[] = [];
      const totalQs = getTotalExamQuestions();

      // Logic tạo bộ câu hỏi gốc dựa trên cấu trúc (Pool)
      // Lưu ý: Nếu tạo nhiều mã đề, ta cần đảm bảo lấy ngẫu nhiên mỗi lần hoặc lấy 1 pool lớn rồi xáo trộn.
      // Ở đây ta sẽ lấy Pool lớn nhất có thể từ DB khớp với cấu trúc, sau đó mỗi lần tạo đề sẽ pick random từ Pool đó.

      const masterPool: Record<string, Question[]> = {}; // Key: "Topic_Level" -> Questions[]

      // Chuẩn bị Master Pool từ client-side questions (đã load sẵn)
      examStructure.forEach(req => {
         const key = `${req.topic}_${req.level}`;
         if (!masterPool[key]) {
            masterPool[key] = questions.filter(q => 
               Number(q.grade) === examConfig.grade && 
               q.topic === req.topic && 
               q.level === req.level
            );
         }
      });

      const generateSingleExamSet = (): Question[] => {
         let examQuestions: Question[] = [];
         
         examStructure.forEach(req => {
            const key = `${req.topic}_${req.level}`;
            const pool = masterPool[key] || [];
            // Shuffle pool và lấy req.count câu
            const selected = [...pool].sort(() => 0.5 - Math.random()).slice(0, req.count);
            examQuestions = [...examQuestions, ...selected];
         });
         
         // Shuffle toàn bộ đề thi lần cuối
         return examQuestions.sort(() => 0.5 - Math.random());
      };

      if (examConfig.generationMode === 'batch') {
        for (let i = 1; i <= examConfig.batchCount; i++) {
          const examSet = generateSingleExamSet();
          if (examSet.length < totalQs) {
             console.warn(`Đề ${i} thiếu câu hỏi (Có ${examSet.length}/${totalQs})`);
          }
          
          const exam = await createInstantExam(`Đề ${100 + i} - Tổng hợp`, examConfig.grade, examSet);
          if (exam) results.push({ name: `Mã đề ${100 + i}`, link: `${window.location.origin}${window.location.pathname}?examId=${exam.examId}` });
        }
      } else {
        // Personalized
        for (const student of students) {
          const examSet = generateSingleExamSet();
          const exam = await createInstantExam(`Đề của: ${student.name}`, examConfig.grade, examSet);
          if (exam) results.push({ name: `HS: ${student.name}`, link: `${window.location.origin}${window.location.pathname}?examId=${exam.examId}` });
        }
      }
      
      setGeneratedBatchResult(results);
      setMessage({ type: 'success', text: `Đã tạo thành công ${results.length} đề thi!` });
    } catch (e) { 
        console.error(e);
        alert('Lỗi khi tạo đề thi'); 
    }
    setIsGeneratingBatch(false);
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans">
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex justify-between items-center shadow-sm sticky top-0 z-40">
        <div className="flex items-center gap-3">
          <GraduationCap className="text-teal-600" size={32} />
          <h1 className="text-2xl font-black text-slate-800 tracking-tight">Hệ thống Quản trị <span className="text-teal-500 font-medium">| Thầy Phúc</span></h1>
        </div>
        <button onClick={onLogout} className="px-5 py-2 text-slate-500 hover:text-red-600 font-bold border border-slate-200 rounded-xl transition hover:bg-red-50">Đăng xuất</button>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <aside className="w-72 bg-white border-r border-slate-200 p-6 space-y-3 shadow-sm">
          {[
            { id: 'questions', icon: ClipboardList, label: 'Ngân hàng câu hỏi' },
            { id: 'exam-creator', icon: Sparkles, label: 'Giao đề thi' },
            { id: 'students', icon: UserCheck, label: 'Theo dõi học sinh' }
          ].map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id as any)} className={`w-full text-left px-5 py-4 rounded-2xl font-bold flex items-center gap-4 transition-all ${activeTab === tab.id ? 'bg-teal-600 text-white shadow-lg shadow-teal-100' : 'text-slate-500 hover:bg-slate-50 hover:text-teal-600'}`}>
              <tab.icon size={22} /> {tab.label}
            </button>
          ))}
        </aside>

        <main className="flex-1 p-8 overflow-y-auto bg-[#f8fafc]">
          {message && (
            <div className={`mb-8 p-5 rounded-2xl flex justify-between items-center animate-fade-in ${message.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
              <span className="font-bold flex items-center gap-2">{message.type === 'success' ? <CheckCircle size={20}/> : <XCircle size={20}/>} {message.text}</span>
              <button onClick={() => setMessage(null)} className="opacity-50 hover:opacity-100"><XCircle size={18}/></button>
            </div>
          )}

          {activeTab === 'questions' && (
            <div className="space-y-6">
              <div className="flex justify-between items-end">
                <div>
                  <h2 className="text-3xl font-black text-slate-800">Ngân hàng câu hỏi</h2>
                  <p className="text-slate-400 font-medium">Quản lý và biên tập nội dung học liệu toán học</p>
                </div>
                <div className="flex gap-3">
                   <Button onClick={() => setImportMode(true)} variant="secondary" className="flex items-center gap-2 border-2 border-teal-200 bg-white hover:bg-teal-50"><FileUp size={20}/> Nhập từ File (OCR)</Button>
                   <Button onClick={() => setEditingQuestion({ question_type: 'Trắc nghiệm', grade: 12, topic: 'Hàm số', level: 'Thông hiểu', quiz_level: 1 })} variant="primary" className="flex items-center gap-2"><Plus size={20}/> Thêm thủ công</Button>
                   <button onClick={loadQuestions} className="p-4 bg-white border border-slate-200 rounded-2xl hover:bg-teal-50 text-teal-600 transition shadow-sm"><RefreshCw size={22} className={loading ? 'animate-spin' : ''}/></button>
                </div>
              </div>

              <div className="bg-white rounded-[2rem] shadow-sm border border-slate-200 overflow-hidden">
                <table className="w-full text-left">
                  <thead className="bg-slate-50/50 border-b">
                    <tr>
                      <th className="p-5 text-xs font-black text-slate-400 uppercase tracking-widest">Phân loại</th>
                      <th className="p-5 text-xs font-black text-slate-400 uppercase tracking-widest">Nội dung</th>
                      <th className="p-5 text-xs font-black text-slate-400 uppercase tracking-widest text-right">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50 text-sm">
                    {questions.map(q => (
                      <tr key={q.exam_id} className="hover:bg-slate-50/30 transition group">
                        <td className="p-5">
                          <div className="font-bold text-slate-700">{q.question_type}</div>
                          <div className="text-[10px] text-teal-600 font-black uppercase mt-1 px-2 py-0.5 bg-teal-50 rounded-md inline-block">{q.level}</div>
                        </td>
                        <td className="p-5">
                          <div className="text-slate-600 font-medium max-w-2xl line-clamp-1">{q.question_text.replace(/<[^>]*>?/gm, '')}</div>
                          <div className="text-[10px] text-slate-300 italic mt-1 font-bold">{q.topic} • Lớp {q.grade}</div>
                        </td>
                        <td className="p-5 text-right">
                          <div className="flex gap-1 justify-end opacity-0 group-hover:opacity-100 transition-all">
                            <button onClick={() => setEditingQuestion(q)} className="p-2.5 text-teal-600 hover:bg-teal-50 rounded-xl transition"><Edit size={20}/></button>
                            <button onClick={() => handleDelete(q.exam_id)} className="p-2.5 text-red-500 hover:bg-red-50 rounded-xl transition"><Trash2 size={20}/></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'exam-creator' && (
            <div className="max-w-6xl mx-auto space-y-8">
              <div className="bg-white p-10 rounded-[2.5rem] shadow-xl border border-slate-100 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-teal-50 rounded-full -mr-16 -mt-16 opacity-30"></div>
                
                <h2 className="text-4xl font-black text-slate-800 mb-2 flex items-center gap-4"><Sparkles className="text-teal-500" size={40}/> Trình tạo đề thi</h2>
                <p className="text-slate-400 font-medium mb-8">Xây dựng ma trận đề thi linh hoạt từ ngân hàng câu hỏi.</p>
                
                {/* SETTINGS AREA */}
                <div className="grid grid-cols-12 gap-8">
                    
                    {/* LEFT: BUILDER CONTROLS */}
                    <div className="col-span-5 space-y-6">
                        <div className="bg-slate-50 p-6 rounded-3xl border border-slate-200">
                            <h3 className="font-black text-slate-700 mb-4 flex items-center gap-2"><Layers size={20}/> Cấu hình Khối & Chủ đề</h3>
                            
                            <div className="space-y-4">
                                <div>
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">Khối lớp</label>
                                    <select className="w-full p-4 bg-white border border-slate-200 rounded-2xl font-bold text-slate-700" 
                                        value={examConfig.grade} 
                                        onChange={e => {
                                            setExamConfig({...examConfig, grade: Number(e.target.value)}); 
                                            loadTopics(Number(e.target.value));
                                            setExamStructure([]); // Reset structure if grade changes
                                        }}>
                                        {GRADES.map(g => <option key={g} value={g}>Lớp {g}</option>)}
                                    </select>
                                </div>

                                <div>
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">Chủ đề (Tổng số câu)</label>
                                    <select className="w-full p-4 bg-white border border-slate-200 rounded-2xl font-bold text-slate-700" 
                                        value={builderSelection.topic} 
                                        onChange={e => setBuilderSelection({...builderSelection, topic: e.target.value})}>
                                        <option value="">-- Chọn chủ đề --</option>
                                        {topics.map(t => (
                                            <option key={t} value={t}>{t} ({getTopicTotalCount(t)})</option>
                                        ))}
                                    </select>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">Mức độ</label>
                                        <select className="w-full p-4 bg-white border border-slate-200 rounded-2xl font-bold text-slate-700" 
                                            value={builderSelection.level} 
                                            onChange={e => setBuilderSelection({...builderSelection, level: e.target.value})}>
                                            {LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">Số lượng</label>
                                        <input type="number" min="1" className="w-full p-4 bg-white border border-slate-200 rounded-2xl font-bold text-slate-700" 
                                            value={builderSelection.count} 
                                            onChange={e => setBuilderSelection({...builderSelection, count: Number(e.target.value)})}
                                        />
                                    </div>
                                </div>

                                {/* Availability Info */}
                                {builderSelection.topic && (
                                    <div className="flex justify-between items-center text-xs font-bold px-1">
                                        <span className="text-slate-400">Khả dụng trong kho:</span>
                                        <span className={`px-2 py-1 rounded ${getAvailableCount(builderSelection.topic, builderSelection.level) >= builderSelection.count ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                            {getAvailableCount(builderSelection.topic, builderSelection.level)} câu
                                        </span>
                                    </div>
                                )}

                                <Button onClick={handleAddStructure} fullWidth className="bg-slate-800 text-white hover:bg-slate-900 shadow-slate-300">
                                    <Plus size={18} className="mr-2 inline"/> Thêm vào cấu trúc
                                </Button>
                            </div>
                        </div>
                    </div>

                    {/* RIGHT: MATRIX TABLE */}
                    <div className="col-span-7 bg-white border-2 border-dashed border-slate-200 rounded-3xl p-6 flex flex-col">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="font-black text-slate-700 text-lg">Ma trận đề thi</h3>
                            <span className="bg-teal-100 text-teal-700 px-3 py-1 rounded-xl font-black text-sm">
                                Tổng: {getTotalExamQuestions()} câu
                            </span>
                        </div>

                        <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar space-y-3">
                            {examStructure.length === 0 ? (
                                <div className="h-full flex flex-col items-center justify-center text-slate-300">
                                    <LayoutList size={48} className="mb-2 opacity-50"/>
                                    <p className="font-medium text-sm">Chưa có thành phần nào.</p>
                                    <p className="text-xs">Hãy chọn chủ đề và thêm vào đây.</p>
                                </div>
                            ) : (
                                examStructure.map((item) => (
                                    <div key={item.id} className="flex items-center justify-between p-4 bg-white border border-slate-200 rounded-2xl shadow-sm hover:border-teal-200 transition">
                                        <div>
                                            <div className="font-bold text-slate-800">{item.topic}</div>
                                            <div className="text-xs font-bold text-slate-400 uppercase mt-1">{item.level}</div>
                                        </div>
                                        <div className="flex items-center gap-4">
                                            <div className="font-mono font-black text-teal-600 text-lg bg-teal-50 px-3 py-1 rounded-lg">
                                                {item.count} câu
                                            </div>
                                            <button onClick={() => handleRemoveStructure(item.id)} className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition">
                                                <Trash2 size={18}/>
                                            </button>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>

                {/* BOTTOM: GENERATION ACTIONS */}
                <div className="mt-8 pt-8 border-t border-slate-100">
                    <div className="flex gap-6 items-end">
                        <div className="flex-1">
                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2 px-1">Chế độ xuất bản</label>
                            <div className="flex gap-4">
                                <button onClick={() => setExamConfig({...examConfig, generationMode: 'batch'})} className={`flex-1 p-4 rounded-2xl border-2 transition-all text-left flex items-center gap-3 ${examConfig.generationMode === 'batch' ? 'border-teal-500 bg-teal-50' : 'border-slate-200 hover:border-teal-200'}`}>
                                    <div className={`p-2 rounded-lg ${examConfig.generationMode === 'batch' ? 'bg-teal-200 text-teal-800' : 'bg-slate-100 text-slate-500'}`}><LayoutList size={20}/></div>
                                    <div>
                                        <div className="font-bold text-slate-800 text-sm">Tạo mã đề</div>
                                        <div className="text-xs text-slate-400">Trộn ngẫu nhiên thành 4-6 đề</div>
                                    </div>
                                </button>
                                <button onClick={() => setExamConfig({...examConfig, generationMode: 'personalized'})} className={`flex-1 p-4 rounded-2xl border-2 transition-all text-left flex items-center gap-3 ${examConfig.generationMode === 'personalized' ? 'border-teal-500 bg-teal-50' : 'border-slate-200 hover:border-teal-200'}`}>
                                    <div className={`p-2 rounded-lg ${examConfig.generationMode === 'personalized' ? 'bg-teal-200 text-teal-800' : 'bg-slate-100 text-slate-500'}`}><UserCheck size={20}/></div>
                                    <div>
                                        <div className="font-bold text-slate-800 text-sm">Mỗi bạn 1 đề</div>
                                        <div className="text-xs text-slate-400">Đề riêng cho từng học sinh</div>
                                    </div>
                                </button>
                            </div>
                        </div>
                        <div className="w-1/3">
                             <Button onClick={generateExams} disabled={isGeneratingBatch || examStructure.length === 0} fullWidth size="lg" className="bg-teal-600 h-[88px] text-xl rounded-2xl shadow-lg shadow-teal-100">
                                {isGeneratingBatch ? <><Loader2 className="animate-spin mr-3 inline"/> Đang xử lý...</> : <><Send className="mr-3 inline"/> Bắt đầu tạo đề</> }
                            </Button>
                        </div>
                    </div>
                </div>
              </div>

              {generatedBatchResult.length > 0 && (
                <div className="bg-white p-8 rounded-[2.5rem] border border-teal-100 animate-slide-in shadow-lg">
                  <h3 className="font-black text-slate-800 mb-6 flex items-center gap-3 text-2xl"><LinkIcon className="text-teal-500" size={28}/> Danh sách link đề thi:</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {generatedBatchResult.map((res, i) => (
                      <div key={i} className="p-5 bg-slate-50 rounded-2xl flex justify-between items-center border border-transparent hover:border-teal-200 transition-all">
                        <span className="font-bold text-slate-700 truncate mr-4">{res.name}</span>
                        <div className="flex gap-2">
                          <button onClick={() => window.open(res.link)} className="p-3 text-teal-600 bg-white rounded-xl border border-slate-200 hover:bg-teal-50 transition-all"><Eye size={18}/></button>
                          <button onClick={() => {navigator.clipboard.writeText(res.link); alert('Đã Copy Link!');}} className="p-3 text-teal-600 bg-white rounded-xl border border-slate-200 hover:bg-teal-50 transition-all"><Copy size={18}/></button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'students' && (
             <div className="space-y-6">
                <div className="flex justify-between items-center">
                  <h2 className="text-3xl font-black text-slate-800">Danh sách học sinh</h2>
                  <div className="bg-teal-100 text-teal-700 px-5 py-2 rounded-2xl font-black text-sm">Tổng cộng: {students.length}</div>
                </div>
                <div className="bg-white rounded-3xl shadow-sm border border-slate-200 overflow-hidden">
                  <table className="w-full text-left">
                    <thead className="bg-slate-50 border-b">
                      <tr>
                        <th className="p-5 text-xs font-black text-slate-400 uppercase tracking-widest">Họ và Tên</th>
                        <th className="p-5 text-xs font-black text-slate-400 uppercase tracking-widest">Lớp</th>
                        <th className="p-5 text-xs font-black text-slate-400 uppercase tracking-widest text-right">Điểm tích lũy</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {students.map((s, i) => (
                        <tr key={i} className="hover:bg-teal-50/10 transition-colors">
                          <td className="p-5 font-black text-slate-700">{s.name}</td>
                          <td className="p-5 text-slate-400 font-bold">{s.class}</td>
                          <td className="p-5 text-right font-mono font-black text-teal-600 text-lg">{s.totalScore}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
             </div>
          )}
        </main>
      </div>

      {/* MODAL IMPORT OCR */}
      {importMode && (
         <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-md flex items-center justify-center z-50 p-6 animate-fade-in">
             <div className="bg-white rounded-[2rem] w-full max-w-5xl h-[85vh] flex flex-col shadow-2xl border border-white/20">
                <div className="p-8 border-b border-slate-100 flex justify-between items-center bg-white rounded-t-[2rem]">
                   <div>
                      <h3 className="text-2xl font-black text-slate-800 flex items-center gap-3"><FileUp className="text-teal-600"/> Nhập đề thi từ File</h3>
                      <p className="text-slate-400 text-sm mt-1">Hỗ trợ Word (.docx), PDF và Ảnh. Hệ thống tự động nhận diện công thức LaTeX.</p>
                   </div>
                   <button onClick={() => setImportMode(false)} className="bg-slate-100 p-2 rounded-full hover:bg-slate-200 text-slate-500"><XCircle size={24}/></button>
                </div>

                <div className="flex-1 overflow-hidden flex">
                   {/* Left: Upload Area */}
                   <div className="w-1/3 bg-slate-50 p-8 border-r border-slate-100 flex flex-col">
                      <div className="border-2 border-dashed border-teal-300 bg-teal-50 rounded-2xl h-48 flex flex-col items-center justify-center cursor-pointer hover:bg-teal-100 transition relative group">
                          <input type="file" accept=".docx,.pdf,.png,.jpg,.jpeg" onChange={handleFileImport} className="absolute inset-0 opacity-0 cursor-pointer" disabled={isProcessingFile} />
                          {isProcessingFile ? (
                              <div className="text-center">
                                  <Loader2 className="animate-spin text-teal-600 mx-auto mb-2" size={32}/>
                                  <span className="text-teal-700 font-bold text-sm">{importStatus}</span>
                              </div>
                          ) : (
                              <div className="text-center group-hover:scale-105 transition">
                                  <div className="bg-white p-3 rounded-full shadow-sm inline-block mb-3"><FileUp size={24} className="text-teal-600"/></div>
                                  <p className="font-bold text-teal-800">Chọn file để tải lên</p>
                                  <p className="text-xs text-teal-600 mt-1">Word, PDF hoặc Ảnh</p>
                              </div>
                          )}
                      </div>
                      
                      <div className="mt-6 space-y-4">
                         <h4 className="font-black text-slate-700 text-sm uppercase">Cài đặt mặc định</h4>
                         <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-400">Khối lớp</label>
                            <select className="w-full p-3 rounded-xl border border-slate-200 bg-white font-bold text-slate-700 text-sm">
                               {GRADES.map(g => <option key={g} value={g}>Lớp {g}</option>)}
                            </select>
                         </div>
                         <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-400">Chủ đề chung</label>
                            <input type="text" className="w-full p-3 rounded-xl border border-slate-200 bg-white font-bold text-slate-700 text-sm" placeholder="VD: Hàm số" />
                         </div>
                      </div>
                      
                      <div className="mt-auto pt-6 border-t border-slate-200">
                         <div className="flex items-center gap-2 text-slate-500 text-xs mb-4 bg-yellow-50 p-3 rounded-lg border border-yellow-100">
                            <FileType size={16} className="text-yellow-600 shrink-0"/>
                            <span>Mẹo: File Word sẽ giữ định dạng tốt nhất. PDF/Ảnh dùng AI để nhận diện.</span>
                         </div>
                         <Button onClick={handleSaveImported} disabled={importedQuestions.length === 0} fullWidth className="bg-teal-600 shadow-teal-200 h-12 rounded-xl flex items-center justify-center gap-2">
                            <Save size={18}/> Lưu {importedQuestions.length} câu hỏi
                         </Button>
                      </div>
                   </div>

                   {/* Right: Preview List */}
                   <div className="flex-1 bg-white p-8 overflow-y-auto custom-scrollbar">
                      <div className="flex justify-between items-center mb-6">
                         <h4 className="font-black text-slate-800 text-lg">Xem trước kết quả ({importedQuestions.length})</h4>
                         {importedQuestions.length > 0 && <button onClick={() => setImportedQuestions([])} className="text-red-500 text-sm font-bold hover:underline">Xóa tất cả</button>}
                      </div>
                      
                      {importedQuestions.length === 0 ? (
                         <div className="h-64 flex flex-col items-center justify-center text-slate-300 border-2 border-dashed border-slate-100 rounded-3xl">
                            <LayoutList size={48} className="mb-4 opacity-50"/>
                            <p className="font-medium">Chưa có câu hỏi nào được trích xuất.</p>
                         </div>
                      ) : (
                         <div className="space-y-4">
                            {importedQuestions.map((q, idx) => (
                               <div key={idx} className="p-6 border border-slate-200 rounded-2xl bg-white shadow-sm hover:border-teal-300 transition group relative">
                                  <button onClick={() => removeImportedQuestion(idx)} className="absolute top-4 right-4 text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition"><Trash2 size={18}/></button>
                                  <div className="flex gap-3 mb-3">
                                     <span className="bg-teal-100 text-teal-700 text-[10px] font-black px-2 py-1 rounded uppercase">{q.question_type}</span>
                                     <span className="bg-slate-200 text-slate-600 text-[10px] font-bold px-2 py-1 rounded">{q.level}</span>
                                  </div>
                                  <div className="font-medium text-slate-900 mb-3"><MathText content={q.question_text || ''} /></div>
                                  {q.question_type === 'Trắc nghiệm' && (
                                     <div className="grid grid-cols-2 gap-2 text-sm text-slate-700">
                                        <div className={q.answer_key === 'A' ? 'text-teal-600 font-bold' : ''}>A. <MathText content={q.option_A || ''}/></div>
                                        <div className={q.answer_key === 'B' ? 'text-teal-600 font-bold' : ''}>B. <MathText content={q.option_B || ''}/></div>
                                        <div className={q.answer_key === 'C' ? 'text-teal-600 font-bold' : ''}>C. <MathText content={q.option_C || ''}/></div>
                                        <div className={q.answer_key === 'D' ? 'text-teal-600 font-bold' : ''}>D. <MathText content={q.option_D || ''}/></div>
                                     </div>
                                  )}
                               </div>
                            ))}
                         </div>
                      )}
                   </div>
                </div>
             </div>
         </div>
      )}

      {/* MODAL EDIT CÂU HỎI */}
      {editingQuestion && (
        <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-md flex items-center justify-center z-50 p-6">
          <div className="bg-white rounded-[2.5rem] w-full max-w-7xl max-h-[92vh] overflow-hidden shadow-2xl flex border border-white/20 animate-fade-in">
            <div className="flex-1 p-10 overflow-y-auto border-r border-slate-100 custom-scrollbar">
               <h3 className="text-3xl font-black text-slate-800 mb-8 flex items-center gap-4"><Edit className="text-teal-600" size={32}/> Chỉnh sửa câu hỏi</h3>
               <div className="space-y-8">
                  <div className="grid grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Dạng câu hỏi</label>
                      <select className="w-full p-5 bg-white border border-slate-300 rounded-3xl font-bold text-slate-900 focus:ring-2 ring-teal-500" value={editingQuestion.question_type} onChange={e => setEditingQuestion({...editingQuestion, question_type: e.target.value as any})}>
                        <option value="Trắc nghiệm">Trắc nghiệm</option>
                        <option value="Đúng/Sai">Đúng/Sai</option>
                        <option value="Trả lời ngắn">Trả lời ngắn</option>
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Mức độ tư duy</label>
                      <select className="w-full p-5 bg-white border border-slate-300 rounded-3xl font-bold text-slate-900 focus:ring-2 ring-teal-500" value={editingQuestion.level} onChange={e => setEditingQuestion({...editingQuestion, level: e.target.value})}>
                        {LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
                      </select>
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Nội dung (Hỗ trợ LaTeX $...$)</label>
                    <textarea className="w-full p-6 bg-white border border-slate-300 rounded-[2rem] h-40 font-medium text-slate-900 focus:ring-2 ring-teal-500 outline-none leading-relaxed" value={editingQuestion.question_text} onChange={e => setEditingQuestion({...editingQuestion, question_text: e.target.value})} placeholder="Nhập đề bài tại đây..." />
                  </div>

                  {(editingQuestion.question_type === 'Trắc nghiệm' || editingQuestion.question_type === 'Đúng/Sai') && (
                    <div className="grid grid-cols-2 gap-6">
                       {['A', 'B', 'C', 'D'].map(opt => (
                         <div key={opt} className="space-y-2">
                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{editingQuestion.question_type === 'Trắc nghiệm' ? `Lựa chọn ${opt}` : `Mệnh đề ${opt}`}</label>
                            <input className="w-full p-5 bg-white border border-slate-300 rounded-3xl font-medium text-slate-900 focus:ring-2 ring-teal-500" value={editingQuestion[`option_${opt}` as keyof Question] as string} onChange={e => setEditingQuestion({...editingQuestion, [`option_${opt}` as keyof Question]: e.target.value})} />
                         </div>
                       ))}
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Đáp án đúng</label>
                      <input className="w-full p-5 bg-teal-50 border border-teal-200 rounded-3xl font-black text-teal-900 placeholder:text-teal-400 focus:ring-2 ring-teal-500" value={editingQuestion.answer_key} onChange={e => setEditingQuestion({...editingQuestion, answer_key: e.target.value})} placeholder={editingQuestion.question_type === 'Đúng/Sai' ? 'Đ-S-Đ-S' : 'A'} />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                       <div className="space-y-2"><label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Lớp</label><select className="w-full p-5 bg-white border border-slate-300 rounded-3xl font-bold text-slate-900" value={editingQuestion.grade} onChange={e => setEditingQuestion({...editingQuestion, grade: Number(e.target.value)})}>{GRADES.map(g => <option key={g} value={g}>{g}</option>)}</select></div>
                       <div className="space-y-2"><label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Chủ đề</label><input className="w-full p-5 bg-white border border-slate-300 rounded-3xl font-bold text-slate-900" value={editingQuestion.topic} onChange={e => setEditingQuestion({...editingQuestion, topic: e.target.value})} /></div>
                    </div>
                  </div>
               </div>

               <div className="flex gap-4 mt-12">
                  <Button onClick={handleSaveEdit} className="bg-teal-600 flex-1 h-16 text-lg rounded-3xl shadow-lg shadow-teal-50">Cập nhật hệ thống</Button>
                  <Button onClick={() => setEditingQuestion(null)} variant="secondary" className="px-10 rounded-3xl h-16">Hủy</Button>
               </div>
            </div>

            <div className="w-[450px] bg-white p-10 overflow-y-auto custom-scrollbar border-l border-slate-100">
               <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-8 flex items-center gap-3"><Eye size={16}/> Xem trước nội dung</h3>
               <div className="bg-slate-50 p-8 rounded-[2rem] shadow-inner border border-slate-200 min-h-[500px] flex flex-col">
                  <div className="text-[10px] font-black bg-teal-100 text-teal-700 px-3 py-1 rounded-lg inline-block mb-4 uppercase self-start">{editingQuestion.question_type}</div>
                  <div className="text-lg font-bold text-slate-900 leading-relaxed mb-8"><MathText content={editingQuestion.question_text || 'Chưa có nội dung...'} /></div>
                  
                  {editingQuestion.question_type === 'Trắc nghiệm' && (
                    <div className="space-y-3">
                       {['A', 'B', 'C', 'D'].map(opt => (
                         <div key={opt} className="p-4 border border-slate-200 rounded-2xl text-sm flex gap-3 bg-white shadow-sm">
                            <span className="font-black text-teal-700">{opt}.</span>
                            <div className="text-slate-900 font-medium w-full">
                                <MathText content={editingQuestion[`option_${opt}` as keyof Question] as string || ''} />
                            </div>
                         </div>
                       ))}
                    </div>
                  )}

                  {editingQuestion.question_type === 'Đúng/Sai' && (
                    <div className="space-y-4 mt-4">
                       {['A', 'B', 'C', 'D'].map(opt => (
                         <div key={opt} className="p-4 border border-slate-200 rounded-2xl text-xs bg-white shadow-sm">
                            <div className="font-black mb-2 text-teal-700">{opt})</div>
                            <div className="text-slate-900 font-medium w-full">
                                <MathText content={editingQuestion[`option_${opt}` as keyof Question] as string || ''} />
                            </div>
                         </div>
                       ))}
                    </div>
                  )}

                  {editingQuestion.question_type === 'Trả lời ngắn' && (
                    <div className="mt-auto pt-6 border-t border-dashed border-slate-300 text-xs text-slate-500 italic flex items-center gap-2"><Send size={14}/> Ô nhập liệu của học sinh...</div>
                  )}
               </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};