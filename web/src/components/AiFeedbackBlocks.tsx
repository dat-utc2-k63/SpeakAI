'use client';

import React from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Award,
  CheckCircle2,
  Cpu,
  GraduationCap,
  Lightbulb,
  MessageSquareQuote,
  Presentation,
  Volume2,
  Waves,
} from 'lucide-react';
import { formatScoreValue, getIeltsBandLabel } from '@/lib/utils';
import type { AiEvalResult, DialogueTurn, WordDetailItem } from '@/lib/types';

function SafeSummaryLines({ text }: { text: string }) {
  const lines = String(text || '').split('\n');
  return (
    <div className="space-y-1.5 text-sm leading-relaxed text-slate-700">
      {lines.map((raw, idx) => {
        const trimmed = raw.trim();
        if (!trimmed) return null;
        if (trimmed.startsWith('## ')) {
          return (
            <h6 key={idx} className="pt-1 font-bold text-slate-900">
              {trimmed.slice(3)}
            </h6>
          );
        }
        return <p key={idx}>{trimmed.replace(/\*\*/g, '')}</p>;
      })}
    </div>
  );
}

interface ComprehensiveAiFeedbackProps {
  aiEval?: AiEvalResult | null;
  otf?: { summary?: string; tips?: string[] } | null;
  scores: {
    total?: number | null;
    accuracy?: number | null;
    context?: number | null;
    lexical?: number | null;
    grammar?: number | null;
  };
}

export function ComprehensiveAiFeedback({ aiEval, otf, scores }: ComprehensiveAiFeedbackProps) {
  const isFallback = Boolean(aiEval?.is_fallback);
  const hasAi = Boolean(aiEval);
  const otfTips = Array.isArray(otf?.tips) ? otf.tips : [];
  const otfSummary = otf?.summary || '';

  const totalNum = Number(aiEval?.score_total ?? scores.total ?? 0);
  const prScore = formatScoreValue(aiEval?.score_pronunciation ?? scores.accuracy ?? scores.total ?? 0);
  const fcScore = formatScoreValue(
    aiEval?.score_fluency_coherence ?? aiEval?.score_context ?? scores.context ?? null,
  );
  const lrScore = formatScoreValue(aiEval?.score_lexical ?? scores.lexical ?? null);
  const graScore = formatScoreValue(aiEval?.score_grammar ?? scores.grammar ?? null);

  const bandInfo = getIeltsBandLabel(totalNum);
  const grammarErrors = aiEval?.grammar_errors || [];
  const expressions = aiEval?.better_dialogue_expressions || [];
  const commTips = aiEval?.communication_tips || [];

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-slate-50/75 p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/80 pb-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <Award className="h-5 w-5 text-amber-500" />
            <span className="font-bold text-slate-900">Nhận Xét Cuộc Hội Thoại</span>
            <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${bandInfo.badgeClass}`}>
              {bandInfo.band} · {bandInfo.level}
            </span>
          </div>
          {hasAi && !isFallback ? (
            <span className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700">
              <CheckCircle2 className="size-3.5" />
              Nhận xét chi tiết
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-0.5 text-xs font-medium text-slate-600">
              <Cpu className="size-3.5" />
              Đánh giá tự động
            </span>
          )}
        </div>
        <SafeSummaryLines
          text={
            aiEval?.conversation_summary ||
            otfSummary ||
            'Đã hoàn thành phân tích toàn diện cuộc hội thoại.'
          }
        />
      </div>

      <div>
        <div className="mb-2 text-xs font-semibold uppercase text-slate-500">
          Chi tiết 4 tiêu chí IELTS Speaking (Band 1.0 – 9.0)
        </div>
        <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
          <div className="rounded-lg border border-slate-200 bg-white p-3 text-center">
            <div className="text-xl font-bold text-emerald-700 tabular-nums">{prScore}</div>
            <div className="mt-1 text-xs font-semibold text-slate-900">Pronunciation (P)</div>
            <div className="text-[11px] text-slate-500">Phát âm &amp; Ngữ điệu</div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-3 text-center">
            <div className="text-xl font-bold text-blue-600 tabular-nums">{fcScore}</div>
            <div className="mt-1 text-xs font-semibold text-slate-900">Fluency &amp; Coherence (FC)</div>
            <div className="text-[11px] text-slate-500">Độ trôi chảy &amp; Mạch lạc</div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-3 text-center">
            <div className="text-xl font-bold text-amber-700 tabular-nums">{lrScore}</div>
            <div className="mt-1 text-xs font-semibold text-slate-900">Lexical Resource (LR)</div>
            <div className="text-[11px] text-slate-500">Từ vựng &amp; Diễn đạt</div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-3 text-center">
            <div className="text-xl font-bold text-slate-800 tabular-nums">{graScore}</div>
            <div className="mt-1 text-xs font-semibold text-slate-900">Grammatical Range (GRA)</div>
            <div className="text-[11px] text-slate-500">Ngữ pháp &amp; Cấu trúc</div>
          </div>
        </div>
      </div>

      {grammarErrors.length > 0 ? (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-bold text-amber-700">
            <AlertTriangle className="h-4 w-4" />
            <span>Các điểm ngữ pháp &amp; cấu trúc cần sửa ({grammarErrors.length}):</span>
          </div>
          <div className="space-y-2">
            {grammarErrors.map((ge, idx) => (
              <div
                key={idx}
                className="rounded-2xl border border-slate-200 bg-white p-3.5 text-xs space-y-1.5 shadow-sm"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-md border border-rose-200 bg-rose-50 px-2 py-0.5 font-semibold text-rose-700">
                    {ge.turn_index ? `Lượt ${ge.turn_index}` : `Lỗi ${idx + 1}`}
                  </span>
                  <span className="font-mono text-rose-600 line-through">
                    &ldquo;{ge.error_text}&rdquo;
                  </span>
                  <ArrowRight className="h-3.5 w-3.5 text-slate-400" />
                  <span className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700">
                    Sửa chuẩn
                  </span>
                  <span className="font-mono font-bold text-emerald-700">
                    &ldquo;{ge.fix}&rdquo;
                  </span>
                </div>
                {ge.explanation && (
                  <div className="border-l-2 border-amber-400 pl-2.5 text-slate-600">
                    {ge.explanation}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : hasAi ? (
        <div className="flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs text-emerald-800">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
          <span>
            <strong>Ngữ pháp đạt chuẩn:</strong> Học viên kiểm soát cấu trúc ngữ pháp tốt trong các lượt nói.
          </span>
        </div>
      ) : null}

      {otfTips.length > 0 && (
        <div className="clean-feedback-box">
          <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase text-amber-800">
            <Waves className="size-4" />
            Gợi ý cải thiện phát âm
          </div>
          <ul className="space-y-1 text-xs text-slate-700">
            {otfTips.map((tip, idx) => (
              <li key={idx} className="flex items-start gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                <span>{tip}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {expressions.length > 0 && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-3.5">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-bold text-emerald-800">
            <MessageSquareQuote className="h-4 w-4" />
            Cách diễn đạt mẫu tự nhiên hơn
          </div>
          <div className="space-y-1.5">
            {expressions.map((exp, idx) => (
              <div
                key={idx}
                className="border-l-2 border-emerald-500 pl-3 text-xs italic text-slate-700"
              >
                &ldquo;{exp}&rdquo;
              </div>
            ))}
          </div>
        </div>
      )}

      {commTips.length > 0 && (
        <div className="rounded-2xl border border-sky-200 bg-sky-50/65 p-3.5">
          <div className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-sky-800">
            <Lightbulb className="h-4 w-4" />
            Lời khuyên giao tiếp &amp; phản xạ tự nhiên
          </div>
          <ul className="list-disc space-y-1 pl-5 text-xs text-slate-700">
            {commTips.map((tip, idx) => (
              <li key={idx}>{tip}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function DialogueTimeline({ turns }: { turns: DialogueTurn[] }) {
  if (!turns || turns.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 p-6 text-center text-sm text-slate-500">
        Không có dữ liệu chi tiết từng lượt hội thoại.
      </div>
    );
  }

  return (
    <div className="timeline space-y-4">
      {turns.map((turn, idx) => {
        const isTeacher = turn.role === 'teacher';
        const sc = turn.scores;
        const hasScores = Boolean(
          turn.scored && sc && (sc.total !== undefined || sc.score_total !== undefined || sc.overall !== undefined),
        );
        const totalVal = sc?.overall ?? sc?.score_total ?? sc?.total ?? 0;
        const pVal = sc?.p ?? sc?.score_pronunciation ?? sc?.accuracy;
        const fcVal = sc?.fc ?? sc?.score_fluency_coherence ?? sc?.context;
        const lrVal = sc?.lr ?? sc?.score_lexical ?? sc?.lexical;
        const graVal = sc?.gra ?? sc?.score_grammar ?? sc?.grammar;
        const badPhonemes = (turn.errors?.phonemes || []).filter(
          (p) => p.is_suspicious || (p.error_probability !== undefined && p.error_probability >= 0.5),
        );

        const wordsWithFeedback = new Map<string, 'warning' | 'bad'>();
        const feedbackItems: Array<{
          contrast: string;
          word?: string;
          ruleName?: string;
          tipText?: string;
        }> = [];
        const seen = new Set<string>();

        for (const p of badPhonemes) {
          const targetIpa = p.target_ipa || (p.phoneme ? `/${p.phoneme}/` : '');
          const actualIpa = p.actual_ipa || '';
          const contrast =
            actualIpa && actualIpa !== targetIpa ? `${targetIpa} → ${actualIpa}` : targetIpa;
          const ruleName = p.rule_name_vi ? p.rule_name_vi.split('(')[0].trim() : '';
          const tipText = p.articulatory_tip || p.tip || '';
          const dedupKey = `${contrast}_${p.word || ''}`;
          if (seen.has(dedupKey)) continue;
          seen.add(dedupKey);

          if (p.word) {
            const wKey = p.word.toLowerCase().replace(/[^a-z0-9]/g, '');
            const sev: 'warning' | 'bad' =
              p.severity === 'critical' || p.severity === 'bad' ? 'bad' : 'warning';
            if (!wordsWithFeedback.has(wKey) || sev === 'bad') {
              wordsWithFeedback.set(wKey, sev);
            }
          }

          feedbackItems.push({ contrast, word: p.word, ruleName, tipText });
        }

        const words: WordDetailItem[] =
          turn.words_detail && turn.words_detail.length > 0
            ? turn.words_detail
            : (turn.transcript || '')
                .split(/\s+/)
                .filter(Boolean)
                .map((w) => ({ word: w, status: 'good' }));

        return (
          <div key={idx} className="flex items-start gap-2.5 sm:gap-3">
            {isTeacher && (
              <div className="hidden sm:flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 border-blue-200 bg-blue-50 text-blue-600">
                <Presentation className="h-4 w-4" />
              </div>
            )}

            <div
              className={`speech-bubble-enhanced flex-1 min-w-0 ${
                isTeacher ? 'teacher-bubble-enhanced' : 'student-bubble-enhanced'
              }`}
            >
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
                  {isTeacher ? (
                    <>
                      <Presentation className="h-3.5 w-3.5 text-blue-600" />
                      <span>Giáo viên</span>
                    </>
                  ) : (
                    <>
                      <GraduationCap className="h-3.5 w-3.5 text-sky-600" />
                      <span>Học viên</span>
                    </>
                  )}
                </div>

                {hasScores && sc ? (
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px] tabular-nums">
                    <span
                      className="rounded-md bg-slate-900 px-2.5 py-0.5 font-semibold text-white"
                      title="Điểm IELTS tổng của câu (Overall)"
                    >
                      Tổng: {Number(totalVal).toFixed(1)}
                    </span>
                    <span
                      className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700"
                      title="Phát âm (Pronunciation - P)"
                    >
                      P: {Number(pVal ?? totalVal).toFixed(1)}
                    </span>
                    <span
                      className="rounded-md border border-blue-200 bg-blue-50 px-2 py-0.5 font-semibold text-blue-700"
                      title="Lưu loát & Mạch lạc (Fluency & Coherence - FC)"
                    >
                      FC: {Number(fcVal ?? totalVal).toFixed(1)}
                    </span>
                    {lrVal != null && (
                      <span
                        className="rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 font-semibold text-amber-700"
                        title="Vốn từ vựng (Lexical Resource - LR)"
                      >
                        LR: {Number(lrVal).toFixed(1)}
                      </span>
                    )}
                    {graVal != null && (
                      <span
                        className="rounded-md border border-slate-200 bg-slate-100 px-2 py-0.5 font-semibold text-slate-700"
                        title="Ngữ pháp & Cấu trúc (Grammar - GRA)"
                      >
                        GRA: {Number(graVal).toFixed(1)}
                      </span>
                    )}
                  </div>
                ) : (
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-[11px] font-medium text-slate-500">
                    {turn.eligibility_reason === 'short_backchannel'
                      ? 'Từ đệm (Không chấm)'
                      : turn.eligibility_reason === 'too_short'
                        ? 'Lượt nói ngắn (Không chấm)'
                        : 'Không chấm điểm'}
                  </span>
                )}
              </div>

              {isTeacher && !turn.scored ? (
                <p className="py-1 text-sm text-slate-800">{turn.transcript}</p>
              ) : (
                <div className="word-token-stream">
                  {words.map((w, wIdx) => {
                    const wKey = (w.word || '').toLowerCase().replace(/[^a-z0-9]/g, '');
                    const fbStatus = wordsWithFeedback.get(wKey);
                    const status = fbStatus || 'good';
                    const titleText = `${w.word}${w.word_ipa ? ` · ${w.word_ipa}` : ''}${
                      fbStatus ? ' (Có âm vị cần lưu ý)' : ' (Phát âm đạt chuẩn)'
                    }`;
                    return (
                      <div key={wIdx} className={`word-token ${status}`} title={titleText}>
                        <span className="word-text">{w.word}</span>
                        {w.word_ipa && <span className="word-ipa">{w.word_ipa}</span>}
                      </div>
                    );
                  })}
                </div>
              )}

              {feedbackItems.length > 0 && (
                <div className="clean-feedback-box mt-2.5">
                  <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase text-amber-800">
                    <Waves className="size-3.5" />
                    Gợi ý sửa phát âm
                  </div>
                  <div className="space-y-1 text-xs text-slate-700">
                    {feedbackItems.map((fi, fIdx) => (
                      <div key={fIdx} className="flex flex-wrap items-center gap-1.5">
                        <AlertCircle className="h-3.5 w-3.5 shrink-0 text-amber-600" />
                        <span className="font-bold text-slate-900">{fi.contrast}</span>
                        {fi.word && (
                          <span>
                            trong <strong>&ldquo;{fi.word}&rdquo;</strong>
                          </span>
                        )}
                        {fi.ruleName && <span className="rule-tag">{fi.ruleName}</span>}
                        {fi.tipText && <span className="italic text-slate-600">— {fi.tipText}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {turn.audio && (
                <div className="mt-2.5 flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5">
                  <Volume2 className="h-4 w-4 shrink-0 text-sky-600" />
                  <audio controls src={turn.audio} className="h-8 w-full" />
                </div>
              )}
            </div>

            {!isTeacher && (
              <div className="hidden sm:flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 border-sky-200 bg-sky-50 text-sky-600">
                <GraduationCap className="h-4 w-4" />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
