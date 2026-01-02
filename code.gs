// ============================================================================
// LMS THẦY PHÚC - GOOGLE APPS SCRIPT V9.4 (FINAL PRODUCTION)
// ============================================================================

// ID của Google Sheet cơ sở dữ liệu
const SPREADSHEET_ID = '19FjZ_DcJQD-j00JYsO7co1yaxwq58BTfgMTj1CGvm-c';

// Tên các Sheet
const SHEET_NAMES = {
  USERS: 'Users',
  QUESTIONS: 'Questions',
  THEORY: 'Theory',
  SESSIONS: 'Sessions',
  VIOLATIONS: 'Violations',
  RESULTS: 'Results',
  DOCUMENTS: 'Documents',
  EXAM_LINKS: 'ExamLinks'
};

// ============================================================================
// 1. HTTP HANDLERS & ROUTING
// ============================================================================

function doGet(e) {
  try {
    if (!e || !e.parameter || Object.keys(e.parameter).length === 0) {
       return createResponse('success', { message: 'LMS API V9.4 Online - Ready' });
    }
    const action = e.parameter.action;
    let payload = e.parameter;
    
    // Hỗ trợ JSON payload qua GET (cho các request dài để tránh lỗi URI too long)
    if (e.parameter.payload) {
      try { 
        const parsed = JSON.parse(e.parameter.payload); 
        payload = { ...payload, ...parsed };
      } catch (err) {}
    }
    return handleAction(action, payload);
  } catch (error) {
    return createResponse('error', null, error.toString());
  }
}

function doPost(e) {
  try {
    let data = {};
    if (e.postData && e.postData.contents) {
      try { data = JSON.parse(e.postData.contents); } catch (err) { return createResponse('error', null, 'Invalid JSON body'); }
    } else if (e.parameter) {
      data = e.parameter;
    }
    const action = data.action || e.parameter.action;
    return handleAction(action, data);
  } catch (error) {
    return createResponse('error', null, error.toString());
  }
}

function handleAction(action, data) {
  try {
    switch(action) {
      // --- AUTHENTICATION ---
      case 'login': return handleLogin(data.email, data.password, data.deviceId);
      case 'validateSession': return handleValidateSession(data.email, data.sessionToken);
      case 'heartbeat': return handleHeartbeat(data.email, data.sessionToken);
      case 'logout': return handleLogout(data.email, data.sessionToken);
      
      // --- QUIZ SYSTEM (STUDENT) ---
      case 'getQuestions': return handleGetQuestions(data.grade, data.topic, data.level);
      case 'getTopics': return handleGetTopics(data.grade);
      case 'getTheory': return handleGetTheory(data.grade, data.topic, data.level);
      case 'getUserProgress': return handleGetUserProgress(data.email);
      case 'submitQuiz': return handleSubmitQuiz(data);
      
      // --- QUESTION BANK MANAGEMENT (ADMIN) ---
      case 'getAllQuestions': return handleGetAllQuestions(); // Dùng cho Ma trận đề thi (Client filter)
      case 'getFilteredQuestions': return handleGetFilteredQuestions(data.grade, data.topic);
      case 'saveQuestion': return handleSaveQuestion(data);
      case 'deleteQuestion': return handleDeleteQuestion(data.exam_id);
      
      // --- THEORY MANAGEMENT (ADMIN) ---
      case 'saveTheory': return handleSaveTheory(data);
      
      // --- STUDENT & RESULT MANAGEMENT (ADMIN) ---
      case 'getAllStudents': return handleGetAllStudents();
      case 'getStudentResults': return handleGetStudentResults(data.email);
      
      // --- DOCUMENTS & OCR (ADMIN) ---
      case 'saveDocument': return handleSaveDocument(data);
      case 'getAllDocuments': return handleGetAllDocuments();
      case 'deleteDocument': return handleDeleteDocument(data.id);
      case 'ocr': return handleOCR(data); 
      
      // --- EXAM CREATOR (MATRIX SUPPORTED) ---
      case 'createInstantExam': return handleCreateInstantExam(data);
      case 'getExamByLink': return handleGetExamByLink(data.examId);
      
      // --- MONITORING & UTILS ---
      case 'reportViolation': return handleReportViolation(data);
      case 'getLeaderboard': return handleGetLeaderboard(data.limit);
      case 'ping': return createResponse('success', { message: 'pong', time: new Date().toISOString() });
      
      default: return createResponse('error', null, 'Unknown action: ' + action);
    }
  } catch (error) {
    Logger.log(error);
    return createResponse('error', null, 'System Error: ' + error.toString());
  }
}

// ============================================================================
// 2. AUTHENTICATION LOGIC
// ============================================================================

function handleLogin(email, password, deviceId) {
  if (!email) return createResponse('error', null, 'Missing email');
  const cleanEmail = email.trim().toLowerCase();
  const sheet = getSheet(SHEET_NAMES.USERS);
  const data = sheet.getDataRange().getValues();
  let user = null;
  
  // Tìm user
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).toLowerCase() === cleanEmail) {
      const storedPass = String(data[i][8]);
      if (storedPass && String(password) !== storedPass) return createResponse('error', null, 'Sai mật khẩu');
      
      user = { 
        email: data[i][0], 
        name: data[i][1], 
        class: data[i][2], 
        avatar: data[i][3], 
        totalScore: Number(data[i][4] || 0), 
        currentLevel: Number(data[i][5] || 1), 
        progress: safeParseJSON(data[i][6], {}), 
        role: data[i][7] || 'student' 
      };
      break;
    }
  }
  
  // Auto register nếu chưa có
  if (!user) {
    const newPass = String(password) || '123456789';
    const role = (cleanEmail.startsWith('admin') || cleanEmail.startsWith('giaovien')) ? 'teacher' : 'student';
    user = { 
      email: cleanEmail, name: cleanEmail.split('@')[0], class: '12', avatar: '', 
      totalScore: 0, currentLevel: 1, progress: {}, role: role 
    };
    sheet.appendRow([user.email, user.name, user.class, user.avatar, user.totalScore, user.currentLevel, JSON.stringify(user.progress), user.role, newPass]);
  }
  
  invalidateUserSessions(user.email);
  const sessionToken = Utilities.getUuid();
  const sessionsSheet = getSheet(SHEET_NAMES.SESSIONS);
  sessionsSheet.appendRow([user.email, sessionToken, deviceId, new Date().toISOString(), 'active', '', new Date().toISOString()]);
  
  return createResponse('success', { user, sessionToken });
}

function handleValidateSession(email, token) { 
  const sessionsSheet = getSheet(SHEET_NAMES.SESSIONS); 
  const data = sessionsSheet.getDataRange().getValues(); 
  for (let i = data.length - 1; i >= 1; i--) { 
    if (data[i][0] === email && data[i][1] === token) { 
      return createResponse('success', { valid: data[i][4] === 'active', user: { email } }); 
    } 
  } 
  return createResponse('success', { valid: false }); 
}

function handleHeartbeat(email, token) { 
  const sessionsSheet = getSheet(SHEET_NAMES.SESSIONS); 
  const data = sessionsSheet.getDataRange().getValues(); 
  for (let i = data.length - 1; i >= 1; i--) { 
    if (data[i][0] === email && data[i][1] === token) { 
      if (data[i][4] !== 'active') return createResponse('success', { valid: false, reason: 'session_conflict' }); 
      sessionsSheet.getRange(i + 1, 7).setValue(new Date().toISOString()); 
      return createResponse('success', { valid: true }); 
    } 
  } 
  return createResponse('success', { valid: false }); 
}

function handleLogout(email, token) { 
  const sessionsSheet = getSheet(SHEET_NAMES.SESSIONS); 
  const data = sessionsSheet.getDataRange().getValues(); 
  for (let i = data.length - 1; i >= 1; i--) { 
    if (data[i][0] === email && data[i][1] === token) { 
      sessionsSheet.getRange(i + 1, 5).setValue('logged_out'); 
      sessionsSheet.getRange(i + 1, 6).setValue(new Date().toISOString()); 
      break; 
    } 
  } 
  return createResponse('success', { loggedOut: true }); 
}

function invalidateUserSessions(email) { 
  const sessionsSheet = getSheet(SHEET_NAMES.SESSIONS); 
  const data = sessionsSheet.getDataRange().getValues(); 
  for (let i = 1; i < data.length; i++) { 
    if (data[i][0] === email && data[i][4] === 'active') { 
      sessionsSheet.getRange(i + 1, 5).setValue('expired'); 
    } 
  } 
}

// ============================================================================
// 3. QUIZ & PROGRESS LOGIC
// ============================================================================

function handleGetTopics(grade) { 
  const sheet = getSheet(SHEET_NAMES.QUESTIONS); 
  const data = sheet.getDataRange().getValues(); 
  const topics = new Set(); 
  for (let i = 1; i < data.length; i++) { 
    if (parseInt(data[i][12]) === parseInt(grade) || !grade) { 
      if (data[i][11]) topics.add(data[i][11].trim()); 
    } 
  } 
  return createResponse('success', Array.from(topics).sort()); 
}

function handleGetQuestions(grade, topic, level) { 
  const sheet = getSheet(SHEET_NAMES.QUESTIONS); 
  const data = sheet.getDataRange().getValues(); 
  const questions = []; 
  const targetGrade = parseInt(grade); 
  const targetLevel = parseInt(level) || 1; 
  for (let i = 1; i < data.length; i++) { 
    if (parseInt(data[i][12]) === targetGrade && String(data[i][11]).trim() === topic) { 
      const qLevel = parseInt(data[i][13]) || 1; 
      if (qLevel === targetLevel) { 
        questions.push(rowToQuestion(data[i])); 
      } 
    } 
  } 
  shuffleArray(questions); 
  return createResponse('success', questions.slice(0, 20)); 
}

function handleSubmitQuiz(data) { 
  const resultsSheet = getSheet(SHEET_NAMES.RESULTS); 
  const resultId = Utilities.getUuid(); 
  const percentage = Math.round((data.score / data.totalQuestions) * 100); 
  const passed = percentage >= 80 && data.submissionReason === 'normal'; 
  
  resultsSheet.appendRow([
    resultId, data.email, data.topic, data.grade, data.level, data.score, 
    data.totalQuestions, percentage, passed ? 'PASS' : 'FAIL', 
    data.timeSpent, data.submissionReason, JSON.stringify(data.answers), 
    new Date().toISOString()
  ]); 
  
  if (data.submissionReason !== 'normal' && data.violations) {
    handleReportViolation({ email: data.email, type: data.submissionReason, topic: data.topic, level: data.level, details: data.violations }); 
  }
  
  let canAdvance = false; 
  let totalScore = 0; 
  
  if (data.email !== 'guest') { 
    const usersSheet = getSheet(SHEET_NAMES.USERS); 
    const users = usersSheet.getDataRange().getValues(); 
    for (let i = 1; i < users.length; i++) { 
      if (users[i][0] === data.email) { 
        const currentTotal = Number(users[i][4] || 0); 
        let currentProgress = safeParseJSON(users[i][6], {}); 
        totalScore = currentTotal + (data.score * 10); 
        
        const progressKey = `${data.grade}_${data.topic}`; 
        const currentLvl = currentProgress[progressKey] || 1; 
        
        if (passed && data.level >= currentLvl) { 
          currentProgress[progressKey] = currentLvl + 1; 
          canAdvance = true; 
        } 
        
        usersSheet.getRange(i + 1, 5).setValue(totalScore); 
        usersSheet.getRange(i + 1, 7).setValue(JSON.stringify(currentProgress)); 
        break; 
      } 
    } 
  } 
  
  const theoryResponse = handleGetTheory(data.grade, data.topic, data.level); 
  const theory = (theoryResponse && theoryResponse.status === 'success') ? theoryResponse.data : null; 
  
  return createResponse('success', { 
    passed, canAdvance, percentage, score: data.score, totalScore, theory, 
    message: passed ? 'Chúc mừng! Bạn đã hoàn thành xuất sắc.' : 'Chưa đạt yêu cầu. Hãy cố gắng hơn!' 
  }); 
}

// ============================================================================
// 4. ADMIN & CONTENT MANAGEMENT
// ============================================================================

function handleGetAllQuestions() { 
  const sheet = getSheet(SHEET_NAMES.QUESTIONS); 
  const data = sheet.getDataRange().getValues(); 
  const questions = []; 
  for (let i = 1; i < data.length; i++) { 
    if (data[i][0]) questions.push(rowToQuestion(data[i])); 
  } 
  return createResponse('success', questions.reverse()); 
}

function handleGetFilteredQuestions(grade, topic) { 
  const sheet = getSheet(SHEET_NAMES.QUESTIONS); 
  const data = sheet.getDataRange().getValues(); 
  const filtered = []; 
  for (let i = 1; i < data.length; i++) { 
    if (parseInt(data[i][12]) === parseInt(grade) && String(data[i][11]).trim() === topic) 
      filtered.push(rowToQuestion(data[i])); 
  } 
  return createResponse('success', filtered); 
}

function handleSaveQuestion(data) { 
  const sheet = getSheet(SHEET_NAMES.QUESTIONS); 
  const rows = sheet.getDataRange().getValues(); 
  const examId = data.exam_id || 'Q' + Date.now(); 
  // [exam_id, level, question_type, question_text, image_id, A, B, C, D, key, solution, topic, grade, quiz_level]
  const newRow = [
    examId, data.level, data.question_type, data.question_text, 
    data.image_id || '', data.option_A || '', data.option_B || '', data.option_C || '', data.option_D || '', 
    data.answer_key, data.solution, data.topic, data.grade, data.quiz_level || 1
  ]; 
  
  let foundIndex = -1; 
  for (let i = 1; i < rows.length; i++) { 
    if (String(rows[i][0]) === String(examId)) { foundIndex = i + 1; break; } 
  } 
  
  if (foundIndex > 0) sheet.getRange(foundIndex, 1, 1, newRow.length).setValues([newRow]); 
  else sheet.appendRow(newRow); 
  
  return createResponse('success', { exam_id: examId }); 
}

function handleDeleteQuestion(examId) { 
  const sheet = getSheet(SHEET_NAMES.QUESTIONS); 
  const rows = sheet.getDataRange().getValues(); 
  for (let i = 1; i < rows.length; i++) { 
    if (String(rows[i][0]) === String(examId)) { 
      sheet.deleteRow(i + 1); 
      return createResponse('success', { deleted: true }); 
    } 
  } 
  return createResponse('error', null, 'Question not found'); 
}

function handleSaveTheory(data) { 
  const sheet = getSheet(SHEET_NAMES.THEORY); 
  const rows = sheet.getDataRange().getValues(); 
  let foundIndex = -1; 
  for(let i = 1; i < rows.length; i++) { 
    if(parseInt(rows[i][0]) === parseInt(data.grade) && String(rows[i][1]).trim() === String(data.topic).trim() && parseInt(rows[i][2]) === parseInt(data.level)) { 
      foundIndex = i + 1; break; 
    } 
  } 
  const rowData = [data.grade, data.topic, data.level, data.title, data.content, data.examples || '', data.tips || '' ]; 
  if (foundIndex > 0) sheet.getRange(foundIndex, 1, 1, rowData.length).setValues([rowData]); 
  else sheet.appendRow(rowData); 
  return createResponse('success', { message: 'Saved theory' }); 
}

function handleGetTheory(grade, topic, level) { 
  const sheet = getSheet(SHEET_NAMES.THEORY); 
  const data = sheet.getDataRange().getValues(); 
  for (let i = 1; i < data.length; i++) { 
    if (parseInt(data[i][0]) === parseInt(grade) && String(data[i][1]).trim() === topic && parseInt(data[i][2]) === parseInt(level)) { 
      return createResponse('success', { 
        grade: data[i][0], topic: data[i][1], level: data[i][2], 
        title: data[i][3], content: data[i][4], examples: data[i][5], tips: data[i][6] 
      }); 
    } 
  } 
  return createResponse('success', null); 
}

// ============================================================================
// 5. DOCUMENTS & OCR
// ============================================================================

function handleSaveDocument(data) { const sheet = getSheet(SHEET_NAMES.DOCUMENTS); const id = 'DOC_' + Date.now(); sheet.appendRow([id, data.name, data.content, new Date().toISOString()]); return createResponse('success', { id }); }
function handleGetAllDocuments() { const sheet = getSheet(SHEET_NAMES.DOCUMENTS); const data = sheet.getDataRange().getValues(); const docs = []; for (let i = 1; i < data.length; i++) { docs.push({ id: data[i][0], name: data[i][1], content: data[i][2], uploadedAt: data[i][3] }); } return createResponse('success', docs.reverse()); }
function handleDeleteDocument(id) { const sheet = getSheet(SHEET_NAMES.DOCUMENTS); const data = sheet.getDataRange().getValues(); for (let i = 1; i < data.length; i++) { if (data[i][0] === id) { sheet.deleteRow(i + 1); return createResponse('success', { deleted: true }); } } return createResponse('error', null, 'Doc not found'); }

function handleOCR(data) {
  try {
    const fileName = data.fileName || 'temp_file';
    const mimeType = data.mimeType || 'application/pdf';
    const base64Content = data.fileContent;
    
    if (!base64Content) return createResponse('error', null, 'Empty content');

    const blob = Utilities.newBlob(Utilities.base64Decode(base64Content), mimeType, fileName);
    
    // Yêu cầu Advanced Drive Service (Drive API) phải được bật trong Resources > Advanced Google Services
    const resource = { title: fileName, mimeType: mimeType };
    const file = Drive.Files.insert(resource, blob, { ocr: true, ocrLanguage: 'vi' });
    
    const doc = DocumentApp.openById(file.id);
    const text = doc.getBody().getText();
    
    // Cleanup: Xóa file tạm để tiết kiệm dung lượng
    Drive.Files.remove(file.id);
    
    return createResponse('success', { allMarkdownDataUri: text });
  } catch (e) {
    return createResponse('error', null, 'OCR Error: ' + e.toString() + ' (Ensure Drive API is enabled in Services)');
  }
}

// ============================================================================
// 6. EXAM CREATOR (Hỗ trợ cấu trúc động/Matrix)
// ============================================================================

function handleCreateInstantExam(data) { 
  if (!data.questions || data.questions.length === 0) return createResponse('error', null, 'Empty questions'); 
  
  try { 
    const fileName = `EXAM_${Date.now()}_${Math.floor(Math.random()*1000)}.json`; 
    const fileContent = JSON.stringify({ 
      title: data.title, grade: data.grade, questions: data.questions, createdAt: new Date().toISOString() 
    }); 
    
    let folder; 
    const folders = DriveApp.getFoldersByName("LMS_Exams"); 
    if (folders.hasNext()) folder = folders.next(); 
    else folder = DriveApp.createFolder("LMS_Exams"); 
    
    const file = folder.createFile(fileName, fileContent, MimeType.PLAIN_TEXT); 
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); 
    
    const examId = 'E_' + Math.random().toString(36).substring(2, 8).toUpperCase(); 
    const sheet = getSheet(SHEET_NAMES.EXAM_LINKS); 
    sheet.appendRow([examId, data.title || 'Đề thi không tên', data.grade || 12, file.getId(), new Date().toISOString(), data.questions.length]); 
    
    return createResponse('success', { examId: examId, message: 'Created' }); 
  } catch (e) { 
    return createResponse('error', null, 'Drive Error: ' + e.toString()); 
  } 
}

function handleGetExamByLink(examId) { 
  if (!examId) return createResponse('error', null, 'Missing Exam ID'); 
  const cleanId = String(examId).trim(); 
  const sheet = getSheet(SHEET_NAMES.EXAM_LINKS); 
  const data = sheet.getDataRange().getValues(); 
  let fileId = null; 
  
  for (let i = 1; i < data.length; i++) { 
    if (String(data[i][0]).trim() === cleanId) { fileId = data[i][3]; break; } 
  } 
  
  if (!fileId) return createResponse('error', null, 'Exam ID not found'); 
  
  try { 
    const file = DriveApp.getFileById(fileId); 
    const content = file.getBlob().getDataAsString(); 
    const json = JSON.parse(content); 
    return createResponse('success', json); 
  } catch (e) { 
    return createResponse('error', null, 'File access error: ' + e.toString()); 
  } 
}

// ============================================================================
// 7. UTILS & HELPERS
// ============================================================================

function handleGetAllStudents() { const sheet = getSheet(SHEET_NAMES.USERS); const data = sheet.getDataRange().getValues(); const students = []; for (let i = 1; i < data.length; i++) { if (data[i][7] === 'student') students.push({ email: data[i][0], name: data[i][1], class: data[i][2], totalScore: data[i][4] }); } return createResponse('success', students); }
function handleGetStudentResults(email) { const sheet = getSheet(SHEET_NAMES.RESULTS); const data = sheet.getDataRange().getValues(); const results = []; for (let i = 1; i < data.length; i++) { if (data[i][1] === email) results.push({ resultId: data[i][0], topic: data[i][2], grade: data[i][3], level: data[i][4], score: data[i][5], total: data[i][6], percentage: data[i][7], passed: data[i][8] === 'PASS', timeSpent: data[i][9], timestamp: data[i][12] }); } return createResponse('success', results.reverse()); }
function handleGetLeaderboard(limit = 20) { const sheet = getSheet(SHEET_NAMES.USERS); const data = sheet.getDataRange().getValues(); const students = []; for (let i = 1; i < data.length; i++) { if (data[i][7] === 'student' && data[i][0]) students.push({ email: data[i][0], name: data[i][1], class: data[i][2], avatar: data[i][3], totalScore: Number(data[i][4] || 0) }); } students.sort((a, b) => b.totalScore - a.totalScore); return createResponse('success', students.slice(0, limit)); }
function handleGetUserProgress(email) { const sheet = getSheet(SHEET_NAMES.USERS); const data = sheet.getDataRange().getValues(); for (let i = 1; i < data.length; i++) { if (data[i][0] === email) return createResponse('success', { totalScore: Number(data[i][4]), currentLevel: Number(data[i][5]), progress: safeParseJSON(data[i][6], {}) }); } return createResponse('error', null, 'User not found'); }
function handleReportViolation(data) { const sheet = getSheet(SHEET_NAMES.VIOLATIONS); sheet.appendRow([Utilities.getUuid(), data.email, data.type, data.quizInfo?.topic || '', data.quizInfo?.level || '', JSON.stringify(data.details), new Date().toISOString()]); return createResponse('success', {}); }

function getSheet(name) { 
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID); 
  let sheet = ss.getSheetByName(name); 
  if (!sheet) { 
    sheet = ss.insertSheet(name); 
    SpreadsheetApp.flush(); 
    initializeSheet(sheet, name); 
  } 
  return sheet; 
}

function initializeSheet(sheet, name) { 
  const headers = { 
    [SHEET_NAMES.USERS]: ['Email', 'Name', 'Class', 'Avatar', 'TotalScore', 'CurrentLevel', 'Progress', 'Role', 'Password'], 
    [SHEET_NAMES.QUESTIONS]: ['exam_id', 'level', 'question_type', 'question_text', 'image_id', 'option_A', 'option_B', 'option_C', 'option_D', 'answer_key', 'solution', 'topic', 'grade', 'quiz_level'], 
    [SHEET_NAMES.RESULTS]: ['result_id', 'email', 'topic', 'grade', 'level', 'score', 'total', 'percentage', 'status', 'time_spent', 'submission_reason', 'answers', 'timestamp'], 
    [SHEET_NAMES.SESSIONS]: ['email', 'token', 'device', 'login_time', 'status', 'logout_time', 'last_heartbeat'], 
    [SHEET_NAMES.VIOLATIONS]: ['id', 'email', 'type', 'topic', 'level', 'details', 'timestamp'], 
    [SHEET_NAMES.THEORY]: ['grade', 'topic', 'level', 'title', 'content', 'examples', 'tips'], 
    [SHEET_NAMES.DOCUMENTS]: ['id', 'name', 'content', 'uploaded_at'], 
    [SHEET_NAMES.EXAM_LINKS]: ['exam_id', 'title', 'grade', 'file_id', 'created_at', 'question_count'] 
  }; 
  if (headers[name]) { 
    sheet.appendRow(headers[name]); 
    sheet.getRange(1, 1, 1, headers[name].length).setFontWeight('bold').setBackground('#ccfbf1'); 
  } 
}

function createResponse(status, data, message) { 
  return ContentService.createTextOutput(JSON.stringify({ status, data, message: message || '' })).setMimeType(ContentService.MimeType.JSON); 
}

function safeParseJSON(str, fallback) { 
  try { return JSON.parse(str); } catch (e) { return fallback; } 
}

function rowToQuestion(row) { 
  return { 
    exam_id: row[0], level: row[1], question_type: row[2], question_text: row[3], 
    image_id: row[4], option_A: row[5], option_B: row[6], option_C: row[7], option_D: row[8], 
    answer_key: row[9], solution: row[10], topic: row[11], grade: row[12], quiz_level: row[13] 
  }; 
}

function shuffleArray(array) { 
  for (let i = array.length - 1; i > 0; i--) { 
    const j = Math.floor(Math.random() * (i + 1)); 
    [array[i], array[j]] = [array[j], array[i]]; 
  } 
}