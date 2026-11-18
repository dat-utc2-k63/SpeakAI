'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
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
  const textSz = size === 'lg' ? 'text-xl' : 'text-base';

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
            <span className={`font-bold ${textSz}`}>REC</span>
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

/* ── CLASSROOM TIMELINE SEGMENTATION STRIP ──────────────── */
export function ClassroomTimelineStrip({
  segments,
  totalAudioSec,
}: {
  segments: ClassroomSegment[];
  totalAudioSec: number;
}) {
  const [selectedSeg, setSelectedSeg] = useState<ClassroomSegment | null>(
    segments.length > 0 ? segments[0] : null,
  );

  useEffect(() => {
    setSelectedSeg(segments.length > 0 ? segments[0] : null);
  }, [segments]);

  const safeTotal = Math.max(
    totalAudioSec || 0,
    segments.reduce((m, s) => Math.max(m, Number(s.end_sec || 0)), 0),
    1,
  );

  if (!segments || segments.length === 0) return null;

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="font-semibold text-slate-800">Language Timeline toàn tiết học (EN / VI)</span>
        <div className="flex flex-wrap items-center gap-3 text-[11px] font-medium text-slate-600">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm bg-blue-600" /> Tiếng Anh (EN)
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm bg-amber-500" /> Tiếng Việt (VI)
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm bg-slate-200 border border-slate-300" /> Khoảng lặng
          </span>
        </div>
      </div>

      <div className="relative h-9 w-full overflow-hidden rounded-lg border border-slate-200 bg-slate-200">
        {segments.map((seg) => {
          const leftPct = Math.max(0, Math.min(100, (Number(seg.start_sec) / safeTotal) * 100));
          const widthPct = Math.max(
            0.6,
            Math.min(100 - leftPct, (Number(seg.duration_sec) / safeTotal) * 100),
          );
          const isVi =
            seg.language === 'vi' || (seg.language !== 'en' && Number(seg.vi_percent || 0) >= 50);
          const bgCls = isVi
            ? 'bg-amber-500 hover:bg-amber-600'
            : 'bg-blue-600 hover:bg-blue-700';
          const isActive = selectedSeg?.index === seg.index;
          const segTitle = `${isVi ? 'Tiếng Việt (VI)' : 'Tiếng Anh (EN)'} (${formatTimestamp(seg.start_sec)} - ${formatTimestamp(seg.end_sec)})`;

          return (
            <button
              key={seg.index}
              type="button"
              onMouseEnter={() => setSelectedSeg(seg)}
              onClick={() => setSelectedSeg(seg)}
              title={segTitle}
              aria-label={segTitle}
              className={`absolute top-0 bottom-0 transition-opacity duration-150 ${bgCls} ${
                isActive ? 'ring-2 ring-slate-900 z-10' : 'opacity-90'
              }`}
              style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
            />
          );
        })}
      </div>

      <div className="flex justify-between text-[10px] font-mono text-slate-500 tabular-nums">
        <span>00:00</span>
        <span>{formatTimestamp(safeTotal / 2)}</span>
        <span>{formatTimestamp(safeTotal)}</span>
      </div>

      {selectedSeg && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-xs">
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`rounded-md px-2 py-0.5 text-[10px] font-semibold border ${
                  selectedSeg.language === 'vi' ||
                  (selectedSeg.language !== 'en' && Number(selectedSeg.vi_percent || 0) >= 50)
                    ? 'bg-amber-50 text-amber-800 border-amber-200'
                    : 'bg-blue-50 text-blue-700 border-blue-200'
                }`}
              >
                {selectedSeg.language === 'vi' ||
                (selectedSeg.language !== 'en' && Number(selectedSeg.vi_percent || 0) >= 50)
                  ? 'VI · Tiếng Việt'
                  : 'EN · Tiếng Anh'}
              </span>
              <span className="font-mono text-slate-500 tabular-nums">
                {formatTimestamp(selectedSeg.start_sec)} – {formatTimestamp(selectedSeg.end_sec)} (
                {Number(selectedSeg.duration_sec || 0).toFixed(1)}s)
              </span>
              <span className="text-slate-500 font-medium tabular-nums">
                {selectedSeg.word_count ?? selectedSeg.total_words ?? 0} từ
              </span>
            </div>
            <p className="text-slate-700 leading-relaxed text-pretty">&ldquo;{selectedSeg.transcript}&rdquo;</p>
          </div>
        </div>
      )}
    </div>
  );
}
