'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Copy,
  Edit3,
  Eye,
  EyeOff,
  FileCheck2,
  ImagePlus,
  Loader2,
  Lock,
  Plus,
  Search,
  Trash2,
  Unlock,
} from 'lucide-react';
import { getSupabaseClient } from '@/lib/supabase';
import {
  TASK_TYPES,
  addQuestion,
  cloneQuestionSet,
  compressImageFile,
  createQuestionSet,
  deleteQuestion,
  deleteQuestionSet,
  fetchQuestionSetsPage,
  fetchQuestions,
  fetchSetSubmissionsPage,
  getAvailableTaskTypes,
  togglePublishSet,
  updateQuestion,
  updateQuestionSet,
} from '@/lib/questionSets';
import { formatScoreValue, getExamTypeName, getLevelLabel, scoreBadgeBgClass } from '@/lib/utils';
import { Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/AnalyticsCharts';
import { Pagination } from '@/components/ui/Pagination';
import { useToast } from '@/components/ToastProvider';
import { TaskQuestionCard, TaskTypeBadge } from '@/components/TaskQuestionCard';
import { PracticeDetailModal } from '@/components/PracticeDetailModal';
import type {
  ExamType,
  PracticeSession,
  Profile,
  Question,
  QuestionLevel,
  QuestionSet,
  TaskType,
} from '@/lib/types';

interface TeacherQuestionSetsViewProps {
  currentUser: Profile;
  onChanged?: () => void;
}

const SETS_PAGE_SIZE = 9;
const SUBMISSIONS_PAGE_SIZE = 8;

export function TeacherQuestionSetsView({ currentUser, onChanged }: TeacherQuestionSetsViewProps) {
  const { showToast } = useToast();

  const [sets, setSets] = useState<QuestionSet[]>([]);
  const [setsTotal, setSetsTotal] = useState(0);
  const [setPage, setSetPage] = useState(1);
  const [loading, setLoading] = useState(true);

  const [ownerScope, setOwnerScope] = useState<'mine' | 'others'>('mine');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [levelFilter, setLevelFilter] = useState('');
  const [publishFilter, setPublishFilter] = useState<'' | 'published' | 'draft'>('');

  // Create Set Modal
  const [createOpen, setCreateOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newExamType, setNewExamType] = useState<ExamType>('general');
  const [newLevel, setNewLevel] = useState<QuestionLevel>('intermediate');
  const [creating, setCreating] = useState(false);

  // Delete Set Confirm Modal
  const [deletingSet, setDeletingSet] = useState<QuestionSet | null>(null);
  const [deletingSetBusy, setDeletingSetBusy] = useState(false);

  // Submissions Modal per set (paginated)
  const [subModalSet, setSubModalSet] = useState<QuestionSet | null>(null);
  const [submissions, setSubmissions] = useState<PracticeSession[]>([]);
  const [subsTotal, setSubsTotal] = useState(0);
  const [subPage, setSubPage] = useState(1);
  const [subsLoading, setSubsLoading] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);

  // Active Question Set Editor
  const [editingSet, setEditingSet] = useState<QuestionSet | null>(null);
  const [editorTitle, setEditorTitle] = useState('');
  const [editorDesc, setEditorDesc] = useState('');
  const [editorExamType, setEditorExamType] = useState<ExamType>('general');
  const [editorLevel, setEditorLevel] = useState<QuestionLevel>('intermediate');
  const [savingSetMeta, setSavingSetMeta] = useState(false);

  const [questions, setQuestions] = useState<Question[]>([]);
  const [loadingQuestions, setLoadingQuestions] = useState(false);

  // Add/Edit/Delete Question Modal
  const [qModalOpen, setQModalOpen] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState<Question | null>(null);
  const [qTaskType, setQTaskType] = useState<TaskType>('short_qa');
  const [qPartTitle, setQPartTitle] = useState('');
  const [qOrderNum, setQOrderNum] = useState(1);
  const [qPrepTime, setQPrepTime] = useState(15);
  const [qResponseTime, setQResponseTime] = useState(30);
  const [qText, setQText] = useState('');
  const [qRefText, setQRefText] = useState('');
  const [qImageUrl, setQImageUrl] = useState('');
  const [qAdvancedOpen, setQAdvancedOpen] = useState(false);
  const [savingQuestion, setSavingQuestion] = useState(false);
  const [deletingQuestion, setDeletingQuestion] = useState<Question | null>(null);
  const [deletingQuestionBusy, setDeletingQuestionBusy] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  const loadSets = useCallback(
    async (targetPage = setPage) => {
      setLoading(true);
      try {
        const res = await fetchQuestionSetsPage({
          currentUserId: currentUser.id,
          scope: ownerScope,
          page: targetPage,
          pageSize: SETS_PAGE_SIZE,
          search: debouncedSearch,
          level: levelFilter,
          publishFilter: ownerScope === 'mine' ? publishFilter : '',
        });
        if (res.items.length === 0 && targetPage > 1 && res.total > 0) {
          setSetPage(Math.max(1, targetPage - 1));
          return;
        }
        setSets(res.items);
        setSetsTotal(res.total);
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Lỗi tải danh sách bộ đề', 'danger');
      } finally {
        setLoading(false);
      }
    },
    [currentUser.id, debouncedSearch, levelFilter, ownerScope, publishFilter, setPage, showToast],
  );

  useEffect(() => {
    loadSets(setPage);
  }, [loadSets, setPage]);

  const loadSubmissionsPage = useCallback(
    async (setId: string, pageNum: number) => {
      setSubsLoading(true);
      try {
        const res = await fetchSetSubmissionsPage(setId, {
          page: pageNum,
          pageSize: SUBMISSIONS_PAGE_SIZE,
        });
        setSubmissions(res.items);
        setSubsTotal(res.total);
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Lỗi tải danh sách bài nộp', 'danger');
      } finally {
        setSubsLoading(false);
      }
    },
    [showToast],
  );

  useEffect(() => {
    if (subModalSet) {
      loadSubmissionsPage(subModalSet.id, subPage);
    }
  }, [subModalSet, subPage, loadSubmissionsPage]);

  const loadEditorQuestions = useCallback(
    async (setId: string) => {
      setLoadingQuestions(true);
      try {
        const list = await fetchQuestions(setId);
        setQuestions(list);
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Lỗi tải câu hỏi', 'danger');
      } finally {
        setLoadingQuestions(false);
      }
    },
    [showToast],
  );

  const handleOpenEditor = async (qs: QuestionSet) => {
    setEditingSet(qs);
    setEditorTitle(qs.title);
    setEditorDesc(qs.description || '');
    setEditorExamType(qs.exam_type || 'general');
    setEditorLevel(qs.level || 'intermediate');
    await loadEditorQuestions(qs.id);
  };

  const handleCreateSet = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    setCreating(true);
    try {
      const created = await createQuestionSet(currentUser.id, {
        title: newTitle.trim(),
        description: newDesc.trim(),
        exam_type: newExamType,
        level: newLevel,
      });
      showToast(`Đã tạo bộ đề "${created.title}"!`, 'success');
      setCreateOpen(false);
      setNewTitle('');
      setNewDesc('');
      setOwnerScope('mine');
      setSetPage(1);
      await loadSets(1);
      onChanged?.();
      await handleOpenEditor({ ...created, creator_name: currentUser.full_name, question_count: 0 });
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : typeof err === 'object' && err !== null && 'message' in err
            ? String((err as { message?: unknown }).message || 'Lỗi tạo bộ đề')
            : 'Lỗi tạo bộ đề';
      showToast(msg, 'danger');
    } finally {
      setCreating(false);
    }
  };

  const handleCloneSet = async (qs: QuestionSet) => {
    try {
      const newId = await cloneQuestionSet(qs.id);
      showToast(`Đã tạo bản sao bộ đề "${qs.title}" về kho của bạn!`, 'success');
      setOwnerScope('mine');
      setSetPage(1);
      onChanged?.();

      const client = getSupabaseClient();
      const { data: clonedRow } = await client
        .from('question_sets')
        .select('id, teacher_id, title, description, level, exam_type, time_limit, is_published, created_at')
        .eq('id', newId)
        .maybeSingle();

      if (clonedRow) {
        await handleOpenEditor({
          ...(clonedRow as QuestionSet),
          creator_name: currentUser.full_name,
          question_count: qs.question_count || 0,
        });
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Lỗi tạo bản sao bộ đề', 'danger');
    }
  };

  const handleTogglePublish = async (qs: QuestionSet) => {
    try {
      await togglePublishSet(qs.id, !qs.is_published);
      setSets((prev) =>
        prev.map((item) => (item.id === qs.id ? { ...item, is_published: !qs.is_published } : item)),
      );
      if (editingSet && editingSet.id === qs.id) {
        setEditingSet({ ...editingSet, is_published: !qs.is_published });
      }
      showToast(
        !qs.is_published ? 'Đã mở bộ đề cho học viên!' : 'Đã chuyển bộ đề về bản nháp.',
        'success',
      );
      onChanged?.();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Lỗi đổi trạng thái bộ đề', 'danger');
    }
  };

  const handleConfirmDeleteSet = async () => {
    if (!deletingSet) return;
    setDeletingSetBusy(true);
    try {
      await deleteQuestionSet(deletingSet.id);
      showToast(`Đã xóa bộ đề "${deletingSet.title}".`, 'info');
      if (editingSet?.id === deletingSet.id) setEditingSet(null);
      setDeletingSet(null);
      await loadSets(setPage);
      onChanged?.();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Lỗi xóa bộ đề', 'danger');
    } finally {
      setDeletingSetBusy(false);
    }
  };

  const handleOpenSubmissions = (qs: QuestionSet) => {
    setSubmissions([]);
    setSubsTotal(0);
    setSubPage(1);
    setSubModalSet(qs);
  };

  const handleSaveSetMeta = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSet) return;
    setSavingSetMeta(true);
    try {
      await updateQuestionSet(editingSet.id, {
        title: editorTitle.trim(),
        description: editorDesc.trim(),
        exam_type: editorExamType,
        level: editorLevel,
      });
      const updated = {
        ...editingSet,
        title: editorTitle.trim(),
        description: editorDesc.trim(),
        exam_type: editorExamType,
        level: editorLevel,
      };
      setEditingSet(updated);
      setSets((prev) => prev.map((s) => (s.id === updated.id ? { ...s, ...updated } : s)));
      showToast('Đã lưu thông tin bộ đề!', 'success');
      onChanged?.();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Lỗi lưu thông tin bộ đề', 'danger');
    } finally {
      setSavingSetMeta(false);
    }
  };

  const openAddQuestion = () => {
    const allowed = getAvailableTaskTypes(editorExamType);
    const defaultType = (allowed[0]?.id || 'short_qa') as TaskType;
    const meta = TASK_TYPES[defaultType];
    setEditingQuestion(null);
    setQTaskType(defaultType);
    setQPartTitle('');
    setQOrderNum(questions.length + 1);
    setQPrepTime(meta.defaultPrep);
    setQResponseTime(meta.defaultResponse);
    setQText('');
    setQRefText('');
    setQImageUrl('');
    setQAdvancedOpen(false);
    setQModalOpen(true);
  };

  const openEditQuestion = (q: Question) => {
    setEditingQuestion(q);
    setQTaskType(q.task_type || 'short_qa');
    setQPartTitle(q.part_title || '');
    setQOrderNum(q.order_num || 1);
    setQPrepTime(q.prep_time ?? 15);
    setQResponseTime(q.response_time ?? 45);
    setQText(q.question_text || '');
    setQRefText(q.reference_text || '');
    setQImageUrl(q.image_url || '');
    setQAdvancedOpen(false);
    setQModalOpen(true);
  };

  const handleTaskTypeChange = (nextType: TaskType) => {
    setQTaskType(nextType);
    if (!editingQuestion) {
      const meta = TASK_TYPES[nextType];
      if (meta) {
        setQPrepTime(meta.defaultPrep);
        setQResponseTime(meta.defaultResponse);
      }
    }
  };

  const handleImageSelect = async (file?: File | null) => {
    if (!file) return;
    try {
      const compressed = await compressImageFile(file);
      setQImageUrl(compressed);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Lỗi xử lý ảnh', 'danger');
    }
  };

  const handleSaveQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSet || !qText.trim()) return;
    setSavingQuestion(true);
    try {
      if (editingQuestion) {
        await updateQuestion(editingQuestion.id, {
          question_text: qText.trim(),
          order_num: Number(qOrderNum) || 1,
          part_title: qPartTitle.trim() || null,
          prep_time: Number(qPrepTime) || 0,
          response_time: Number(qResponseTime) || 15,
          task_type: qTaskType,
          reference_text: qRefText.trim() || null,
          image_url: qImageUrl.trim() || null,
        });
        showToast('Đã cập nhật câu hỏi!', 'success');
      } else {
        await addQuestion(editingSet.id, {
          question_text: qText.trim(),
          order_num: Number(qOrderNum) || questions.length + 1,
          part_title: qPartTitle.trim() || null,
          prep_time: Number(qPrepTime) || 0,
          response_time: Number(qResponseTime) || 15,
          task_type: qTaskType,
          reference_text: qRefText.trim() || null,
          image_url: qImageUrl.trim() || null,
        });
        showToast('Đã thêm câu hỏi mới!', 'success');
      }
      setQModalOpen(false);
      await loadEditorQuestions(editingSet.id);
      await loadSets(setPage);
      onChanged?.();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Lỗi lưu câu hỏi', 'danger');
    } finally {
      setSavingQuestion(false);
    }
  };

  const handleConfirmDeleteQuestion = async () => {
    if (!editingSet || !deletingQuestion) return;
    setDeletingQuestionBusy(true);
    try {
      await deleteQuestion(deletingQuestion.id);
      showToast('Đã xóa câu hỏi.', 'info');
      setDeletingQuestion(null);
      await loadEditorQuestions(editingSet.id);
      await loadSets(setPage);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Lỗi xóa câu hỏi', 'danger');
    } finally {
      setDeletingQuestionBusy(false);
    }
  };

  // VIEW B: QUESTION SET EDITOR
  if (editingSet) {
    const isOwner = editingSet.teacher_id === currentUser.id;
    const availableTypes = getAvailableTaskTypes(editorExamType);

    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => {
              setEditingSet(null);
              loadSets(setPage);
            }}
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition"
          >
            <ArrowLeft className="h-4 w-4" />
            Quay lại Danh sách Bộ đề
          </button>

          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                isOwner
                  ? 'border border-blue-200 bg-blue-50 text-blue-700'
                  : 'border border-slate-200 bg-slate-100 text-slate-600'
              }`}
            >
              {isOwner ? 'Bộ đề của tôi' : 'Bộ đề tham khảo (Chỉ xem)'}
            </span>

            {isOwner ? (
              <button
                type="button"
                onClick={() => handleTogglePublish(editingSet)}
                className={`inline-flex items-center gap-1.5 rounded-2xl px-4 py-2 text-xs font-semibold transition ${
                  editingSet.is_published
                    ? 'border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                    : 'bg-emerald-600 text-white hover:bg-emerald-700'
                }`}
              >
                {editingSet.is_published ? <Eye className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
                {editingSet.is_published ? 'Đang mở (Nhấn để ẩn)' : 'Mở bộ đề cho Học viên'}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => handleCloneSet(editingSet)}
                className="inline-flex items-center gap-1.5 rounded-2xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-blue-500"
              >
                <Copy className="h-3.5 w-3.5" />
                Tạo bản sao về kho của tôi
              </button>
            )}
          </div>
        </div>

        {/* Metadata form */}
        <form onSubmit={handleSaveSetMeta} className="section-card space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-semibold text-slate-600">Tên bộ đề</label>
              <input
                type="text"
                required
                disabled={!isOwner}
                value={editorTitle}
                onChange={(e) => setEditorTitle(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50/80 px-3.5 py-2.5 text-sm text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-none disabled:opacity-65"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">Định dạng bài thi</label>
              <select
                value={editorExamType}
                disabled={!isOwner}
                onChange={(e) => setEditorExamType(e.target.value as ExamType)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2.5 text-sm text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-none disabled:opacity-65"
              >
                <option value="general">Luyện tập chung</option>
                <option value="ielts">IELTS Speaking</option>
                <option value="vstep">VSTEP Speaking</option>
                <option value="toeic">TOEIC Speaking</option>
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">Trình độ</label>
              <select
                value={editorLevel}
                disabled={!isOwner}
                onChange={(e) => setEditorLevel(e.target.value as QuestionLevel)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2.5 text-sm text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-none disabled:opacity-65"
              >
                <option value="beginner">Cơ bản</option>
                <option value="intermediate">Trung cấp</option>
                <option value="advanced">Nâng cao</option>
              </select>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">Mô tả ngắn</label>
            <textarea
              rows={2}
              disabled={!isOwner}
              value={editorDesc}
              onChange={(e) => setEditorDesc(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50/80 px-3.5 py-2.5 text-sm text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-none disabled:opacity-65"
            />
          </div>

          {isOwner && (
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={savingSetMeta}
                className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-blue-500 disabled:opacity-50"
              >
                {savingSetMeta && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Lưu thông tin bộ đề
              </button>
            </div>
          )}
        </form>

        {/* Questions List */}
        <div className="section-card space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
            <h3 className="text-base font-bold text-slate-900">
              Danh sách Câu hỏi ({questions.length})
            </h3>
            {isOwner && (
              <button
                type="button"
                onClick={openAddQuestion}
                className="inline-flex items-center gap-1.5 rounded-xl bg-sky-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-sky-500"
              >
                <Plus className="h-4 w-4" />
                Thêm câu hỏi mới
              </button>
            )}
          </div>

          {loadingQuestions ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
            </div>
          ) : questions.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-500">
              Bộ đề này chưa có câu hỏi nào.{isOwner ? ' Nhấn "Thêm câu hỏi mới" để bắt đầu biên soạn.' : ''}
            </div>
          ) : (
            <div className="space-y-4">
              {questions.map((q) => (
                <div
                  key={q.id}
                  className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4 space-y-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-xl border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-700">
                        Câu {q.order_num}
                      </span>
                      {q.part_title && (
                        <span className="rounded-xl border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600">
                          {q.part_title}
                        </span>
                      )}
                      <TaskTypeBadge taskType={q.task_type} />
                      <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                        <Clock className="h-3.5 w-3.5" />
                        Chuẩn bị: {q.prep_time}s · Trả lời: {q.response_time}s
                      </span>
                    </div>

                    {isOwner && (
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => openEditQuestion(q)}
                          className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          <Edit3 className="h-3.5 w-3.5" />
                          Sửa
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeletingQuestion(q)}
                          className="rounded-xl border border-rose-200 bg-rose-50 p-1.5 text-rose-600 hover:bg-rose-100"
                          title="Xóa câu hỏi"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                  </div>

                  <TaskQuestionCard question={q} />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Add / Edit Question Modal */}
        <Modal
          open={qModalOpen}
          onClose={() => setQModalOpen(false)}
          maxWidthClass="max-w-2xl"
          title={editingQuestion ? `Sửa Câu ${editingQuestion.order_num}` : 'Thêm Câu hỏi Speaking'}
        >
          <form onSubmit={handleSaveQuestion} className="space-y-4">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">Dạng bài</label>
              <select
                value={qTaskType}
                onChange={(e) => handleTaskTypeChange(e.target.value as TaskType)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-none"
              >
                {availableTypes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">
                {qTaskType === 'read_aloud'
                  ? 'Đoạn văn cần đọc to *'
                  : 'Nội dung câu hỏi / Đề bài *'}
              </label>
              <textarea
                rows={3}
                required
                value={qText}
                onChange={(e) => setQText(e.target.value)}
                placeholder="Nhập đề bài Speaking..."
                className="w-full rounded-xl border border-slate-200 bg-slate-50/80 px-3.5 py-2.5 text-sm text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-none"
              />
            </div>

            {/* Collapsible Advanced Options (Part Title, Order, Prep/Response Time) */}
            <div className="rounded-xl border border-slate-200 bg-slate-50">
              <button
                type="button"
                onClick={() => setQAdvancedOpen((v) => !v)}
                className="flex w-full items-center justify-between gap-2 px-3.5 py-2.5 text-left text-xs font-semibold text-slate-700 hover:text-slate-900 transition-colors duration-150"
              >
                <span>
                  Tùy chọn nâng cao{' '}
                  <span className="font-normal text-slate-500 tabular-nums">
                    (Câu {qOrderNum} · Chuẩn bị {qPrepTime}s · Trả lời {qResponseTime}s
                    {qPartTitle.trim() ? ` · ${qPartTitle.trim()}` : ''})
                  </span>
                </span>
                {qAdvancedOpen ? (
                  <ChevronUp className="size-4 shrink-0 text-slate-500" />
                ) : (
                  <ChevronDown className="size-4 shrink-0 text-slate-500" />
                )}
              </button>

              {qAdvancedOpen && (
                <div className="space-y-3 border-t border-slate-200 px-3.5 py-3">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">
                      Phần thi (không bắt buộc, VD: Part 1, Task 2)
                    </label>
                    <input
                      type="text"
                      value={qPartTitle}
                      onChange={(e) => setQPartTitle(e.target.value)}
                      placeholder="VD: Phần 1 / Part 1"
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                    />
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-600">Thứ tự</label>
                      <input
                        type="number"
                        min={1}
                        value={qOrderNum}
                        onChange={(e) => setQOrderNum(Number(e.target.value))}
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 tabular-nums focus:border-blue-600 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-600">
                        Chuẩn bị (giây)
                      </label>
                      <input
                        type="number"
                        min={0}
                        value={qPrepTime}
                        onChange={(e) => setQPrepTime(Number(e.target.value))}
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 tabular-nums focus:border-blue-600 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-600">
                        Trả lời (giây)
                      </label>
                      <input
                        type="number"
                        min={5}
                        value={qResponseTime}
                        onChange={(e) => setQResponseTime(Number(e.target.value))}
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 tabular-nums focus:border-blue-600 focus:outline-none"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {['information_qa', 'long_turn', 'problem_solution'].includes(qTaskType) && (
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">
                  {qTaskType === 'long_turn'
                    ? 'Các ý gợi ý cần nói (mỗi ý 1 dòng)'
                    : qTaskType === 'problem_solution'
                      ? 'Các giải pháp / lựa chọn (mỗi ý 1 dòng)'
                      : 'Thông tin / Lịch trình cho sẵn'}
                </label>
                <textarea
                  rows={4}
                  value={qRefText}
                  onChange={(e) => setQRefText(e.target.value)}
                  placeholder="Mỗi gợi ý trên một dòng..."
                  className="w-full rounded-xl border border-slate-200 bg-slate-50/80 px-3.5 py-2.5 text-sm text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-none"
                />
              </div>
            )}

            {qTaskType === 'picture_description' && (
              <div className="space-y-2 rounded-2xl border border-slate-200 bg-slate-50/80 p-3.5">
                <label className="block text-xs font-semibold text-slate-700">
                  Hình ảnh minh họa đề thi
                </label>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-blue-200 bg-blue-50 px-3.5 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-100">
                    <ImagePlus className="h-4 w-4" />
                    Chọn ảnh tải lên
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => handleImageSelect(e.target.files?.[0])}
                    />
                  </label>
                  {qImageUrl && (
                    <button
                      type="button"
                      onClick={() => setQImageUrl('')}
                      className="text-xs font-semibold text-rose-600 underline"
                    >
                      Xóa ảnh
                    </button>
                  )}
                </div>
                {qImageUrl && (
                  <img
                    src={qImageUrl}
                    alt="Ảnh xem trước"
                    className="mt-2 max-h-48 rounded-xl border border-slate-200 object-contain bg-white"
                  />
                )}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setQModalOpen(false)}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Hủy
              </button>
              <button
                type="submit"
                disabled={savingQuestion}
                className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-blue-500 disabled:opacity-50"
              >
                {savingQuestion && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {editingQuestion ? 'Cập nhật câu hỏi' : 'Thêm vào bộ đề'}
              </button>
            </div>
          </form>
        </Modal>

        {/* Delete Question Confirm Modal */}
        <Modal
          open={Boolean(deletingQuestion)}
          onClose={() => setDeletingQuestion(null)}
          maxWidthClass="max-w-md"
          title="Xác nhận xóa câu hỏi"
        >
          <div className="space-y-4 text-sm text-slate-600">
            <p>
              Bạn chắc chắn muốn xóa <strong className="text-slate-900">Câu {deletingQuestion?.order_num}</strong>?
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeletingQuestion(null)}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700"
              >
                Hủy
              </button>
              <button
                type="button"
                disabled={deletingQuestionBusy}
                onClick={handleConfirmDeleteQuestion}
                className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-500 disabled:opacity-50"
              >
                {deletingQuestionBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Xóa câu hỏi
              </button>
            </div>
          </div>
        </Modal>
      </div>
    );
  }

  // VIEW A: QUESTION SETS CATALOG
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="KHO BỘ ĐỀ SPEAKING"
        title="Quản lý Bộ đề Speaking"
        subtitle="Tạo bộ đề mới, biên soạn câu hỏi theo chuẩn thi và tạo bản sao các bộ đề tham khảo về kho của bạn."
        pill={<span>{setsTotal} bộ đề</span>}
        action={
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="inline-flex rounded-2xl border border-slate-200 bg-slate-100/90 p-1">
              <button
                type="button"
                onClick={() => {
                  setOwnerScope('mine');
                  setSetPage(1);
                }}
                className={`rounded-xl px-3.5 py-2 text-xs font-semibold transition ${
                  ownerScope === 'mine'
                    ? 'bg-white text-blue-700 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Bộ đề của tôi
              </button>
              <button
                type="button"
                onClick={() => {
                  setOwnerScope('others');
                  setPublishFilter('');
                  setSetPage(1);
                }}
                className={`rounded-xl px-3.5 py-2 text-xs font-semibold transition ${
                  ownerScope === 'others'
                    ? 'bg-white text-blue-700 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Tham khảo (Chỉ xem)
              </button>
            </div>

            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 transition-colors duration-150"
            >
              <Plus className="size-4" />
              Tạo bộ đề mới
            </button>
          </div>
        }
      />

      {/* Filters (removed "Tất cả bộ đề" dropdown) */}
      <div
        className={`section-card grid gap-3 sm:grid-cols-2 ${
          ownerScope === 'mine' ? 'lg:grid-cols-3' : 'lg:grid-cols-2'
        }`}
      >
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setSetPage(1);
            }}
            placeholder={
              ownerScope === 'mine' ? 'Tìm tên hoặc mô tả bộ đề...' : 'Tìm tên bộ đề, tác giả...'
            }
            className="w-full rounded-xl border border-slate-200 bg-slate-50/80 py-2.5 pl-9 pr-3 text-sm text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none"
          />
        </div>

        <select
          value={levelFilter}
          onChange={(e) => {
            setLevelFilter(e.target.value);
            setSetPage(1);
          }}
          className="rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2.5 text-sm text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-none"
        >
          <option value="">Mọi trình độ</option>
          <option value="beginner">Cơ bản</option>
          <option value="intermediate">Trung cấp</option>
          <option value="advanced">Nâng cao</option>
        </select>

        {ownerScope === 'mine' && (
          <select
            value={publishFilter}
            onChange={(e) => {
              setPublishFilter(e.target.value as '' | 'published' | 'draft');
              setSetPage(1);
            }}
            className="rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2.5 text-sm text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-none"
          >
            <option value="">Tất cả trạng thái</option>
            <option value="published">Đang mở</option>
            <option value="draft">Bản nháp</option>
          </select>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-14">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
        </div>
      ) : sets.length === 0 ? (
        <div className="section-card py-12 text-center text-sm text-slate-500">
          {ownerScope === 'mine'
            ? 'Bạn chưa có bộ đề nào khớp tiêu chí lọc.'
            : 'Chưa có bộ đề tham khảo nào khớp tiêu chí lọc.'}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {sets.map((qs) => {
              const isOwner = qs.teacher_id === currentUser.id;
              return (
                <div
                  key={qs.id}
                  className="section-card card-interactive flex flex-col justify-between gap-4"
                >
                  <div className="space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                          isOwner
                            ? 'border border-blue-200 bg-blue-50 text-blue-700'
                            : 'border border-slate-200 bg-slate-100 text-slate-600'
                        }`}
                      >
                        {isOwner ? 'Của tôi' : 'Tham khảo (Chỉ xem)'}
                      </span>

                      {qs.is_published ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700">
                          <Eye className="h-3 w-3" /> Đang mở
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-[11px] font-semibold text-slate-500">
                          <EyeOff className="h-3 w-3" /> Nháp
                        </span>
                      )}
                    </div>

                    <h3 className="text-base font-bold text-slate-900 line-clamp-2">{qs.title}</h3>
                    {qs.description && (
                      <p className="text-xs text-slate-500 line-clamp-2">{qs.description}</p>
                    )}

                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-600 pt-1">
                      <span className="rounded-lg bg-slate-100 px-2 py-0.5 font-medium">
                        {getExamTypeName(qs.exam_type)}
                      </span>
                      <span className="rounded-lg bg-slate-100 px-2 py-0.5 font-medium">
                        {getLevelLabel(qs.level)}
                      </span>
                      <span className="rounded-lg border border-sky-200 bg-sky-50 px-2 py-0.5 text-sky-700 font-semibold">
                        {qs.question_count || 0} câu
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500">
                      Tác giả: <strong className="text-slate-800">{qs.creator_name}</strong>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
                    <button
                      type="button"
                      onClick={() => handleOpenEditor(qs)}
                      className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-blue-600 px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-blue-500 transition"
                    >
                      <Edit3 className="h-3.5 w-3.5" />
                      {isOwner ? 'Biên soạn' : 'Xem câu hỏi'}
                    </button>

                    {!isOwner && (
                      <button
                        type="button"
                        onClick={() => handleCloneSet(qs)}
                        className="inline-flex items-center gap-1 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-semibold text-sky-700 hover:bg-sky-100 transition"
                        title="Tạo bản sao bộ đề về kho của tôi"
                      >
                        <Copy className="h-3.5 w-3.5" />
                        Tạo bản sao
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => handleOpenSubmissions(qs)}
                      className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
                      title="Xem bài nộp học viên"
                    >
                      <FileCheck2 className="h-3.5 w-3.5 text-emerald-600" />
                      Bài nộp
                    </button>

                    {isOwner && (
                      <>
                        <button
                          type="button"
                          onClick={() => handleTogglePublish(qs)}
                          className="rounded-xl border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-50 transition"
                          title={qs.is_published ? 'Ẩn bộ đề' : 'Mở bộ đề cho học viên'}
                        >
                          {qs.is_published ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeletingSet(qs)}
                          className="rounded-xl border border-rose-200 bg-rose-50 p-2 text-rose-600 hover:bg-rose-100 transition"
                          title="Xóa bộ đề"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <Pagination
            page={setPage}
            pageSize={SETS_PAGE_SIZE}
            totalCount={setsTotal}
            onPageChange={setSetPage}
            disabled={loading}
            itemLabel="bộ đề"
          />
        </div>
      )}

      {/* Create Question Set Modal */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        maxWidthClass="max-w-lg"
        title="Tạo Bộ đề Speaking Mới"
      >
        <form onSubmit={handleCreateSet} className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">
              Tên bộ đề <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              required
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="VD: IELTS Speaking Part 1-3 Travel"
              className="w-full rounded-xl border border-slate-200 bg-slate-50/80 px-3.5 py-2.5 text-sm text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-none"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">Định dạng thi</label>
              <select
                value={newExamType}
                onChange={(e) => setNewExamType(e.target.value as ExamType)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-none"
              >
                <option value="general">Luyện tập chung</option>
                <option value="ielts">IELTS Speaking</option>
                <option value="vstep">VSTEP Speaking</option>
                <option value="toeic">TOEIC Speaking</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">Trình độ</label>
              <select
                value={newLevel}
                onChange={(e) => setNewLevel(e.target.value as QuestionLevel)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-none"
              >
                <option value="beginner">Cơ bản</option>
                <option value="intermediate">Trung cấp</option>
                <option value="advanced">Nâng cao</option>
              </select>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">Mô tả</label>
            <textarea
              rows={2}
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              placeholder="Mô tả mục tiêu bộ đề..."
              className="w-full rounded-xl border border-slate-200 bg-slate-50/80 px-3.5 py-2 text-sm text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-none"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setCreateOpen(false)}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={creating}
              className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-blue-500 disabled:opacity-50"
            >
              {creating && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Tạo &amp; Soạn câu hỏi
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete Question Set Confirm Modal */}
      <Modal
        open={Boolean(deletingSet)}
        onClose={() => setDeletingSet(null)}
        maxWidthClass="max-w-md"
        title="Xác nhận xóa bộ đề"
      >
        <div className="space-y-4 text-sm text-slate-600">
          <p>
            Xóa bộ đề <strong className="text-slate-900">{deletingSet?.title}</strong>? Toàn bộ câu hỏi bên trong sẽ bị xóa và không thể khôi phục.
          </p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setDeletingSet(null)}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700"
            >
              Hủy
            </button>
            <button
              type="button"
              disabled={deletingSetBusy}
              onClick={handleConfirmDeleteSet}
              className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-500 disabled:opacity-50"
            >
              {deletingSetBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Xác nhận xóa
            </button>
          </div>
        </div>
      </Modal>

      {/* Set Submissions Modal (Paginated) */}
      <Modal
        open={Boolean(subModalSet)}
        onClose={() => setSubModalSet(null)}
        maxWidthClass="max-w-3xl"
        title={`Bài nộp Học viên · ${subModalSet?.title || ''}`}
      >
        {subsLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
          </div>
        ) : submissions.length === 0 ? (
          <div className="py-8 text-center text-sm text-slate-500">
            Chưa có học viên nào hoàn thành bộ đề này.
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-2.5">
              {submissions.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSelectedSessionId(s.id)}
                  className="flex w-full items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50/75 p-3.5 text-left hover:border-blue-300 hover:bg-white transition"
                >
                  <div>
                    <div className="text-sm font-bold text-slate-900">
                      {s.student?.full_name || 'Học viên'}
                    </div>
                    <div className="mt-0.5 text-xs text-slate-500">
                      {s.mode === 'exam' ? 'Thi thử' : 'Luyện tập'} ·{' '}
                      {new Date(s.completed_at || s.started_at).toLocaleString('vi-VN')}
                    </div>
                  </div>
                  <div className="flex items-center gap-2.5">
                    {s.status === 'reviewed' && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2.5 py-0.5 text-[11px] font-semibold text-sky-700">
                        <CheckCircle2 className="h-3 w-3" /> Đã duyệt
                      </span>
                    )}
                    <span
                      className={`rounded-xl border px-3 py-1 text-sm font-extrabold tabular-nums ${scoreBadgeBgClass(s.score_total)}`}
                    >
                      {formatScoreValue(s.score_total)}
                    </span>
                  </div>
                </button>
              ))}
            </div>

            <Pagination
              compact
              page={subPage}
              pageSize={SUBMISSIONS_PAGE_SIZE}
              totalCount={subsTotal}
              onPageChange={setSubPage}
              disabled={subsLoading}
              itemLabel="bài nộp"
            />
          </div>
        )}
      </Modal>

      <PracticeDetailModal
        sessionId={selectedSessionId}
        canReview
        onClose={() => setSelectedSessionId(null)}
        onReviewed={(updated) => {
          setSubmissions((prev) =>
            prev.map((item) => (item.id === updated.id ? { ...item, ...updated } : item)),
          );
        }}
      />
    </div>
  );
}
