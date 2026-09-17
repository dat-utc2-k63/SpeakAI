import { supabase } from './supabase.js';
        import { signOut, getProfile, updateProfile } from './auth.js';
        import {
          fetchMyStudents, fetchTeacherStats, uploadConversationAudio,
          createAssessment, saveAssessment, fetchSavedAssessments, deleteAssessment,
          uploadAudioUrlToSupabase
        } from './teacher.js';
        import { fetchStudentProfile, fetchStudentAssessments, fetchStudentStats } from './student.js';
        import { ENROLLMENT_SENTENCES, uploadVoiceSample, markVoiceEnrolled } from './voice.js';
        import { fetchEmbeddingFromBackend, cosineSimilarity } from './voice.js';
        import {
          fetchQuestionSets, createQuestionSet, updateQuestionSet, deleteQuestionSet,
          togglePublishSet, fetchQuestions, addQuestion, updateQuestion, deleteQuestion,
          updateQuestionSetPermissions, fetchTeachersList,
          TASK_TYPES, getAvailableTaskTypes
        } from './question_sets.js';
        import {
          fetchPublishedSets, fetchSetWithQuestions, startSession, saveAnswer,
          completeSession, fetchSessionHistory, fetchSessionDetail,
          uploadPracticeAudio, assessSingleAnswer, detectVoiceActivity,
          playBeep, playStartTone, playEndTone, calculateBandScore,
          fetchActiveSession, cancelSession
        } from './practice.js';
        import {
          evaluateAnswerWithGemini, evaluateConversationWithAi, getGeminiConfig, saveLocalGeminiConfig,
          testGeminiConnection, DEFAULT_GEMINI_ENDPOINT, DEFAULT_GEMINI_MODEL
        } from './gemini_eval.js';


        // ── AUTH GUARD ────────────────────────────────────────────
        let currentUser = null;
        let currentProfile = null;

        function hasVoiceEnrolled(u) {
          if (!u) return false;
          if (u.voice_enrolled === true) return true;
          if (u.voice_embeddings) {
            if (Array.isArray(u.voice_embeddings) && u.voice_embeddings.length > 0) return true;
            if (typeof u.voice_embeddings === 'string' && u.voice_embeddings.trim().length > 10) return true;
          }
          if (u.voice_sample_url && typeof u.voice_sample_url === 'string' && u.voice_sample_url.trim() !== '') return true;
          return false;
        }

        function escapeHtml(str) {
          if (!str) return '';
          return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
        }

        function buildTaskQuestionCardContent(q) {
          const taskType = q.task_type || 'short_qa';
          const qText = escapeHtml(q.question_text || '');
          const refText = (q.reference_text || '').trim();
          const imgUrl = (q.image_url || '').trim();

          if (taskType === 'read_aloud') {
            return `
              <div class="read-aloud-box mb-3">
                <div class="read-aloud-header">
                  <i class="bi bi-volume-up-fill me-1"></i>VĂN BẢN CẦN ĐỌC TO (READING PASSAGE)
                </div>
                <div class="read-aloud-text">${qText}</div>
              </div>
              <div class="text-muted small fst-italic">
                <i class="bi bi-info-circle me-1"></i>Yêu cầu: Phát âm chuẩn xác, ngữ điệu tự nhiên, ngắt nghỉ đúng câu.
              </div>
            `;
          }

          if (taskType === 'picture_description') {
            return `
              <div class="question-text mb-3">${qText}</div>
              ${imgUrl ? `
                <div class="question-image-box mb-3">
                  <img src="${escapeHtml(imgUrl)}" alt="Đề thi hình ảnh" class="question-image img-fluid" loading="lazy" />
                </div>
              ` : ''}
              <div class="text-muted small fst-italic">
                <i class="bi bi-eye me-1"></i>Hãy quan sát bức tranh và miêu tả chi tiết về con người, bối cảnh và hành động đang diễn ra.
              </div>
            `;
          }

          if (taskType === 'information_qa') {
            return `
              ${refText ? `
                <div class="info-doc-box mb-3">
                  <div class="info-doc-header">
                    <i class="bi bi-file-earmark-text-fill me-2"></i>TÀI LIỆU DỮ LIỆU CHO SẴN (REFERENCE DOCUMENT)
                  </div>
                  <div class="info-doc-content">${escapeHtml(refText)}</div>
                </div>
              ` : ''}
              <div class="info-qa-prompt mt-2">
                <div class="text-warning small fw-bold text-uppercase mb-1">
                  <i class="bi bi-question-circle me-1"></i>Câu hỏi truy vấn thông tin:
                </div>
                <div class="question-text">${qText}</div>
              </div>
            `;
          }

          if (taskType === 'long_turn') {
            const bulletItems = refText ? refText.split('\n').filter(line => line.trim()) : [];
            return `
              <div class="cue-card-box mb-3">
                <div class="cue-card-badge">
                  <i class="bi bi-card-checklist me-1"></i>CUE CARD TOPIC • 1-2 PHÚT NÓI
                </div>
                <div class="cue-card-topic">${qText}</div>
                ${bulletItems.length > 0 ? `
                  <div class="cue-card-subheading">You should say:</div>
                  <ul class="cue-card-bullet-list">
                    ${bulletItems.map(item => `
                      <li class="cue-card-bullet-item">${escapeHtml(item.replace(/^[-*•]\s*/, ''))}</li>
                    `).join('')}
                  </ul>
                ` : ''}
                <div class="mt-3 small text-muted fst-italic">
                  <i class="bi bi-pencil-square me-1"></i>Hãy tận dụng thời gian chuẩn bị để vạch ra các ý chính trước khi trình bày.
                </div>
              </div>
            `;
          }

          if (taskType === 'problem_solution') {
            const options = refText ? refText.split('\n').filter(line => line.trim()) : [];
            return `
              <div class="problem-solution-box mb-3">
                <div class="problem-solution-header">
                  <i class="bi bi-exclamation-diamond me-1"></i>TÌNH HUỐNG (SITUATION / PROBLEM)
                </div>
                <div class="problem-situation-text fs-5 mb-3">${qText}</div>
                ${options.length > 0 ? `
                  <div class="text-warning small fw-bold mb-2">
                    <i class="bi bi-lightbulb me-1"></i>Các phương án / giải pháp gợi ý:
                  </div>
                  <div class="problem-options-list">
                    ${options.map(opt => `
                      <div class="problem-option-card">
                        <i class="bi bi-check2-circle me-2 text-warning"></i>${escapeHtml(opt.replace(/^[-*•]\s*/, ''))}
                      </div>
                    `).join('')}
                  </div>
                ` : ''}
              </div>
            `;
          }

          // Default: short_qa, description, experience_future, opinion, discussion
          return `
            <div class="question-text mb-3">${qText}</div>
            ${imgUrl ? `
              <div class="question-image-box mb-3">
                <img src="${escapeHtml(imgUrl)}" alt="Question Image" class="question-image img-fluid" loading="lazy" />
              </div>
            ` : ''}
            ${refText ? `
              <div class="info-doc-box mb-3">
                <div class="info-doc-header"><i class="bi bi-info-circle me-1"></i>Thông tin bổ sung</div>
                <div class="info-doc-content">${escapeHtml(refText)}</div>
              </div>
            ` : ''}
          `;
        }

        (async () => {
          try {
            const { data: { session }, error: sessionError } = await supabase.auth.getSession();
            if (sessionError || !session) {
              window.location.href = 'index.html';
              return;
            }
            currentUser = session.user;
            currentProfile = await getProfile(currentUser.id);
            if (!currentProfile) {
              console.error("Không tìm thấy profile cho user:", currentUser.id);
              document.getElementById('sidebarName').textContent = currentUser.email || 'Người dùng';
              document.getElementById('sidebarRole').textContent = 'Chưa có vai trò';
              alert('Tài khoản của bạn chưa có hồ sơ trong hệ thống. Vui lòng liên hệ Admin!');
              return;
            }

            if (currentProfile && !currentProfile.voice_enrolled && hasVoiceEnrolled(currentProfile)) {
              currentProfile.voice_enrolled = true;
              updateProfile(currentUser.id, { voice_enrolled: true }).catch(console.error);
            }

            try {
              const m = await import('./auth.js');
              const settings = await m.getGlobalSettings();
              if (settings) {
                if (settings.api_url) window.globalApiUrl = settings.api_url;
                if (settings.gemini_api_key) window.globalGeminiApiKey = settings.gemini_api_key;
                if (settings.gemini_api_url) window.globalGeminiApiUrl = settings.gemini_api_url;
                if (settings.gemini_model) window.globalGeminiModel = settings.gemini_model;
              } else {
                console.warn("Chưa cấu hình API URL");
              }
            } catch(e) {
              console.error("Lỗi tải API URL", e);
            }

            initUI();
          } catch (err) {
            console.error("Lỗi khởi tạo dashboard:", err);
            document.getElementById('sidebarName').textContent = 'Lỗi kết nối';
            document.getElementById('sidebarRole').textContent = 'Error';
            alert('Lỗi khởi tạo trang: ' + (err.message || err));
          }
        })();

        function initUI() {
          const { role, full_name, email, voice_enrolled } = currentProfile;
          const avatarSrc = `https://ui-avatars.com/api/?name=${encodeURIComponent(full_name)}&background=4F46E5&color=fff&size=200`;

          ['sidebarAvatar', 'mobileAvatar'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.src = avatarSrc;
          });

          document.getElementById('sidebarName').textContent = full_name;
          const roleBadge = document.getElementById('sidebarRole');
          if (role === 'teacher') {
            roleBadge.textContent = 'Giáo viên';
            roleBadge.className = 'badge bg-primary';
            document.getElementById('teacherNav').classList.remove('d-none');
            initTeacher();
          } else if (role === 'admin') {
            roleBadge.textContent = 'Quản trị';
            roleBadge.className = 'badge bg-danger';
            document.getElementById('adminNav').classList.remove('d-none');
            document.getElementById('sidebarApiConfigBtn')?.classList.remove('d-none');
            initAdmin();
          } else {
            roleBadge.textContent = 'Học viên';
            roleBadge.className = 'badge bg-success';
            document.getElementById('studentNav').classList.remove('d-none');
            initStudent();
          }



          // Common Profile Setup
          document.getElementById('profileName').textContent = currentProfile.full_name;
          document.getElementById('profileEmail').textContent = currentProfile.email;
          document.getElementById('profilePhone').textContent = currentProfile.phone || 'Chưa cập nhật';
          document.getElementById('editFullName').value = currentProfile.full_name;
          document.getElementById('editPhone').value = currentProfile.phone || '';
          document.getElementById('profileAvatar').src = avatarSrc;

          const isEnrolled = hasVoiceEnrolled(currentProfile);
          document.getElementById('voiceStatusText').textContent =
            isEnrolled ? 'Đã đăng ký mẫu giọng' : 'Chưa đăng ký mẫu giọng';
          document.getElementById('voiceBadge').innerHTML = isEnrolled
            ? '<span class="badge bg-success"><i class="bi bi-check-circle me-1"></i>Đã đăng ký</span>'
            : '<span class="badge bg-secondary">Chưa có</span>';

          document.getElementById('profileForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            await updateProfile(currentUser.id, {
              full_name: document.getElementById('editFullName').value.trim(),
              phone: document.getElementById('editPhone').value.trim(),
            });
            // Update local profile and UI seamlessly
            currentProfile.full_name = document.getElementById('editFullName').value.trim();
            currentProfile.phone = document.getElementById('editPhone').value.trim();
            document.getElementById('profileName').textContent = currentProfile.full_name;
            document.getElementById('profilePhone').textContent = currentProfile.phone;
            document.getElementById('sidebarName').textContent = currentProfile.full_name;
            showToast('Đã cập nhật hồ sơ!', 'success');
          });

          // Nav routing
          document.querySelectorAll('.nav-item[data-page]').forEach(el => {
            el.addEventListener('click', (e) => {
              e.preventDefault();
              checkExitPracticeBeforeNavigate(() => {
                navigateTo(el.dataset.page);
                closeSidebar();
              });
            });
          });

          document.getElementById('logoutBtn').addEventListener('click', async () => {
            await signOut();
            window.location.href = 'index.html';
          });

          // Mobile sidebar
          document.getElementById('sidebarToggle').addEventListener('click', () => {
            document.getElementById('sidebar').classList.toggle('open');
            document.getElementById('sidebarOverlay').classList.toggle('d-none');
          });
          document.getElementById('sidebarOverlay').addEventListener('click', closeSidebar);
        }

        function closeSidebar() {
          document.getElementById('sidebar').classList.remove('open');
          document.getElementById('sidebarOverlay').classList.add('d-none');
        }

        window.navigateTo = function (page) {
          document.querySelectorAll('.page-section').forEach(p => p.classList.add('d-none'));
          document.querySelectorAll('.nav-item[data-page]').forEach(el => {
            el.classList.toggle('active', el.dataset.page === page);
          });
          const role = currentProfile.role;
          // Special pages that don't follow standard role-page pattern
          const specialPages = ['practice-session', 'practice-summary', 'questionset-edit'];
          let sectionId;
          if (page === 'profile') {
            sectionId = 'page-profile';
          } else if (specialPages.includes(page)) {
            sectionId = `page-${role}-${page}`;
          } else {
            sectionId = `page-${role}-${page}`;
          }
          const section = document.getElementById(sectionId);
          if (section) section.classList.remove('d-none');
          // Trigger page-specific init
          if (page === 'questionsets' && role === 'teacher') renderQuestionSets();
          if (page === 'practice' && role === 'student') renderPracticeSets();
          if (page === 'practice-history' && role === 'student') renderPracticeHistory();
        };

        // ── TEACHER ───────────────────────────────────────────────
        async function initTeacher() {
          navigateTo('overview');
          document.getElementById('greetTeacher').textContent =
            `Chào, ${currentProfile.full_name}! Hôm nay có ${new Date().toLocaleDateString('vi-VN')}`;

          // Stats
          const stats = await fetchTeacherStats(currentUser.id);
          document.getElementById('statStudents').textContent = stats.studentCount;
          document.getElementById('statAssessments').textContent = stats.assessmentCount;
          document.getElementById('statAvgScore').textContent = stats.avgScore;

          // Recent students
          const students = await fetchMyStudents(currentUser.id);
          // Normalize students voice_enrolled flag and auto-heal DB
          students.forEach(s => {
            if (!s.voice_enrolled && hasVoiceEnrolled(s)) {
              s.voice_enrolled = true;
              supabase.from('profiles').update({ voice_enrolled: true }).eq('id', s.id).then(() => {}).catch(console.error);
            }
          });
          window.allStudents = students;
          renderRecentStudents(students.slice(0, 5));
          renderStudentsGrid(students);
          populateStudentSelect(students);
          renderHistory();

          // Assess flow
          initAssessFlow();

          // Question Sets
          initQuestionSetsUI();
        }

        function renderRecentStudents(students) {
          const el = document.getElementById('recentStudentsList');
          if (!students.length) {
            el.innerHTML = '<div class="text-muted small p-3 text-center">Chưa có học viên nào</div>';
            return;
          }
          el.innerHTML = students.map(s => {
            const hasVoice = hasVoiceEnrolled(s);
            return `
    <div class="list-group-item list-group-item-action d-flex align-items-center gap-3 bg-transparent border-0 border-bottom border-secondary py-3">
      <img src="https://ui-avatars.com/api/?name=${encodeURIComponent(s.full_name)}&background=4F46E5&color=fff&size=80"
           class="rounded-circle" width="40" height="40" alt="avatar" />
      <div class="flex-grow-1">
        <div class="fw-semibold">${s.full_name}</div>
        <div class="text-muted small">${s.email}</div>
      </div>
      <span class="badge ${hasVoice ? 'bg-success' : 'bg-secondary'}">
        ${hasVoice ? '🎙 Đã có giọng' : 'Chưa có giọng'}
      </span>
    </div>
  `;
          }).join('');
        }

        function renderStudentsGrid(students) {
          const el = document.getElementById('studentsGrid');
          if (!students.length) {
            el.innerHTML = '<div class="col-12"><div class="text-muted text-center p-5">Chưa có học viên</div></div>';
            return;
          }
          el.innerHTML = students.map(s => {
            const hasVoice = hasVoiceEnrolled(s);
            return `
    <div class="col-md-6 col-lg-4 student-card-wrap" data-name="${s.full_name.toLowerCase()}">
      <div class="section-card h-100 d-flex flex-column">
        <div class="d-flex align-items-center gap-3 mb-3">
          <img src="https://ui-avatars.com/api/?name=${encodeURIComponent(s.full_name)}&background=4F46E5&color=fff&size=80"
               class="rounded-circle" width="52" height="52" alt="avatar" />
          <div>
            <div class="fw-semibold">${s.full_name}</div>
            <div class="text-muted small">${s.email}</div>
          </div>
        </div>
        <div class="d-flex gap-2 flex-wrap">
          <span class="badge ${hasVoice ? 'bg-success' : 'bg-secondary'}">
            <i class="bi bi-mic${hasVoice ? '-fill' : ''} me-1"></i>${hasVoice ? 'Giọng OK' : 'Chưa có giọng'}
          </span>
          ${s.phone ? `<span class="badge bg-outline-secondary">${s.phone}</span>` : ''}
        </div>
        <div class="text-muted smaller mt-2 mb-3">Tham gia: ${new Date(s.created_at).toLocaleDateString('vi-VN')}</div>
        <div class="mt-auto pt-2 border-top border-secondary border-opacity-25">
          <button class="btn btn-sm btn-outline-primary w-100 fw-semibold" onclick="openTeacherStudentSessions('${s.id}', '${encodeURIComponent(s.full_name)}')">
            <i class="bi bi-award me-1"></i>Xem bài Luyện & Thi thử
          </button>
        </div>
      </div>
    </div>
  `;
          }).join('');

          // Search
          document.getElementById('studentSearch').addEventListener('input', (e) => {
            const q = e.target.value.toLowerCase();
            document.querySelectorAll('.student-card-wrap').forEach(el => {
              el.classList.toggle('d-none', !el.dataset.name.includes(q));
            });
          });
        }

        function populateStudentSelect(students) {
          const sel = document.getElementById('assessStudentSelect');
          sel.innerHTML = '<option value="">-- Chọn học viên --</option>' +
            students.map(s => {
              const hasVoice = hasVoiceEnrolled(s);
              const tag = hasVoice ? ' (Đã có giọng 🎙)' : ' (Chưa có giọng ⚠️)';
              return `<option value="${s.id}">${s.full_name}${tag}</option>`;
            }).join('');
          checkRunReady();
          sel.addEventListener('change', checkRunReady);
        }

        function checkRunReady() {
          const hasFile = !document.getElementById('convAudioPreview').classList.contains('d-none');
          const hasStudent = !!document.getElementById('assessStudentSelect').value;
          document.getElementById('runAssessBtn').disabled = !(hasFile && hasStudent);
        }

        let convFile = null;
        function initAssessFlow() {
          const dropzone = document.getElementById('audioDropzone');
          const fileInput = document.getElementById('convFileInput');

          dropzone.addEventListener('click', () => fileInput.click());
          dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('dragover'); });
          dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
          dropzone.addEventListener('drop', (e) => { e.preventDefault(); dropzone.classList.remove('dragover'); setConvFile(e.dataTransfer.files[0]); });
          fileInput.addEventListener('change', () => setConvFile(fileInput.files[0]));

          document.getElementById('removeConvBtn').addEventListener('click', () => {
            convFile = null;
            document.getElementById('convAudioPreview').classList.add('d-none');
            checkRunReady();
          });

          document.getElementById('runAssessBtn').addEventListener('click', runAssessment);
          document.getElementById('saveAssessBtn').addEventListener('click', doSaveAssessment);
          document.getElementById('discardAssessBtn').addEventListener('click', () => {
            document.getElementById('assessResults').classList.add('d-none');
          });
        }

        function setConvFile(file) {
          if (!file) return;
          convFile = file;
          document.getElementById('convFileName').textContent = file.name;
          document.getElementById('convFileSize').textContent = (file.size / 1024 / 1024).toFixed(1) + ' MB';
          document.getElementById('convAudioPlayer').src = URL.createObjectURL(file);
          document.getElementById('convAudioPreview').classList.remove('d-none');
          checkRunReady();
        }

        async function runAssessment() {
          const apiUrl = window.globalApiUrl;
          if (!apiUrl) {
            alert("Admin chưa cấu hình API Endpoint URL (Tunnel). Vui lòng liên hệ Admin!");
            return;
          }

          const studentId = document.getElementById('assessStudentSelect').value;
          const student = (window.allStudents || []).find(s => s.id === studentId);
          if (!student || !hasVoiceEnrolled(student)) {
            alert("Học viên này chưa đăng ký giọng nói!");
            return;
          }
          if (!currentProfile || !hasVoiceEnrolled(currentProfile)) {
            alert("Bạn (Giáo viên) chưa đăng ký mẫu giọng nói!");
            return;
          }

          document.getElementById('assessLoading').classList.remove('d-none');
          document.getElementById('assessResults').classList.add('d-none');
          document.getElementById('runAssessBtn').disabled = true;

          try {
            const stepEl = document.getElementById('assessLoadingStep');
            stepEl.textContent = 'Đang gửi yêu cầu...';

            let tEmb = currentProfile.voice_embeddings;
            if (typeof tEmb === 'string') {
              try { tEmb = JSON.parse(tEmb); } catch (e) {}
            }
            let sEmb = student.voice_embeddings;
            if (typeof sEmb === 'string') {
              try { sEmb = JSON.parse(sEmb); } catch (e) {}
            }

            // Gọi API FastAPI trên Colab (Khởi tạo Task)
            const formData = new FormData();
            const scoreTeacher = document.getElementById('scoreTeacherCheck').checked;
            formData.append("audio", convFile);
            formData.append("teacher_embeddings_json", JSON.stringify(tEmb || []));
            formData.append("student_embeddings_json", JSON.stringify(sEmb || []));
            formData.append("score_teacher", scoreTeacher);
            formData.append("skip_feedback", "true"); // Bỏ qua LLM cũ trên Colab vì đã tích hợp AI Evaluator bằng API Key trực tiếp trên client

            const startResponse = await fetch(`${apiUrl.replace(/\/$/, '')}/assess_start`, {
              method: "POST",
              body: formData
            });

            if (!startResponse.ok) {
              throw new Error(`Lỗi server khởi tạo: ${startResponse.status}`);
            }

            const startData = await startResponse.json();
            if (!startData.success) {
              throw new Error(startData.error || "Lỗi khởi tạo API");
            }

            const taskId = startData.task_id;

            // Bắt đầu vòng lặp polling (Kiểm tra tiến độ realtime)
            let apiData = null;
            while (true) {
              await new Promise(r => setTimeout(r, 2000));

              const statusRes = await fetch(`${apiUrl.replace(/\/$/, '')}/assess_status/${taskId}`);
              if (!statusRes.ok) throw new Error("Lỗi mạng khi kiểm tra tiến độ");

              const statusData = await statusRes.json();
              if (!statusData.success) throw new Error(statusData.error || "Lỗi trạng thái API");

              const task = statusData.data;
              if (task.step) {
                stepEl.textContent = task.step;
              }

              if (task.status === 'completed') {
                apiData = task;
                break;
              }

              if (task.status === 'error') {
                throw new Error(task.error || "Lỗi phân tích trên Colab");
              }
            }

            // Upload audio lưu vào Supabase (chạy ngầm)
            const audioUrl = await uploadConversationAudio(currentUser.id, convFile);

            // Create assessment record in DB (status=pending)
            const assessment = await createAssessment(currentUser.id, studentId, audioUrl, scoreTeacher);

            document.getElementById('assessLoading').classList.add('d-none');

            // Hiển thị kết quả thật
            showRealResults(assessment.id, apiData.result, apiData.llm_feedback);
          } catch (e) {
            document.getElementById('assessLoading').classList.add('d-none');
            document.getElementById('runAssessBtn').disabled = false;
            alert('Lỗi: ' + e.message);
          }
        }

        let currentAssessmentId = null;
        let currentApiResult = null;

        async function showRealResults(assessmentId, resultObj, llmFeedback) {
          currentAssessmentId = assessmentId;
          currentApiResult = { ...resultObj, llm_feedback: llmFeedback };

          // Trích xuất điểm trung bình của học viên từ resultObj.student
          let sTotal = 0, sAcc = 0, sFlu = 0, sPro = 0;
          const sSentences = resultObj.student?.sentences || [];
          let sCount = 0;
          for (const s of sSentences) {
            if (s.scores) {
              sTotal += s.scores.total || 0;
              sAcc += s.scores.accuracy || 0;
              sFlu += s.scores.fluency || 0;
              sPro += s.scores.prosodic || 0;
              sCount++;
            }
          }
          if (sCount > 0) {
            sTotal /= sCount; sAcc /= sCount; sFlu /= sCount; sPro /= sCount;
          }

          // Trích xuất điểm trung bình của giáo viên từ resultObj.teacher
          let tTotal = 0, tAcc = 0, tFlu = 0, tPro = 0;
          const tSentences = resultObj.teacher?.sentences || [];
          let tCount = 0;
          for (const s of tSentences) {
            if (s.scores) {
              tTotal += s.scores.total || 0;
              tAcc += s.scores.accuracy || 0;
              tFlu += s.scores.fluency || 0;
              tPro += s.scores.prosodic || 0;
              tCount++;
            }
          }
          if (tCount > 0) {
            tTotal /= tCount; tAcc /= tCount; tFlu /= tCount; tPro /= tCount;
          }

          // Level badge helper
          function updateLevelBadge(score) {
            const levelBadge = document.getElementById('resLevelBadge');
            if (!levelBadge) return;
            const level = score >= 8.5 ? 'excellent' : score >= 7.0 ? 'good' : score >= 5.0 ? 'average' : score >= 3.0 ? 'weak' : 'critical';
            const levelLabels = { excellent: 'Xuất sắc', good: 'Tốt', average: 'Trung bình', weak: 'Yếu', critical: 'Cần cải thiện' };
            const levelColors = { excellent: 'bg-success', good: 'bg-info', average: 'bg-warning text-dark', weak: 'bg-danger', critical: 'bg-danger' };
            levelBadge.textContent = levelLabels[level] || level;
            levelBadge.className = `badge fs-6 ${levelColors[level] || 'bg-secondary'}`;
          }

          let sGrammar = '--', sContext = '--';
          let tGrammar = '--', tContext = '--';

          function renderSummaryScores(total, acc, flu, pro, gram = '--', ctx = '--') {
            document.getElementById('resTotal').textContent = total.toFixed(1);
            document.getElementById('resAcc').textContent = acc.toFixed(1);
            document.getElementById('resFlu').textContent = flu.toFixed(1);
            document.getElementById('resPro').textContent = pro.toFixed(1);
            if (document.getElementById('resGrammar')) document.getElementById('resGrammar').textContent = gram;
            if (document.getElementById('resContext')) document.getElementById('resContext').textContent = ctx;
            updateLevelBadge(total);
          }

          renderSummaryScores(sTotal, sAcc, sFlu, sPro, sGrammar, sContext);

          // Quản lý nút chuyển đổi điểm Học viên / Giáo viên
          const switcher = document.getElementById('scoreRoleSwitcher');
          const btnStu = document.getElementById('btnScoreStudent');
          const btnTea = document.getElementById('btnScoreTeacher');
          if (switcher && btnStu && btnTea) {
            if (tCount > 0) {
              switcher.classList.remove('d-none');
              btnStu.innerHTML = `<i class="bi bi-mortarboard me-1"></i>Học viên (${sTotal.toFixed(1)})`;
              btnTea.innerHTML = `<i class="bi bi-person-video3 me-1"></i>Giáo viên (${tTotal.toFixed(1)})`;
              btnStu.classList.add('active');
              btnTea.classList.remove('active');

              btnStu.onclick = () => {
                btnStu.classList.add('active');
                btnTea.classList.remove('active');
                renderSummaryScores(sTotal, sAcc, sFlu, sPro, sGrammar, sContext);
              };
              btnTea.onclick = () => {
                btnTea.classList.add('active');
                btnStu.classList.remove('active');
                renderSummaryScores(tTotal, tAcc, tFlu, tPro, tGrammar, tContext);
              };
            } else {
              switcher.classList.add('d-none');
            }
          }

          // Hide model comparison table (SpeechOcean762 is sole scoring model)
          const comparisonInfo = document.getElementById('modelComparisonInfo');
          if (comparisonInfo) {
            comparisonInfo.classList.add('d-none');
          }

          document.getElementById('dialogueTimeline').innerHTML = (resultObj.dialogue?.turns || []).map(renderTurnApi).join('');
          document.getElementById('assessTitleInput').value = '';
          document.getElementById('assessResults').classList.remove('d-none');
          document.getElementById('runAssessBtn').disabled = false;

          // Lưu điểm tạm thời
          currentApiResult.score_total = sTotal;
          currentApiResult.score_accuracy = sAcc;
          currentApiResult.score_fluency = sFlu;
          currentApiResult.score_prosodic = sPro;

          // ── KÍCH HOẠT AI EVALUATOR ĐÁNH GIÁ NGỮ PHÁP, NGỮ CẢNH & HIỆU CHUẨN ĐIỂM HỘI THOẠI ──
          const tfSummaryBox = document.getElementById('tfSummaryBox');
          const statusBadge = document.getElementById('aiAssessStatus');
          if (statusBadge) {
            statusBadge.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>AI đang đánh giá...';
            statusBadge.className = 'badge bg-warning-subtle text-warning border border-warning-subtle smaller';
          }
          if (tfSummaryBox) {
            tfSummaryBox.innerHTML = `
              <div class="d-flex align-items-center gap-2 text-info py-2">
                <span class="spinner-border spinner-border-sm"></span>
                <span>AI Evaluator đang phân tích ngữ pháp, ngữ cảnh và hiệu chuẩn điểm toàn diện cho cuộc hội thoại...</span>
              </div>`;
          }

          try {
            const turns = resultObj.dialogue?.turns || [];
            const aiEval = await evaluateConversationWithAi({
              dialogueTurns: turns,
              pronunciationScores: { total: sTotal, accuracy: sAcc, fluency: sFlu, prosodic: sPro },
            });

            if (aiEval && aiEval.score_total != null) {
              sTotal = aiEval.score_total;
              sGrammar = Number(aiEval.score_grammar || 0).toFixed(1);
              sContext = Number(aiEval.score_context || 0).toFixed(1);
              if (!btnTea || !btnTea.classList.contains('active')) {
                renderSummaryScores(sTotal, sAcc, sFlu, sPro, sGrammar, sContext);
              }

              if (btnStu) {
                btnStu.innerHTML = `<i class="bi bi-mortarboard me-1"></i>Học viên (${sTotal.toFixed(1)})`;
              }

              if (statusBadge) {
                statusBadge.innerHTML = '<i class="bi bi-check-circle-fill me-1"></i>Đã hiệu chuẩn AI';
                statusBadge.className = 'badge bg-success-subtle text-success border border-success-subtle smaller';
              }

              // Hiển thị Nhận xét Sư phạm & Lỗi Ngữ pháp của AI Evaluator
              if (tfSummaryBox) {
                let html = `
                  <div class="mb-3">
                    <div class="fw-semibold text-white mb-2 d-flex align-items-center gap-2">
                      <i class="bi bi-robot text-primary fs-5"></i>
                      <span>Nhận Xét Sư Phạm từ AI Evaluator</span>
                      ${aiEval.is_fallback ? '<span class="badge bg-secondary-subtle text-secondary border border-secondary-subtle smaller">Đánh giá cơ bản</span>' : '<span class="badge bg-primary-subtle text-primary border border-primary-subtle smaller">Chuẩn Khảo Thí</span>'}
                    </div>
                    <div class="text-light text-opacity-90 small lh-base p-3 rounded-3" style="background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(255,255,255,0.08);">
                      ${simpleMarkdown(aiEval.conversation_summary || '')}
                    </div>
                  </div>`;

                if (aiEval.grammar_errors && aiEval.grammar_errors.length > 0) {
                  html += `
                    <div class="mb-3">
                      <div class="small fw-semibold text-warning mb-2">
                        <i class="bi bi-exclamation-triangle-fill me-1"></i>Các điểm ngữ pháp & cấu trúc cần cải thiện:
                      </div>
                      <div class="d-flex flex-column gap-2">
                        ${aiEval.grammar_errors.map(ge => `
                          <div class="p-2 rounded bg-dark border border-secondary border-opacity-25 small">
                            <div class="d-flex align-items-center flex-wrap gap-2 mb-1">
                              <span class="badge bg-danger-subtle text-danger border border-danger-subtle smaller">Học viên nói</span>
                              <span class="text-danger font-monospace">"${ge.error_text}"</span>
                              <i class="bi bi-arrow-right text-muted"></i>
                              <span class="badge bg-success-subtle text-success border border-success-subtle smaller">Sửa chuẩn</span>
                              <span class="text-success fw-bold font-monospace">"${ge.fix}"</span>
                            </div>
                            ${ge.explanation ? `<div class="text-muted smaller">${ge.explanation}</div>` : ''}
                          </div>
                        `).join('')}
                      </div>
                    </div>`;
                } else {
                  html += `
                    <div class="mb-3 p-2 rounded bg-dark border border-secondary border-opacity-25 small text-success">
                      <i class="bi bi-check-circle-fill me-1"></i>Ngữ pháp: Học viên phản xạ và diễn đạt các cấu trúc ngữ pháp đạt chuẩn trong lượt nói.
                    </div>`;
                }

                if (aiEval.communication_tips && aiEval.communication_tips.length > 0) {
                  html += `
                    <div class="mb-2">
                      <div class="small fw-semibold text-info mb-1">
                        <i class="bi bi-lightbulb-fill me-1"></i>Lời khuyên phản xạ & giao tiếp tự nhiên:
                      </div>
                      <ul class="mb-0 ps-3 small text-muted">
                        ${aiEval.communication_tips.map(tip => `<li>${tip}</li>`).join('')}
                      </ul>
                    </div>`;
                }

                if (aiEval.better_dialogue_expressions && aiEval.better_dialogue_expressions.length > 0) {
                  html += `
                    <div class="mt-3 pt-2 border-top border-secondary border-opacity-25">
                      <div class="small fw-semibold text-success mb-1">
                        <i class="bi bi-chat-quote-fill me-1"></i>Cách diễn đạt mẫu tự nhiên, nâng cao:
                      </div>
                      <div class="small text-light fst-italic ps-2 border-start border-success border-2">
                        "${aiEval.better_dialogue_expressions.join('" / "')}"
                      </div>
                    </div>`;
                }

                tfSummaryBox.innerHTML = html;
              }

              // Lưu dữ liệu vào kết quả
              currentApiResult.ai_eval = aiEval;
              currentApiResult.score_grammar = aiEval.score_grammar;
              currentApiResult.score_context = aiEval.score_context;
              currentApiResult.score_total = sTotal;
            }
          } catch (aiErr) {
            console.warn('Lỗi gọi AI Evaluator cho hội thoại:', aiErr);
            if (statusBadge) {
              statusBadge.innerHTML = '<i class="bi bi-info-circle me-1"></i>Phân tích âm học';
              statusBadge.className = 'badge bg-secondary-subtle text-secondary border border-secondary-subtle smaller';
            }
            if (tfSummaryBox) {
              const otf = resultObj.overall_transformer_feedback || {};
              tfSummaryBox.innerHTML = otf.summary ? simpleMarkdown(otf.summary) : '<span class="text-muted">Đã hoàn thành phân tích âm học.</span>';
            }
          }
        }

        function renderTurnApi(turn) {
          const isTeacher = turn.role === 'teacher';
          const sc = turn.scores || { total: 0, accuracy: 0, fluency: 0, prosodic: 0 };
          const errs = turn.errors || {};
          const badPhonemes = errs.phonemes ? (
            errs.phonemes.filter(p => p.is_suspicious || (p.error_probability !== undefined && p.error_probability >= 0.5))
          ) : [];
          const audioHtml = turn.audio ? `
            <div class="mini-audio-pill mt-2">
              <i class="bi bi-volume-up text-info"></i>
              <audio controls src="${turn.audio}"></audio>
            </div>` : '';

          const hasScores = turn.scored && turn.scores && turn.scores.total !== undefined;
          const scorePillsHtml = hasScores ? `
            <div class="score-pill-group">
              <span class="score-pill-total">Total: ${(sc.total || 0).toFixed(1)}</span>
              <span class="score-pill-sub">Acc: ${(sc.accuracy || 0).toFixed(1)}</span>
              <span class="score-pill-sub">Flu: ${(sc.fluency || 0).toFixed(1)}</span>
              <span class="score-pill-sub">Pro: ${(sc.prosodic || 0).toFixed(1)}</span>
            </div>` : `
            <span class="badge bg-secondary-subtle text-muted border border-secondary-subtle smaller">Không chấm điểm</span>`;

          // 1. Build Clean Correction Box & Collect words that actually have feedback
          const wordsWithFeedback = new Map(); // word_clean -> severity ('bad' or 'warning')
          const feedbackItems = [];
          const seen = new Set();

          if (badPhonemes.length > 0) {
            badPhonemes.forEach(p => {
              const targetIpa = p.target_ipa || (p.phoneme ? ('/' + p.phoneme + '/') : '');
              const actualIpa = p.actual_ipa || '';
              const contrastStr = (actualIpa && actualIpa !== targetIpa) ? `${targetIpa} → ${actualIpa}` : targetIpa;
              const inWord = p.word ? ` trong "<strong>${p.word}</strong>"` : '';
              const ruleName = p.rule_name_vi ? p.rule_name_vi.split('(')[0].trim() : '';
              const tipText = p.articulatory_tip || p.tip || '';

              const key = `${contrastStr}_${p.word}`;
              if (seen.has(key)) return;
              seen.add(key);

              if (p.word) {
                const wKey = p.word.toLowerCase().replace(/[^a-z0-9]/g, '');
                const sev = (p.severity === 'critical' || p.severity === 'bad') ? 'bad' : 'warning';
                if (!wordsWithFeedback.has(wKey) || sev === 'bad') {
                  wordsWithFeedback.set(wKey, sev);
                }
              }

              feedbackItems.push(`
                <div class="feedback-issue-item">
                  <i class="bi bi-exclamation-circle text-warning me-1"></i>
                  <span class="fw-bold text-light">${contrastStr}</span>${inWord}
                  ${ruleName ? `<span class="rule-tag">${ruleName}</span>` : ''}
                  ${tipText ? `<span class="tip-text">— ${tipText}</span>` : ''}
                </div>`);
            });
          }

          let feedbackBoxHtml = '';
          if (feedbackItems.length > 0) {
            feedbackBoxHtml = `
              <div class="clean-feedback-box mt-2">
                <div class="clean-feedback-title">
                  <i class="bi bi-soundwave me-1"></i>Lưu ý phát âm (L2-MDD & ASHA):
                </div>
                <div class="clean-feedback-list">
                  ${feedbackItems.join('')}
                </div>
              </div>`;
          }

          // 2. Build Word Tokens Stream with IPA — 100% synchronized with feedback
          let words = turn.words_detail;
          if (!words || words.length === 0) {
            words = (turn.transcript || '').split(' ').map(w => ({ word: w, status: 'good' }));
          }

          const wordTokensHtml = words.map(w => {
            const wKey = (w.word || '').toLowerCase().replace(/[^a-z0-9]/g, '');
            // Word is highlighted as warning/bad IF AND ONLY IF it has an active feedback item below!
            const hasFb = wordsWithFeedback.has(wKey);
            const status = hasFb ? wordsWithFeedback.get(wKey) : 'good';

            const ipaDisplay = w.word_ipa ? `<span class="word-ipa">${w.word_ipa}</span>` : '';
            const statusNote = hasFb ? ' (Có âm vị cần lưu ý)' : ' (Phát âm đạt chuẩn)';
            const titleAttr = `${w.word}${w.word_ipa ? ' · ' + w.word_ipa : ''}${statusNote}`;
            return `<div class="word-token ${status}" title="${titleAttr}">
              <span class="word-text">${w.word}</span>
              ${ipaDisplay}
            </div>`;
          }).join('');

          if (isTeacher) {
            if (!turn.scored) {
              // Nếu không chấm cho teacher thì không cần đưa ra feedback hay highlight lỗi cho teacher
              return `
      <div class="timeline-item timeline-teacher">
        <div class="timeline-dot teacher-dot"><i class="bi bi-person-video3"></i></div>
        <div class="speech-bubble-enhanced teacher-bubble-enhanced">
          <div class="d-flex justify-content-between align-items-center mb-1">
            <div class="small text-muted fw-semibold"><i class="bi bi-person-badge me-1 text-primary"></i>Giáo viên</div>
            <span class="badge bg-secondary-subtle text-muted border border-secondary-subtle smaller">Không chấm điểm</span>
          </div>
          <div class="teacher-transcript text-light py-1">${turn.transcript}</div>
          ${audioHtml}
        </div>
      </div>`;
            }

            // Nếu CÓ chấm điểm cho teacher thì hiển thị đầy đủ như student
            return `
      <div class="timeline-item timeline-teacher">
        <div class="timeline-dot teacher-dot"><i class="bi bi-person-video3"></i></div>
        <div class="speech-bubble-enhanced teacher-bubble-enhanced">
          <div class="d-flex justify-content-between align-items-center mb-1">
            <div class="small text-muted fw-semibold"><i class="bi bi-person-badge me-1 text-primary"></i>Giáo viên</div>
            ${scorePillsHtml}
          </div>

          <!-- Word-by-word interactive stream with IPA -->
          <div class="word-token-stream">
            ${wordTokensHtml}
          </div>

          <!-- Clean, unified correction box (if any) -->
          ${feedbackBoxHtml}

          <!-- Audio Player -->
          ${audioHtml}
        </div>
      </div>`;
          }

          return `
      <div class="timeline-item timeline-student">
        <div class="speech-bubble-enhanced student-bubble-enhanced">
          <div class="d-flex justify-content-between align-items-center mb-1">
            <div class="small text-muted fw-semibold"><i class="bi bi-mortarboard me-1 text-teal"></i>Học viên</div>
            ${scorePillsHtml}
          </div>

          <!-- Word-by-word interactive stream with IPA -->
          <div class="word-token-stream">
            ${wordTokensHtml}
          </div>

          <!-- Clean, unified correction box (if any) -->
          ${feedbackBoxHtml}

          <!-- Audio Player -->
          ${audioHtml}
        </div>
        <div class="timeline-dot student-dot"><i class="bi bi-mortarboard"></i></div>
      </div>`;
        }

        async function doSaveAssessment() {
          const btn = document.getElementById('saveAssessBtn');
          const oldHtml = btn.innerHTML;
          btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Đang lưu...';
          btn.disabled = true;

          try {
            const r = JSON.parse(JSON.stringify(currentApiResult)); // Clone

            // Upload audio urls from Colab to Supabase
            const uploadUrl = async (url, suffix) => {
              if (typeof url === 'string' && url.includes('/audio/') && !url.includes('supabase.co')) {
                return await uploadAudioUrlToSupabase(currentUser.id, url, suffix);
              }
              return url;
            };

            if (r.teacher && r.teacher.full_audio) {
              r.teacher.full_audio = await uploadUrl(r.teacher.full_audio, 'teacher');
            }
            if (r.student && r.student.full_audio) {
              r.student.full_audio = await uploadUrl(r.student.full_audio, 'student');
            }
            if (r.dialogue && r.dialogue.turns) {
              for (let i = 0; i < r.dialogue.turns.length; i++) {
                let t = r.dialogue.turns[i];
                if (t.audio) {
                  t.audio = await uploadUrl(t.audio, 'turn_' + i);
                }
              }
            }

            await saveAssessment(currentAssessmentId, {
              score_total: r.score_total, score_accuracy: r.score_accuracy, score_fluency: r.score_fluency,
              score_prosodic: r.score_prosodic, llm_feedback: r.ai_eval?.conversation_summary || r.llm_feedback, result_json: r,
              title: document.getElementById('assessTitleInput').value.trim()
            });

            document.getElementById('assessResults').classList.add('d-none');
            showToast('Đã lưu kết quả thành công!', 'success');
            renderHistory();
          } catch (e) {
            alert('Lỗi lưu: ' + e.message);
          } finally {
            btn.innerHTML = oldHtml;
            btn.disabled = false;
          }
        }

        // ===== ADMIN LOGIC =====
        async function initAdmin() {
          navigateTo('overview');
          initApiConfigForm();
          import('./auth.js').then(async (m) => {

            // Load users
            const { data: users, error } = await supabase
              .from('profiles')
              .select('*')
              .order('created_at', { ascending: false });

            const tbody = document.getElementById('adminUsersTableBody');
            if (error) {
              tbody.innerHTML = `<tr><td colspan="6" class="text-danger">Lỗi tải dữ liệu: ${error.message}</td></tr>`;
              return;
            }
            if (!users || users.length === 0) {
              tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted">Chưa có người dùng nào</td></tr>`;
              return;
            }

            tbody.innerHTML = users.map(u => `
              <tr>
                <td>
                  <div class="d-flex align-items-center gap-2">
                    <img src="https://ui-avatars.com/api/?name=${encodeURIComponent(u.full_name)}&background=4F46E5&color=fff" class="rounded-circle" width="32" height="32">
                    <span class="fw-semibold">${u.full_name}</span>
                  </div>
                </td>
                <td>${u.email}</td>
                <td><span class="badge ${u.role === 'admin' ? 'bg-danger' : u.role === 'teacher' ? 'bg-primary' : 'bg-success'}">${u.role.toUpperCase()}</span></td>
                <td>${hasVoiceEnrolled(u) ? '<i class="bi bi-check-circle text-success"></i>' : '-'}</td>
                <td>${new Date(u.created_at).toLocaleDateString('vi-VN')}</td>
                <td>
                  <button class="btn btn-sm btn-outline-primary btn-edit-user" data-id="${u.id}" data-role="${u.role}" data-name="${u.full_name}" title="Đổi vai trò"><i class="bi bi-pencil"></i></button>
                  <button class="btn btn-sm btn-outline-danger btn-delete-user" data-id="${u.id}" title="Xoá user"><i class="bi bi-trash"></i></button>
                </td>
              </tr>
            `).join('');
            document.querySelectorAll('.btn-edit-user').forEach(btn => {
              btn.addEventListener('click', async (e) => {
                const id = e.currentTarget.dataset.id;
                const currentRole = e.currentTarget.dataset.role;
                const newRole = prompt(`Nhập vai trò mới cho ${e.currentTarget.dataset.name} (admin, teacher, student):`, currentRole);
                if (newRole && ['admin', 'teacher', 'student'].includes(newRole.toLowerCase().trim())) {
                  const { error } = await supabase.from('profiles').update({ role: newRole.toLowerCase().trim() }).eq('id', id);
                  if (error) alert("Lỗi cập nhật: " + error.message);
                  else {
                    showToast('Đã cập nhật vai trò', 'success');
                    initAdmin();
                  }
                } else if (newRole) {
                  alert("Vai trò không hợp lệ!");
                }
              });
            });

            document.querySelectorAll('.btn-delete-user').forEach(btn => {
              btn.addEventListener('click', async (e) => {
                const id = e.currentTarget.dataset.id;
                if (confirm("Bạn có chắc chắn muốn xoá user này?")) {
                  // Xoá các bài đánh giá liên quan (để tránh lỗi Foreign Key Constraint 'assessments_student_id_fkey' / 'assessments_teacher_id_fkey')
                  const { error: assessError } = await supabase.from('assessments').delete().or(`student_id.eq.${id},teacher_id.eq.${id}`);
                  if (assessError) {
                    alert("Lỗi xoá bài đánh giá liên quan: " + assessError.message);
                    return;
                  }

                  // Xoá từ profiles trước để tránh lỗi Foreign Key Constraint
                  const { error } = await supabase.from('profiles').delete().eq('id', id);
                  if (error) {
                    alert("Lỗi xoá user (Profile): " + error.message);
                    return;
                  }

                  // Xoá từ auth.users (Thông qua RPC của admin)
                  const { error: authError } = await supabase.rpc('delete_user_by_admin', { user_id: id });
                  if (authError) {
                    alert("Cảnh báo (Auth): " + authError.message + " (Profile đã được xoá)");
                  }
                  
                  showToast('Đã xoá tài khoản hoàn toàn', 'success');
                  initAdmin(); // reload
                }
              });
            });
          });
        }

        async function renderHistory() {
          const list = document.getElementById('historyList');
          try {
            const items = await fetchSavedAssessments(currentUser.id);
            window.allAssessments = items;
            if (!items.length) {
              list.innerHTML = '<div class="text-muted text-center p-5">Chưa có bài đã lưu</div>';
              return;
            }
            list.innerHTML = items.map(a => renderAssessmentCard(a, true)).join('');

            // Bind delete buttons
            setTimeout(() => {
              document.querySelectorAll('.btn-delete-assess').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                  e.stopPropagation();
                  if (confirm('Bạn có chắc muốn xoá bài kiểm tra này?')) {
                    try {
                      await deleteAssessment(btn.dataset.id);
                      showToast('Đã xoá thành công', 'success');
                      renderHistory();
                      // Update stats quietly
                      const stats = await fetchTeacherStats(currentUser.id);
                      document.getElementById('statAssessments').textContent = stats.assessmentCount;
                      document.getElementById('statAvgScore').textContent = stats.avgScore;
                    } catch (err) {
                      alert(err.message);
                    }
                  }
                });
              });
            }, 100);
          } catch (e) { list.innerHTML = '<div class="text-danger">Lỗi tải dữ liệu</div>'; }
        }

        // ── STUDENT ───────────────────────────────────────────────
        async function initStudent() {
          navigateTo('overview');
          const profile = await fetchStudentProfile(currentUser.id);
          const stats = await fetchStudentStats(currentUser.id);
          const assessments = await fetchStudentAssessments(currentUser.id);
          window.allAssessments = assessments;

          document.getElementById('greetStudent').textContent =
            `Chào, ${profile.full_name}! Tiếp tục luyện tập nhé 🎯`;

          document.getElementById('stuStatCount').textContent = stats.count;
          document.getElementById('stuStatTotal').textContent = stats.avgTotal;
          document.getElementById('stuStatFlu').textContent = stats.avgFlu;
          document.getElementById('stuStatAcc').textContent = stats.avgAcc;

          // Teacher info (Only for student)
          if (profile.teacher) {
            const t = profile.teacher;
            document.getElementById('teacherNameStu').textContent = t.full_name;
            document.getElementById('teacherEmailStu').textContent = t.email;
            document.getElementById('teacherAvatarStu').src =
              `https://ui-avatars.com/api/?name=${encodeURIComponent(t.full_name)}&background=4F46E5&color=fff&size=80`;
          }

          // Recent results
          const recentEl = document.getElementById('stuRecentList');
          recentEl.innerHTML = assessments.slice(0, 3).map(a => renderAssessmentCard(a, false)).join('');

          // All results
          document.getElementById('stuResultsList').innerHTML =
            assessments.length ? assessments.map(a => renderAssessmentCard(a, false)).join('') :
              '<div class="text-muted text-center p-5">Chưa có bài đánh giá nào</div>';

          // Practice flow
          initPracticeUI();
        }

        // ── SHARED RENDERERS ──────────────────────────────────────
        function renderTurn(turn) {
          const isTeacher = turn.role === 'teacher';
          if (isTeacher) {
            return `
      <div class="timeline-item timeline-teacher">
        <div class="timeline-dot teacher-dot"><i class="bi bi-person-video3"></i></div>
        <div class="timeline-bubble teacher-bubble">
          <div class="small text-muted mb-1">Giáo viên</div>
          <div>${turn.transcript}</div>
        </div>
      </div>`;
          }
          return `
    <div class="timeline-item timeline-student">
      <div class="timeline-bubble student-bubble">
        <div class="d-flex justify-content-between align-items-center mb-1">
          <div class="small text-muted">Học viên</div>
          <div class="d-flex gap-2">
            <span class="badge bg-primary">Total: ${turn.total.toFixed(1)}</span>
            <span class="badge bg-secondary">Acc: ${turn.acc.toFixed(1)}</span>
            <span class="badge bg-secondary">Flu: ${turn.flu.toFixed(1)}</span>
          </div>
        </div>
        <div>${turn.transcript}</div>
        ${turn.bad_words?.length ? `<div class="mt-2"><small class="text-warning"><i class="bi bi-exclamation-triangle me-1"></i>Từ cần sửa: ${turn.bad_words.map(w => `<code>${w}</code>`).join(', ')}</small></div>` : ''}
      </div>
      <div class="timeline-dot student-dot"><i class="bi bi-mortarboard"></i></div>
    </div>`;
        }

        function renderAssessmentCard(a, isTeacher = false) {
          const date = new Date(a.created_at).toLocaleDateString('vi-VN');
          const name = a.student?.full_name || a.teacher?.full_name || 'N/A';
          const customTitle = a.result_json && a.result_json.title ? a.result_json.title : null;
          const titleText = customTitle ? `<strong class="text-primary">${customTitle}</strong> - ${name}` : `Đánh giá của ${name}`;
          const total = a.score_total ? a.score_total.toFixed(1) : '--';
          const scoreColor = a.score_total >= 8 ? 'success' : a.score_total >= 6 ? 'warning' : 'danger';

          let deleteBtn = '';
          if (isTeacher) {
            deleteBtn = `<button class="btn btn-sm btn-outline-danger ms-2 btn-delete-assess" data-id="${a.id}"><i class="bi bi-trash"></i></button>`;
          }

          return `
    <div class="assessment-card section-card d-flex align-items-center">
      <div class="flex-grow-1 d-flex align-items-center gap-3" onclick="openAssessDetail('${a.id}')" style="cursor: pointer;">
        <div class="score-badge score-${scoreColor}">${total}</div>
        <div class="flex-grow-1">
          <div class="fw-semibold">${titleText}</div>
          <div class="text-muted small">${date}</div>
          <div class="d-flex gap-2 mt-1">
            <span class="badge bg-secondary">Acc: ${a.score_accuracy?.toFixed(1) ?? '--'}</span>
            <span class="badge bg-secondary">Flu: ${a.score_fluency?.toFixed(1) ?? '--'}</span>
            <span class="badge bg-secondary">Pro: ${a.score_prosodic?.toFixed(1) ?? '--'}</span>
          </div>
        </div>
        <i class="bi bi-chevron-right text-muted"></i>
      </div>
      ${deleteBtn}
    </div>`;
        }

        window.openAssessDetail = function (id) {
          const a = (window.allAssessments || []).find(x => x.id === id);
          if (!a) return;
          const r = a.result_json || {};
          const turns = r.dialogue?.turns || r.turns || [];
          const otf = r.overall_transformer_feedback || {};

          // Level badge
          const total = a.score_total || 0;
          const level = otf.level || (total >= 8.5 ? 'excellent' : total >= 7.0 ? 'good' : total >= 5.0 ? 'average' : total >= 3.0 ? 'weak' : 'critical');
          const levelLabels = { excellent: 'Xuất sắc', good: 'Tốt', average: 'Trung bình', weak: 'Yếu', critical: 'Cần cải thiện' };
          const levelColors = { excellent: 'bg-success', good: 'bg-info', average: 'bg-warning text-dark', weak: 'bg-danger', critical: 'bg-danger' };
          const levelBadgeHtml = `<span class="badge fs-6 ${levelColors[level] || 'bg-secondary'}">${levelLabels[level] || level}</span>`;

          const aiEval = a.result_json?.ai_eval;
          const gramVal = a.score_grammar ?? aiEval?.score_grammar;
          const ctxVal = a.score_context ?? aiEval?.score_context;

          const scoresGridHtml = (gramVal != null || ctxVal != null) ? `
      <div class="row g-3">
        <div class="col-6 col-md-4 col-lg-2">
          <div class="score-card score-card-total">
            <div class="score-label">Tổng Thể</div>
            <div class="score-value">${(a.score_total || 0).toFixed(1)}</div>
            <div class="score-sub">Hiệu chuẩn AI</div>
          </div>
        </div>
        <div class="col-6 col-md-4 col-lg-2">
          <div class="score-card">
            <div class="score-label">Ngữ Pháp</div>
            <div class="score-value text-primary">${gramVal != null ? Number(gramVal).toFixed(1) : '--'}</div>
            <div class="score-sub">Cấu trúc câu</div>
          </div>
        </div>
        <div class="col-6 col-md-4 col-lg-2">
          <div class="score-card">
            <div class="score-label">Ngữ Cảnh</div>
            <div class="score-value text-info">${ctxVal != null ? Number(ctxVal).toFixed(1) : '--'}</div>
            <div class="score-sub">Phản xạ & Ý</div>
          </div>
        </div>
        <div class="col-6 col-md-4 col-lg-2">
          <div class="score-card">
            <div class="score-label">Accuracy</div>
            <div class="score-value">${(a.score_accuracy || 0).toFixed(1)}</div>
            <div class="score-sub">Phát âm âm vị</div>
          </div>
        </div>
        <div class="col-6 col-md-4 col-lg-2">
          <div class="score-card">
            <div class="score-label">Fluency</div>
            <div class="score-value">${(a.score_fluency || 0).toFixed(1)}</div>
            <div class="score-sub">Độ lưu loát</div>
          </div>
        </div>
        <div class="col-6 col-md-4 col-lg-2">
          <div class="score-card">
            <div class="score-label">Prosody</div>
            <div class="score-value">${(a.score_prosodic || 0).toFixed(1)}</div>
            <div class="score-sub">Ngữ điệu nói</div>
          </div>
        </div>
      </div>` : `
      <div class="row g-3">
        <div class="col-6 col-lg-3">
          <div class="score-card score-card-total">
            <div class="score-label">Tổng</div>
            <div class="score-value">${(a.score_total || 0).toFixed(1)}</div>
            <div class="score-sub">/ 10</div>
          </div>
        </div>
        <div class="col-6 col-lg-3">
          <div class="score-card">
            <div class="score-label">Accuracy</div>
            <div class="score-value">${(a.score_accuracy || 0).toFixed(1)}</div>
            <div class="score-sub">/ 10</div>
          </div>
        </div>
        <div class="col-6 col-lg-3">
          <div class="score-card">
            <div class="score-label">Fluency</div>
            <div class="score-value">${(a.score_fluency || 0).toFixed(1)}</div>
            <div class="score-sub">/ 10</div>
          </div>
        </div>
        <div class="col-6 col-lg-3">
          <div class="score-card">
            <div class="score-label">Prosody</div>
            <div class="score-value">${(a.score_prosodic || 0).toFixed(1)}</div>
            <div class="score-sub">/ 10</div>
          </div>
        </div>
      </div>`;

          // AI Feedback HTML
          let tfHtml = '';
          if (aiEval) {
            let innerHtml = `
              <div class="mb-3">
                <div class="fw-semibold text-white mb-2 d-flex align-items-center gap-2">
                  <i class="bi bi-robot text-primary fs-5"></i>
                  <span>Nhận Xét Sư Phạm từ AI Evaluator</span>
                  <span class="badge bg-primary-subtle text-primary border border-primary-subtle smaller">Chuẩn Khảo Thí</span>
                </div>
                <div class="text-light text-opacity-90 small lh-base p-3 rounded-3" style="background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(255,255,255,0.08);">
                  ${simpleMarkdown(aiEval.conversation_summary || '')}
                </div>
              </div>`;

            if (aiEval.grammar_errors && aiEval.grammar_errors.length > 0) {
              innerHtml += `
                <div class="mb-3">
                  <div class="small fw-semibold text-warning mb-2">
                    <i class="bi bi-exclamation-triangle-fill me-1"></i>Các điểm ngữ pháp & cấu trúc cần cải thiện:
                  </div>
                  <div class="d-flex flex-column gap-2">
                    ${aiEval.grammar_errors.map(ge => `
                      <div class="p-2 rounded bg-dark border border-secondary border-opacity-25 small">
                        <div class="d-flex align-items-center flex-wrap gap-2 mb-1">
                          <span class="badge bg-danger-subtle text-danger border border-danger-subtle smaller">Học viên nói</span>
                          <span class="text-danger font-monospace">"${ge.error_text}"</span>
                          <i class="bi bi-arrow-right text-muted"></i>
                          <span class="badge bg-success-subtle text-success border border-success-subtle smaller">Sửa chuẩn</span>
                          <span class="text-success fw-bold font-monospace">"${ge.fix}"</span>
                        </div>
                        ${ge.explanation ? `<div class="text-muted smaller">${ge.explanation}</div>` : ''}
                      </div>
                    `).join('')}
                  </div>
                </div>`;
            }

            if (aiEval.communication_tips && aiEval.communication_tips.length > 0) {
              innerHtml += `
                <div class="mb-2">
                  <div class="small fw-semibold text-info mb-1">
                    <i class="bi bi-lightbulb-fill me-1"></i>Lời khuyên phản xạ & giao tiếp tự nhiên:
                  </div>
                  <ul class="mb-0 ps-3 small text-muted">
                    ${aiEval.communication_tips.map(tip => `<li>${tip}</li>`).join('')}
                  </ul>
                </div>`;
            }

            if (aiEval.better_dialogue_expressions && aiEval.better_dialogue_expressions.length > 0) {
              innerHtml += `
                <div class="mt-3 pt-2 border-top border-secondary border-opacity-25">
                  <div class="small fw-semibold text-success mb-1">
                    <i class="bi bi-chat-quote-fill me-1"></i>Cách diễn đạt mẫu tự nhiên, nâng cao:
                  </div>
                  <div class="small text-light fst-italic ps-2 border-start border-success border-2">
                    "${aiEval.better_dialogue_expressions.join('" / "')}"
                  </div>
                </div>`;
            }

            tfHtml = `
              <div class="section-card mb-4 tf-feedback-section">
                <div class="d-flex justify-content-between align-items-center mb-3">
                  <h6 class="fw-bold mb-0"><i class="bi bi-robot me-2 text-info"></i>Đánh Giá Toàn Diện của AI Evaluator</h6>
                  <span class="badge bg-success-subtle text-success border border-success-subtle smaller">Đã hiệu chuẩn</span>
                </div>
                <div>${innerHtml}</div>
              </div>`;
          } else if (otf.summary) {
            tfHtml = `
              <div class="section-card mb-4 tf-feedback-section">
                <h6 class="fw-bold mb-3"><i class="bi bi-cpu me-2 text-info"></i>Phân tích AI Chi tiết (Transformer)</h6>
                <div class="mb-3 p-3 rounded-3" style="background: rgba(79, 70, 229, 0.08); border-left: 3px solid var(--color-indigo);">
                  ${simpleMarkdown(otf.summary)}
                </div>
              </div>`;
          }

          document.getElementById('assessDetailBody').innerHTML = `
    <!-- Score overview -->
    <div class="section-card mb-4">
      <div class="d-flex justify-content-between align-items-start mb-4 flex-wrap gap-2">
        <div>
          <h6 class="fw-bold mb-1"><i class="bi bi-bar-chart-line me-2 text-primary"></i>Điểm Đánh Giá Toàn Diện Cuộc Hội Thoại</h6>
          <p class="text-muted smaller mb-0">Kết hợp Phát âm âm học & Khảo thí Ngữ pháp/Ngữ cảnh (AI Evaluator)</p>
        </div>
        <div class="d-flex align-items-center gap-2">
          <span class="badge bg-primary-subtle text-primary border border-primary-subtle small"><i class="bi bi-stars me-1"></i>AI Evaluator</span>
          ${levelBadgeHtml}
        </div>
      </div>
      ${scoresGridHtml}
    </div>

    ${tfHtml}

    <!-- Dialogue timeline -->
    <div class="section-card mb-4">
      <h6 class="fw-bold mb-4"><i class="bi bi-chat-left-text me-2 text-primary"></i>Chi tiết từng lượt nói</h6>
      <div class="timeline">${turns.map(renderTurnApi).join('')}</div>
    </div>
  `;
          bootstrap.Modal.getOrCreateInstance(document.getElementById('assessDetailModal')).show();
        };

        function simpleMarkdown(text) {
          return text
            .replace(/##\s+(.+)/g, '<h6 class="fw-bold mt-3">$1</h6>')
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.+?)\*/g, '<em>$1</em>')
            .replace(/`(.+?)`/g, '<code class="text-warning">$1</code>')
            .replace(/\n- (.+)/g, '<li>$1</li>')
            .replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>')
            .replace(/\n/g, '<br>');
        }

        function showToast(msg, type = 'info') {
          const t = document.createElement('div');
          t.className = `toast-notification toast-${type}`;
          t.innerHTML = `<i class="bi bi-check-circle me-2"></i>${msg}`;
          document.body.appendChild(t);
          setTimeout(() => t.classList.add('show'), 10);
          setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 3000);
        }

        document.getElementById('reEnrollVoiceBtn').addEventListener('click', () => {
          buildSentencesList();
          new bootstrap.Modal(document.getElementById('voiceModal')).show();
        });

        function setLoading(btn, isLoading) {
          if (isLoading) {
            btn.disabled = true;
            btn.querySelector('.btn-text').classList.add('d-none');
            btn.querySelector('.btn-loader').classList.remove('d-none');
          } else {
            btn.disabled = false;
            btn.querySelector('.btn-text').classList.remove('d-none');
            btn.querySelector('.btn-loader').classList.add('d-none');
          }
        }
        // ── VOICE ENROLLMENT ──────────────────────────────────────
        // Upload file
        const dropzone = document.getElementById('voiceDropzone');
        const fileInput = document.getElementById('voiceFileInput');
        let uploadedFiles = [];

        dropzone.addEventListener('click', () => fileInput.click());
        dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('dragover'); });
        dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
        dropzone.addEventListener('drop', (e) => {
          e.preventDefault();
          dropzone.classList.remove('dragover');
          handleFileSelect(e.dataTransfer.files);
        });
        fileInput.addEventListener('change', () => handleFileSelect(fileInput.files));
        document.getElementById('removeUploadBtn').addEventListener('click', () => {
          uploadedFiles = [];
          document.getElementById('uploadedAudioPreview').classList.add('d-none');
          document.getElementById('saveVoiceBtn').disabled = true;
          fileInput.value = '';
        });

        async function handleFileSelect(files) {
          if (!files || files.length === 0) return;
          const validFiles = Array.from(files).filter(f => {
            const isAudio = f.type.startsWith('audio/') || f.type === 'video/mp4' || f.name.match(/\.(wav|mp3|m4a|ogg|webm|aac)$/i);
            return isAudio && f.size <= 10 * 1024 * 1024;
          });
          if (validFiles.length === 0) { alert('Vui lòng chọn file audio hợp lệ (<10MB)!'); return; }

          uploadedFiles = validFiles;
          const titleEl = document.getElementById('uploadedFileName');
          titleEl.innerHTML = `<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Đang kiểm tra ${validFiles.length} file...`;

          const listContainer = document.getElementById('uploadedFilesList');
          listContainer.innerHTML = '';

          validFiles.forEach((file, index) => {
            const url = URL.createObjectURL(file);
            const fileHtml = `
            <div class="d-flex align-items-center gap-3 p-2 rounded-2 border">
              <i class="bi bi-file-music text-primary fs-5"></i>
              <div class="flex-grow-1 overflow-hidden">
                <div class="fw-semibold text-truncate small">${index + 1}. ${file.name}</div>
                <audio controls class="w-100 mt-1" style="height: 30px;" src="${url}"></audio>
              </div>
            </div>
          `;
            listContainer.innerHTML += fileHtml;
          });

          document.getElementById('uploadedAudioPreview').classList.remove('d-none');
          document.getElementById('saveVoiceBtn').disabled = true;

          // ── AI CHECK NGAY LẬP TỨC ──
          try {
            if (validFiles.length === 1) {
              // Chỉ up 1 file thì mặc định làm mẫu gốc
              await fetchEmbeddingFromBackend(validFiles[0]); // Chạy test thử xem file có lỗi ko
              titleEl.innerHTML = `Đã chọn 1 file (Mẫu gốc) <i class="bi bi-check-circle-fill text-success"></i>`;
              document.getElementById('saveVoiceBtn').disabled = false;
            } else {
              const embeddings = [];
              for (const file of validFiles) {
                embeddings.push(await fetchEmbeddingFromBackend(file));
              }
              let totalSim = 0;
              let count = 0;
              for (let i = 0; i < embeddings.length; i++) {
                for (let j = i + 1; j < embeddings.length; j++) {
                  totalSim += cosineSimilarity(embeddings[i], embeddings[j]);
                  count++;
                }
              }
              const avgSim = totalSim / count;
              const percent = Math.round(avgSim * 100);

              if (avgSim < 0.5) {
                titleEl.innerHTML = `<span class="text-danger">Đã chọn ${validFiles.length} file (Không khớp: ${percent}%) ❌</span>`;
                alert(`⚠️ Các file âm thanh không đồng nhất (Độ khớp: ${percent}%). Có thể do tiếng ồn hoặc nhiều người cùng nói. Vui lòng chọn lại!`);
              } else {
                titleEl.innerHTML = `Đã chọn ${validFiles.length} file (Độ khớp: ${percent}%) <i class="bi bi-check-circle-fill text-success"></i>`;
                document.getElementById('saveVoiceBtn').disabled = false;
              }
            }
          } catch (err) {
            titleEl.innerHTML = `<span class="text-danger">Lỗi: File âm thanh không hợp lệ hoặc quá nhỏ! ❌</span>`;
            alert("Lỗi kiểm tra giọng: " + err.message);
          }
        }

        // Record
        const recorderStates = {};
        function buildSentencesList() {
          const container = document.getElementById('sentencesList');
          container.innerHTML = ENROLLMENT_SENTENCES.map((s, i) => `
    <div class="sentence-item p-3 rounded-3" id="sentence-${i}">
      <div class="d-flex align-items-start gap-3">
        <div class="sentence-idx">${i + 1}</div>
        <div class="flex-grow-1">
          <div class="sentence-text mb-2">"${s}"</div>
          <div class="d-flex align-items-center gap-2 flex-wrap">
            <button class="btn btn-sm btn-outline-primary record-btn" data-idx="${i}">
              <i class="bi bi-mic-fill me-1"></i>Ghi âm
            </button>
            <audio class="sentence-audio d-none" data-idx="${i}" controls></audio>
            <span class="badge bg-secondary status-badge" id="status-${i}">Chưa ghi</span>
          </div>
        </div>
      </div>
    </div>
  `).join('');

          document.querySelectorAll('.record-btn').forEach(btn => {
            btn.addEventListener('click', () => toggleRecord(parseInt(btn.dataset.idx)));
          });
        }

        async function toggleRecord(idx) {
          const state = recorderStates[idx];
          const btn = document.querySelector(`.record-btn[data-idx="${idx}"]`);
          const statusEl = document.getElementById(`status-${idx}`);
          const audioEl = document.querySelector(`.sentence-audio[data-idx="${idx}"]`);
          const item = document.getElementById(`sentence-${idx}`);

          if (!state || state.status !== 'recording') {
            // Start recording with WebRTC Noise Suppression & Echo Cancellation
            try {
              const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                  noiseSuppression: true,
                  echoCancellation: true,
                  autoGainControl: true
                }
              });
              const recorder = new MediaRecorder(stream);
              const chunks = [];
              recorder.ondataavailable = e => chunks.push(e.data);
              recorder.onstop = async () => {
                const blob = new Blob(chunks, { type: 'audio/webm' });

                // Progressive Check
                btn.innerHTML = '<i class="spinner-border spinner-border-sm me-1"></i>Kiểm tra...';
                btn.disabled = true;
                try {
                  const emb = await fetchEmbeddingFromBackend(blob);

                  const prevEmbeddings = [];
                  for (let i = 0; i < ENROLLMENT_SENTENCES.length; i++) {
                    if (i !== idx && recorderStates[i]?.embedding) {
                      prevEmbeddings.push(recorderStates[i].embedding);
                    }
                  }

                  let avgSim = null;
                  if (prevEmbeddings.length > 0) {
                    let totalSim = 0;
                    for (const prevEmb of prevEmbeddings) {
                      totalSim += cosineSimilarity(emb, prevEmb);
                    }
                    avgSim = totalSim / prevEmbeddings.length;
                    if (avgSim < 0.5) {
                      alert(`⚠️ Giọng đọc này không giống với các câu trước đó (Độ tương đồng: ${Math.round(avgSim * 100)}%). Vui lòng đọc lại!`);
                      delete recorderStates[idx].blob;
                      delete recorderStates[idx].embedding;
                      statusEl.className = 'badge bg-danger status-badge';
                      statusEl.textContent = `Thất bại (${Math.round(avgSim * 100)}%) ❌`;
                      item.classList.remove('recorded');
                      btn.innerHTML = '<i class="bi bi-arrow-repeat me-1"></i>Ghi lại';
                      btn.className = 'btn btn-sm btn-outline-danger record-btn';
                      btn.disabled = false;
                      checkAllRecorded();
                      return;
                    }
                  }

                  recorderStates[idx].blob = blob;
                  recorderStates[idx].embedding = emb;
                  audioEl.src = URL.createObjectURL(blob);
                  audioEl.classList.remove('d-none');
                  statusEl.className = 'badge bg-success status-badge';
                  if (avgSim !== null) {
                    statusEl.textContent = `Đã ghi ✓ (Khớp ${Math.round(avgSim * 100)}%)`;
                  } else {
                    statusEl.textContent = 'Đã ghi ✓ (Mẫu gốc)';
                  }
                  item.classList.add('recorded');
                  btn.innerHTML = '<i class="bi bi-arrow-repeat me-1"></i>Ghi lại';
                  btn.className = 'btn btn-sm btn-outline-warning record-btn';
                } catch (err) {
                  alert("Lỗi kiểm tra giọng: " + err.message);
                  delete recorderStates[idx].blob;
                  delete recorderStates[idx].embedding;
                  statusEl.className = 'badge bg-danger status-badge';
                  statusEl.textContent = 'Lỗi ❌';
                  btn.innerHTML = '<i class="bi bi-arrow-repeat me-1"></i>Ghi lại';
                  btn.className = 'btn btn-sm btn-outline-danger record-btn';
                } finally {
                  btn.disabled = false;
                  stream.getTracks().forEach(t => t.stop());
                  checkAllRecorded();
                }
              };
              recorder.start();
              recorderStates[idx] = { status: 'recording', recorder, stream };
              btn.innerHTML = '<i class="bi bi-stop-fill me-1"></i>Dừng';
              btn.className = 'btn btn-sm btn-danger record-btn';
              statusEl.className = 'badge bg-danger status-badge';
              statusEl.textContent = '● Đang ghi...';
            } catch (e) {
              alert('Không thể truy cập microphone: ' + e.message);
            }
          } else {
            // Stop recording
            state.recorder.stop();
            state.status = 'done';
          }
        }

        function checkAllRecorded() {
          const allDone = ENROLLMENT_SENTENCES.every((_, i) => recorderStates[i]?.blob);
          if (allDone) document.getElementById('saveVoiceBtn').disabled = false;
        }

        // Save voice and Finish Registration
        document.getElementById('saveVoiceBtn').addEventListener('click', async () => {
          const btn = document.getElementById('saveVoiceBtn');
          setLoading(btn, true);
          try {
            const isUpload = document.getElementById('voiceUploadPanel').classList.contains('show');
            let voiceUrl;
            let finalEmbeddings = [];
            const tempId = 'new_user_' + Date.now();

            if (isUpload && uploadedFiles.length > 0) {
              btn.querySelector('.btn-text').innerHTML = '<i class="bi bi-cpu me-2"></i>Đang trích xuất...';
              const embeddings = [];
              for (const file of uploadedFiles) {
                embeddings.push(await fetchEmbeddingFromBackend(file));
              }
              finalEmbeddings = embeddings;
              btn.querySelector('.btn-text').innerHTML = '<i class="bi bi-check-circle me-2"></i>Đang lưu...';
              voiceUrl = "";
            } else {
              // Direct Recording
              const allBlobs = ENROLLMENT_SENTENCES.map((_, i) => recorderStates[i]?.blob).filter(Boolean);
              finalEmbeddings = ENROLLMENT_SENTENCES.map((_, i) => recorderStates[i]?.embedding).filter(Boolean);

              btn.querySelector('.btn-text').innerHTML = '<i class="bi bi-check-circle me-2"></i>Đang lưu...';
              voiceUrl = "";
            }

            // Calculate mean embedding
            let meanEmb = [];
            if (finalEmbeddings.length > 0) {
              const dim = finalEmbeddings[0].length;
              meanEmb = new Float32Array(dim);
              for (let i = 0; i < dim; i++) {
                let sum = 0;
                for (const emb of finalEmbeddings) {
                  sum += emb[i];
                }
                meanEmb[i] = sum / finalEmbeddings.length;
              }
              // L2 Normalize
              let norm = 0;
              for (let i = 0; i < dim; i++) {
                norm += meanEmb[i] * meanEmb[i];
              }
              norm = Math.sqrt(norm);
              if (norm > 0) {
                for (let i = 0; i < dim; i++) {
                  meanEmb[i] /= norm;
                }
              }
            }


            // Now do the actual Sign Up
            await updateProfile(currentUser.id, { voice_embeddings: Array.from(meanEmb), voice_enrolled: true });
            await markVoiceEnrolled(currentUser.id, voiceUrl);
            currentProfile.voice_embeddings = Array.from(meanEmb);
            currentProfile.voice_enrolled = true;
            document.getElementById('voiceStatusText').textContent = 'Đã đăng ký mẫu giọng';
            document.getElementById('voiceBadge').innerHTML = '<span class="badge bg-success"><i class="bi bi-check-circle me-1"></i>Đã đăng ký</span>';
            showToast('Đã cập nhật mẫu giọng thành công!', 'success');

            bootstrap.Modal.getInstance(document.getElementById('voiceModal')).hide();
          } catch (e) {
            alert('Lỗi đăng ký: ' + e.message);
            setLoading(btn, false);
          }
        });

        // ══════════════════════════════════════════════════════════
        // TEACHER: QUESTION SETS MANAGEMENT
        // ══════════════════════════════════════════════════════════
        let currentEditSetId = null;
        let currentEditSetPublished = false;
        let currentEditingQuestions = [];
        let currentEditSetData = null;
        let currentEditSetCanEdit = true;
        let currentEditSetIsOwner = true;
        let availableTeachersForPerm = [];

        async function compressImage(file, maxDimension = 1280, quality = 0.85) {
          return new Promise((resolve, reject) => {
            if (!file || !file.type.startsWith('image/')) {
              reject(new Error('Tệp tải lên không phải là hình ảnh hợp lệ!'));
              return;
            }
            const reader = new FileReader();
            reader.onload = (e) => {
              const img = new Image();
              img.onload = () => {
                let width = img.naturalWidth || img.width;
                let height = img.naturalHeight || img.height;
                if (width > maxDimension || height > maxDimension) {
                  if (width > height) {
                    height = Math.round((height * maxDimension) / width);
                    width = maxDimension;
                  } else {
                    width = Math.round((width * maxDimension) / height);
                    height = maxDimension;
                  }
                }
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                const dataUrl = canvas.toDataURL('image/jpeg', quality);
                resolve(dataUrl);
              };
              img.onerror = () => reject(new Error('Không thể đọc dữ liệu hình ảnh!'));
              img.src = e.target.result;
            };
            reader.onerror = () => reject(new Error('Lỗi khi đọc file ảnh!'));
            reader.readAsDataURL(file);
          });
        }

        async function handleImageFileUpload(file) {
          if (!file) return;
          try {
            const dataUrl = await compressImage(file);
            const imgInput = document.getElementById('qImageUrlInput');
            if (imgInput) imgInput.value = dataUrl;
            updateQuestionImagePreview(dataUrl);
            showToast('Đã tải và tối ưu ảnh thành công!', 'success');
          } catch (err) {
            alert(err.message || 'Không thể xử lý ảnh tải lên!');
          }
        }

        function updateQuestionImagePreview(url) {
          const promptEl = document.getElementById('qImageUploadPrompt');
          const container = document.getElementById('qImagePreviewContainer');
          const previewImg = document.getElementById('qImagePreview');
          if (!container || !previewImg) return;
          const cleanUrl = (url || '').trim();
          if (cleanUrl) {
            previewImg.src = cleanUrl;
            previewImg.onload = () => {
              container.classList.remove('d-none');
              if (promptEl) promptEl.classList.add('d-none');
            };
            previewImg.onerror = () => {
              container.classList.add('d-none');
              if (promptEl) promptEl.classList.remove('d-none');
            };
          } else {
            previewImg.src = '';
            container.classList.add('d-none');
            if (promptEl) promptEl.classList.remove('d-none');
            const fileInput = document.getElementById('qImageFileInput');
            if (fileInput) fileInput.value = '';
          }
        }

        function getExamTypeName(examType = 'general') {
          const map = {
            toeic: 'TOEIC Speaking',
            vstep: 'VSTEP Speaking',
            ielts: 'IELTS Speaking',
            general: 'Luyện tập chung'
          };
          return map[(examType || 'general').toLowerCase()] || 'Luyện tập chung';
        }

        function configureQuestionModalForTaskType(taskType, isInitialOrTypeChange = false) {
          const t = TASK_TYPES[taskType] || TASK_TYPES['short_qa'];

          if (isInitialOrTypeChange && t) {
            const prepInput = document.getElementById('qPrepTimeInput');
            const respInput = document.getElementById('qResponseTimeInput');
            if (prepInput) prepInput.value = t.defaultPrep;
            if (respInput) respInput.value = t.defaultResponse;
          }

          const imgArea = document.getElementById('qImageArea');
          const refArea = document.getElementById('qReferenceArea');
          const refLabel = document.getElementById('qReferenceLabel');
          const refInput = document.getElementById('qReferenceInput');
          const refHint = document.getElementById('qReferenceHint');
          const textLabel = document.getElementById('qTextLabel');
          const textInput = document.getElementById('qTextInput');

          if (taskType === 'read_aloud') {
            if (imgArea) imgArea.classList.add('d-none');
            if (refArea) refArea.classList.add('d-none');
            if (textLabel) textLabel.innerHTML = '<i class="bi bi-megaphone-fill me-1 text-primary"></i>Đoạn văn bản cần đọc to (Reading Passage) *';
            if (textInput) {
              textInput.rows = 4;
              textInput.placeholder = 'Nhập đoạn văn bản tiếng Anh cần đọc to (khoảng 40-70 từ)...';
            }
          } else if (taskType === 'picture_description') {
            if (imgArea) imgArea.classList.remove('d-none');
            if (refArea) refArea.classList.add('d-none');
            if (textLabel) textLabel.innerHTML = '<i class="bi bi-chat-left-text-fill me-1 text-primary"></i>Câu lệnh đề bài cho học viên (Instruction) *';
            if (textInput) {
              textInput.rows = 2;
              if (isInitialOrTypeChange && !textInput.value.trim()) {
                textInput.value = 'Describe what you see in the picture in as much detail as possible.';
              }
              textInput.placeholder = 'VD: Describe what you see in the picture in as much detail as possible.';
            }
          } else if (taskType === 'information_qa') {
            if (imgArea) imgArea.classList.add('d-none');
            if (refArea) refArea.classList.remove('d-none');
            if (refLabel) refLabel.innerHTML = '<i class="bi bi-file-earmark-spreadsheet-fill me-1 text-info"></i>Bảng thông tin / Lịch trình / Bảng biểu cho sẵn (Schedule / Agenda) *';
            if (refInput) refInput.placeholder = 'Nhập bảng thông tin, lịch trình hoặc thông báo cho sẵn...\nVí dụ:\nCONFERENCE SCHEDULE\n- 09:00 AM: Keynote Speech by Dr. John Smith (Room A)\n- 10:30 AM: Coffee Break\n- 11:00 AM: Workshop on AI (Room B)';
            if (refHint) refHint.innerHTML = 'Thí sinh sẽ quan sát bảng dữ liệu này trong suốt quá trình chuẩn bị và trả lời câu hỏi.';
            if (textLabel) textLabel.innerHTML = '<i class="bi bi-question-circle-fill me-1 text-warning"></i>Câu hỏi truy vấn dựa trên thông tin cho sẵn *';
            if (textInput) {
              textInput.rows = 2;
              textInput.placeholder = 'VD: What time does the conference begin, and where will it be held?';
            }
          } else if (taskType === 'long_turn') {
            if (imgArea) imgArea.classList.add('d-none');
            if (refArea) refArea.classList.remove('d-none');
            if (refLabel) refLabel.innerHTML = '<i class="bi bi-card-checklist me-1 text-warning"></i>Các gợi ý triển khai ý (Cue Card Points: You should say - Mỗi dòng 1 ý) *';
            if (refInput) refInput.placeholder = 'You should say:\n- Who this person is\n- What they do\n- How you know them\n- And explain why you admire or respect this person.';
            if (refHint) refHint.innerHTML = 'Mỗi dòng sẽ được hiển thị như một gạch đầu dòng trong Thẻ Cue Card hướng dẫn thí sinh.';
            if (textLabel) textLabel.innerHTML = '<i class="bi bi-journal-text me-1 text-primary"></i>Chủ đề thuyết trình chính (Cue Card Topic) *';
            if (textInput) {
              textInput.rows = 2;
              textInput.placeholder = 'VD: Describe an influential person you admire.';
            }
          } else if (taskType === 'problem_solution') {
            if (imgArea) imgArea.classList.add('d-none');
            if (refArea) refArea.classList.remove('d-none');
            if (refLabel) refLabel.innerHTML = '<i class="bi bi-lightbulb-fill me-1 text-success"></i>Các phương án lựa chọn gợi ý (Options - Mỗi dòng 1 phương án, tùy chọn)';
            if (refInput) refInput.placeholder = '- Option 1: Organize an outdoor team-building trip\n- Option 2: Rent an indoor cinema / amusement hall\n- Option 3: Host a virtual celebration online';
            if (refHint) refHint.innerHTML = 'Các phương án này sẽ hiển thị dưới dạng thẻ gợi ý để học viên phân tích và lựa chọn.';
            if (textLabel) textLabel.innerHTML = '<i class="bi bi-exclamation-triangle-fill me-1 text-danger"></i>Tình huống / Vấn đề cần giải quyết (Situation / Problem) *';
            if (textInput) {
              textInput.rows = 3;
              textInput.placeholder = 'VD: Your company is organizing an annual trip, but the budget has been cut by 30%. You need to choose the best travel plan...';
            }
          } else if (taskType === 'opinion') {
            if (imgArea) imgArea.classList.add('d-none');
            if (refArea) refArea.classList.add('d-none');
            if (textLabel) textLabel.innerHTML = '<i class="bi bi-chat-left-quote-fill me-1 text-primary"></i>Chủ đề bày tỏ quan điểm & Lập luận (Opinion Topic) *';
            if (textInput) {
              textInput.rows = 3;
              textInput.placeholder = 'VD: Do you agree or disagree with the statement: "Working remotely is more effective than working in an office"? Give reasons and examples.';
            }
          } else if (taskType === 'description') {
            if (imgArea) imgArea.classList.add('d-none');
            if (refArea) refArea.classList.add('d-none');
            if (textLabel) textLabel.innerHTML = '<i class="bi bi-card-text me-1 text-info"></i>Yêu cầu miêu tả chi tiết (Description Prompt) *';
            if (textInput) {
              textInput.rows = 2;
              textInput.placeholder = 'VD: Describe a special place in your city that tourists often visit.';
            }
          } else if (taskType === 'experience_future') {
            if (imgArea) imgArea.classList.add('d-none');
            if (refArea) refArea.classList.add('d-none');
            if (textLabel) textLabel.innerHTML = '<i class="bi bi-compass-fill me-1 text-info"></i>Câu hỏi về Trải nghiệm / Kế hoạch tương lai *';
            if (textInput) {
              textInput.rows = 2;
              textInput.placeholder = 'VD: Talk about a memorable trip you took in the past. Where did you go and what did you do?';
            }
          } else if (taskType === 'discussion') {
            if (imgArea) imgArea.classList.add('d-none');
            if (refArea) refArea.classList.add('d-none');
            if (textLabel) textLabel.innerHTML = '<i class="bi bi-people-fill me-1 text-primary"></i>Chủ đề thảo luận chuyên sâu / Trừu tượng (Discussion Topic) *';
            if (textInput) {
              textInput.rows = 3;
              textInput.placeholder = 'VD: In your opinion, how might artificial intelligence affect employment opportunities in the future?';
            }
          } else {
            if (imgArea) imgArea.classList.add('d-none');
            if (refArea) refArea.classList.add('d-none');
            if (textLabel) textLabel.innerHTML = '<i class="bi bi-chat-dots-fill me-1 text-info"></i>Câu hỏi giao tiếp / Hỏi đáp cá nhân *';
            if (textInput) {
              textInput.rows = 2;
              textInput.placeholder = 'VD: What kind of sports do you enjoy playing or watching? Why?';
            }
          }
        }

        function populateTaskTypeSelect(examType, selectedTaskType = null) {
          const taskSel = document.getElementById('qTaskTypeSelect');
          if (!taskSel) return;
          const currentExam = (examType || 'general').toLowerCase();
          const availableTypes = getAvailableTaskTypes(currentExam);

          const validIds = availableTypes.map(t => t.id || t.key);
          if (selectedTaskType && !validIds.includes(selectedTaskType) && TASK_TYPES[selectedTaskType]) {
            availableTypes.push({
              ...TASK_TYPES[selectedTaskType],
              id: selectedTaskType,
              key: selectedTaskType,
              status: 'primary',
            });
            validIds.push(selectedTaskType);
          }
          if (!selectedTaskType || !validIds.includes(selectedTaskType)) {
            selectedTaskType = validIds[0] || 'short_qa';
          }

          taskSel.innerHTML = availableTypes.map(t => {
            const taskId = t.id || t.key;
            const isSelected = taskId === selectedTaskType ? 'selected' : '';
            return `<option value="${taskId}" ${isSelected}>${t.label} – ${t.title}</option>`;
          }).join('');

          taskSel.value = selectedTaskType;
          configureQuestionModalForTaskType(selectedTaskType, true);
        }

        function initQuestionSetsUI() {
          document.getElementById('createQSetBtn').addEventListener('click', async () => {
            try {
              const newSet = await createQuestionSet(currentUser.id, {
                title: 'Bộ đề mới',
                description: '',
                level: 'intermediate',
              });
              openQuestionSetEditor(newSet.id);
            } catch (e) {
              alert('Lỗi tạo bộ đề: ' + e.message);
            }
          });

          document.getElementById('backToQSetsBtn').addEventListener('click', () => {
            currentEditSetId = null;
            currentEditSetData = null;
            const editPage = document.getElementById('page-teacher-questionset-edit');
            const mainPage = document.getElementById('page-teacher-questionsets');
            if (editPage) editPage.classList.add('d-none');
            if (mainPage) mainPage.classList.remove('d-none');
            if (typeof navigateTo === 'function') {
              navigateTo('questionsets');
            } else {
              renderQuestionSets();
            }
          });

          // Lắng nghe thay đổi loại đề thi / chuẩn ngay lập tức
          const examTypeSelect = document.getElementById('qsetExamTypeSelect');
          if (examTypeSelect) {
            examTypeSelect.addEventListener('change', async (e) => {
              const newExam = e.target.value;
              if (currentEditSetData) {
                currentEditSetData.exam_type = newExam;
              }
              if (currentEditSetId && currentEditSetCanEdit) {
                try {
                  await updateQuestionSet(currentEditSetId, { exam_type: newExam });
                  showToast(`Đã chuyển chuẩn đề thi sang ${getExamTypeName(newExam)}`, 'info');
                } catch (err) {
                  console.warn('Lỗi lưu ngầm exam_type:', err);
                }
              }
            });
          }

          // Save set info
          document.getElementById('saveQSetInfoBtn').addEventListener('click', async () => {
            if (!currentEditSetCanEdit) { alert('Bạn không có quyền chỉnh sửa thông tin bộ đề này!'); return; }
            const title = document.getElementById('qsetTitleInput').value.trim();
            if (!title) { alert('Vui lòng nhập tên bộ đề!'); return; }
            const desc = document.getElementById('qsetDescInput').value.trim();
            const level = document.getElementById('qsetLevelSelect').value;
            const examType = document.getElementById('qsetExamTypeSelect').value;

            try {
              await updateQuestionSet(currentEditSetId, { title, description: desc, level, exam_type: examType });
              document.getElementById('qsetEditorTitle').textContent = title;
              if (currentEditSetData) currentEditSetData.exam_type = examType;
              showToast('Đã lưu thông tin bộ đề!', 'success');
            } catch (e) {
              alert('Lỗi: ' + e.message);
            }
          });

          // Toggle publish
          document.getElementById('togglePublishBtn').addEventListener('click', async () => {
            if (!currentEditSetCanEdit) { alert('Bạn không có quyền thay đổi trạng thái xuất bản bộ đề này!'); return; }
            try {
              const targetStatus = !currentEditSetPublished;
              const updated = await togglePublishSet(currentEditSetId, targetStatus);
              currentEditSetPublished = (updated && typeof updated.is_published === 'boolean') ? updated.is_published : targetStatus;
              if (currentEditSetData) currentEditSetData.is_published = currentEditSetPublished;
              updatePublishBtnUI();
              showToast(currentEditSetPublished ? 'Đã xuất bản bộ đề!' : 'Đã chuyển về bản nháp!', 'info');
            } catch (e) {
              alert('Lỗi: ' + e.message);
            }
          });

          // Delete set
          document.getElementById('deleteQSetBtn').addEventListener('click', async () => {
            if (!currentEditSetCanEdit) { alert('Bạn không có quyền xóa bộ đề này!'); return; }
            if (!confirm('Bạn có chắc muốn xóa toàn bộ bộ đề này cùng các câu hỏi?')) return;
            try {
              await deleteQuestionSet(currentEditSetId);
              showToast('Đã xóa bộ đề!', 'success');
              currentEditSetId = null;
              currentEditSetData = null;
              const editPage = document.getElementById('page-teacher-questionset-edit');
              const mainPage = document.getElementById('page-teacher-questionsets');
              if (editPage) editPage.classList.add('d-none');
              if (mainPage) mainPage.classList.remove('d-none');
              if (typeof navigateTo === 'function') {
                navigateTo('questionsets');
              } else {
                renderQuestionSets();
              }
            } catch (e) {
              alert('Lỗi: ' + e.message);
            }
          });

          // Mở modal Phân quyền bộ đề
          const shareBtn = document.getElementById('shareQSetBtn');
          if (shareBtn) {
            shareBtn.addEventListener('click', async () => {
              if (!currentEditSetId || !currentEditSetData) return;
              if (!currentEditSetIsOwner) {
                alert('Chỉ người tạo bộ đề (hoặc Quản trị viên) mới có quyền phân quyền!');
                return;
              }

              const subtitleEl = document.getElementById('permModalSubtitle');
              if (subtitleEl) {
                subtitleEl.innerHTML = `Phân quyền sửa/xóa cho bộ đề: <b class="text-white">${currentEditSetData.title || ''}</b>`;
              }

              const searchInput = document.getElementById('permSearchInput') || document.getElementById('searchPermTeacherInput');
              if (searchInput) searchInput.value = '';

              const listEl = document.getElementById('permTeachersList');
              listEl.innerHTML = `
                <div class="text-center py-4 text-muted">
                  <span class="spinner-border spinner-border-sm me-2"></span>Đang tải danh sách giáo viên...
                </div>`;

              bootstrap.Modal.getOrCreateInstance(document.getElementById('qsetPermissionsModal')).show();

              try {
                availableTeachersForPerm = await fetchTeachersList(currentUser.id);
                renderPermissionsTeacherList();
              } catch (err) {
                listEl.innerHTML = `<div class="text-danger p-3">Lỗi tải danh sách giáo viên: ${err.message}</div>`;
              }
            });
          }

          // Tìm kiếm giáo viên trong modal phân quyền
          const searchPermInput = document.getElementById('permSearchInput') || document.getElementById('searchPermTeacherInput');
          if (searchPermInput) {
            searchPermInput.addEventListener('input', (e) => {
              const query = e.target.value.toLowerCase().trim();
              const items = document.querySelectorAll('.perm-teacher-item');
              items.forEach(item => {
                const name = item.getAttribute('data-name') || '';
                const email = item.getAttribute('data-email') || '';
                if (name.includes(query) || email.includes(query)) {
                  item.classList.remove('d-none');
                } else {
                  item.classList.add('d-none');
                }
              });
            });
          }

          // Chọn tất cả giáo viên trong modal phân quyền
          const permSelectAllBtn = document.getElementById('permSelectAllBtn');
          if (permSelectAllBtn) {
            permSelectAllBtn.addEventListener('click', () => {
              document.querySelectorAll('.perm-teacher-checkbox').forEach(cb => {
                const item = cb.closest('.perm-teacher-item');
                if (!item || !item.classList.contains('d-none')) {
                  cb.checked = true;
                }
              });
            });
          }

          // Bỏ chọn tất cả giáo viên trong modal phân quyền
          const permDeselectAllBtn = document.getElementById('permDeselectAllBtn');
          if (permDeselectAllBtn) {
            permDeselectAllBtn.addEventListener('click', () => {
              document.querySelectorAll('.perm-teacher-checkbox').forEach(cb => {
                const item = cb.closest('.perm-teacher-item');
                if (!item || !item.classList.contains('d-none')) {
                  cb.checked = false;
                }
              });
            });
          }

          // Lưu phân quyền
          const savePermBtn = document.getElementById('savePermissionsBtn') || document.getElementById('savePermBtn');
          if (savePermBtn) {
            savePermBtn.addEventListener('click', async () => {
              if (!currentEditSetId) return;
              const btn = savePermBtn;
              const originalText = btn.innerHTML;
              btn.disabled = true;
              btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Đang lưu...';

              try {
                const checkedCheckboxes = document.querySelectorAll('.perm-teacher-checkbox:checked');
                const allowedTeacherIds = Array.from(checkedCheckboxes).map(cb => cb.value);

                await updateQuestionSetPermissions(currentEditSetId, allowedTeacherIds);
                if (currentEditSetData) {
                  currentEditSetData.allowed_teacher_ids = allowedTeacherIds;
                }

                bootstrap.Modal.getOrCreateInstance(document.getElementById('qsetPermissionsModal')).hide();
                showToast(`Đã lưu phân quyền cho ${allowedTeacherIds.length} giáo viên!`, 'success');
              } catch (err) {
                alert('Lỗi lưu phân quyền: ' + err.message);
              } finally {
                btn.disabled = false;
                btn.innerHTML = originalText;
              }
            });
          }

          // Sự kiện đổi dạng đề bài trong modal tạo/sửa câu hỏi
          const qTaskSelect = document.getElementById('qTaskTypeSelect');
          if (qTaskSelect) {
            qTaskSelect.addEventListener('change', (e) => {
              const val = e.target.value;
              configureQuestionModalForTaskType(val, true);
            });
          }

          // Sự kiện xem trước và upload ảnh thật
          const qImgInput = document.getElementById('qImageUrlInput');
          const qFileInput = document.getElementById('qImageFileInput');
          const qDropzone = document.getElementById('qImageDropzone');
          const qBrowseBtn = document.getElementById('qImageBrowseBtn');
          const qImgClearBtn = document.getElementById('qImageClearBtn');

          if (qBrowseBtn && qFileInput) {
            qBrowseBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              qFileInput.click();
            });
          }

          if (qDropzone && qFileInput) {
            qDropzone.addEventListener('click', (e) => {
              if (e.target.closest('#qImageClearBtn')) return;
              if (document.getElementById('qImagePreviewContainer')?.classList.contains('d-none')) {
                qFileInput.click();
              }
            });

            qDropzone.addEventListener('dragover', (e) => {
              e.preventDefault();
              qDropzone.style.borderColor = '#0d6efd';
              qDropzone.style.background = 'rgba(13, 110, 253, 0.08)';
            });

            qDropzone.addEventListener('dragleave', (e) => {
              e.preventDefault();
              qDropzone.style.borderColor = '';
              qDropzone.style.background = 'rgba(255,255,255,0.03)';
            });

            qDropzone.addEventListener('drop', (e) => {
              e.preventDefault();
              qDropzone.style.borderColor = '';
              qDropzone.style.background = 'rgba(255,255,255,0.03)';
              if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                const file = e.dataTransfer.files[0];
                handleImageFileUpload(file);
              }
            });
          }

          if (qFileInput) {
            qFileInput.addEventListener('change', (e) => {
              if (e.target.files && e.target.files.length > 0) {
                handleImageFileUpload(e.target.files[0]);
              }
            });
          }

          if (qImgInput) {
            qImgInput.addEventListener('input', (e) => {
              updateQuestionImagePreview(e.target.value);
            });
          }

          if (qImgClearBtn) {
            qImgClearBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              if (qImgInput) qImgInput.value = '';
              if (qFileInput) qFileInput.value = '';
              updateQuestionImagePreview('');
            });
          }

          document.getElementById('addQuestionBtn').addEventListener('click', () => {
            if (!currentEditSetCanEdit) { alert('Bạn không có quyền thêm câu hỏi vào bộ đề này!'); return; }
            document.getElementById('editQuestionId').value = '';
            document.getElementById('qPartTitleInput').value = '';
            document.getElementById('qTextInput').value = '';
            if (qImgInput) qImgInput.value = '';
            updateQuestionImagePreview('');
            const refInput = document.getElementById('qReferenceInput');
            if (refInput) refInput.value = '';

            const currentExam = document.getElementById('qsetExamTypeSelect')?.value || currentEditSetData?.exam_type || 'general';
            populateTaskTypeSelect(currentExam);

            const examLabel = getExamTypeName(currentExam);
            document.getElementById('questionModalTitle').innerHTML =
              `<i class="bi bi-plus-circle me-2 text-primary"></i>Thêm câu hỏi <span class="badge bg-primary-subtle text-primary border border-primary-subtle fs-6 ms-2">${examLabel}</span>`;
            bootstrap.Modal.getOrCreateInstance(document.getElementById('questionModal')).show();
          });

          document.getElementById('saveQuestionBtn').addEventListener('click', async () => {
            if (!currentEditSetCanEdit) { alert('Bạn không có quyền lưu câu hỏi vào bộ đề này!'); return; }
            const qText = document.getElementById('qTextInput').value.trim();
            if (!qText) { alert('Vui lòng nhập câu hỏi / nội dung bài!'); return; }
            const editId = document.getElementById('editQuestionId').value;
            const taskType = document.getElementById('qTaskTypeSelect')?.value || 'short_qa';
            const partTitle = document.getElementById('qPartTitleInput').value.trim() || null;
            const prepTime = parseInt(document.getElementById('qPrepTimeInput').value) || 15;
            const responseTime = parseInt(document.getElementById('qResponseTimeInput').value) || 30;
            const imageUrl = document.getElementById('qImageUrlInput')?.value.trim() || null;
            const refText = document.getElementById('qReferenceInput')?.value.trim() || null;

            try {
              if (editId) {
                await updateQuestion(editId, {
                  question_text: qText,
                  reference_text: refText,
                  image_url: imageUrl,
                  hint: null,
                  part_title: partTitle,
                  task_type: taskType,
                  prep_time: prepTime,
                  response_time: responseTime,
                });
              } else {
                const existingQs = await fetchQuestions(currentEditSetId);
                await addQuestion(currentEditSetId, {
                  question_text: qText,
                  reference_text: refText,
                  image_url: imageUrl,
                  hint: null,
                  order_num: existingQs.length + 1,
                  part_title: partTitle,
                  task_type: taskType,
                  prep_time: prepTime,
                  response_time: responseTime,
                });
              }
              bootstrap.Modal.getOrCreateInstance(document.getElementById('questionModal')).hide();
              showToast(editId ? 'Đã cập nhật câu hỏi!' : 'Đã thêm câu hỏi!', 'success');
              renderQuestionEditor();
            } catch (e) {
              alert('Lỗi: ' + e.message);
            }
          });

          // Filters
          document.getElementById('qsetFilterLevel').addEventListener('change', renderQuestionSets);
          document.getElementById('qsetFilterStatus').addEventListener('change', renderQuestionSets);
          document.getElementById('qsetFilterAuthor')?.addEventListener('change', renderQuestionSets);
        }

        function renderPermissionsTeacherList() {
          const listEl = document.getElementById('permTeachersList');
          if (!availableTeachersForPerm || availableTeachersForPerm.length === 0) {
            listEl.innerHTML = `
              <div class="text-center py-4 text-muted">
                <i class="bi bi-people fs-2 d-block mb-2"></i>
                Không tìm thấy giáo viên đồng nghiệp nào khác trong hệ thống.
              </div>`;
            return;
          }

          const currentAllowed = currentEditSetData?.allowed_teacher_ids || [];

          listEl.innerHTML = availableTeachersForPerm.map(t => {
            const isChecked = Array.isArray(currentAllowed) && currentAllowed.includes(t.id);
            const initial = (t.full_name || t.email || 'T').charAt(0).toUpperCase();
            const roleBadge = t.role === 'admin' 
              ? `<span class="badge bg-danger-subtle text-danger border border-danger-subtle ms-2" style="font-size:0.65rem;">Admin</span>`
              : `<span class="badge bg-info-subtle text-info border border-info-subtle ms-2" style="font-size:0.65rem;">Giáo viên</span>`;

            return `
              <div class="permission-teacher-item" data-name="${(t.full_name || '').toLowerCase()}" data-email="${(t.email || '').toLowerCase()}">
                <div class="d-flex align-items-center gap-3">
                  <div class="permission-teacher-avatar">${initial}</div>
                  <div>
                    <div class="fw-semibold text-white d-flex align-items-center">
                      ${t.full_name || 'Chưa cập nhật tên'}
                      ${roleBadge}
                    </div>
                    <div class="text-muted smaller">${t.email || 'Không có email'}</div>
                  </div>
                </div>
                <div class="form-check form-switch m-0">
                  <input class="form-check-input perm-teacher-checkbox" type="checkbox" value="${t.id}" id="perm_teacher_${t.id}" ${isChecked ? 'checked' : ''} style="cursor:pointer; width:2.5em; height:1.3em;">
                  <label class="form-check-label visually-hidden" for="perm_teacher_${t.id}">Cấp quyền</label>
                </div>
              </div>`;
          }).join('');
        }

        function updatePublishBtnUI() {
          const btn = document.getElementById('togglePublishBtn');
          const text = document.getElementById('publishBtnText');
          if (currentEditSetPublished) {
            btn.className = 'btn btn-success btn-sm';
            text.textContent = 'Đã Publish ✓';
          } else {
            btn.className = 'btn btn-outline-secondary btn-sm';
            text.textContent = 'Publish';
          }
        }

        async function renderQuestionSets() {
          const grid = document.getElementById('qsetGrid');
          try {
            let sets = await fetchQuestionSets();
            const filterLevel = document.getElementById('qsetFilterLevel').value;
            const filterStatus = document.getElementById('qsetFilterStatus').value;
            const filterAuthor = document.getElementById('qsetFilterAuthor')?.value;

            if (filterLevel) sets = sets.filter(s => s && s.level === filterLevel);
            if (filterStatus === 'published') sets = sets.filter(s => s && Boolean(s.is_published));
            if (filterStatus === 'draft') sets = sets.filter(s => s && !s.is_published);
            if (filterAuthor === 'mine') sets = sets.filter(s => s && s.teacher_id === currentUser.id);
            if (filterAuthor === 'shared_with_me') {
              sets = sets.filter(s => s && s.teacher_id !== currentUser.id && Array.isArray(s.allowed_teacher_ids) && s.allowed_teacher_ids.includes(currentUser.id));
            }
            if (filterAuthor === 'others') {
              sets = sets.filter(s => s && s.teacher_id !== currentUser.id && (!Array.isArray(s.allowed_teacher_ids) || !s.allowed_teacher_ids.includes(currentUser.id)));
            }

            if (!sets.length) {
              grid.innerHTML = `
                <div class="col-12">
                  <div class="empty-state">
                    <i class="bi bi-journal-text"></i>
                    <div class="empty-title">Chưa có bộ đề nào</div>
                    <p>Nhấn "Tạo bộ đề mới" để bắt đầu</p>
                  </div>
                </div>`;
              return;
            }

            grid.innerHTML = sets.map(s => {
              const levelLabels = { beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced' };
              const examTypeLabels = { general: 'General', vstep: 'VSTEP', toeic: 'TOEIC', ielts: 'IELTS' };
              const examType = s.exam_type || 'general';
              const isOwner = (s.teacher_id === currentUser.id) || (currentProfile?.role === 'admin');
              const isCollab = Array.isArray(s.allowed_teacher_ids) && s.allowed_teacher_ids.includes(currentUser.id);
              const canEdit = isOwner || isCollab;

              let permBadge = '';
              if (s.teacher_id === currentUser.id) {
                permBadge = `<span class="badge-perm badge-perm-owner" title="Bạn là chủ sở hữu bộ đề"><i class="bi bi-person-fill me-1"></i>Chủ sở hữu</span>`;
              } else if (isCollab) {
                permBadge = `<span class="badge-perm badge-perm-collab" title="Bạn được cấp quyền sửa và xóa"><i class="bi bi-pencil-square me-1"></i>Được sửa/xóa</span>`;
              } else {
                permBadge = `<span class="badge-perm badge-perm-readonly" title="Chế độ chỉ xem"><i class="bi bi-eye me-1"></i>Chỉ xem</span>`;
              }

              return `
                <div class="col-md-6 col-lg-4 d-flex">
                  <div class="qset-card w-100" onclick="openQuestionSetEditor('${s.id}')">
                    <div class="d-flex justify-content-between align-items-start mb-2">
                      <span class="exam-type-badge ${examType}">${examTypeLabels[examType] || examType.toUpperCase()}</span>
                      <span class="status-pill ${s.is_published ? 'published' : 'draft'}">${s.is_published ? '● Đã publish' : '○ Bản nháp'}</span>
                    </div>
                    <div class="qset-title" title="${s.title}">${s.title}</div>
                    <div class="qset-desc ${!s.description ? 'text-muted fst-italic' : ''}">${s.description || 'Chưa có mô tả cho bộ đề này'}</div>
                    <div class="qset-meta">
                      <span class="level-badge ${s.level}">${levelLabels[s.level] || s.level}</span>
                      <span class="badge bg-secondary"><i class="bi bi-chat-square-text me-1"></i>${s.question_count} câu</span>
                    </div>
                    <div class="qset-footer">
                      <div class="d-flex align-items-center justify-content-between gap-1 text-info small mb-1">
                        <span class="text-truncate" title="Người tạo: ${s.creator_name || 'Giáo viên'}">
                          <i class="bi bi-person-fill me-1"></i>Tạo bởi: <b>${s.creator_name || 'Giáo viên'}</b>
                        </span>
                        ${permBadge}
                      </div>
                      <div class="text-muted smaller mb-2">${new Date(s.created_at).toLocaleDateString('vi-VN')}</div>
                      <button class="btn btn-sm btn-outline-info w-100 fw-semibold" onclick="event.stopPropagation(); openTeacherSetSubmissions('${s.id}', '${encodeURIComponent(s.title)}')">
                        <i class="bi bi-people me-1"></i>Xem bài nộp học viên
                      </button>
                    </div>
                  </div>
                </div>`;
            }).join('');
          } catch (e) {
            grid.innerHTML = `<div class="col-12 text-danger">Lỗi tải dữ liệu: ${e.message}</div>`;
          }
        }

        window.openQuestionSetEditor = async function (setId) {
          currentEditSetId = setId;
          // Show editor page
          document.querySelectorAll('.page-section').forEach(p => p.classList.add('d-none'));
          document.getElementById('page-teacher-questionset-edit').classList.remove('d-none');

          try {
            // Load set info kèm thông tin người tạo
            const { data: setData, error } = await supabase
              .from('question_sets')
              .select(`
                *,
                creator:profiles!teacher_id(id, full_name, email)
              `)
              .eq('id', setId)
              .single();
            if (error) throw error;

            currentEditSetData = setData;
            const isOwner = (setData.teacher_id === currentUser.id) || (currentProfile?.role === 'admin');
            const isCollab = Array.isArray(setData.allowed_teacher_ids) && setData.allowed_teacher_ids.includes(currentUser.id);
            const canEdit = isOwner || isCollab;

            currentEditSetIsOwner = isOwner;
            currentEditSetCanEdit = canEdit;

            document.getElementById('qsetTitleInput').value = setData.title;
            document.getElementById('qsetDescInput').value = setData.description || '';
            document.getElementById('qsetLevelSelect').value = setData.level;
            document.getElementById('qsetExamTypeSelect').value = setData.exam_type || 'general';
            document.getElementById('qsetEditorTitle').textContent = setData.title;

            // Bật/tắt chế độ Read-only theo quyền hạn
            document.getElementById('qsetTitleInput').disabled = !canEdit;
            document.getElementById('qsetDescInput').disabled = !canEdit;
            document.getElementById('qsetLevelSelect').disabled = !canEdit;
            document.getElementById('qsetExamTypeSelect').disabled = !canEdit;

            const readOnlyBanner = document.getElementById('qsetReadOnlyBanner');
            if (readOnlyBanner) {
              if (canEdit) readOnlyBanner.classList.add('d-none');
              else readOnlyBanner.classList.remove('d-none');
            }

            const saveInfoBtn = document.getElementById('saveQSetInfoBtn');
            if (saveInfoBtn) {
              if (canEdit) saveInfoBtn.classList.remove('d-none');
              else saveInfoBtn.classList.add('d-none');
            }

            const togglePubBtn = document.getElementById('togglePublishBtn');
            if (togglePubBtn) {
              if (canEdit) togglePubBtn.classList.remove('d-none');
              else togglePubBtn.classList.add('d-none');
            }

            const delSetBtn = document.getElementById('deleteQSetBtn');
            if (delSetBtn) {
              if (canEdit) delSetBtn.classList.remove('d-none');
              else delSetBtn.classList.add('d-none');
            }

            const addQBtn = document.getElementById('addQuestionBtn');
            if (addQBtn) {
              if (canEdit) addQBtn.classList.remove('d-none');
              else addQBtn.classList.add('d-none');
            }

            // Nút Phân quyền: chỉ Owner (hoặc admin) mới có quyền phân quyền
            const shareBtn = document.getElementById('shareQSetBtn');
            if (shareBtn) {
              if (isOwner) shareBtn.classList.remove('d-none');
              else shareBtn.classList.add('d-none');
            }

            const creatorName = setData.creator?.full_name || 'Giáo viên';
            let permRoleText = '';
            if (isOwner) {
              permRoleText = `<span class="badge bg-primary-subtle text-primary border border-primary-subtle ms-1">Bạn là Chủ sở hữu</span>`;
            } else if (isCollab) {
              permRoleText = `<span class="badge bg-success-subtle text-success border border-success-subtle ms-1">Được cấp quyền Sửa/Xóa</span>`;
            } else {
              permRoleText = `<span class="badge bg-warning-subtle text-warning border border-warning-subtle ms-1">Chế độ Chỉ xem</span>`;
            }

            document.getElementById('qsetEditorSubtitle').innerHTML =
              `<span class="text-info"><i class="bi bi-person-fill me-1"></i>Người tạo: <b>${creatorName}</b></span> ${permRoleText} • Ngày ${new Date(setData.created_at).toLocaleDateString('vi-VN')}`;

            currentEditSetPublished = setData.is_published;
            updatePublishBtnUI();

            renderQuestionEditor();
          } catch (e) {
            alert('Lỗi tải bộ đề: ' + e.message);
          }
        };

        async function renderQuestionEditor() {
          const list = document.getElementById('questionsList');
          try {
            const questions = await fetchQuestions(currentEditSetId);
            currentEditingQuestions = questions || [];
            document.getElementById('questionCount').textContent = currentEditingQuestions.length;

            if (!currentEditingQuestions.length) {
              list.innerHTML = `
                <div class="empty-state py-4">
                  <i class="bi bi-chat-square-text" style="font-size:2rem;"></i>
                  <div class="empty-title">Chưa có câu hỏi</div>
                  <p class="small">Nhấn nút bên dưới để thêm câu hỏi đầu tiên</p>
                </div>`;
              return;
            }

            list.innerHTML = currentEditingQuestions.map((q, idx) => {
              const taskInfo = TASK_TYPES[q.task_type] || TASK_TYPES['short_qa'];
              return `
              <div class="question-editor-item" data-id="${q.id}">
                <div class="d-flex align-items-start gap-3">
                  <div class="q-number">${idx + 1}</div>
                  <div class="flex-grow-1">
                    <div class="d-flex flex-wrap align-items-center gap-2 mb-2">
                      ${q.part_title ? `<span class="badge bg-primary-subtle text-primary border border-primary-subtle small fw-semibold"><i class="bi bi-bookmark me-1"></i>${q.part_title}</span>` : ''}
                      ${taskInfo ? `
                        <span class="badge-task-type ${taskInfo.badgeClass}">
                          <i class="bi ${taskInfo.icon}"></i> ${taskInfo.label}
                        </span>
                      ` : ''}
                    </div>
                    <div class="fw-semibold mb-2">${escapeHtml(q.question_text || '')}</div>
                    ${q.image_url ? `
                      <div class="mb-2">
                        <img src="${escapeHtml(q.image_url)}" alt="Hình ảnh câu hỏi" style="max-height: 90px; max-width: 160px; object-fit: cover; border-radius: 6px; border: 1px solid rgba(255,255,255,0.15);" />
                      </div>
                    ` : ''}
                    ${q.reference_text ? `
                      <div class="small text-muted mb-2 p-2 rounded" style="background: rgba(255,255,255,0.03); border-left: 3px solid var(--accent, #6366f1); font-family: monospace; white-space: pre-wrap; max-height: 80px; overflow-y: auto;">${escapeHtml(q.reference_text)}</div>
                    ` : ''}
                    <div class="d-flex gap-2 mt-1">
                      <span class="badge bg-secondary-subtle text-secondary small"><i class="bi bi-hourglass-split me-1"></i>Chuẩn bị: ${q.prep_time || 15}s</span>
                      <span class="badge bg-secondary-subtle text-secondary small"><i class="bi bi-mic me-1"></i>Trả lời: ${q.response_time || 45}s</span>
                    </div>
                  </div>
                  ${currentEditSetCanEdit ? `
                  <div class="d-flex gap-1 flex-shrink-0">
                    <button class="btn btn-sm btn-outline-primary" onclick="editQuestionItem('${q.id}')" title="Sửa câu hỏi">
                      <i class="bi bi-pencil"></i>
                    </button>
                    <button class="btn btn-sm btn-outline-danger" onclick="deleteQuestionItem('${q.id}')" title="Xóa câu hỏi">
                      <i class="bi bi-trash"></i>
                    </button>
                  </div>` : ''}
                </div>
              </div>
            `;}).join('');
          } catch (e) {
            list.innerHTML = `<div class="text-danger">Lỗi: ${e.message}</div>`;
          }
        }

        window.editQuestionItem = function (id, text, partTitle = '', prepTime = 15, responseTime = 45) {
          if (!currentEditSetCanEdit) {
            alert('Bạn không có quyền chỉnh sửa bộ đề này!');
            return;
          }
          const found = currentEditingQuestions.find(item => item.id === id);
          const qText = (text !== undefined && typeof text === 'string') ? text : (found?.question_text || '');
          const qPart = (partTitle !== undefined && typeof partTitle === 'string' && partTitle !== '') ? partTitle : (found?.part_title || '');
          const qPrep = (prepTime !== undefined && !isNaN(Number(prepTime)) && Number(prepTime) !== 15) ? Number(prepTime) : (found?.prep_time || 15);
          const qResp = (responseTime !== undefined && !isNaN(Number(responseTime)) && Number(responseTime) !== 45) ? Number(responseTime) : (found?.response_time || 45);
          const qTask = found?.task_type || 'short_qa';
          const qImg = found?.image_url || '';
          const qRef = found?.reference_text || '';

          document.getElementById('editQuestionId').value = id || '';
          document.getElementById('qPartTitleInput').value = qPart;
          
          const currentExam = document.getElementById('qsetExamTypeSelect')?.value || currentEditSetData?.exam_type || 'general';
          populateTaskTypeSelect(currentExam, qTask);

          const imgInput = document.getElementById('qImageUrlInput');
          if (imgInput) imgInput.value = qImg;
          updateQuestionImagePreview(qImg);

          const refInput = document.getElementById('qReferenceInput');
          if (refInput) refInput.value = qRef;

          document.getElementById('qPrepTimeInput').value = qPrep;
          document.getElementById('qResponseTimeInput').value = qResp;
          document.getElementById('qTextInput').value = qText;
          
          const examLabel = getExamTypeName(currentExam);
          document.getElementById('questionModalTitle').innerHTML =
            `<i class="bi bi-pencil me-2 text-primary"></i>Sửa câu hỏi <span class="badge bg-primary-subtle text-primary border border-primary-subtle fs-6 ms-2">${examLabel}</span>`;
          const modalEl = document.getElementById('questionModal');
          bootstrap.Modal.getOrCreateInstance(modalEl).show();
        };

        window.deleteQuestionItem = async function (id) {
          if (!currentEditSetCanEdit) {
            alert('Bạn không có quyền xóa câu hỏi của bộ đề này!');
            return;
          }
          if (!confirm('Xóa câu hỏi này?')) return;
          try {
            await deleteQuestion(id);
            showToast('Đã xóa!', 'success');
            renderQuestionEditor();
          } catch (e) {
            alert('Lỗi: ' + e.message);
          }
        };

        // ══════════════════════════════════════════════════════════
        // STUDENT: PRACTICE & EXAM FLOW (VSTEP / TOEIC / IELTS)
        // ══════════════════════════════════════════════════════════
        let practiceSession = null;        // { id, set_id }
        let practiceQuestions = [];        // Array of question objects
        let practiceCurrentIdx = 0;        // Current question index
        let practiceAnswers = {};          // questionId -> { blob, result, scores, transcript, audioUrl, pending }
        let currentSessionMode = 'practice'; // 'practice' | 'exam'
        let currentSetData = null;
        let selectedSetForModal = null;
        let examAssessPromises = [];
        let pendingResumeData = null; // Holds activeSession & setData for resume modal

        // Recording & Timers
        let practiceRecorder = null;
        let practiceRecordStream = null;
        let practiceRecordTimer = null;
        let practiceRecordStartTime = null;

        let examTimerInterval = null;
        let examRemainingSeconds = 0;
        let examCurrentPhase = 'idle';     // 'idle' | 'prep' | 'speaking'

        let pendingPracticeExitCallback = null;

        function checkExitPracticeBeforeNavigate(onConfirm) {
          const sessionPage = document.getElementById('page-student-practice-session');
          const isSessionActive = sessionPage && !sessionPage.classList.contains('d-none') && practiceSession;

          if (!isSessionActive) {
            onConfirm();
            return;
          }

          if (currentSessionMode === 'exam') {
            const confirmExit = confirm('⚠️ Bạn đang trong bài thi thử!\nNếu thoát ra giữa chừng, toàn bộ kết quả bài thi này sẽ bị hủy và KHÔNG được lưu lên hệ thống.\n\nBạn có chắc chắn muốn thoát?');
            if (confirmExit) {
              cleanupPracticeTimers();
              if (practiceSession?.id) {
                cancelSession(practiceSession.id).catch(console.warn);
              }
              practiceSession = null;
              practiceAnswers = {};
              examAssessPromises = [];
              onConfirm();
            }
            return;
          }

          // Chế độ Luyện tập
          const answeredCount = Object.keys(practiceAnswers).filter(k => practiceAnswers[k]?.scores).length;
          const totalCount = practiceQuestions ? practiceQuestions.length : 0;

          if (answeredCount >= 1) {
            document.getElementById('exitPracticeAnsweredCount').textContent = `${answeredCount}/${totalCount}`;
            pendingPracticeExitCallback = onConfirm;
            new bootstrap.Modal(document.getElementById('exitPracticeConfirmModal')).show();
          } else {
            cleanupPracticeTimers();
            if (practiceSession?.id) {
              cancelSession(practiceSession.id).catch(console.warn);
              practiceSession = null;
            }
            onConfirm();
          }
        }

        function initPracticeUI() {
          // Practice interactive mic
          document.getElementById('practiceRecordBtn').addEventListener('click', togglePracticeRecord);
          document.getElementById('practiceNextBtn').addEventListener('click', practiceGoNext);
          document.getElementById('practicePrevBtn').addEventListener('click', practiceGoPrev);

          // Exit & Retry buttons
          document.getElementById('exitPracticeBtn').addEventListener('click', () => {
            checkExitPracticeBeforeNavigate(() => navigateTo('practice'));
          });

          document.getElementById('btnSaveSessionAndExit')?.addEventListener('click', () => {
            const modalEl = document.getElementById('exitPracticeConfirmModal');
            const inst = bootstrap.Modal.getInstance(modalEl);
            if (inst) inst.hide();
            cleanupPracticeTimers();
            practiceSession = null;
            const cb = pendingPracticeExitCallback || (() => navigateTo('practice'));
            pendingPracticeExitCallback = null;
            cb();
            showToast('Đã lưu phiên làm dở! Bài này chưa hoàn thành nên sẽ không xuất hiện trong Lịch sử.', 'info');
          });

          document.getElementById('btnDiscardAndExit')?.addEventListener('click', async () => {
            const modalEl = document.getElementById('exitPracticeConfirmModal');
            const inst = bootstrap.Modal.getInstance(modalEl);
            if (inst) inst.hide();
            cleanupPracticeTimers();
            if (practiceSession?.id) {
              await cancelSession(practiceSession.id);
              practiceSession = null;
            }
            const cb = pendingPracticeExitCallback || (() => navigateTo('practice'));
            pendingPracticeExitCallback = null;
            cb();
            showToast('Đã hủy phiên làm bài.', 'secondary');
          });

          document.getElementById('summaryBackToListBtn').addEventListener('click', () => {
            cleanupPracticeTimers();
            navigateTo('practice');
          });
          document.getElementById('summaryRetryBtn').addEventListener('click', () => {
            if (practiceSession) {
              startSessionWithMode(practiceSession.set_id, currentSessionMode, true);
            }
          });

          // Cảnh báo khi người dùng vô tình đóng tab / reload trong khi đang làm bài
          window.addEventListener('beforeunload', (e) => {
            const sessionPage = document.getElementById('page-student-practice-session');
            const isSessionActive = sessionPage && !sessionPage.classList.contains('d-none') && practiceSession;
            if (isSessionActive) {
              e.preventDefault();
              e.returnValue = '';
            }
          });


          // Filter listeners
          document.getElementById('practiceFilterLevel').addEventListener('change', renderPracticeSets);
          document.getElementById('practiceFilterType').addEventListener('change', renderPracticeSets);
          document.getElementById('historyFilterMode').addEventListener('change', renderPracticeHistory);

          // Mode Selection Modal buttons
          document.getElementById('selectPracticeModeBtn').addEventListener('click', () => {
            if (selectedSetForModal) {
              const modalEl = document.getElementById('modeSelectModal');
              const modalInst = bootstrap.Modal.getInstance(modalEl);
              if (modalInst) modalInst.hide();
              startSessionWithMode(selectedSetForModal.id, 'practice');
            }
          });

          document.getElementById('selectExamModeBtn').addEventListener('click', () => {
            if (selectedSetForModal) {
              const modalEl = document.getElementById('modeSelectModal');
              const modalInst = bootstrap.Modal.getInstance(modalEl);
              if (modalInst) modalInst.hide();
              startSessionWithMode(selectedSetForModal.id, 'exam');
            }
          });

          // Resume Session Modal buttons (Làm tiếp bài dở dang)
          document.getElementById('resumeContinueBtn').addEventListener('click', () => {
            const modalEl = document.getElementById('resumeSessionModal');
            const modalInst = bootstrap.Modal.getInstance(modalEl);
            if (modalInst) modalInst.hide();
            if (pendingResumeData) {
              resumePracticeSession(pendingResumeData.activeSession, pendingResumeData.setData);
              pendingResumeData = null;
            }
          });

          document.getElementById('resumeStartFreshBtn').addEventListener('click', async () => {
            const modalEl = document.getElementById('resumeSessionModal');
            const modalInst = bootstrap.Modal.getInstance(modalEl);
            if (modalInst) modalInst.hide();
            if (pendingResumeData) {
              const setId = pendingResumeData.setData.id;
              await cancelSession(pendingResumeData.activeSession.id);
              pendingResumeData = null;
              startSessionWithMode(setId, 'practice', true);
            }
          });

          // Exam action buttons
          document.getElementById('skipPrepBtn').addEventListener('click', () => {
            if (examCurrentPhase === 'prep') {
              if (examTimerInterval) { clearInterval(examTimerInterval); examTimerInterval = null; }
              startExamSpeakingPhase();
            }
          });

          document.getElementById('finishExamSpeakBtn').addEventListener('click', () => {
            if (examCurrentPhase === 'speaking') {
              stopExamSpeaking();
            }
          });
        }

        function cleanupPracticeTimers() {
          if (examTimerInterval) { clearInterval(examTimerInterval); examTimerInterval = null; }
          if (practiceRecordTimer) { clearInterval(practiceRecordTimer); practiceRecordTimer = null; }
          if (practiceRecorder && practiceRecorder.state === 'recording') {
            try { practiceRecorder.stop(); } catch (e) {}
            practiceRecorder = null;
          }
          if (practiceRecordStream) {
            try { practiceRecordStream.getTracks().forEach(t => t.stop()); } catch (e) {}
            practiceRecordStream = null;
          }
        }

        async function renderPracticeSets() {
          const grid = document.getElementById('practiceSetGrid');
          try {
            let sets = await fetchPublishedSets();
            const filterLevel = document.getElementById('practiceFilterLevel').value;
            const filterType = document.getElementById('practiceFilterType').value;
            if (filterLevel) sets = sets.filter(s => s.level === filterLevel);
            if (filterType) sets = sets.filter(s => (s.exam_type || 'general') === filterType);

            if (!sets.length) {
              grid.innerHTML = `
                <div class="col-12">
                  <div class="empty-state">
                    <i class="bi bi-journal-text"></i>
                    <div class="empty-title">Chưa có bộ đề nào phù hợp</div>
                    <p>Hãy thử thay đổi bộ lọc hoặc đợi giáo viên publish thêm bộ đề</p>
                  </div>
                </div>`;
              return;
            }

            const levelLabels = { beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced' };
            const examTypeLabels = { general: 'General', vstep: 'VSTEP', toeic: 'TOEIC', ielts: 'IELTS' };

            grid.innerHTML = sets.map(s => {
              const examType = s.exam_type || 'general';
              return `
                <div class="col-md-6 col-lg-4 d-flex">
                  <div class="qset-card w-100" onclick="openModeSelectModal('${s.id}')">
                    <div class="d-flex justify-content-between align-items-center mb-2">
                      <span class="exam-type-badge ${examType}">${examTypeLabels[examType] || examType.toUpperCase()}</span>
                      <span class="level-badge ${s.level}">${levelLabels[s.level] || s.level}</span>
                    </div>
                    <div class="qset-title" title="${s.title}">${s.title}</div>
                    <div class="qset-desc ${!s.description ? 'text-muted fst-italic' : ''}">${s.description || 'Luyện tập phát âm và phản xạ nói tiếng Anh'}</div>
                    <div class="qset-footer">
                      <div class="qset-meta mb-0">
                        <span class="badge bg-secondary"><i class="bi bi-chat-square-text me-1"></i>${s.question_count} câu</span>
                        <span class="badge bg-outline-secondary"><i class="bi bi-person me-1"></i>${s.teacher_name || 'Giáo viên'}</span>
                      </div>
                    </div>
                  </div>
                </div>`;
            }).join('');
          } catch (e) {
            grid.innerHTML = `<div class="col-12 text-danger">Lỗi: ${e.message}</div>`;
          }
        }

        window.openModeSelectModal = async function (setId) {
          try {
            const setData = await fetchSetWithQuestions(setId);
            if (!setData.questions || setData.questions.length === 0) {
              alert('Bộ đề này hiện chưa có câu hỏi nào!');
              return;
            }
            selectedSetForModal = setData;

            document.getElementById('modeModalTitle').textContent = setData.title;
            const examTypeLabels = { general: 'General', vstep: 'VSTEP (B1-B2-C1)', toeic: 'TOEIC Speaking', ielts: 'IELTS Speaking' };
            const examLabel = examTypeLabels[setData.exam_type] || (setData.exam_type || 'General').toUpperCase();
            document.getElementById('modeModalSubtitle').innerHTML =
              `<span class="badge bg-primary-soft text-primary me-2">${examLabel}</span>Trình độ: <b class="text-white">${setData.level.toUpperCase()}</b> • <b>${setData.questions.length}</b> câu hỏi`;

            new bootstrap.Modal(document.getElementById('modeSelectModal')).show();
          } catch (e) {
            alert('Lỗi tải thông tin bộ đề: ' + e.message);
          }
        };

        window.startSessionWithMode = async function (setId, mode = 'practice', forceFresh = false) {
          cleanupPracticeTimers();
          try {
            const setData = await fetchSetWithQuestions(setId);
            if (!setData.questions || setData.questions.length === 0) {
              alert('Bộ đề này chưa có câu hỏi nào!');
              return;
            }

            // Nếu là chế độ Luyện tập và không ép làm mới: kiểm tra bài làm dở dang
            if (mode === 'practice' && !forceFresh) {
              const activeSession = await fetchActiveSession(currentUser.id, setId, 'practice');
              const answered = activeSession ? (activeSession.practice_answers || []) : [];
              if (activeSession && answered.length > 0) {
                pendingResumeData = { activeSession, setData };
                document.getElementById('resumeModalMessage').textContent =
                  `Bạn đang có một bài luyện tập dở dang cho bộ đề "${setData.title}".`;
                document.getElementById('resumeModalProgress').textContent =
                  `${answered.length}/${setData.questions.length} câu đã hoàn thành`;
                const pct = Math.min(100, Math.round((answered.length / setData.questions.length) * 100));
                document.getElementById('resumeModalProgressBar').style.width = `${pct}%`;

                new bootstrap.Modal(document.getElementById('resumeSessionModal')).show();
                return;
              }
            }

            if (mode === 'exam') {
              // Chế độ Thi thử: Không tạo session trên Supabase trước, chỉ lưu khi học viên nộp bài thi
              practiceSession = { id: null, set_id: setId };
            } else {
              const session = await startSession(currentUser.id, setId, mode);
              practiceSession = { id: session.id, set_id: setId };
            }
            currentSessionMode = mode;
            currentSetData = setData;
            practiceQuestions = setData.questions;
            practiceCurrentIdx = 0;
            practiceAnswers = {};
            examAssessPromises = [];

            // Switch page
            document.querySelectorAll('.page-section').forEach(p => p.classList.add('d-none'));
            document.getElementById('page-student-practice-session').classList.remove('d-none');

            // Header UI
            document.getElementById('practiceSetTitle').textContent = setData.title;
            document.getElementById('practiceTotalQ').textContent = practiceQuestions.length;

            const examBanner = document.getElementById('examModeBanner');
            const modeBadge = document.getElementById('sessionModeBadge');
            const prevBtn = document.getElementById('practicePrevBtn');

            if (mode === 'exam') {
              examBanner.classList.remove('d-none');
              const typeBadge = document.getElementById('examTypeBadge');
              const examType = setData.exam_type || 'general';
              typeBadge.className = `exam-type-badge ${examType}`;
              typeBadge.textContent = examType.toUpperCase();

              modeBadge.className = 'badge bg-warning text-dark fw-bold';
              modeBadge.textContent = `THI THỬ (${examType.toUpperCase()})`;
              prevBtn.classList.add('d-none'); // Thi thật không quay lại câu trước
            } else {
              examBanner.classList.add('d-none');
              modeBadge.className = 'badge bg-primary-soft text-primary fw-bold';
              modeBadge.textContent = 'LUYỆN TẬP';
              prevBtn.classList.remove('d-none');
            }

            renderCurrentQuestion();
          } catch (e) {
            alert('Lỗi khởi tạo phiên làm bài: ' + e.message);
          }
        };

        function resumePracticeSession(activeSession, setData) {
          cleanupPracticeTimers();
          practiceSession = { id: activeSession.id, set_id: setData.id };
          currentSessionMode = 'practice';
          currentSetData = setData;
          practiceQuestions = setData.questions;
          practiceAnswers = {};
          examAssessPromises = [];

          // Khôi phục các câu trả lời trước đó từ Supabase
          for (const a of (activeSession.practice_answers || [])) {
            practiceAnswers[a.question_id] = {
              audioUrl: a.audio_url,
              transcript: a.transcript,
              scores: {
                total: a.score_total || 0,
                accuracy: a.score_accuracy || 0,
                fluency: a.score_fluency || 0,
                prosodic: a.score_prosodic || 0,
              },
              result: a.result_json,
            };
          }

          // Nhảy tới câu chưa làm đầu tiên (hoặc câu 1 nếu đã làm hết)
          const firstUnanswered = practiceQuestions.findIndex(q => !practiceAnswers[q.id]);
          practiceCurrentIdx = firstUnanswered !== -1 ? firstUnanswered : 0;

          // Switch page
          document.querySelectorAll('.page-section').forEach(p => p.classList.add('d-none'));
          document.getElementById('page-student-practice-session').classList.remove('d-none');

          // Header UI
          document.getElementById('practiceSetTitle').textContent = setData.title;
          document.getElementById('practiceTotalQ').textContent = practiceQuestions.length;
          document.getElementById('examModeBanner').classList.add('d-none');
          const modeBadge = document.getElementById('sessionModeBadge');
          modeBadge.className = 'badge bg-primary-soft text-primary fw-bold';
          modeBadge.textContent = 'LUYỆN TẬP';
          document.getElementById('practicePrevBtn').classList.remove('d-none');

          renderCurrentQuestion();
        }

        window.jumpToPracticeQuestion = function (idx) {
          if (currentSessionMode !== 'practice') return;
          if (idx >= 0 && idx < practiceQuestions.length) {
            practiceCurrentIdx = idx;
            renderCurrentQuestion();
          }
        };

        function renderCurrentQuestion() {
          cleanupPracticeTimers();

          const q = practiceQuestions[practiceCurrentIdx];
          const area = document.getElementById('practiceQuestionArea');
          const num = practiceCurrentIdx + 1;
          const total = practiceQuestions.length;

          document.getElementById('practiceCurrentQ').textContent = num;
          document.getElementById('practiceProgressFill').style.width = `${(num / total) * 100}%`;

          // Navigation Strip (Pills)
          const stripEl = document.getElementById('practiceQuestionStrip');
          if (stripEl) {
            if (currentSessionMode === 'practice') {
              stripEl.classList.remove('d-none');
              stripEl.innerHTML = practiceQuestions.map((ques, idx) => {
                const isCurrent = idx === practiceCurrentIdx;
                const isDone = !!(practiceAnswers[ques.id] && practiceAnswers[ques.id].scores);
                const cls = `q-nav-pill ${isDone ? 'completed' : ''} ${isCurrent ? 'current' : ''}`;
                const label = isDone && !isCurrent ? '<i class="bi bi-check"></i>' : `${idx + 1}`;
                return `<div class="${cls}" onclick="jumpToPracticeQuestion(${idx})" title="Câu ${idx + 1}: ${isDone ? 'Đã hoàn thành' : 'Chưa làm'}">${label}</div>`;
              }).join('');
            } else {
              stripEl.classList.add('d-none');
            }
          }

          // Navigation buttons
          const prevBtn = document.getElementById('practicePrevBtn');
          prevBtn.disabled = practiceCurrentIdx === 0;
          const nextBtn = document.getElementById('practiceNextBtn');

          if (practiceCurrentIdx === total - 1) {
            nextBtn.innerHTML = '<i class="bi bi-check-circle me-1"></i>Hoàn thành';
            nextBtn.className = 'btn btn-success btn-glow';
          } else {
            nextBtn.innerHTML = 'Câu tiếp<i class="bi bi-chevron-right ms-1"></i>';
            nextBtn.className = 'btn btn-primary btn-glow';
          }

          // Render Question Card
          const taskInfo = TASK_TYPES[q.task_type] || TASK_TYPES['short_qa'];
          const taskBadgeHtml = taskInfo ? `
            <div class="mb-2">
              <span class="badge-task-type ${taskInfo.badgeClass}">
                <i class="bi ${taskInfo.icon}"></i> ${taskInfo.label} • ${taskInfo.title}
              </span>
            </div>` : '';

          const cardContentHtml = buildTaskQuestionCardContent(q);

          if (currentSessionMode === 'exam') {
            // EXAM MODE
            area.innerHTML = `
              <div class="practice-question-card">
                ${taskBadgeHtml}
                ${q.part_title ? `<div class="text-primary small fw-semibold mb-1"><i class="bi bi-bookmark me-1"></i>${q.part_title}</div>` : ''}
                <div class="question-number">Câu hỏi ${num} / ${total}</div>
                ${cardContentHtml}
                <div class="text-muted small fst-italic mt-3">
                  <i class="bi bi-shield-lock me-1"></i>Chế độ thi: Hãy suy nghĩ trong thời gian chuẩn bị và trả lời rõ ràng vào micro khi có tín hiệu Beep.
                </div>
              </div>`;

            // Hide practice recording controls and instant score
            document.getElementById('practiceRecordingArea').classList.add('d-none');
            document.getElementById('practiceAnswerResult').classList.add('d-none');
            document.getElementById('practiceScoringOverlay').classList.add('d-none');

            // Start Exam Preparation Phase
            startExamPrepPhase();

          } else {
            // PRACTICE MODE: Focused question card, interactive recording
            area.innerHTML = `
              <div class="practice-question-card">
                ${taskBadgeHtml}
                ${q.part_title ? `<div class="text-primary small fw-semibold mb-1"><i class="bi bi-bookmark me-1"></i>${q.part_title}</div>` : ''}
                <div class="question-number">Câu hỏi ${num} / ${total}</div>
                ${cardContentHtml}
              </div>`;

            document.getElementById('examPrepArea').classList.add('d-none');
            document.getElementById('examSpeakArea').classList.add('d-none');

            // Show existing answer if already recorded
            const existing = practiceAnswers[q.id];
            const resultArea = document.getElementById('practiceAnswerResult');
            if (existing && existing.scores) {
              renderAnswerResult(existing, q);
              resultArea.classList.remove('d-none');
            } else {
              resultArea.classList.add('d-none');
            }

            // Reset recording UI
            const recordBtn = document.getElementById('practiceRecordBtn');
            recordBtn.classList.remove('recording');
            recordBtn.innerHTML = '<i class="bi bi-mic-fill"></i>';
            document.getElementById('practiceRecordTimer').classList.add('d-none');
            document.getElementById('practiceRecordStatus').textContent =
              existing ? 'Nhấn để ghi âm lại' : 'Nhấn để bắt đầu ghi âm';
            document.getElementById('practiceRecordingArea').classList.remove('d-none');
            document.getElementById('practiceScoringOverlay').classList.add('d-none');
          }
        }

        // ── EXAM MODE PHASES ──────────────────────────────────────
        function startExamPrepPhase() {
          examCurrentPhase = 'prep';
          const q = practiceQuestions[practiceCurrentIdx];
          const prepSeconds = (q.prep_time !== undefined && q.prep_time !== null) ? q.prep_time : 15;

          document.getElementById('examPrepArea').classList.remove('d-none');
          document.getElementById('examSpeakArea').classList.add('d-none');

          if (prepSeconds <= 0) {
            startExamSpeakingPhase();
            return;
          }

          examRemainingSeconds = prepSeconds;
          document.getElementById('examPrepSeconds').textContent = examRemainingSeconds;

          if (examTimerInterval) clearInterval(examTimerInterval);
          examTimerInterval = setInterval(() => {
            examRemainingSeconds--;
            document.getElementById('examPrepSeconds').textContent = examRemainingSeconds;

            if (examRemainingSeconds <= 3 && examRemainingSeconds > 0) {
              playBeep(700, 0.08);
            } else if (examRemainingSeconds <= 0) {
              clearInterval(examTimerInterval);
              examTimerInterval = null;
              startExamSpeakingPhase();
            }
          }, 1000);
        }

        async function startExamSpeakingPhase() {
          if (examTimerInterval) clearInterval(examTimerInterval);
          examTimerInterval = null;
          examCurrentPhase = 'speaking';

          playStartTone(); // Beep hiệu lệnh bắt đầu nói!

          document.getElementById('examPrepArea').classList.add('d-none');
          document.getElementById('examSpeakArea').classList.remove('d-none');

          const q = practiceQuestions[practiceCurrentIdx];
          const isLastQ = (practiceCurrentIdx === practiceQuestions.length - 1);
          const finishBtn = document.getElementById('finishExamSpeakBtn');
          if (finishBtn) {
            if (isLastQ) {
              finishBtn.className = 'btn btn-success btn-sm px-3 fw-bold';
              finishBtn.innerHTML = '<i class="bi bi-send-check me-1"></i>Hoàn thành & Nộp bài thi';
            } else {
              finishBtn.className = 'btn btn-outline-danger btn-sm px-3';
              finishBtn.innerHTML = '<i class="bi bi-check2-circle me-1"></i>Nộp câu này sớm';
            }
          }

          const speakSeconds = (q.response_time !== undefined && q.response_time !== null) ? q.response_time : 45;
          examRemainingSeconds = speakSeconds;

          const updateSpeakTimerDisplay = () => {
            const mins = String(Math.floor(examRemainingSeconds / 60)).padStart(2, '0');
            const secs = String(examRemainingSeconds % 60).padStart(2, '0');
            document.getElementById('examSpeakTimer').textContent = `${mins}:${secs}`;
          };
          updateSpeakTimerDisplay();

          try {
            const stream = await navigator.mediaDevices.getUserMedia({
              audio: { noiseSuppression: true, echoCancellation: true, autoGainControl: true }
            });
            practiceRecordStream = stream;
            const recorder = new MediaRecorder(stream);
            const chunks = [];
            recorder.ondataavailable = e => chunks.push(e.data);
            recorder.onstop = () => {
              const blob = new Blob(chunks, { type: 'audio/webm' });
              if (practiceRecordStream) {
                practiceRecordStream.getTracks().forEach(t => t.stop());
                practiceRecordStream = null;
              }
              submitExamAnswer(blob);
            };
            recorder.start();
            practiceRecorder = recorder;

            examTimerInterval = setInterval(() => {
              examRemainingSeconds--;
              updateSpeakTimerDisplay();

              if (examRemainingSeconds <= 3 && examRemainingSeconds > 0) {
                playBeep(440, 0.12, 'triangle');
              } else if (examRemainingSeconds <= 0) {
                clearInterval(examTimerInterval);
                examTimerInterval = null;
                stopExamSpeaking();
              }
            }, 1000);

          } catch (e) {
            alert('Không thể truy cập microphone trong phòng thi: ' + e.message);
          }
        }

        function stopExamSpeaking() {
          if (examTimerInterval) {
            clearInterval(examTimerInterval);
            examTimerInterval = null;
          }
          playEndTone();
          if (practiceRecorder && practiceRecorder.state === 'recording') {
            practiceRecorder.stop();
            practiceRecorder = null;
          }
        }

        async function submitExamAnswer(audioBlob) {
          const q = practiceQuestions[practiceCurrentIdx];
          const isLast = (practiceCurrentIdx === practiceQuestions.length - 1);

          // Tạo promise xử lý chấm câu này (không upload lên Supabase khi chưa nộp bài)
          const assessPromise = (async () => {
            try {
              // [VAD CHECK TRƯỚC KHI ĐƯA VÀO WHISPER]
              let vadResult = { hasVoice: true };
              try {
                vadResult = await detectVoiceActivity(audioBlob);
              } catch (vadErr) {
                console.warn('[VAD Exam] Lỗi check VAD client:', vadErr);
              }

              if (!vadResult.hasVoice) {
                console.log(`[VAD Exam] Câu ${q.order_num || practiceCurrentIdx + 1}: Không phát hiện tiếng người (${vadResult.reason}). Bỏ qua Whisper, chấm 0 điểm.`);
                const zeroScores = { total: 0, accuracy: 0, fluency: 0, prosodic: 0, grammar: 0, context: 0 };
                const emptyTranscript = '(Không phát hiện giọng nói)';
                const emptyGemini = {
                  score_total: 0,
                  score_grammar: 0,
                  score_context: 0,
                  feedback_summary: 'Hệ thống không phát hiện giọng nói của thí sinh trong câu trả lời này (bản ghi âm im lặng hoặc micro không thu được tiếng).',
                  relevance_level: 'too_short',
                  grammar_errors: []
                };
                practiceAnswers[q.id] = {
                  blob: audioBlob,
                  result: {
                    student: { sentences: [], transcript: '', scores: zeroScores, message: 'No speech detected (VAD)' },
                    gemini_eval: emptyGemini
                  },
                  scores: zeroScores,
                  transcript: emptyTranscript,
                  audioUrl: null,
                  geminiEval: emptyGemini
                };
                return;
              }

              const apiUrl = window.globalApiUrl;
              let sEmb = currentProfile.voice_embeddings;
              if (typeof sEmb === 'string') {
                try { sEmb = JSON.parse(sEmb); } catch (e) {}
              }

              // Assess trực tiếp qua backend API (không động tới Supabase)
              let scores = { total: 0, accuracy: 0, fluency: 0, prosodic: 0 };
              let transcript = '';
              let result = null;

              if (apiUrl) {
                const targetRefText = q.task_type === 'read_aloud' ? (q.question_text || '') : (q.reference_text || '');
                result = await assessSingleAnswer(apiUrl, audioBlob, sEmb || [], {
                  taskType: q.task_type || 'short_qa',
                  referenceText: targetRefText
                });
                const studentData = result.student || {};
                if (studentData.scores && studentData.scores.total != null) {
                  scores.total = Number(studentData.scores.total) || 0;
                  scores.accuracy = Number(studentData.scores.accuracy) || 0;
                  scores.fluency = Number(studentData.scores.fluency) || 0;
                  scores.prosodic = Number(studentData.scores.prosodic) || 0;
                  transcript = studentData.transcript || '';
                } else {
                  const sentences = studentData.sentences || [];
                  if (sentences.length > 0) {
                    let count = 0;
                    for (const s of sentences) {
                      if (s.scores) {
                        scores.total += s.scores.total || 0;
                        scores.accuracy += s.scores.accuracy || 0;
                        scores.fluency += s.scores.fluency || 0;
                        scores.prosodic += s.scores.prosodic || 0;
                        count++;
                      }
                      if (s.transcript) transcript += (transcript ? ' ' : '') + s.transcript;
                    }
                    if (count > 0) {
                      scores.total /= count;
                      scores.accuracy /= count;
                      scores.fluency /= count;
                      scores.prosodic /= count;
                    }
                  }
                }
              }

              if (q.task_type === 'read_aloud' && !transcript) {
                transcript = q.question_text || '';
              }

              // Gọi Gemini đánh giá Ngữ pháp & Ngữ cảnh và hiệu chuẩn điểm tổng thể
              let geminiEval = null;
              try {
                geminiEval = await evaluateAnswerWithGemini({
                  questionText: q.question_text || q.title || '',
                  partTitle: q.part_title || '',
                  examType: currentSetData?.exam_type || 'general',
                  taskType: q.task_type || 'short_qa',
                  referenceText: q.task_type === 'read_aloud' ? (q.question_text || '') : (q.reference_text || ''),
                  transcript: transcript,
                  pronunciationScores: scores,
                  imageUrl: q.image_url || null
                });
                if (geminiEval && geminiEval.score_total != null) {
                  if (q.task_type === 'read_aloud') {
                    // Dạng Read Aloud: Hoàn toàn không chấm ngữ pháp và ngữ cảnh, chỉ giữ 100% điểm phát âm âm học
                    scores.grammar = null;
                    scores.context = null;
                    scores.total = scores.total;
                  } else {
                    scores.total = geminiEval.score_total;
                    scores.grammar = geminiEval.score_grammar;
                    scores.context = geminiEval.score_context;
                  }
                }
              } catch (gErr) {
                console.warn('Lỗi gọi Gemini Eval khi thi thử:', gErr);
              }

              // Lưu kết quả tạm thời trong bộ nhớ trình duyệt, audioUrl sẽ có khi nộp bài
              const combinedResult = { ...(result || {}), gemini_eval: geminiEval };
              practiceAnswers[q.id] = { blob: audioBlob, result: combinedResult, scores, transcript, audioUrl: null, geminiEval };
            } catch (e) {
              console.error(`Lỗi chấm câu ${q.id}:`, e);
              practiceAnswers[q.id] = { blob: audioBlob, scores: { total: 5, accuracy: 5, fluency: 5, prosodic: 5, grammar: 5, context: 5 }, transcript: '', audioUrl: null, geminiEval: null };
            }
          })();

          examAssessPromises.push(assessPromise);

          if (!isLast) {
            // Chuyển sang câu tiếp theo ngay lập tức như thi thật!
            practiceCurrentIdx++;
            renderCurrentQuestion();
          } else {
            // Câu cuối cùng -> Đợi chấm toàn bài và thực hiện nộp bài lên Supabase
            document.getElementById('examSpeakArea').classList.add('d-none');
            document.getElementById('practiceScoringOverlay').classList.remove('d-none');
            document.getElementById('practiceScoringStep').textContent = 'Đang thu bài và xử lý âm thanh...';

            await Promise.all(examAssessPromises);
            await finishPracticeSession();
          }
        }

        // ── PRACTICE MODE RECORDING ───────────────────────────────
        async function togglePracticeRecord() {
          const btn = document.getElementById('practiceRecordBtn');
          const timerEl = document.getElementById('practiceRecordTimer');
          const statusEl = document.getElementById('practiceRecordStatus');

          if (!practiceRecorder || practiceRecorder.state !== 'recording') {
            try {
              const stream = await navigator.mediaDevices.getUserMedia({
                audio: { noiseSuppression: true, echoCancellation: true, autoGainControl: true }
              });
              practiceRecordStream = stream;
              const recorder = new MediaRecorder(stream);
              const chunks = [];
              recorder.ondataavailable = e => chunks.push(e.data);
              recorder.onstop = () => {
                const blob = new Blob(chunks, { type: 'audio/webm' });
                practiceRecordStream.getTracks().forEach(t => t.stop());
                clearInterval(practiceRecordTimer);
                submitPracticeAnswer(blob);
              };
              recorder.start();
              practiceRecorder = recorder;
              practiceRecordStartTime = Date.now();

              btn.classList.add('recording');
              btn.innerHTML = '<i class="bi bi-stop-fill"></i>';
              timerEl.classList.remove('d-none');
              timerEl.textContent = '00:00';
              statusEl.textContent = '● Đang ghi âm... Nhấn để dừng';

              practiceRecordTimer = setInterval(() => {
                const elapsed = Math.floor((Date.now() - practiceRecordStartTime) / 1000);
                const mins = String(Math.floor(elapsed / 60)).padStart(2, '0');
                const secs = String(elapsed % 60).padStart(2, '0');
                timerEl.textContent = `${mins}:${secs}`;
              }, 500);
            } catch (e) {
              alert('Không thể truy cập microphone: ' + e.message);
            }
          } else {
            practiceRecorder.stop();
            practiceRecorder = null;
          }
        }

        async function submitPracticeAnswer(audioBlob) {
          const q = practiceQuestions[practiceCurrentIdx];
          const recordBtn = document.getElementById('practiceRecordBtn');
          const timerEl = document.getElementById('practiceRecordTimer');
          const statusEl = document.getElementById('practiceRecordStatus');
          const scoringOverlay = document.getElementById('practiceScoringOverlay');

          recordBtn.classList.remove('recording');
          recordBtn.innerHTML = '<i class="bi bi-mic-fill"></i>';
          timerEl.classList.add('d-none');

          // [VAD CHECK TRƯỚC KHI ĐƯA VÀO WHISPER]
          statusEl.textContent = 'Đang kiểm tra tín hiệu giọng nói...';
          try {
            const vad = await detectVoiceActivity(audioBlob);
            if (!vad.hasVoice) {
              console.warn('[VAD Practice] Không phát hiện tiếng người:', vad);
              statusEl.textContent = '⚠️ Không phát hiện tiếng người. Nhấn để ghi âm lại.';
              showToast(`⚠️ Không phát hiện tiếng người trong bản ghi (${vad.reason}). Vui lòng nói to rõ hơn và ghi âm lại!`, 'danger');
              return;
            }
          } catch (vadErr) {
            console.warn('[VAD Practice] Lỗi kiểm tra VAD client, tiếp tục nộp:', vadErr);
          }

          document.getElementById('practiceRecordingArea').classList.add('d-none');
          scoringOverlay.classList.remove('d-none');
          document.getElementById('practiceScoringStep').textContent = 'Đang gửi audio lên server...';

          try {
            const apiUrl = window.globalApiUrl;
            if (!apiUrl) throw new Error('API URL chưa được cấu hình!');

            let sEmb = currentProfile.voice_embeddings;
            if (typeof sEmb === 'string') {
              try { sEmb = JSON.parse(sEmb); } catch (e) {}
            }

            document.getElementById('practiceScoringStep').textContent = 'Đang lưu audio...';
            const audioUrl = await uploadPracticeAudio(currentUser.id, audioBlob, `q${practiceCurrentIdx + 1}.webm`);

            document.getElementById('practiceScoringStep').textContent = 'Đang phân tích phát âm âm học...';
            const targetRefText = q.task_type === 'read_aloud' ? (q.question_text || '') : (q.reference_text || '');
            const result = await assessSingleAnswer(apiUrl, audioBlob, sEmb || [], {
              taskType: q.task_type || 'short_qa',
              referenceText: targetRefText
            });

            let scores = { total: 0, accuracy: 0, fluency: 0, prosodic: 0 };
            let transcript = '';
            const studentData = result.student || {};
            if (studentData.scores && studentData.scores.total != null) {
              scores.total = Number(studentData.scores.total) || 0;
              scores.accuracy = Number(studentData.scores.accuracy) || 0;
              scores.fluency = Number(studentData.scores.fluency) || 0;
              scores.prosodic = Number(studentData.scores.prosodic) || 0;
              transcript = studentData.transcript || '';
            } else {
              const sentences = studentData.sentences || [];
              if (sentences.length > 0) {
                let count = 0;
                for (const s of sentences) {
                  if (s.scores) {
                    scores.total += s.scores.total || 0;
                    scores.accuracy += s.scores.accuracy || 0;
                    scores.fluency += s.scores.fluency || 0;
                    scores.prosodic += s.scores.prosodic || 0;
                    count++;
                  }
                  if (s.transcript) transcript += (transcript ? ' ' : '') + s.transcript;
                }
                if (count > 0) {
                  scores.total /= count;
                  scores.accuracy /= count;
                  scores.fluency /= count;
                  scores.prosodic /= count;
                }
              }
            }

            if (q.task_type === 'read_aloud' && !transcript) {
              transcript = q.question_text || '';
            }

            // Gọi AI Evaluator chấm điểm Ngữ pháp, Ngữ cảnh & Điểm tổng thể (Non-linear)
            document.getElementById('practiceScoringStep').textContent = 'Đang đánh giá ngữ pháp & ngữ cảnh (AI Evaluator)...';
            let geminiEval = null;
            try {
              geminiEval = await evaluateAnswerWithGemini({
                questionText: q.question_text || q.title || '',
                partTitle: q.part_title || '',
                examType: currentSetData?.exam_type || 'general',
                taskType: q.task_type || 'short_qa',
                referenceText: q.task_type === 'read_aloud' ? (q.question_text || '') : (q.reference_text || ''),
                transcript: transcript,
                pronunciationScores: scores,
                imageUrl: q.image_url || null
              });
              if (geminiEval && geminiEval.score_total != null) {
                if (q.task_type === 'read_aloud') {
                  // Dạng Read Aloud: Hoàn toàn không chấm ngữ pháp và ngữ cảnh, chỉ giữ 100% điểm phát âm âm học
                  scores.grammar = null;
                  scores.context = null;
                  scores.total = scores.total;
                } else {
                  scores.total = geminiEval.score_total;
                  scores.grammar = geminiEval.score_grammar;
                  scores.context = geminiEval.score_context;
                }
              }
            } catch (gErr) {
              console.warn('Lỗi gọi Gemini Eval:', gErr);
            }

            const combinedResult = { ...(result || {}), gemini_eval: geminiEval };

            await saveAnswer(practiceSession.id, q.id, {
              audio_url: audioUrl,
              transcript,
              score_total: scores.total,
              score_accuracy: scores.accuracy,
              score_fluency: scores.fluency,
              score_prosodic: scores.prosodic,
              score_grammar: geminiEval?.score_grammar ?? null,
              score_context: geminiEval?.score_context ?? null,
              result_json: combinedResult,
            });

            practiceAnswers[q.id] = { blob: audioBlob, result: combinedResult, scores, transcript, audioUrl, geminiEval };

            scoringOverlay.classList.add('d-none');
            document.getElementById('practiceRecordingArea').classList.remove('d-none');
            statusEl.textContent = 'Nhấn để ghi âm lại';
            renderAnswerResult(practiceAnswers[q.id], q);
            document.getElementById('practiceAnswerResult').classList.remove('d-none');

          } catch (e) {
            scoringOverlay.classList.add('d-none');
            document.getElementById('practiceRecordingArea').classList.remove('d-none');
            statusEl.textContent = 'Lỗi chấm điểm. Nhấn để thử lại.';
            alert('Lỗi chấm điểm: ' + e.message);
          }
        }

        function renderAnswerResult(answer, targetQ = null) {
          if (!answer) return;
          const currentQ = targetQ || practiceQuestions[practiceCurrentIdx] || {};
          const isReadAloud = currentQ.task_type === 'read_aloud';
          const s = answer.scores || {};
          const resultArea = document.getElementById('practiceAnswerResult');
          if (!resultArea) return;
          const valClass = (v) => v >= 8 ? 'excellent' : v >= 6 ? 'good' : v >= 4 ? 'average' : 'poor';
          const gemini = answer.geminiEval || answer.result?.gemini_eval;

          const relevanceMap = {
            'excellent': { label: 'Xuất sắc', cls: 'badge-relevance-excellent' },
            'relevant': { label: 'Đúng trọng tâm', cls: 'badge-relevance-good' },
            'partially_relevant': { label: 'Đạt một phần', cls: 'badge-relevance-mid' },
            'too_short': { label: 'Quá cộc lốc / Ngắn', cls: 'badge-relevance-poor' },
            'irrelevant': { label: 'Lạc đề hoàn toàn', cls: 'badge-relevance-poor' },
          };
          const relInfo = (!isReadAloud && gemini?.relevance_level) ? (relevanceMap[gemini.relevance_level] || { label: gemini.relevance_level, cls: 'bg-secondary' }) : null;

          const errors = gemini?.grammar_errors || [];

          resultArea.innerHTML = `
            <div class="answer-result-card">
              <!-- Header điểm số -->
              <div class="d-flex align-items-center justify-content-between mb-3 flex-wrap gap-2">
                <div class="d-flex align-items-center gap-2">
                  <span class="fs-5 fw-bold text-light"><i class="bi bi-patch-check-fill text-warning me-2"></i>Kết quả câu trả lời</span>
                  ${relInfo ? `<span class="badge ${relInfo.cls}">${relInfo.label}</span>` : ''}
                </div>
                ${gemini?.is_fallback
                  ? `<span class="badge bg-secondary-subtle text-secondary border border-secondary-subtle small" title="Đánh giá dự phòng heuristic">Đánh giá cơ bản</span>`
                  : `<span class="badge bg-primary-subtle text-primary border border-primary-subtle small"><i class="bi bi-stars me-1"></i>AI Evaluator</span>`
                }
              </div>

              <!-- Lưới điểm tổng hợp -->
              <div class="result-scores-grid">
                <div class="result-score-item highlight-total">
                  <div class="score-label">Điểm Tổng Thể</div>
                  <div class="score-val ${valClass(s.total || 0)}">${(s.total || 0).toFixed(1)}</div>
                  <div class="score-subtext">${isReadAloud ? 'Phát âm âm học' : 'Khảo thí kết hợp'}</div>
                </div>
                ${!isReadAloud ? `
                <div class="result-score-item">
                  <div class="score-label">Ngữ Pháp (Grammar)</div>
                  <div class="score-val ${valClass(s.grammar ?? gemini?.score_grammar ?? 0)}">${(s.grammar ?? gemini?.score_grammar ?? 0).toFixed(1)}</div>
                  <div class="score-subtext">Cấu trúc & Chia thì</div>
                </div>
                <div class="result-score-item">
                  <div class="score-label">Ngữ Cảnh (Context)</div>
                  <div class="score-val ${valClass(s.context ?? gemini?.score_context ?? 0)}">${(s.context ?? gemini?.score_context ?? 0).toFixed(1)}</div>
                  <div class="score-subtext">Độ dài & Đáp ứng đề</div>
                </div>
                ` : ''}
                <div class="result-score-item">
                  <div class="score-label">Accuracy</div>
                  <div class="score-val ${valClass(s.accuracy)}">${s.accuracy.toFixed(1)}</div>
                  <div class="score-subtext">Phát âm âm vị</div>
                </div>
                <div class="result-score-item">
                  <div class="score-label">Fluency</div>
                  <div class="score-val ${valClass(s.fluency)}">${s.fluency.toFixed(1)}</div>
                  <div class="score-subtext">Trôi chảy, nhịp điệu</div>
                </div>
                <div class="result-score-item">
                  <div class="score-label">Prosody</div>
                  <div class="score-val ${valClass(s.prosodic)}">${s.prosodic.toFixed(1)}</div>
                  <div class="score-subtext">Ngữ điệu, cao độ</div>
                </div>
              </div>

              <!-- Transcript -->
              ${answer.transcript ? `
                <div class="result-transcript-box mt-3">
                  <div class="d-flex align-items-center gap-1 text-muted smaller mb-1">
                    <i class="bi bi-chat-left-quote-fill text-primary"></i>
                    <span class="fw-semibold">Lời bạn đã nói (AI nhận diện):</span>
                  </div>
                  <div class="fst-italic text-light">"${answer.transcript}"</div>
                </div>
              ` : ''}

              <!-- Nhận xét sư phạm Gemini -->
              ${gemini?.feedback_summary ? `
                <div class="gemini-feedback-box mt-3">
                  <div class="d-flex align-items-center gap-2 mb-1">
                    <i class="bi bi-lightbulb-fill text-warning"></i>
                    <span class="fw-semibold small text-warning">Nhận xét từ Giám khảo AI:</span>
                  </div>
                  <div class="small text-light text-opacity-90">${gemini.feedback_summary}</div>
                </div>
              ` : ''}

              <!-- Chi tiết lỗi ngữ pháp -->
              ${errors.length > 0 ? `
                <div class="grammar-errors-section mt-3">
                  <div class="d-flex align-items-center gap-2 mb-2">
                    <i class="bi bi-exclamation-triangle-fill text-danger"></i>
                    <span class="fw-semibold small text-danger">Lỗi Ngữ Pháp cần sửa (${errors.length}):</span>
                  </div>
                  <div class="d-flex flex-column gap-2">
                    ${errors.map((err, i) => `
                      <div class="grammar-error-card">
                        <div class="d-flex align-items-center gap-2 flex-wrap mb-1">
                          <span class="badge bg-danger-subtle text-danger border border-danger-subtle smaller">Lỗi ${i + 1}</span>
                          <span class="text-danger text-decoration-line-through smaller">${err.error_text || ''}</span>
                          <i class="bi bi-arrow-right text-muted smaller"></i>
                          <span class="text-success fw-semibold smaller">${err.fix || ''}</span>
                        </div>
                        ${err.explanation ? `<div class="text-muted smaller"><i class="bi bi-info-circle me-1"></i>${err.explanation}</div>` : ''}
                      </div>
                    `).join('')}
                  </div>
                </div>
              ` : (answer.transcript && gemini ? `
                <div class="grammar-success-box mt-3">
                  <i class="bi bi-check-circle-fill text-success me-2"></i>
                  <span class="small text-success">Ngữ pháp tốt! Không phát hiện lỗi cấu trúc nghiêm trọng.</span>
                </div>
              ` : '')}

              <!-- Gợi ý diễn đạt tự nhiên hơn -->
              ${gemini?.better_expression ? `
                <div class="better-expression-box mt-3">
                  <div class="d-flex align-items-center gap-2 mb-1">
                    <i class="bi bi-chat-heart-fill text-info"></i>
                    <span class="fw-semibold small text-info">Gợi ý cách diễn đạt tự nhiên & nâng cao hơn:</span>
                  </div>
                  <div class="fst-italic small text-light ps-3 border-start border-info border-2">
                    "${gemini.better_expression}"
                  </div>
                </div>
              ` : ''}

              <!-- Audio player -->
              ${answer.audioUrl ? `
                <div class="mt-3 pt-2 border-top border-secondary border-opacity-25">
                  <div class="text-muted smaller mb-1"><i class="bi bi-soundwave me-1 text-primary"></i>Nghe lại bản ghi âm câu trả lời:</div>
                  <audio controls class="w-100" style="height: 38px;" src="${answer.audioUrl}"></audio>
                </div>
              ` : ''}
            </div>`;
        }

        function practiceGoNext() {
          if (practiceCurrentIdx < practiceQuestions.length - 1) {
            practiceCurrentIdx++;
            renderCurrentQuestion();
          } else {
            finishPracticeSession();
          }
        }

        function practiceGoPrev() {
          if (currentSessionMode === 'exam') return; // Không cho phép quay lại trong Exam mode
          if (practiceCurrentIdx > 0) {
            practiceCurrentIdx--;
            renderCurrentQuestion();
          }
        }

        async function finishPracticeSession() {
          cleanupPracticeTimers();
          try {
            let bandInfo = null;
            if (currentSessionMode === 'exam') {
              // Tính sơ bộ band
              const examType = currentSetData?.exam_type || 'general';
              let sum = 0, count = 0;
              for (const q of practiceQuestions) {
                const a = practiceAnswers[q.id];
                if (a && a.scores && a.scores.total != null) {
                  sum += a.scores.total;
                  count++;
                }
              }
              const avgScore = count > 0 ? (sum / count) : 0;
              bandInfo = calculateBandScore(avgScore, examType);

              // CHẾ ĐỘ THI THỬ: Chỉ lưu lên Supabase khi học viên nộp bài thi
              document.getElementById('practiceScoringOverlay')?.classList.remove('d-none');
              const stepEl = document.getElementById('practiceScoringStep');
              if (stepEl) stepEl.textContent = 'Đang nộp bài và tạo phiên thi trên hệ thống...';

              // 1. Tạo phiên thi trên Supabase
              const session = await startSession(currentUser.id, currentSetData.id, 'exam');
              practiceSession = { id: session.id, set_id: currentSetData.id };

              // 2. Upload các file ghi âm và lưu câu trả lời vào Supabase
              for (let idx = 0; idx < practiceQuestions.length; idx++) {
                const q = practiceQuestions[idx];
                const a = practiceAnswers[q.id];
                if (a) {
                  let audioUrl = a.audioUrl || null;
                  if (!audioUrl && a.blob) {
                    if (stepEl) stepEl.textContent = `Đang tải lên bài ghi âm câu ${idx + 1}/${practiceQuestions.length}...`;
                    try {
                      audioUrl = await uploadPracticeAudio(currentUser.id, a.blob, `q${idx + 1}_exam_${Date.now()}.webm`);
                      a.audioUrl = audioUrl;
                    } catch (err) {
                      console.warn('Lỗi upload audio câu', idx + 1, err);
                    }
                  }

                  await saveAnswer(practiceSession.id, q.id, {
                    audio_url: audioUrl,
                    transcript: a.transcript || '',
                    score_total: a.scores?.total || 0,
                    score_accuracy: a.scores?.accuracy || 0,
                    score_fluency: a.scores?.fluency || 0,
                    score_prosodic: a.scores?.prosodic || 0,
                    score_grammar: a.scores?.grammar ?? a.geminiEval?.score_grammar ?? null,
                    score_context: a.scores?.context ?? a.geminiEval?.score_context ?? null,
                    result_json: a.result || null,
                  });
                }
              }

              if (stepEl) stepEl.textContent = 'Đang hoàn tất và tổng hợp kết quả thi...';
            }

            const finalScores = await completeSession(practiceSession.id, bandInfo ? bandInfo.band : null);
            document.getElementById('practiceScoringOverlay')?.classList.add('d-none');

            // Show summary page
            document.querySelectorAll('.page-section').forEach(p => p.classList.add('d-none'));
            document.getElementById('page-student-practice-summary').classList.remove('d-none');

            // Exam Band Card
            const examBandCard = document.getElementById('summaryExamBandCard');
            if (currentSessionMode === 'exam' && bandInfo) {
              examBandCard.classList.remove('d-none');
              document.getElementById('summaryBandCategory').textContent = `KẾT QUẢ THI THỬ ${bandInfo.title.toUpperCase()}`;
              const badgeEl = document.getElementById('summaryBandBadge');
              badgeEl.className = `exam-band-badge ${bandInfo.badgeClass}`;
              badgeEl.textContent = bandInfo.band;
              document.getElementById('summaryBandTitle').textContent = bandInfo.title;
              document.getElementById('summaryBandDesc').textContent = bandInfo.description;
            } else {
              examBandCard.classList.add('d-none');
            }

            document.getElementById('summaryTotalScore').textContent = finalScores.score_total.toFixed(1);
            document.getElementById('summaryAccScore').textContent = finalScores.score_accuracy.toFixed(1);
            document.getElementById('summaryFluScore').textContent = finalScores.score_fluency.toFixed(1);
            document.getElementById('summaryProScore').textContent = finalScores.score_prosodic.toFixed(1);

            // Detail list
            const detailList = document.getElementById('summaryDetailList');
            detailList.innerHTML = practiceQuestions.map((q, idx) => {
              const answer = practiceAnswers[q.id];
              const scoreClass = (v) => v >= 8 ? 'score-success' : v >= 6 ? 'score-warning' : 'score-danger';
              const gemini = answer?.geminiEval || answer?.result?.gemini_eval;
              const gramScore = answer?.scores?.grammar ?? gemini?.score_grammar;
              const ctxScore = answer?.scores?.context ?? gemini?.score_context;

              if (answer && answer.scores) {
                return `
                  <div class="practice-history-card" style="cursor:default;">
                    <div class="history-score ${scoreClass(answer.scores.total)}">${answer.scores.total.toFixed(1)}</div>
                    <div class="flex-grow-1">
                      <div class="fw-semibold small">Câu ${idx + 1}: ${q.question_text}</div>
                      ${answer.transcript ? `<div class="text-muted smaller">"${answer.transcript}"</div>` : ''}
                      <div class="d-flex gap-2 mt-1 flex-wrap">
                        ${(q.task_type !== 'read_aloud' && gramScore != null)
                          ? `<span class="badge bg-primary-subtle text-primary border border-primary-subtle">Grammar: ${Number(gramScore).toFixed(1)}</span>`
                          : ''
                        }
                        ${(q.task_type !== 'read_aloud' && ctxScore != null)
                          ? `<span class="badge bg-info-subtle text-info border border-info-subtle">Context: ${Number(ctxScore).toFixed(1)}</span>`
                          : ''
                        }
                        <span class="badge bg-secondary">Acc: ${answer.scores.accuracy.toFixed(1)}</span>
                        <span class="badge bg-secondary">Flu: ${answer.scores.fluency.toFixed(1)}</span>
                        <span class="badge bg-secondary">Pro: ${answer.scores.prosodic.toFixed(1)}</span>
                      </div>
                      ${gemini?.feedback_summary ? `<div class="smaller text-warning mt-1"><i class="bi bi-lightbulb me-1"></i>${gemini.feedback_summary}</div>` : ''}
                      ${answer.audioUrl ? `<audio controls class="w-100 mt-2" src="${answer.audioUrl}"></audio>` : ''}
                    </div>
                  </div>`;
              }
              return `
                <div class="practice-history-card" style="cursor:default;">
                  <div class="history-score score-danger">--</div>
                  <div class="flex-grow-1">
                    <div class="fw-semibold small">Câu ${idx + 1}: ${q.question_text}</div>
                    <div class="text-muted smaller">Chưa trả lời</div>
                  </div>
                </div>`;
            }).join('');

          } catch (e) {
            document.getElementById('practiceScoringOverlay')?.classList.add('d-none');
            alert('Lỗi hoàn thành phiên: ' + e.message);
          }
        }

        async function renderPracticeHistory() {
          const list = document.getElementById('practiceHistoryList');
          try {
            let sessions = await fetchSessionHistory(currentUser.id);
            const filterMode = document.getElementById('historyFilterMode').value;
            if (filterMode) sessions = sessions.filter(s => s.mode === filterMode);

            if (!sessions.length) {
              list.innerHTML = `
                <div class="empty-state">
                  <i class="bi bi-clock-history"></i>
                  <div class="empty-title">Chưa có lịch sử làm bài</div>
                  <p>Bắt đầu luyện tập hoặc thi thử để xem kết quả tại đây</p>
                </div>`;
              return;
            }

            list.innerHTML = sessions.map(s => {
              const scoreColor = (s.score_total || 0) >= 8 ? 'score-success' : (s.score_total || 0) >= 6 ? 'score-warning' : 'score-danger';
              const date = new Date(s.started_at).toLocaleDateString('vi-VN');
              const time = new Date(s.started_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
              const setTitle = s.question_set?.title || 'Bộ đề';
              const level = s.question_set?.level || '';
              const levelLabels = { beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced' };
              const isExam = s.mode === 'exam';

              return `
                <div class="practice-history-card" onclick="openPracticeDetail('${s.id}')">
                  <div class="history-score ${scoreColor}">${(s.score_total || 0).toFixed(1)}</div>
                  <div class="flex-grow-1">
                    <div class="d-flex align-items-center gap-2 mb-1 flex-wrap">
                      <span class="fw-semibold">${setTitle}</span>
                      ${isExam
                        ? `<span class="badge bg-warning-subtle text-warning border border-warning-subtle small"><i class="bi bi-award me-1"></i>Thi thử: ${s.exam_band || 'Exam'}</span>`
                        : `<span class="badge bg-success-subtle text-success border border-success-subtle small"><i class="bi bi-book me-1"></i>Luyện tập</span>`
                      }
                    </div>
                    <div class="d-flex gap-2 flex-wrap mt-1">
                      ${level ? `<span class="level-badge ${level}">${levelLabels[level]}</span>` : ''}
                      <span class="text-muted small">${date} ${time}</span>
                    </div>
                    <div class="d-flex gap-2 mt-1 flex-wrap">
                      ${s.score_grammar != null ? `<span class="badge bg-primary-subtle text-primary border border-primary-subtle">Gram: ${s.score_grammar.toFixed(1)}</span>` : ''}
                      ${s.score_context != null ? `<span class="badge bg-info-subtle text-info border border-info-subtle">Ctx: ${s.score_context.toFixed(1)}</span>` : ''}
                      <span class="badge bg-secondary">Acc: ${(s.score_accuracy || 0).toFixed(1)}</span>
                      <span class="badge bg-secondary">Flu: ${(s.score_fluency || 0).toFixed(1)}</span>
                      <span class="badge bg-secondary">Pro: ${(s.score_prosodic || 0).toFixed(1)}</span>
                    </div>
                  </div>
                  <i class="bi bi-chevron-right text-muted"></i>
                </div>`;
            }).join('');
          } catch (e) {
            list.innerHTML = `<div class="text-danger">Lỗi: ${e.message}</div>`;
          }
        }

        window.openPracticeDetail = async function (sessionId) {
          try {
            const detail = await fetchSessionDetail(sessionId);
            const body = document.getElementById('practiceDetailBody');

            const valClass = (v) => v >= 8 ? 'excellent' : v >= 6 ? 'good' : v >= 4 ? 'average' : 'poor';
            const isExam = detail.mode === 'exam';

            body.innerHTML = `
              ${isExam ? `
                <div class="exam-band-card mb-3" style="padding:1.25rem;">
                  <div class="text-warning small fw-bold text-uppercase">KẾT QUẢ THI THỬ</div>
                  <div class="exam-band-badge" style="font-size:2rem; padding:0.25rem 1rem;">${detail.exam_band || 'Thi thử'}</div>
                </div>
              ` : ''}

              <div class="practice-summary mb-4" style="padding:1.5rem;">
                <div class="summary-score" style="font-size:2.5rem;">${(detail.score_total || 0).toFixed(1)}</div>
                <div class="summary-label">Điểm tổng thể khảo thí / 10</div>
                <div class="d-flex justify-content-center gap-3 mt-2 flex-wrap">
                  ${detail.score_grammar != null ? `
                    <div class="text-center">
                      <div class="fw-bold text-primary">${detail.score_grammar.toFixed(1)}</div>
                      <div class="text-muted small">Grammar</div>
                    </div>
                  ` : ''}
                  ${detail.score_context != null ? `
                    <div class="text-center">
                      <div class="fw-bold text-info">${detail.score_context.toFixed(1)}</div>
                      <div class="text-muted small">Context</div>
                    </div>
                  ` : ''}
                  <div class="text-center">
                    <div class="fw-bold">${(detail.score_accuracy || 0).toFixed(1)}</div>
                    <div class="text-muted small">Accuracy</div>
                  </div>
                  <div class="text-center">
                    <div class="fw-bold">${(detail.score_fluency || 0).toFixed(1)}</div>
                    <div class="text-muted small">Fluency</div>
                  </div>
                  <div class="text-center">
                    <div class="fw-bold">${(detail.score_prosodic || 0).toFixed(1)}</div>
                    <div class="text-muted small">Prosody</div>
                  </div>
                </div>
              </div>

              <h6 class="fw-semibold mb-3"><i class="bi bi-list-check me-2 text-primary"></i>Chi tiết từng câu</h6>
              ${(detail.answers || []).map((a, idx) => {
                const gemini = a.result_json?.gemini_eval;
                const errors = gemini?.grammar_errors || [];
                const gramScore = a.score_grammar ?? gemini?.score_grammar;
                const ctxScore = a.score_context ?? gemini?.score_context;

                return `
                  <div class="answer-result-card mb-3">
                    <div class="fw-semibold small mb-2">
                      <span class="text-primary">Câu ${a.question?.order_num || (idx + 1)}:</span>
                      ${a.question?.question_text || ''}
                    </div>
                    <div class="result-scores-grid">
                      <div class="result-score-item highlight-total">
                        <div class="score-label">Total</div>
                        <div class="score-val ${valClass(a.score_total || 0)}">${(a.score_total || 0).toFixed(1)}</div>
                      </div>
                      <div class="result-score-item">
                        <div class="score-label">Ngữ pháp</div>
                        <div class="score-val ${valClass(gramScore || 0)}">${gramScore != null ? Number(gramScore).toFixed(1) : '--'}</div>
                      </div>
                      <div class="result-score-item">
                        <div class="score-label">Ngữ cảnh</div>
                        <div class="score-val ${valClass(ctxScore || 0)}">${ctxScore != null ? Number(ctxScore).toFixed(1) : '--'}</div>
                      </div>
                      <div class="result-score-item">
                        <div class="score-label">Accuracy</div>
                        <div class="score-val ${valClass(a.score_accuracy || 0)}">${(a.score_accuracy || 0).toFixed(1)}</div>
                      </div>
                      <div class="result-score-item">
                        <div class="score-label">Fluency</div>
                        <div class="score-val ${valClass(a.score_fluency || 0)}">${(a.score_fluency || 0).toFixed(1)}</div>
                      </div>
                      <div class="result-score-item">
                        <div class="score-label">Prosody</div>
                        <div class="score-val ${valClass(a.score_prosodic || 0)}">${(a.score_prosodic || 0).toFixed(1)}</div>
                      </div>
                    </div>

                    ${a.transcript ? `
                      <div class="p-2 rounded bg-dark bg-opacity-50 border border-secondary border-opacity-25 mt-2">
                        <div class="text-muted smaller fw-semibold mb-1"><i class="bi bi-chat-left-quote me-1 text-primary"></i>Transcript nhận diện:</div>
                        <div class="small text-light">"${a.transcript}"</div>
                      </div>
                    ` : ''}

                    ${gemini?.feedback_summary ? `
                      <div class="mt-2 p-2 rounded bg-warning bg-opacity-10 border border-warning border-opacity-25">
                        <div class="smaller text-warning fw-semibold mb-1"><i class="bi bi-stars me-1"></i>Nhận xét Giám khảo AI:</div>
                        <div class="smaller text-light">${gemini.feedback_summary}</div>
                      </div>
                    ` : ''}

                    ${errors.length > 0 ? `
                      <div class="mt-2 p-2 rounded bg-danger bg-opacity-10 border border-danger border-opacity-25">
                        <div class="smaller text-danger fw-semibold mb-1"><i class="bi bi-exclamation-circle me-1"></i>Lỗi ngữ pháp (${errors.length}):</div>
                        ${errors.map(err => `
                          <div class="smaller text-light mb-1 ps-2 border-start border-danger">
                            <span class="text-danger text-decoration-line-through">${err.error_text || ''}</span>
                            <i class="bi bi-arrow-right text-muted mx-1"></i>
                            <span class="text-success fw-semibold">${err.fix || ''}</span>
                            ${err.explanation ? `<div class="text-muted smaller">${err.explanation}</div>` : ''}
                          </div>
                        `).join('')}
                      </div>
                    ` : ''}

                    ${gemini?.better_expression ? `
                      <div class="mt-2 p-2 rounded bg-info bg-opacity-10 border border-info border-opacity-25">
                        <div class="smaller text-info fw-semibold mb-1"><i class="bi bi-lightbulb me-1"></i>Gợi ý diễn đạt tự nhiên hơn:</div>
                        <div class="smaller text-light fst-italic">"${gemini.better_expression}"</div>
                      </div>
                    ` : ''}

                    ${a.audio_url ? `
                      <div class="mt-2 p-2 rounded bg-dark border border-secondary border-opacity-25">
                        <div class="d-flex align-items-center justify-content-between mb-1">
                          <span class="smaller text-info fw-semibold"><i class="bi bi-soundwave me-1"></i>Bản ghi âm câu trả lời:</span>
                          <a href="${a.audio_url}" target="_blank" class="smaller text-muted text-decoration-none" title="Mở file ghi âm"><i class="bi bi-box-arrow-up-right me-1"></i>Mở audio</a>
                        </div>
                        <audio controls class="w-100" style="height: 36px;" src="${a.audio_url}"></audio>
                      </div>
                    ` : '<div class="text-muted smaller mt-2 fst-italic"><i class="bi bi-mic-mute me-1"></i>Không có bản ghi âm</div>'}
                  </div>
                `;
              }).join('')}
            `;

            new bootstrap.Modal(document.getElementById('practiceDetailModal')).show();
          } catch (e) {
            alert('Lỗi tải chi tiết: ' + e.message);
          }
        };

        // ── TEACHER: VIEW STUDENT SESSIONS & SUBMISSIONS ───────────
        window.currentTeacherLoadedSessions = [];

        window.openTeacherStudentSessions = async function (studentId, encodedName) {
          const studentName = decodeURIComponent(encodedName);
          const modalEl = document.getElementById('teacherSessionsModal');
          document.getElementById('teacherSessionsModalTitle').innerHTML =
            `<i class="bi bi-award text-warning me-2"></i>Bài làm của ${studentName}`;
          document.getElementById('teacherSessionsModalSubtitle').textContent = 'Xem kết quả bài làm và nghe lại audio từng câu';
          const listEl = document.getElementById('teacherSessionsList');
          listEl.innerHTML = '<div class="text-center py-4 text-muted"><div class="spinner-border spinner-border-sm text-primary me-2"></div>Đang tải dữ liệu...</div>';

          new bootstrap.Modal(modalEl).show();

          try {
            const { data: sessions, error } = await supabase
              .from('practice_sessions')
              .select(`
                id, mode, status, score_total, score_accuracy, score_fluency, score_prosodic, exam_band,
                started_at, completed_at,
                question_set:question_sets(id, title, level, exam_type)
              `)
              .eq('student_id', studentId)
              .eq('status', 'completed')
              .order('completed_at', { ascending: false });

            if (error) throw error;

            window.currentTeacherLoadedSessions = (sessions || []).map(s => ({
              ...s,
              displayTitle: s.question_set?.title || 'Bộ đề',
              displaySubtitle: s.question_set?.exam_type ? s.question_set.exam_type.toUpperCase() : ''
            }));
            renderTeacherSessionsFiltered();
          } catch (e) {
            listEl.innerHTML = `<div class="alert alert-danger py-2">Lỗi tải dữ liệu: ${e.message}</div>`;
          }
        };

        window.openTeacherSetSubmissions = async function (setId, encodedTitle) {
          const setTitle = decodeURIComponent(encodedTitle);
          const modalEl = document.getElementById('teacherSessionsModal');
          document.getElementById('teacherSessionsModalTitle').innerHTML =
            `<i class="bi bi-journal-check text-info me-2"></i>Bài nộp: ${setTitle}`;
          document.getElementById('teacherSessionsModalSubtitle').textContent = 'Danh sách tất cả học viên đã hoàn thành bài thi / luyện tập bộ đề này';
          const listEl = document.getElementById('teacherSessionsList');
          listEl.innerHTML = '<div class="text-center py-4 text-muted"><div class="spinner-border spinner-border-sm text-primary me-2"></div>Đang tải dữ liệu...</div>';

          new bootstrap.Modal(modalEl).show();

          try {
            const { data: sessions, error } = await supabase
              .from('practice_sessions')
              .select(`
                id, mode, status, score_total, score_accuracy, score_fluency, score_prosodic, exam_band,
                started_at, completed_at,
                question_set:question_sets(id, title, level, exam_type),
                student:profiles!student_id(id, full_name, email)
              `)
              .eq('set_id', setId)
              .eq('status', 'completed')
              .order('completed_at', { ascending: false });

            if (error) throw error;

            window.currentTeacherLoadedSessions = (sessions || []).map(s => ({
              ...s,
              displayTitle: s.student?.full_name ? `Học viên: ${s.student.full_name}` : 'Học viên',
              displaySubtitle: s.student?.email || '',
            }));
            renderTeacherSessionsFiltered();
          } catch (e) {
            listEl.innerHTML = `<div class="alert alert-danger py-2">Lỗi tải dữ liệu: ${e.message}</div>`;
          }
        };

        function renderTeacherSessionsFiltered() {
          const listEl = document.getElementById('teacherSessionsList');
          const filter = document.getElementById('teacherSessionsFilterMode')?.value || '';
          let list = window.currentTeacherLoadedSessions || [];
          if (filter) list = list.filter(s => s.mode === filter);

          if (!list.length) {
            listEl.innerHTML = `
              <div class="empty-state py-4 text-center">
                <i class="bi bi-journal-x fs-2 text-muted"></i>
                <div class="text-muted mt-2">Chưa có bài nộp nào trong danh mục này</div>
              </div>`;
            return;
          }

          listEl.innerHTML = list.map(s => {
            const isExam = s.mode === 'exam';
            const isDone = s.status === 'completed';
            const date = new Date(s.started_at).toLocaleDateString('vi-VN');
            const time = new Date(s.started_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
            const scoreVal = s.score_total != null ? s.score_total.toFixed(1) : '--';
            const scoreColor = (s.score_total || 0) >= 8 ? 'score-success' : (s.score_total || 0) >= 6 ? 'score-warning' : 'score-danger';
            const title = s.displayTitle || 'Bộ đề';

            return `
              <div class="practice-history-card p-3 rounded bg-dark border border-secondary border-opacity-25 d-flex align-items-center gap-3 cursor-pointer" onclick="openPracticeDetailFromTeacher('${s.id}')">
                <div class="history-score ${scoreColor}" style="min-width:54px; text-align:center; font-size:1.4rem; font-weight:800;">${scoreVal}</div>
                <div class="flex-grow-1">
                  <div class="d-flex align-items-center gap-2 flex-wrap mb-1">
                    <span class="fw-bold text-white">${title}</span>
                    ${s.displaySubtitle ? `<span class="text-muted small">(${s.displaySubtitle})</span>` : ''}
                    ${isExam
                      ? `<span class="badge bg-warning text-dark fw-bold"><i class="bi bi-award me-1"></i>Thi thử: ${s.exam_band || 'Exam'}</span>`
                      : `<span class="badge bg-success-subtle text-success border border-success-subtle"><i class="bi bi-book me-1"></i>Luyện tập</span>`
                    }
                    ${!isDone ? `<span class="badge bg-secondary-subtle text-secondary small">Đang làm dở</span>` : ''}
                  </div>
                  <div class="d-flex gap-3 flex-wrap small text-muted">
                    <span><i class="bi bi-calendar3 me-1"></i>${date} ${time}</span>
                    ${s.score_accuracy != null ? `<span class="text-light">Accuracy: ${s.score_accuracy.toFixed(1)}</span>` : ''}
                    ${s.score_fluency != null ? `<span class="text-light">Fluency: ${s.score_fluency.toFixed(1)}</span>` : ''}
                    ${s.score_prosodic != null ? `<span class="text-light">Prosody: ${s.score_prosodic.toFixed(1)}</span>` : ''}
                  </div>
                </div>
                <button class="btn btn-sm btn-outline-info rounded-pill px-3">
                  <i class="bi bi-eye me-1"></i>Chi tiết & Nghe
                </button>
              </div>`;
          }).join('');
        }

        window.openPracticeDetailFromTeacher = function (sessionId) {
          const tModalEl = document.getElementById('teacherSessionsModal');
          if (tModalEl) {
            const inst = bootstrap.Modal.getInstance(tModalEl);
            if (inst) inst.hide();
          }
          openPracticeDetail(sessionId);
        };

        document.getElementById('teacherSessionsFilterMode')?.addEventListener('change', renderTeacherSessionsFiltered);

        // ── ADMIN & SYSTEM API CONFIGURATION ──────────────────────
        function initApiConfigForm() {
          const cfg = getGeminiConfig();
          const gpuUrlInput = document.getElementById('adminGpuApiUrl');
          const geminiKeyInput = document.getElementById('adminGeminiKey');
          const geminiUrlInput = document.getElementById('adminGeminiUrl');
          const geminiModelInput = document.getElementById('adminGeminiModel');

          if (gpuUrlInput && window.globalApiUrl) gpuUrlInput.value = window.globalApiUrl;
          if (geminiKeyInput) geminiKeyInput.value = cfg.apiKey || '';
          if (geminiUrlInput) geminiUrlInput.value = cfg.apiUrl || DEFAULT_GEMINI_ENDPOINT;
          if (geminiModelInput) geminiModelInput.value = cfg.model || DEFAULT_GEMINI_MODEL;
        }

        // Modal API Config Handlers (dành cho mọi người dùng khi click nút Cấu hình trên sidebar hoặc Admin)
        function setupApiConfigModal() {
          const modalEl = document.getElementById('apiConfigModal');
          if (!modalEl) return;

          function populateConfigInputs() {
            const cfg = getGeminiConfig();
            const keyInput = document.getElementById('modalGeminiKey');
            const urlInput = document.getElementById('modalGeminiUrl');
            const modelInput = document.getElementById('modalGeminiModel');
            const gpuInput = document.getElementById('modalGpuApiUrl');

            if (keyInput) keyInput.value = cfg.apiKey || '';
            if (urlInput) urlInput.value = cfg.apiUrl || DEFAULT_GEMINI_ENDPOINT;
            if (modelInput) modelInput.value = cfg.model || DEFAULT_GEMINI_MODEL;
            if (gpuInput) gpuInput.value = window.globalApiUrl || '';

            const statusEl = document.getElementById('modalGeminiTestStatus');
            if (statusEl) statusEl.innerHTML = '';
          }

          // Tự động load dữ liệu mới nhất mỗi khi modal được mở
          modalEl.addEventListener('show.bs.modal', populateConfigInputs);

          const openBtns = document.querySelectorAll('.btn-open-api-config');
          openBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
              e.preventDefault();
              populateConfigInputs();
              bootstrap.Modal.getOrCreateInstance(modalEl).show();
            });
          });

          // Test Gemini Connection
          document.getElementById('modalTestGeminiBtn')?.addEventListener('click', async () => {
            const key = document.getElementById('modalGeminiKey')?.value.trim();
            const url = document.getElementById('modalGeminiUrl')?.value.trim() || DEFAULT_GEMINI_ENDPOINT;
            const model = document.getElementById('modalGeminiModel')?.value.trim() || DEFAULT_GEMINI_MODEL;
            const statusEl = document.getElementById('modalGeminiTestStatus');
            const btn = document.getElementById('modalTestGeminiBtn');

            if (!key) {
              if (statusEl) statusEl.innerHTML = '<span class="text-danger small"><i class="bi bi-exclamation-circle me-1"></i>Vui lòng nhập API Key trước khi test!</span>';
              return;
            }

            btn.disabled = true;
            if (statusEl) statusEl.innerHTML = '<span class="text-info small"><span class="spinner-border spinner-border-sm me-1"></span>Đang kiểm tra kết nối tới AI Evaluator...</span>';

            try {
              const res = await testGeminiConnection(key, url, model);
              if (statusEl) statusEl.innerHTML = `<span class="text-success small"><i class="bi bi-check-circle-fill me-1"></i>Kết nối thành công! Model: <b>${res.model}</b> (Phản hồi: "${res.reply}")</span>`;
            } catch (err) {
              if (statusEl) statusEl.innerHTML = `<span class="text-danger small"><i class="bi bi-x-circle-fill me-1"></i>${err.message}</span>`;
            } finally {
              btn.disabled = false;
            }
          });

          // Save Settings
          document.getElementById('modalSaveApiConfigBtn')?.addEventListener('click', async () => {
            const key = document.getElementById('modalGeminiKey')?.value.trim() || '';
            const url = document.getElementById('modalGeminiUrl')?.value.trim() || DEFAULT_GEMINI_ENDPOINT;
            const model = document.getElementById('modalGeminiModel')?.value.trim() || DEFAULT_GEMINI_MODEL;
            const gpuUrl = document.getElementById('modalGpuApiUrl')?.value.trim() || '';
            const statusEl = document.getElementById('modalGeminiTestStatus');

            // 1. Lưu local cache
            saveLocalGeminiConfig({ apiKey: key, apiUrl: url, model: model });
            window.globalGeminiApiKey = key;
            window.globalGeminiApiUrl = url;
            window.globalGeminiModel = model;
            if (gpuUrl) window.globalApiUrl = gpuUrl;

            // 2. Thử lưu lên Supabase global_settings
            try {
              const { updateGlobalSettings } = await import('./auth.js');
              await updateGlobalSettings({
                api_url: gpuUrl || window.globalApiUrl || '',
                gemini_api_key: key,
                gemini_api_url: url,
                gemini_model: model,
              });
              if (statusEl) statusEl.innerHTML = '<span class="text-success small"><i class="bi bi-check-circle me-1"></i>Đã lưu cấu hình lên Hệ thống & Trình duyệt thành công!</span>';
            } catch (e) {
              console.warn('Không thể lưu lên Supabase (có thể do quyền), đã lưu local:', e);
              if (statusEl) statusEl.innerHTML = '<span class="text-warning small"><i class="bi bi-info-circle me-1"></i>Đã lưu cấu hình vào trình duyệt của bạn!</span>';
            }

            setTimeout(() => {
              const inst = bootstrap.Modal.getOrCreateInstance(modalEl);
              if (inst) inst.hide();
            }, 1200);
          });
        }

        // Khởi động setup modal cấu hình
        setupApiConfigModal();