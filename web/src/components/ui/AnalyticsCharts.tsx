'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play, Volume2 } from 'lucide-react';
import { formatTimestamp } from '@/lib/utils';
import type { ClassroomSegment } from '@/lib/types';

/* ── PAGE HEADER ────────────────────────────────────────── */
export function PageHeader({
  eyebrow,
  title,
  subtitle,
  pill,
  action,
}: {
  eyebrow: string;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  pill?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <div className="text-xs font-semibold uppercase text-blue-600">
          {eyebrow}
        </div>
        <h2 className="mt-1 text-2xl font-bold text-slate-900 sm:text-[26px] sm:leading-tight text-balance">
          {title}
        </h2>
        {subtitle && (
          <p className="mt-1 text-sm leading-relaxed text-slate-500 text-pretty">{subtitle}</p>
        )}
      </div>

      {(pill || action) && (
        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          {pill && (
            <div className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm">
              {pill}
            </div>
          )}
          {action}
        </div>
      )}
    </div>
  );
}

/* ── SCORE RING GAUGE (CIRCULAR DONUT) ──────────────────── */
export function ScoreRingGauge({
  score,
  max = 9,
  size = 160,
  strokeWidth = 14,
  label,
  sublabel,
  showPercent = false,
}: {
  score: number | null | undefined;
  max?: number;
  size?: number;
  strokeWidth?: number;
  label?: string;
  sublabel?: string;
  showPercent?: boolean;
}) {
  const numeric = score != null && !Number.isNaN(Number(score)) ? Number(score) : null;
  const pct = numeric != null ? Math.max(0, Math.min(100, (numeric / max) * 100)) : 0;

  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (pct / 100) * circumference;

  let strokeColor = '#94A3B8';
  let textColor = 'text-slate-400';
  if (numeric != null) {
    if (pct >= 78) {
      strokeColor = '#059669';
      textColor = 'text-emerald-700';
    } else if (pct >= 58) {
      strokeColor = '#2563EB';
      textColor = 'text-blue-600';
    } else if (pct >= 40) {
      strokeColor = '#D97706';
      textColor = 'text-amber-600';
    } else {
      strokeColor = '#E11D48';
      textColor = 'text-rose-600';
    }
  }

  return (
    <div className="flex flex-col items-center justify-center">
      <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="transparent"
            stroke="#E2E8F0"
            strokeWidth={strokeWidth}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="transparent"
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <span
            className={`font-bold tabular-nums ${textColor}`}
            style={{ fontSize: size >= 150 ? '2.15rem' : size >= 110 ? '1.6rem' : '1.15rem' }}
          >
            {numeric == null ? '--' : showPercent ? `${numeric.toFixed(0)}%` : numeric.toFixed(1)}
          </span>
          {label && <span className="mt-0.5 text-[11px] font-medium text-slate-500">{label}</span>}
        </div>
      </div>
      {sublabel && <div className="mt-2 text-xs text-slate-500 text-pretty text-center">{sublabel}</div>}
    </div>
  );
}

/* ── SOLID REC BUTTON ───────────────────────────────────── */
export function VoiceRecSphere({
  recording,
  processing = false,
  disabled = false,
  hasRecorded = false,
  size = 'lg',
  onClick,
}: {
  recording: boolean;
  processing?: boolean;
  disabled?: boolean;
  hasRecorded?: boolean;
  size?: 'md' | 'lg';
  onClick: () => void;
}) {
  const dims = size === 'lg' ? 'size-24 sm:size-28' : 'size-20';
  const textSz = size === 'lg' ? 'text-base sm:text-lg' : 'text-sm';

  return (
    <div className="relative inline-flex items-center justify-center">
      <button
        type="button"
        disabled={disabled || processing}
        onClick={onClick}
        aria-label={recording ? 'Dừng ghi âm' : hasRecorded ? 'Ghi âm lại' : 'Bắt đầu ghi âm'}
        className={`relative flex flex-col items-center justify-center rounded-full ${dims} text-white transition-colors duration-150 select-none shadow-sm ${
          recording
            ? 'bg-rose-600 hover:bg-rose-700 ring-4 ring-rose-100'
            : 'bg-slate-900 hover:bg-slate-800 ring-4 ring-slate-200/80'
        } disabled:cursor-not-allowed disabled:opacity-50`}
      >
        {processing ? (
          <span className="size-6 animate-spin rounded-full border-2 border-white/30 border-t-white" />
        ) : recording ? (
          <>
            <span className="size-5 rounded-sm bg-white" />
            <span className="mt-1.5 text-[11px] font-semibold uppercase text-white/95">
              Dừng
            </span>
          </>
        ) : (
          <>
            <span className={`font-bold ${textSz}`}>Ghi âm</span>
            <span className="mt-0.5 text-[10px] font-medium text-white/80">
              {hasRecorded ? 'Ghi lại' : 'Nhấn nói'}
            </span>
          </>
        )}
      </button>
    </div>
  );
}

/* ── LIVE AUDIO EQUALIZER VISUALIZER ────────────────────── */
export function LiveAudioVisualizer({
  stream,
  active,
  mode = 'idle',
  barCount = 13,
  height = 72,
}: {
  stream?: MediaStream | null;
  active: boolean;
  mode?: 'idle' | 'recording' | 'processing' | 'ready';
  barCount?: number;
  height?: number;
}) {
  const defaultPattern = useMemo(() => {
    const mid = (barCount - 1) / 2;
    return Array.from({ length: barCount }, (_, i) => {
      const dist = Math.abs(i - mid) / (mid || 1);
      return Math.max(0.22, 0.72 - dist * 0.48);
    });
  }, [barCount]);

  const [levels, setLevels] = useState<number[]>(defaultPattern);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!active || !stream) {
      setLevels(defaultPattern);
      return;
    }

    let audioCtx: AudioContext | null = null;
    try {
      const AudioContextCtor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextCtor) return;

      audioCtx = new AudioContextCtor();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64;
      analyser.smoothingTimeConstant = 0.75;
      source.connect(analyser);

      const data = new Uint8Array(analyser.frequencyBinCount);
      const mid = (barCount - 1) / 2;

      const update = () => {
        analyser.getByteFrequencyData(data);
        setLevels(
          Array.from({ length: barCount }, (_, i) => {
            const dist = Math.abs(i - mid);
            const binIdx = Math.min(data.length - 1, Math.round(dist * 1.4));
            const norm = data[binIdx] / 255;
            const centerBoost = 1 - (dist / (mid || 1)) * 0.35;
            return Math.min(1, Math.max(0.16, norm * centerBoost * 1.25 + 0.16));
          }),
        );
        rafRef.current = window.requestAnimationFrame(update);
      };
      rafRef.current = window.requestAnimationFrame(update);
    } catch {
      // Fallback safely if AudioContext fails
    }

    return () => {
      if (rafRef.current != null) window.cancelAnimationFrame(rafRef.current);
      if (audioCtx) {
        audioCtx.close().catch(() => {});
      }
    };
  }, [active, barCount, defaultPattern, stream]);

  const barColor =
    active || mode === 'recording'
      ? '#E11D48'
      : mode === 'processing' || mode === 'ready'
        ? '#2563EB'
        : '#CBD5E1';

  return (
    <div
      className="flex items-center justify-center gap-1.5"
      style={{ height }}
      aria-hidden="true"
    >
      {levels.map((val, idx) => (
        <span
          key={idx}
          className="w-1.5 rounded-full origin-center"
          style={{
            height: `${height}px`,
            backgroundColor: barColor,
            transform: `scaleY(${Math.max(0.14, val)})`,
            opacity: mode === 'idle' && !active ? 0.65 : 0.92,
          }}
        />
      ))}
    </div>
  );
}

/* ── SCORE TREND LINE / AREA CHART ──────────────────────── */
export interface ScoreTrendPoint {
  id: string;
  label: string;
  dateLabel: string;
  score: number;
  kind?: string;
}

export function ScoreTrendChart({
  data,
  height = 210,
}: {
  data: ScoreTrendPoint[];
  height?: number;
}) {
  const [activeIdx, setActiveIdx] = useState<number | null>(data.length > 0 ? data.length - 1 : null);

  useEffect(() => {
    setActiveIdx(data.length > 0 ? data.length - 1 : null);
  }, [data.length]);

  const W = 540;
  const H = height;
  const padL = 34;
  const padR = 18;
  const padT = 18;
  const padB = 34;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const { coords, linePath, areaPath } = useMemo(() => {
    if (!data || data.length === 0) {
      return { coords: [], linePath: '', areaPath: '' };
    }
    const pts = data.map((d, i) => {
      const x =
        data.length === 1 ? padL + plotW / 2 : padL + (i / (data.length - 1)) * plotW;
      const clamped = Math.max(0, Math.min(9, d.score));
      const y = padT + plotH - (clamped / 9) * plotH;
      return { x, y, ...d };
    });

    let line = '';
    if (pts.length === 1) {
      line = `M ${pts[0].x} ${pts[0].y}`;
    } else if (pts.length >= 2) {
      line = pts.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
    }

    const area =
      pts.length >= 2
        ? `${line} L ${pts[pts.length - 1].x} ${padT + plotH} L ${pts[0].x} ${padT + plotH} Z`
        : '';

    return { coords: pts, linePath: line, areaPath: area };
  }, [data, padL, padT, plotH, plotW]);

  if (coords.length === 0) {
    return (
      <div className="flex h-[180px] items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 p-4 text-center text-xs text-slate-500 text-pretty">
        Chưa có dữ liệu điểm số để vẽ biểu đồ tiến bộ. Hãy hoàn thành bài Speaking đầu tiên!
      </div>
    );
  }

  const selected = activeIdx != null && coords[activeIdx] ? coords[activeIdx] : coords[coords.length - 1];

  return (
    <div className="space-y-3">
      <div className="relative w-full overflow-hidden">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto select-none">
          {[1, 3, 5, 7, 9].map((tick) => {
            const y = padT + plotH - (tick / 9) * plotH;
            return (
              <g key={tick}>
                <line
                  x1={padL}
                  y1={y}
                  x2={W - padR}
                  y2={y}
                  stroke="#E2E8F0"
                  strokeDasharray="4 4"
                />
                <text
                  x={padL - 8}
                  y={y + 4}
                  textAnchor="end"
                  fontSize="10"
                  fill="#64748B"
                  fontWeight={600}
                >
                  {tick}
                </text>
              </g>
            );
          })}

          {areaPath && <path d={areaPath} fill="#2563EB" fillOpacity="0.07" />}

          {coords.length >= 2 && (
            <path
              d={linePath}
              fill="none"
              stroke="#2563EB"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {coords.map((p, idx) => {
            const isActive = selected?.id === p.id;
            return (
              <g
                key={p.id}
                className="cursor-pointer"
                onMouseEnter={() => setActiveIdx(idx)}
                onClick={() => setActiveIdx(idx)}
              >
                {isActive && (
                  <line
                    x1={p.x}
                    y1={padT}
                    x2={p.x}
                    y2={padT + plotH}
                    stroke="#BFDBFE"
                    strokeDasharray="3 3"
                  />
                )}
                <circle cx={p.x} cy={p.y} r={16} fill="transparent" />
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={isActive ? 6 : 4}
                  fill={isActive ? '#2563EB' : '#FFFFFF'}
                  stroke="#2563EB"
                  strokeWidth={2.5}
                />
                {(idx === 0 || idx === coords.length - 1 || isActive || coords.length <= 6) && (
                  <text
                    x={p.x}
                    y={H - 10}
                    textAnchor="middle"
                    fontSize="10"
                    fill={isActive ? '#1D4ED8' : '#64748B'}
                    fontWeight={isActive ? 700 : 500}
                  >
                    {p.dateLabel}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      {selected && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs">
          <div className="min-w-0 truncate font-semibold text-slate-800">
            {selected.label}
            {selected.kind && (
              <span className="ml-2 rounded-md bg-white px-2 py-0.5 text-[10px] font-medium text-slate-600 border border-slate-200">
                {selected.kind}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-slate-500 tabular-nums">{selected.dateLabel}</span>
            <span className="rounded-md bg-blue-600 px-2 py-0.5 font-bold text-white tabular-nums">
              {selected.score.toFixed(1)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── 4-SKILL RADAR CHART ────────────────────────────────── */
export interface SkillMetric {
  label: string;
  value: number | null;
  color?: string;
}

export function SkillRadarChart({
  skills,
  size = 320,
  max = 9,
}: {
  skills: [SkillMetric, SkillMetric, SkillMetric, SkillMetric];
  size?: number;
  max?: number;
}) {
  const vbW = 440;
  const vbH = 300;
  const cx = vbW / 2;
  const cy = vbH / 2 + 2;
  const radius = 98;

  // Top (P), Right (FC), Bottom (LR), Left (GRA)
  const angles = [-Math.PI / 2, 0, Math.PI / 2, Math.PI];
  const defaultColors = ['#059669', '#2563EB', '#D97706', '#334155'];

  const getPoint = (angle: number, ratio: number) => ({
    x: cx + Math.cos(angle) * radius * ratio,
    y: cy + Math.sin(angle) * radius * ratio,
  });

  const rings = [0.25, 0.5, 0.75, 1];
  const values = skills.map((s) =>
    s.value != null && !Number.isNaN(s.value) ? Math.max(0, Math.min(max, s.value)) : 0,
  );
  const polygonPoints = values
    .map((v, i) => {
      const pt = getPoint(angles[i], Math.max(0.08, v / max));
      return `${pt.x},${pt.y}`;
    })
    .join(' ');

  const measuredCount = skills.filter((s) => s.value != null && !Number.isNaN(s.value)).length;
  const hasAny = skills.some((s) => s.value != null && s.value > 0);
  const maxWidthPx = Math.max(320, Math.round(size * 1.45));

  return (
    <div className="flex flex-col items-center justify-center gap-2 w-full">
      <svg
        viewBox={`0 0 ${vbW} ${vbH}`}
        className="w-full h-auto overflow-visible select-none"
        style={{ maxWidth: `${maxWidthPx}px` }}
      >
        {rings.map((r) => {
          const pts = angles
            .map((a) => {
              const p = getPoint(a, r);
              return `${p.x},${p.y}`;
            })
            .join(' ');
          return (
            <polygon
              key={r}
              points={pts}
              fill={r === 1 ? '#F8FAFC' : 'none'}
              stroke={r === 1 ? '#CBD5E1' : '#E2E8F0'}
              strokeWidth={r === 1 ? '1.25' : '1'}
              strokeDasharray={r === 1 ? undefined : '3 3'}
            />
          );
        })}

        {angles.map((a, idx) => {
          const end = getPoint(a, 1);
          return <line key={idx} x1={cx} y1={cy} x2={end.x} y2={end.y} stroke="#CBD5E1" strokeWidth="1" />;
        })}

        {/* Band scale markers along the upper-right diamond edge */}
        {[0.5, 1].map((r) => {
          const tx = cx + 0.5 * radius * r + 4;
          const ty = cy - 0.5 * radius * r - 3;
          return (
            <text
              key={`tick-${r}`}
              x={tx}
              y={ty}
              fontSize="9.5"
              fontWeight={600}
              fill="#64748B"
            >
              {(max * r).toFixed(1)}
            </text>
          );
        })}

        {hasAny && (
          <>
            {measuredCount >= 2 ? (
              <polygon
                points={polygonPoints}
                fill="#2563EB"
                fillOpacity="0.12"
                stroke="#2563EB"
                strokeWidth="2.5"
                strokeLinejoin="round"
              />
            ) : (
              values.map((v, i) => {
                if (skills[i].value == null) return null;
                const end = getPoint(angles[i], Math.max(0.08, v / max));
                return (
                  <line
                    key={`seg-${i}`}
                    x1={cx}
                    y1={cy}
                    x2={end.x}
                    y2={end.y}
                    stroke="#2563EB"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                  />
                );
              })
            )}
            {values.map((v, i) => {
              if (skills[i].value == null) return null;
              const pt = getPoint(angles[i], Math.max(0.08, v / max));
              const dotColor = skills[i].color || defaultColors[i];
              return (
                <circle
                  key={i}
                  cx={pt.x}
                  cy={pt.y}
                  r={5}
                  fill="#FFFFFF"
                  stroke={dotColor}
                  strokeWidth="2.5"
                />
              );
            })}
          </>
        )}

        {skills.map((s, i) => {
          const dotColor = s.color || defaultColors[i];
          const labelPt =
            i === 0
              ? { x: cx, y: cy - radius - 26 }
              : i === 2
                ? { x: cx, y: cy + radius + 20 }
                : i === 1
                  ? { x: cx + radius + 16, y: cy - 3 }
                  : { x: cx - radius - 16, y: cy - 3 };
          const textAnchor = i === 1 ? 'start' : i === 3 ? 'end' : 'middle';
          return (
            <g key={s.label}>
              <text
                x={labelPt.x}
                y={labelPt.y}
                textAnchor={textAnchor}
                fontSize="12.5"
                fontWeight={600}
                fill="#1E293B"
              >
                {s.label}
              </text>
              <text
                x={labelPt.x}
                y={labelPt.y + 16}
                textAnchor={textAnchor}
                fontSize="14"
                fontWeight={700}
                fill={s.value != null ? dotColor : '#94A3B8'}
              >
                {s.value != null ? s.value.toFixed(1) : '--'}
              </text>
            </g>
          );
        })}
      </svg>

      {!hasAny && (
        <div className="text-xs text-slate-500">Chưa đủ dữ liệu đánh giá 4 kỹ năng</div>
      )}
    </div>
  );
}

/* ── IELTS 4-CRITERIA BAND PROGRESS LIST ────────────────── */
export function IeltsCriteriaList({
  pr,
  fc,
  lr,
  gra,
  max = 9,
  compact = false,
}: {
  pr: number | null | undefined;
  fc: number | null | undefined;
  lr: number | null | undefined;
  gra: number | null | undefined;
  max?: number;
  compact?: boolean;
}) {
  const rows = [
    {
      code: 'P',
      title: 'Pronunciation',
      sub: 'Phát âm & Ngữ điệu',
      val: pr,
      badgeCls: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      valCls: 'text-emerald-700',
      barCls: 'bg-emerald-600',
    },
    {
      code: 'FC',
      title: 'Fluency & Coherence',
      sub: 'Trôi chảy & Mạch lạc',
      val: fc,
      badgeCls: 'bg-blue-50 text-blue-700 border-blue-200',
      valCls: 'text-blue-600',
      barCls: 'bg-blue-600',
    },
    {
      code: 'LR',
      title: 'Lexical Resource',
      sub: 'Vốn từ vựng',
      val: lr,
      badgeCls: 'bg-amber-50 text-amber-700 border-amber-200',
      valCls: 'text-amber-700',
      barCls: 'bg-amber-500',
    },
    {
      code: 'GRA',
      title: 'Grammatical Range',
      sub: 'Ngữ pháp & Cấu trúc',
      val: gra,
      badgeCls: 'bg-slate-100 text-slate-700 border-slate-200',
      valCls: 'text-slate-800',
      barCls: 'bg-slate-700',
    },
  ];

  return (
    <div className={compact ? 'space-y-2' : 'space-y-2.5'}>
      {rows.map((r) => {
        const num = r.val != null && !Number.isNaN(Number(r.val)) ? Number(r.val) : null;
        const pct = num != null ? Math.max(0, Math.min(100, (num / max) * 100)) : 0;
        return (
          <div
            key={r.code}
            className={`rounded-lg border border-slate-200 bg-slate-50 ${
              compact ? 'px-3.5 py-2.5' : 'px-4 py-3'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5 min-w-0">
                <span
                  className={`inline-flex h-6 min-w-[34px] items-center justify-center rounded-md border px-1.5 text-[10px] font-bold ${r.badgeCls}`}
                >
                  {r.code}
                </span>
                <div className="min-w-0">
                  <div className="truncate text-xs font-semibold text-slate-900">{r.title}</div>
                  <div className="truncate text-[11px] text-slate-500">{r.sub}</div>
                </div>
              </div>
              <div className="flex items-baseline gap-0.5 shrink-0">
                <span className={`text-base font-bold tabular-nums ${num != null ? r.valCls : 'text-slate-400'}`}>
                  {num != null ? num.toFixed(1) : '--'}
                </span>
                <span className="text-[10px] font-medium text-slate-400">/{max}</span>
              </div>
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
              <div
                className={`h-full rounded-full ${r.barCls}`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── DISTRIBUTION BAR CHART ─────────────────────────────── */
export interface BarChartItem {
  label: string;
  value: number;
  sublabel?: string;
  colorClass?: string;
  hex?: string;
}

export function DistributionBarChart({
  items,
  emptyText = 'Chưa có dữ liệu thống kê.',
  unit = '',
}: {
  items: BarChartItem[];
  emptyText?: string;
  unit?: string;
}) {
  const maxVal = Math.max(1, ...items.map((i) => i.value));
  const total = items.reduce((a, b) => a + b.value, 0);

  if (total === 0) {
    return (
      <div className="flex h-[150px] items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 p-4 text-center text-xs text-slate-500 text-pretty">
        {emptyText}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {items.map((item) => {
        const widthPct = Math.max(item.value > 0 ? 6 : 0, Math.round((item.value / maxVal) * 100));
        return (
          <div key={item.label} className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-slate-700">{item.label}</span>
              <span className="font-semibold text-slate-900 tabular-nums">
                {item.value}
                {unit}
                {item.sublabel ? (
                  <span className="ml-1.5 font-normal text-slate-400">({item.sublabel})</span>
                ) : null}
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className={`h-full rounded-full ${item.colorClass || 'bg-blue-600'}`}
                style={{
                  width: `${widthPct}%`,
                  ...(item.hex ? { backgroundColor: item.hex } : {}),
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── MULTI-SEGMENT DONUT CHART ──────────────────────────── */
export interface DonutSegment {
  label: string;
  value: number;
  color: string;
}

export function RatioDonutChart({
  segments,
  centerValue,
  centerLabel,
  size = 136,
  strokeWidth = 16,
}: {
  segments: DonutSegment[];
  centerValue: string;
  centerLabel?: string;
  size?: number;
  strokeWidth?: number;
}) {
  const total = segments.reduce((sum, s) => sum + Math.max(0, s.value), 0);
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  let accumulatedPct = 0;

  return (
    <div className="flex flex-wrap items-center justify-center gap-5">
      <div className="relative inline-flex items-center justify-center shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="transparent"
            stroke="#F1F5F9"
            strokeWidth={strokeWidth}
          />
          {total > 0 &&
            segments.map((seg) => {
              const frac = Math.max(0, seg.value) / total;
              const segLen = frac * circumference;
              const dashOffset = -accumulatedPct * circumference;
              accumulatedPct += frac;
              if (segLen <= 0.5) return null;
              return (
                <circle
                  key={seg.label}
                  cx={size / 2}
                  cy={size / 2}
                  r={radius}
                  fill="transparent"
                  stroke={seg.color}
                  strokeWidth={strokeWidth}
                  strokeDasharray={`${segLen} ${circumference}`}
                  strokeDashoffset={dashOffset}
                />
              );
            })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-lg font-bold text-slate-900 tabular-nums">{centerValue}</span>
          {centerLabel && (
            <span className="text-[10px] font-medium text-slate-500">{centerLabel}</span>
          )}
        </div>
      </div>

      <div className="space-y-2 min-w-[130px]">
        {segments.map((seg) => {
          const pct = total > 0 ? Math.round((seg.value / total) * 100) : 0;
          return (
            <div key={seg.label} className="flex items-center justify-between gap-3 text-xs">
              <span className="flex items-center gap-2 text-slate-600 font-medium">
                <span
                  className="size-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: seg.color }}
                />
                {seg.label}
              </span>
              <span className="font-semibold text-slate-900 tabular-nums">
                {pct}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function resolveClassroomSegLang(seg: ClassroomSegment): 'en' | 'vi' | 'unknown' {
  if (seg.language === 'unknown') return 'unknown';
  if (seg.language === 'vi') return 'vi';
  if (seg.language === 'en') return 'en';
  return Number(seg.vi_percent || 0) >= 50 ? 'vi' : 'en';
}

interface TimelineBlock {
  key: string;
  isSilence: boolean;
  start_sec: number;
  end_sec: number;
  duration_sec: number;
  language: 'en' | 'vi' | 'unknown' | 'silence';
  word_count: number;
  transcript: string;
}

/* ── CLASSROOM TIMELINE SEGMENTATION STRIP ──────────────── */
export function ClassroomTimelineStrip({
  segments,
  totalAudioSec,
  audioUrl,
}: {
  segments: ClassroomSegment[];
  totalAudioSec: number;
  audioUrl?: string | null;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const activeBoundsRef = useRef<{ key: string; start: number; end: number } | null>(null);

  const safeTotal = Math.max(
    totalAudioSec || 0,
    segments.reduce((m, s) => Math.max(m, Number(s.end_sec || 0)), 0),
    1,
  );

  // Compute all contiguous blocks including both speech and silence regions
  const allBlocks = useMemo(() => {
    if (!segments || segments.length === 0) return [];
    const sorted = [...segments].sort((a, b) => Number(a.start_sec) - Number(b.start_sec));
    const list: TimelineBlock[] = [];
    let cursor = 0;
    let silenceCount = 0;

    for (let i = 0; i < sorted.length; i++) {
      const seg = sorted[i];
      const sStart = Math.max(0, Number(seg.start_sec || 0));
      const sEnd = Math.max(sStart + 0.05, Number(seg.end_sec || sStart + Number(seg.duration_sec || 0)));

      // If gap before this speech segment is at least 0.25s, register it as a silence block
      if (sStart - cursor >= 0.25) {
        list.push({
          key: `silence-${silenceCount++}`,
          isSilence: true,
          start_sec: cursor,
          end_sec: sStart,
          duration_sec: sStart - cursor,
          language: 'silence',
          word_count: 0,
          transcript: '',
        });
      }

      const segLang = resolveClassroomSegLang(seg);
      list.push({
        key: `speech-${seg.index ?? i}`,
        isSilence: false,
        start_sec: sStart,
        end_sec: sEnd,
        duration_sec: Math.max(0.1, sEnd - sStart),
        language: segLang,
        word_count: seg.word_count ?? seg.total_words ?? 0,
        transcript: seg.transcript || '',
      });

      cursor = Math.max(cursor, sEnd);
    }

    // Trailing silence after last segment up to total audio duration
    if (safeTotal - cursor >= 0.25) {
      list.push({
        key: `silence-${silenceCount++}`,
        isSilence: true,
        start_sec: cursor,
        end_sec: safeTotal,
        duration_sec: safeTotal - cursor,
        language: 'silence',
        word_count: 0,
        transcript: '',
      });
    }

    return list;
  }, [segments, safeTotal]);

  const [selectedBlock, setSelectedBlock] = useState<TimelineBlock | null>(null);
  const [playingBlockKey, setPlayingBlockKey] = useState<string | null>(null);
  const [playheadSec, setPlayheadSec] = useState<number | null>(null);

  useEffect(() => {
    const firstSpeech = allBlocks.find((b) => !b.isSilence);
    setSelectedBlock(firstSpeech || (allBlocks.length > 0 ? allBlocks[0] : null));
    setPlayingBlockKey(null);
    setPlayheadSec(null);
    activeBoundsRef.current = null;
    if (audioRef.current) {
      audioRef.current.pause();
    }
  }, [allBlocks, audioUrl]);

  useEffect(() => {
    const audio = audioRef.current;
    return () => {
      if (audio) audio.pause();
    };
  }, []);

  const stopPlayback = () => {
    const audio = audioRef.current;
    if (audio) audio.pause();
    activeBoundsRef.current = null;
    setPlayingBlockKey(null);
    setPlayheadSec(null);
  };

  const handlePlayOrToggleBlock = (block: TimelineBlock) => {
    setSelectedBlock(block);
    const audio = audioRef.current;
    if (!audioUrl || !audio) return;

    // Clicking the currently playing block toggles pause
    if (playingBlockKey === block.key && !audio.paused) {
      stopPlayback();
      return;
    }

    const start = Math.max(0, Number(block.start_sec || 0));
    const end = Math.max(start + 0.1, Number(block.end_sec || start + Number(block.duration_sec || 0)));
    activeBoundsRef.current = { key: block.key, start, end };
    setPlayingBlockKey(block.key);
    setPlayheadSec(start);

    const startFromOffset = () => {
      try {
        audio.currentTime = start;
      } catch {
        // Ignore seek error if metadata is still loading
      }
      const p = audio.play();
      if (p && typeof p.catch === 'function') {
        p.catch(() => {
          setPlayingBlockKey(null);
        });
      }
    };

    if (audio.readyState >= 1) {
      startFromOffset();
    } else {
      const onMeta = () => {
        audio.removeEventListener('loadedmetadata', onMeta);
        startFromOffset();
      };
      audio.addEventListener('loadedmetadata', onMeta);
      audio.load();
    }
  };

  const handleTimeUpdate = () => {
    const audio = audioRef.current;
    const bounds = activeBoundsRef.current;
    if (!audio || !bounds) return;
    const now = audio.currentTime;
    setPlayheadSec(now);
    if (now >= bounds.end - 0.04) {
      audio.pause();
      activeBoundsRef.current = null;
      setPlayingBlockKey(null);
      setPlayheadSec(null);
    }
  };

  const hasUnknown = segments.some((s) => resolveClassroomSegLang(s) === 'unknown');

  if (!segments || segments.length === 0) return null;

  const isSelectedPlaying =
    selectedBlock != null && playingBlockKey === selectedBlock.key;
  const playheadPct =
    playheadSec != null ? Math.max(0, Math.min(100, (playheadSec / safeTotal) * 100)) : null;

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
      {audioUrl && (
        <audio
          ref={audioRef}
          src={audioUrl}
          preload="metadata"
          onTimeUpdate={handleTimeUpdate}
          onEnded={stopPlayback}
          className="hidden"
        />
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div>
          <div className="font-semibold text-slate-800">
            Diễn biến ngôn ngữ trong tiết học (Tiếng Anh / Tiếng Việt)
          </div>
          <div className="mt-0.5 text-[11px] text-slate-500">
            {audioUrl
              ? 'Nhấn vào từng đoạn màu hoặc vùng khoảng lặng trên thanh để nghe trực tiếp'
              : 'Nhấn vào từng đoạn màu hoặc khoảng lặng để xem mốc thời gian'}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-[11px] font-medium text-slate-600">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm bg-blue-600" /> Tiếng Anh (EN)
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm bg-amber-500" /> Tiếng Việt (VI)
          </span>
          {hasUnknown && (
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm bg-slate-400" /> Không xác định
            </span>
          )}
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm bg-slate-200 border border-slate-300" /> Khoảng lặng (nghe được)
          </span>
        </div>
      </div>

      <div className="relative h-11 w-full overflow-hidden rounded-lg border border-slate-300 bg-slate-200 shadow-inner">
        {allBlocks.map((block) => {
          const leftPct = Math.max(0, Math.min(100, (Number(block.start_sec) / safeTotal) * 100));
          const widthPct = Math.max(
            0.35,
            Math.min(100 - leftPct, (Number(block.duration_sec) / safeTotal) * 100),
          );
          const isThisPlaying = playingBlockKey === block.key;
          const isActive = selectedBlock?.key === block.key;

          let bgCls = '';
          let langLabel = '';
          if (block.isSilence) {
            bgCls = 'bg-slate-200 hover:bg-slate-300 border-r border-slate-300/40';
            langLabel = 'Khoảng lặng';
          } else if (block.language === 'unknown') {
            bgCls = 'bg-slate-400 hover:bg-slate-500';
            langLabel = 'Không xác định';
          } else if (block.language === 'vi') {
            bgCls = 'bg-amber-500 hover:bg-amber-600';
            langLabel = 'Tiếng Việt (VI)';
          } else {
            bgCls = 'bg-blue-600 hover:bg-blue-700';
            langLabel = 'Tiếng Anh (EN)';
          }

          const blockTitle = `${langLabel} (${formatTimestamp(block.start_sec)} - ${formatTimestamp(block.end_sec)})${audioUrl ? ' — Nhấn để nghe' : ''}`;

          return (
            <button
              key={block.key}
              type="button"
              onMouseEnter={() => {
                if (playingBlockKey === null) setSelectedBlock(block);
              }}
              onClick={() => handlePlayOrToggleBlock(block)}
              title={blockTitle}
              aria-label={blockTitle}
              className={`absolute top-0 bottom-0 cursor-pointer transition-opacity duration-150 ${bgCls} ${
                isThisPlaying
                  ? 'ring-2 ring-slate-900 z-20 opacity-100 shadow-md'
                  : isActive
                    ? 'ring-2 ring-slate-800/80 z-10 opacity-100'
                    : block.isSilence
                      ? 'opacity-85 hover:opacity-100'
                      : 'opacity-90 hover:opacity-100'
              }`}
              style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
            />
          );
        })}

        {playheadPct != null && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute top-0 bottom-0 z-30 w-0.5 bg-slate-900 shadow-sm"
            style={{ left: `${playheadPct}%` }}
          />
        )}
      </div>

      <div className="flex justify-between text-[10px] font-mono text-slate-500 tabular-nums">
        <span>00:00</span>
        <span>{formatTimestamp(safeTotal / 2)}</span>
        <span>{formatTimestamp(safeTotal)}</span>
      </div>

      {selectedBlock && (
        <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3.5 py-3 text-xs">
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`rounded-md px-2 py-0.5 text-[10px] font-semibold border ${
                  selectedBlock.isSilence
                    ? 'bg-slate-100 text-slate-700 border-slate-300'
                    : selectedBlock.language === 'unknown'
                      ? 'bg-slate-100 text-slate-700 border-slate-300'
                      : selectedBlock.language === 'vi'
                        ? 'bg-amber-50 text-amber-800 border-amber-200'
                        : 'bg-blue-50 text-blue-700 border-blue-200'
                }`}
              >
                {selectedBlock.isSilence
                  ? 'Khoảng lặng'
                  : selectedBlock.language === 'unknown'
                    ? 'Không xác định'
                    : selectedBlock.language === 'vi'
                      ? 'VI · Tiếng Việt'
                      : 'EN · Tiếng Anh'}
              </span>
              <span className="font-mono text-slate-500 tabular-nums">
                {formatTimestamp(selectedBlock.start_sec)} – {formatTimestamp(selectedBlock.end_sec)} (
                {Number(selectedBlock.duration_sec || 0).toFixed(1)}s)
              </span>
              {!selectedBlock.isSilence && (
                <span className="text-slate-500 font-medium tabular-nums">
                  {selectedBlock.word_count} từ
                </span>
              )}
              {isSelectedPlaying && playheadSec != null && (
                <span className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700 tabular-nums">
                  <Volume2 className="size-3" />
                  Đang phát {formatTimestamp(playheadSec)}
                </span>
              )}
            </div>
            {selectedBlock.isSilence ? (
              <p className="text-slate-500 italic text-pretty">
                (Khoảng lặng — Không có giọng nói tiếng Anh hay tiếng Việt)
              </p>
            ) : (
              <p className="text-slate-700 leading-relaxed text-pretty">&ldquo;{selectedBlock.transcript}&rdquo;</p>
            )}
          </div>

          {audioUrl && (
            <button
              type="button"
              onClick={() => handlePlayOrToggleBlock(selectedBlock)}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors duration-150 ${
                isSelectedPlaying
                  ? 'bg-blue-600 text-white hover:bg-blue-700'
                  : 'border border-slate-200 bg-slate-900 text-white hover:bg-slate-800'
              }`}
            >
              {isSelectedPlaying ? (
                <>
                  <Pause className="size-3.5" />
                  Tạm dừng
                </>
              ) : (
                <>
                  <Play className="size-3.5" />
                  {selectedBlock.isSilence ? 'Nghe đoạn im lặng' : 'Nghe đoạn này'}
                </>
              )}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
