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
              navigateTo(el.dataset.page);
              closeSidebar();
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
          const sectionId = page === 'profile' ? 'page-profile' : `page-${role}-${page}`;
          const section = document.getElementById(sectionId);
          if (section) section.classList.remove('d-none');
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
      <div class="section-card h-100">
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
        <div class="text-muted smaller mt-2">Tham gia: ${new Date(s.created_at).toLocaleDateString('vi-VN')}</div>
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
            errs.phonemes.filter(p => p.is_suspicious || (p.error_probability !== undefined && p.error_probability >= 0.5) || (p.score !== undefined && p.score < 6.5))
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

          // Build Word Tokens Stream with IPA
          let words = turn.words_detail;
          if (!words || words.length === 0) {
            words = (turn.transcript || '').split(' ').map(w => ({ word: w, status: 'good' }));
          }

          const wordTokensHtml = words.map(w => {
            const ipaDisplay = w.word_ipa ? `<span class="word-ipa">${w.word_ipa}</span>` : '';
            const statusNote = (w.status === 'bad' || w.status === 'warning') ? ' (Có âm vị cần lưu ý)' : ' (Phát âm đạt chuẩn)';
            const titleAttr = `${w.word}${w.word_ipa ? ' · ' + w.word_ipa : ''}${statusNote}`;
            return `<div class="word-token ${w.status || 'good'}" title="${titleAttr}">
              <span class="word-text">${w.word}</span>
              ${ipaDisplay}
            </div>`;
          }).join('');

          // Build Clean Correction Box (Single unified, compact block)
          let feedbackBoxHtml = '';
          if (badPhonemes.length > 0) {
            const seen = new Set();
            const itemsHtml = badPhonemes.map(p => {
              const targetIpa = p.target_ipa || (p.phoneme ? ('/' + p.phoneme + '/') : '');
              const actualIpa = p.actual_ipa || '';
              const contrastStr = (actualIpa && actualIpa !== targetIpa) ? `${targetIpa} → ${actualIpa}` : targetIpa;
              const inWord = p.word ? ` trong "<strong>${p.word}</strong>"` : '';
              const ruleName = p.rule_name_vi ? p.rule_name_vi.split('(')[0].trim() : '';
              const tipText = p.articulatory_tip || p.tip || '';

              const key = `${contrastStr}_${p.word}`;
              if (seen.has(key)) return '';
              seen.add(key);

              return `
                <div class="feedback-issue-item">
                  <i class="bi bi-exclamation-circle text-warning me-1"></i>
                  <span class="fw-bold text-light">${contrastStr}</span>${inWord}
                  ${ruleName ? `<span class="rule-tag">${ruleName}</span>` : ''}
                  ${tipText ? `<span class="tip-text">— ${tipText}</span>` : ''}
                </div>`;
            }).filter(Boolean).join('');

            if (itemsHtml.trim()) {
              feedbackBoxHtml = `
                <div class="clean-feedback-box mt-2">
                  <div class="clean-feedback-title">
                    <i class="bi bi-soundwave me-1"></i>Lưu ý phát âm (L2-MDD & ASHA):
                  </div>
                  <div class="clean-feedback-list">
                    ${itemsHtml}
                  </div>
                </div>`;
            }
          }

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