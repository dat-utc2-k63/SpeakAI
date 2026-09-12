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
          togglePublishSet, fetchQuestions, addQuestion, updateQuestion, deleteQuestion
        } from './question_sets.js';
        import {
          fetchPublishedSets, fetchSetWithQuestions, startSession, saveAnswer,
          completeSession, fetchSessionHistory, fetchSessionDetail,
          uploadPracticeAudio, assessSingleAnswer,
          playBeep, playStartTone, playEndTone, calculateBandScore,
          fetchActiveSession, cancelSession
        } from './practice.js';


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

        (async () => {
          const { data: { session } } = await supabase.auth.getSession();
          if (!session) { window.location.href = 'index.html'; return; }
          currentUser = session.user;
          currentProfile = await getProfile(currentUser.id);
          if (currentProfile && !currentProfile.voice_enrolled && hasVoiceEnrolled(currentProfile)) {
            currentProfile.voice_enrolled = true;
            updateProfile(currentUser.id, { voice_enrolled: true }).catch(console.error);
          }

          try {
            const m = await import('./auth.js');
            const settings = await m.getGlobalSettings();
            if (settings && settings.api_url) {
              window.globalApiUrl = settings.api_url;
            } else {
              console.warn("Chưa cấu hình API URL");
            }
          } catch(e) {
            console.error("Lỗi tải API URL", e);
          }

          const loader = document.getElementById('globalAiLoader');
          if (loader) loader.remove();

          initUI();
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
            const skipFeedback = document.getElementById('skipFeedbackCheck').checked;
            formData.append("audio", convFile);
            formData.append("teacher_embeddings_json", JSON.stringify(tEmb || []));
            formData.append("student_embeddings_json", JSON.stringify(sEmb || []));
            formData.append("score_teacher", scoreTeacher);
            formData.append("skip_feedback", skipFeedback);

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

        function showRealResults(assessmentId, resultObj, llmFeedback) {
          currentAssessmentId = assessmentId;
          currentApiResult = { ...resultObj, llm_feedback: llmFeedback };

          // Trích xuất điểm trung bình của học viên từ resultObj.student
          let total = 0, acc = 0, flu = 0, pro = 0;
          const sentences = resultObj.student.sentences || [];
          if (sentences.length > 0) {
            let count = 0;
            for (const s of sentences) {
              if (s.scores) {
                total += s.scores.total || 0;
                acc += s.scores.accuracy || 0;
                flu += s.scores.fluency || 0;
                pro += s.scores.prosodic || 0;
                count++;
              }
            }
            if (count > 0) {
              total /= count; acc /= count; flu /= count; pro /= count;
            }
          }

          document.getElementById('resTotal').textContent = total.toFixed(1);
          document.getElementById('resAcc').textContent = acc.toFixed(1);
          document.getElementById('resFlu').textContent = flu.toFixed(1);
          document.getElementById('resPro').textContent = pro.toFixed(1);

          // Level badge
          const levelBadge = document.getElementById('resLevelBadge');
          const otf = resultObj.overall_transformer_feedback || {};
          const level = otf.level || (total >= 8.5 ? 'excellent' : total >= 7.0 ? 'good' : total >= 5.0 ? 'average' : total >= 3.0 ? 'weak' : 'critical');
          const levelLabels = { excellent: 'Xuất sắc', good: 'Tốt', average: 'Trung bình', weak: 'Yếu', critical: 'Cần cải thiện' };
          const levelColors = { excellent: 'bg-success', good: 'bg-info', average: 'bg-warning text-dark', weak: 'bg-danger', critical: 'bg-danger' };
          levelBadge.textContent = levelLabels[level] || level;
          levelBadge.className = `badge fs-6 ${levelColors[level] || 'bg-secondary'}`;

          // Hide model comparison table (SpeechOcean762 is sole scoring model)
          const comparisonInfo = document.getElementById('modelComparisonInfo');
          if (comparisonInfo) {
            comparisonInfo.classList.add('d-none');
          }

          // Transformer feedback panel
          const tfSummaryBox = document.getElementById('tfSummaryBox');
          if (tfSummaryBox) {
            if (otf && otf.summary) {
              tfSummaryBox.innerHTML = simpleMarkdown(otf.summary);
            } else {
              tfSummaryBox.innerHTML = '<span class="text-muted">Đang phân tích...</span>';
            }
          }

          document.getElementById('dialogueTimeline').innerHTML = (resultObj.dialogue.turns || []).map(renderTurnApi).join('');
          document.getElementById('assessTitleInput').value = '';
          document.getElementById('assessResults').classList.remove('d-none');
          document.getElementById('runAssessBtn').disabled = false;

          // Lấy các điểm trung bình lưu vào lại để saveAssessment dùng
          currentApiResult.score_total = total;
          currentApiResult.score_accuracy = acc;
          currentApiResult.score_fluency = flu;
          currentApiResult.score_prosodic = pro;
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

          if (isTeacher) {
            return `
      <div class="timeline-item timeline-teacher">
        <div class="timeline-dot teacher-dot"><i class="bi bi-person-video3"></i></div>
        <div class="speech-bubble-enhanced teacher-bubble-enhanced">
          <div class="d-flex justify-content-between align-items-center mb-1">
            <div class="small text-muted fw-semibold"><i class="bi bi-person-badge me-1 text-primary"></i>Giáo viên</div>
          </div>
          <div class="teacher-transcript text-white-50">${turn.transcript}</div>
          ${audioHtml}
        </div>
      </div>`;
          }

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

          return `
    <div class="timeline-item timeline-student">
      <div class="speech-bubble-enhanced student-bubble-enhanced">
        <div class="d-flex justify-content-between align-items-center mb-1">
          <div class="small text-muted fw-semibold"><i class="bi bi-mortarboard me-1 text-teal"></i>Học viên</div>
          <div class="score-pill-group">
            <span class="score-pill-total">Total: ${(sc.total || 0).toFixed(1)}</span>
            <span class="score-pill-sub">Acc: ${(sc.accuracy || 0).toFixed(1)}</span>
            <span class="score-pill-sub">Flu: ${(sc.fluency || 0).toFixed(1)}</span>
            <span class="score-pill-sub">Pro: ${(sc.prosodic || 0).toFixed(1)}</span>
          </div>
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
              score_prosodic: r.score_prosodic, llm_feedback: r.llm_feedback, result_json: r,
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

          // Transformer feedback HTML
          let tfHtml = '';
          if (otf.summary) {
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
      <div class="d-flex justify-content-between align-items-start mb-4">
        <h6 class="fw-bold mb-0"><i class="bi bi-bar-chart-line me-2 text-primary"></i>Điểm Tổng Quát (SpeechOcean762)</h6>
        ${levelBadgeHtml}
      </div>
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
      </div>
    </div>

    ${tfHtml}

    <!-- Dialogue timeline -->
    <div class="section-card mb-4">
      <h6 class="fw-bold mb-4"><i class="bi bi-chat-left-text me-2 text-primary"></i>Chi tiết từng lượt nói</h6>
      <div class="timeline">${turns.map(renderTurnApi).join('')}</div>
    </div>
  `;
          new bootstrap.Modal(document.getElementById('assessDetailModal')).show();
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
          if (typeof initEcapaModel === 'function') {
            initEcapaModel().catch(e => console.log('Init ECAPA error:', e));
          }
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
            navigateTo('questionsets');
          });

          document.getElementById('saveQSetInfoBtn').addEventListener('click', async () => {
            if (!currentEditSetId) return;
            const title = document.getElementById('qsetTitleInput').value.trim();
            if (!title) { alert('Vui lòng nhập tiêu đề!'); return; }
            try {
              await updateQuestionSet(currentEditSetId, {
                title,
                description: document.getElementById('qsetDescInput').value.trim(),
                level: document.getElementById('qsetLevelSelect').value,
                exam_type: document.getElementById('qsetExamTypeSelect').value || 'general',
              });
              document.getElementById('qsetEditorTitle').textContent = title;
              showToast('Đã lưu thông tin bộ đề!', 'success');
            } catch (e) {
              alert('Lỗi: ' + e.message);
            }
          });

          document.getElementById('togglePublishBtn').addEventListener('click', async () => {
            if (!currentEditSetId) return;
            try {
              const newState = !currentEditSetPublished;
              await togglePublishSet(currentEditSetId, newState);
              currentEditSetPublished = newState;
              updatePublishBtnUI();
              showToast(newState ? 'Đã publish bộ đề!' : 'Đã gỡ publish!', 'success');
            } catch (e) {
              alert('Lỗi: ' + e.message);
            }
          });

          document.getElementById('deleteQSetBtn').addEventListener('click', async () => {
            if (!currentEditSetId) return;
            if (!confirm('Bạn có chắc muốn xóa bộ đề này?')) return;
            try {
              await deleteQuestionSet(currentEditSetId);
              showToast('Đã xóa bộ đề!', 'success');
              navigateTo('questionsets');
            } catch (e) {
              alert('Lỗi: ' + e.message);
            }
          });

          document.getElementById('addQuestionBtn').addEventListener('click', () => {
            document.getElementById('editQuestionId').value = '';
            document.getElementById('qPartTitleInput').value = '';
            document.getElementById('qPrepTimeInput').value = '15';
            document.getElementById('qResponseTimeInput').value = '45';
            document.getElementById('qTextInput').value = '';
            document.getElementById('qRefInput').value = '';
            document.getElementById('qHintInput').value = '';
            document.getElementById('questionModalTitle').innerHTML =
              '<i class="bi bi-chat-square-text me-2 text-primary"></i>Thêm câu hỏi';
            new bootstrap.Modal(document.getElementById('questionModal')).show();
          });

          document.getElementById('saveQuestionBtn').addEventListener('click', async () => {
            const qText = document.getElementById('qTextInput').value.trim();
            if (!qText) { alert('Vui lòng nhập câu hỏi!'); return; }
            const editId = document.getElementById('editQuestionId').value;
            const partTitle = document.getElementById('qPartTitleInput').value.trim() || null;
            const prepTime = parseInt(document.getElementById('qPrepTimeInput').value) || 15;
            const responseTime = parseInt(document.getElementById('qResponseTimeInput').value) || 45;

            try {
              if (editId) {
                await updateQuestion(editId, {
                  question_text: qText,
                  reference_text: document.getElementById('qRefInput').value.trim() || null,
                  hint: document.getElementById('qHintInput').value.trim() || null,
                  part_title: partTitle,
                  prep_time: prepTime,
                  response_time: responseTime,
                });
              } else {
                const existingQs = await fetchQuestions(currentEditSetId);
                await addQuestion(currentEditSetId, {
                  question_text: qText,
                  reference_text: document.getElementById('qRefInput').value.trim() || null,
                  hint: document.getElementById('qHintInput').value.trim() || null,
                  order_num: existingQs.length + 1,
                  part_title: partTitle,
                  prep_time: prepTime,
                  response_time: responseTime,
                });
              }
              bootstrap.Modal.getInstance(document.getElementById('questionModal')).hide();
              showToast(editId ? 'Đã cập nhật câu hỏi!' : 'Đã thêm câu hỏi!', 'success');
              renderQuestionEditor();
            } catch (e) {
              alert('Lỗi: ' + e.message);
            }
          });

          // Filters
          document.getElementById('qsetFilterLevel').addEventListener('change', renderQuestionSets);
          document.getElementById('qsetFilterStatus').addEventListener('change', renderQuestionSets);
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
            let sets = await fetchQuestionSets(currentUser.id);
            const filterLevel = document.getElementById('qsetFilterLevel').value;
            const filterStatus = document.getElementById('qsetFilterStatus').value;
            if (filterLevel) sets = sets.filter(s => s.level === filterLevel);
            if (filterStatus === 'published') sets = sets.filter(s => s.is_published);
            if (filterStatus === 'draft') sets = sets.filter(s => !s.is_published);

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
              return `
                <div class="col-md-6 col-lg-4">
                  <div class="qset-card" onclick="openQuestionSetEditor('${s.id}')">
                    <div class="d-flex justify-content-between align-items-start mb-2">
                      <span class="exam-type-badge ${examType}">${examTypeLabels[examType] || examType.toUpperCase()}</span>
                      <span class="status-pill ${s.is_published ? 'published' : 'draft'}">${s.is_published ? '● Đã publish' : '○ Bản nháp'}</span>
                    </div>
                    <div class="qset-title">${s.title}</div>
                    ${s.description ? `<div class="qset-desc">${s.description}</div>` : ''}
                    <div class="qset-meta mt-2">
                      <span class="level-badge ${s.level}">${levelLabels[s.level] || s.level}</span>
                      <span class="badge bg-secondary"><i class="bi bi-chat-square-text me-1"></i>${s.question_count} câu</span>
                    </div>
                    <div class="text-muted smaller mt-2 mb-2">${new Date(s.created_at).toLocaleDateString('vi-VN')}</div>
                    <div class="pt-2 border-top border-secondary border-opacity-25">
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
            // Load set info
            const { data: setData, error } = await supabase
              .from('question_sets')
              .select('*')
              .eq('id', setId)
              .single();
            if (error) throw error;

            document.getElementById('qsetTitleInput').value = setData.title;
            document.getElementById('qsetDescInput').value = setData.description || '';
            document.getElementById('qsetLevelSelect').value = setData.level;
            document.getElementById('qsetExamTypeSelect').value = setData.exam_type || 'general';
            document.getElementById('qsetEditorTitle').textContent = setData.title;
            document.getElementById('qsetEditorSubtitle').textContent =
              `Tạo ngày ${new Date(setData.created_at).toLocaleDateString('vi-VN')}`;
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
            document.getElementById('questionCount').textContent = questions.length;

            if (!questions.length) {
              list.innerHTML = `
                <div class="empty-state py-4">
                  <i class="bi bi-chat-square-text" style="font-size:2rem;"></i>
                  <div class="empty-title">Chưa có câu hỏi</div>
                  <p class="small">Nhấn nút bên dưới để thêm câu hỏi đầu tiên</p>
                </div>`;
              return;
            }

            list.innerHTML = questions.map((q, idx) => `
              <div class="question-editor-item" data-id="${q.id}">
                <div class="d-flex align-items-start gap-3">
                  <div class="q-number">${idx + 1}</div>
                  <div class="flex-grow-1">
                    ${q.part_title ? `<div class="text-primary small fw-semibold mb-1"><i class="bi bi-bookmark me-1"></i>${q.part_title}</div>` : ''}
                    <div class="fw-semibold mb-1">${q.question_text}</div>
                    ${q.reference_text ? `<div class="text-muted small"><i class="bi bi-chat-quote me-1"></i>Mẫu: ${q.reference_text}</div>` : ''}
                    ${q.hint ? `<div class="text-muted small fst-italic"><i class="bi bi-lightbulb me-1"></i>${q.hint}</div>` : ''}
                    <div class="d-flex gap-2 mt-2">
                      <span class="badge bg-secondary-subtle text-secondary small"><i class="bi bi-hourglass-split me-1"></i>Chuẩn bị: ${q.prep_time || 15}s</span>
                      <span class="badge bg-secondary-subtle text-secondary small"><i class="bi bi-mic me-1"></i>Trả lời: ${q.response_time || 45}s</span>
                    </div>
                  </div>
                  <div class="d-flex gap-1 flex-shrink-0">
                    <button class="btn btn-sm btn-outline-primary" onclick="editQuestionItem('${q.id}', ${JSON.stringify(q.question_text).replace(/'/g, "&#39;")}, ${JSON.stringify(q.reference_text || '').replace(/'/g, "&#39;")}, ${JSON.stringify(q.hint || '').replace(/'/g, "&#39;")}, ${JSON.stringify(q.part_title || '').replace(/'/g, "&#39;")}, ${q.prep_time || 15}, ${q.response_time || 45})">
                      <i class="bi bi-pencil"></i>
                    </button>
                    <button class="btn btn-sm btn-outline-danger" onclick="deleteQuestionItem('${q.id}')">
                      <i class="bi bi-trash"></i>
                    </button>
                  </div>
                </div>
              </div>
            `).join('');
          } catch (e) {
            list.innerHTML = `<div class="text-danger">Lỗi: ${e.message}</div>`;
          }
        }

        window.editQuestionItem = function (id, text, ref, hint, partTitle = '', prepTime = 15, responseTime = 45) {
          document.getElementById('editQuestionId').value = id;
          document.getElementById('qPartTitleInput').value = partTitle || '';
          document.getElementById('qPrepTimeInput').value = prepTime || 15;
          document.getElementById('qResponseTimeInput').value = responseTime || 45;
          document.getElementById('qTextInput').value = text;
          document.getElementById('qRefInput').value = ref;
          document.getElementById('qHintInput').value = hint;
          document.getElementById('questionModalTitle').innerHTML =
            '<i class="bi bi-pencil me-2 text-primary"></i>Sửa câu hỏi';
          new bootstrap.Modal(document.getElementById('questionModal')).show();
        };

        window.deleteQuestionItem = async function (id) {
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
                <div class="col-md-6 col-lg-4">
                  <div class="qset-card" onclick="openModeSelectModal('${s.id}')">
                    <div class="d-flex justify-content-between align-items-center mb-2">
                      <span class="exam-type-badge ${examType}">${examTypeLabels[examType] || examType.toUpperCase()}</span>
                      <span class="level-badge ${s.level}">${levelLabels[s.level] || s.level}</span>
                    </div>
                    <div class="qset-title">${s.title}</div>
                    ${s.description ? `<div class="qset-desc">${s.description}</div>` : ''}
                    <div class="qset-meta mt-3">
                      <span class="badge bg-secondary"><i class="bi bi-chat-square-text me-1"></i>${s.question_count} câu</span>
                      <span class="badge bg-outline-secondary"><i class="bi bi-person me-1"></i>${s.teacher_name}</span>
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
          if (currentSessionMode === 'exam') {
            // EXAM MODE: No hints, no reference text!
            area.innerHTML = `
              <div class="practice-question-card">
                ${q.part_title ? `<div class="text-primary small fw-semibold mb-1"><i class="bi bi-bookmark me-1"></i>${q.part_title}</div>` : ''}
                <div class="question-number">Câu hỏi ${num} / ${total}</div>
                <div class="question-text">${q.question_text}</div>
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
                ${q.part_title ? `<div class="text-primary small fw-semibold mb-1"><i class="bi bi-bookmark me-1"></i>${q.part_title}</div>` : ''}
                <div class="question-number">Câu hỏi ${num} / ${total}</div>
                <div class="question-text">${q.question_text}</div>
              </div>`;

            document.getElementById('examPrepArea').classList.add('d-none');
            document.getElementById('examSpeakArea').classList.add('d-none');

            // Show existing answer if already recorded
            const existing = practiceAnswers[q.id];
            const resultArea = document.getElementById('practiceAnswerResult');
            if (existing && existing.scores) {
              renderAnswerResult(existing);
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
                result = await assessSingleAnswer(apiUrl, audioBlob, sEmb || []);
                const studentData = result.student || {};
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

              // Lưu kết quả tạm thời trong bộ nhớ trình duyệt, audioUrl sẽ có khi nộp bài
              practiceAnswers[q.id] = { blob: audioBlob, result, scores, transcript, audioUrl: null };
            } catch (e) {
              console.error(`Lỗi chấm câu ${q.id}:`, e);
              practiceAnswers[q.id] = { blob: audioBlob, scores: { total: 5, accuracy: 5, fluency: 5, prosodic: 5 }, transcript: '', audioUrl: null };
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

            document.getElementById('practiceScoringStep').textContent = 'Đang phân tích phát âm...';
            const result = await assessSingleAnswer(apiUrl, audioBlob, sEmb || []);

            let scores = { total: 0, accuracy: 0, fluency: 0, prosodic: 0 };
            let transcript = '';
            const studentData = result.student || {};
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

            await saveAnswer(practiceSession.id, q.id, {
              audio_url: audioUrl,
              transcript,
              score_total: scores.total,
              score_accuracy: scores.accuracy,
              score_fluency: scores.fluency,
              score_prosodic: scores.prosodic,
              result_json: result,
            });

            practiceAnswers[q.id] = { blob: audioBlob, result, scores, transcript, audioUrl };

            scoringOverlay.classList.add('d-none');
            document.getElementById('practiceRecordingArea').classList.remove('d-none');
            statusEl.textContent = 'Nhấn để ghi âm lại';
            renderAnswerResult(practiceAnswers[q.id]);
            document.getElementById('practiceAnswerResult').classList.remove('d-none');

          } catch (e) {
            scoringOverlay.classList.add('d-none');
            document.getElementById('practiceRecordingArea').classList.remove('d-none');
            statusEl.textContent = 'Lỗi chấm điểm. Nhấn để thử lại.';
            alert('Lỗi chấm điểm: ' + e.message);
          }
        }

        function renderAnswerResult(answer) {
          const s = answer.scores;
          const resultArea = document.getElementById('practiceAnswerResult');
          const scoreClass = (v) => v >= 8 ? 'excellent' : v >= 6 ? 'good' : v >= 4 ? 'average' : 'poor';

          resultArea.innerHTML = `
            <div class="answer-result-card">
              <div class="result-scores">
                <div class="result-score-item">
                  <div class="score-label">Total</div>
                  <div class="score-val ${scoreClass(s.total)}">${s.total.toFixed(1)}</div>
                </div>
                <div class="result-score-item">
                  <div class="score-label">Accuracy</div>
                  <div class="score-val ${scoreClass(s.accuracy)}">${s.accuracy.toFixed(1)}</div>
                </div>
                <div class="result-score-item">
                  <div class="score-label">Fluency</div>
                  <div class="score-val ${scoreClass(s.fluency)}">${s.fluency.toFixed(1)}</div>
                </div>
                <div class="result-score-item">
                  <div class="score-label">Prosody</div>
                  <div class="score-val ${scoreClass(s.prosodic)}">${s.prosodic.toFixed(1)}</div>
                </div>
              </div>
              ${answer.transcript ? `<div class="text-muted small"><i class="bi bi-chat-dots me-1"></i>"${answer.transcript}"</div>` : ''}
              ${answer.audioUrl ? `<audio controls class="w-100 mt-2" src="${answer.audioUrl}"></audio>` : ''}
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
              if (answer && answer.scores) {
                return `
                  <div class="practice-history-card" style="cursor:default;">
                    <div class="history-score ${scoreClass(answer.scores.total)}">${answer.scores.total.toFixed(1)}</div>
                    <div class="flex-grow-1">
                      <div class="fw-semibold small">Câu ${idx + 1}: ${q.question_text}</div>
                      ${answer.transcript ? `<div class="text-muted smaller">"${answer.transcript}"</div>` : ''}
                      <div class="d-flex gap-2 mt-1">
                        <span class="badge bg-secondary">Acc: ${answer.scores.accuracy.toFixed(1)}</span>
                        <span class="badge bg-secondary">Flu: ${answer.scores.fluency.toFixed(1)}</span>
                        <span class="badge bg-secondary">Pro: ${answer.scores.prosodic.toFixed(1)}</span>
                      </div>
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
                    <div class="d-flex gap-2 mt-1">
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
                <div class="summary-label">Điểm trung bình / 10</div>
                <div class="d-flex justify-content-center gap-3 mt-2">
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
              ${(detail.answers || []).map((a, idx) => `
                <div class="answer-result-card mb-2">
                  <div class="fw-semibold small mb-2">
                    <span class="text-primary">Câu ${a.question?.order_num || (idx + 1)}:</span>
                    ${a.question?.question_text || ''}
                  </div>
                  <div class="result-scores">
                    <div class="result-score-item">
                      <div class="score-label">Total</div>
                      <div class="score-val ${valClass(a.score_total || 0)}">${(a.score_total || 0).toFixed(1)}</div>
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
              `).join('')}
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