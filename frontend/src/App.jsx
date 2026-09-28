import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import {
  LayoutGrid,
  Inbox,
  Sun,
  FileCheck2,
  Settings as SettingsIcon,
  ChevronLeft,
  ChevronDown,
  ChevronUp,
  CircleDot,
  CircleCheck,
  CircleHelp,
  Link2,
  CalendarClock,
  Tag,
  Search,
  AlertTriangle,
  Send,
  MessageSquareText,
  Bot,
  Users,
  Cpu,
  Database,
  ExternalLink,
  X,
  Menu,
  Star,
  MessageCircle,
  BarChart3,
  Banknote,
  RefreshCw,
  Plus,
  Trash2,
  Copy,
  Check,
  ScrollText,
  LogOut,
  Download,
} from "lucide-react";
import { api, periodParams, normalizeTicket, jiraHref, PERIOD_OPTIONS, isoToday, isoDaysAgo, getToken, setToken, setUnauthorizedHandler } from "./api.js";

/* ---------------------------------------------------------------------
   Дизайн-система "Paper" — тёплая бумага.
   Ink (почти чёрный тёплый) для сайдбара, тёплый белый фон контента,
   плоские карточки со скруглением 8px и волосяной границей, Manrope для
   текста, IBM Plex Mono для всех чисел, два зелёных (акцент + успех) и
   кирпичный для роста/падения и критичных состояний.
--------------------------------------------------------------------- */

const FONT_IMPORT = `@import url('https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500;600&display=swap');`;

const C = {
  ink: "#14171A",
  inkText: "#F5F3EC",
  inkTextMuted: "#A9A79C",
  inkBorder: "rgba(245,243,236,0.10)",
  inkActiveSoft: "rgba(10,163,124,0.22)",

  bg: "#FAF9F6",
  surface: "#FFFFFF",
  surfaceMuted: "#F2F0EA",
  border: "#E6E2D8",
  borderStrong: "#D8D3C5",

  textPrimary: "#20221E",
  textSecondary: "#6B6558",
  textFaint: "#9C9686",

  accent: "#0AA37C",
  accentSoft: "#E1F3EC",
  accentBorder: "#BEE3D4",

  amber: "#B7791F",
  amberSoft: "#FBF2DF",
  amberBorder: "#F0DCAE",

  green: "#1F5F52",
  greenSoft: "#E4EEEC",
  greenBorder: "#C3D9D4",

  red: "#A8402F",
  redSoft: "#F8E8E4",
  redBorder: "#EBC4BB",
};
const MONO = "'IBM Plex Mono', monospace";
const SANS = "'Manrope', sans-serif";
const CARD_RADIUS = 8;

/* ---------- helpers ---------- */

const STATUS_META = {
  open: { label: "Открыто", color: C.amber, soft: C.amberSoft, border: C.amberBorder, icon: CircleDot },
  waiting_client: { label: "Ожидание ответа клиента", color: "#3f7a63", soft: "#eaf2ee", border: "#c8ddd2", icon: CircleCheck },
  pending_confirm: { label: "Требует подтверждения", color: C.accent, soft: C.accentSoft, border: C.accentBorder, icon: CircleHelp },
  closed: { label: "Закрыто", color: C.green, soft: C.greenSoft, border: C.greenBorder, icon: CircleCheck },
};

function dateLabel(daysAgo) {
  if (daysAgo === 0) return "Сегодня";
  if (daysAgo === 1) return "Вчера";
  return `${daysAgo} дн. назад`;
}
function fmtDate(d) {
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getFullYear()).slice(-2)}`;
}
// Реальные календарные границы выбранного периода — используются и для
// подписи недель на графике, и как единый источник правды о том, какой
// диапазон дат сейчас выбран (совпадает с тем, что уходит в periodParams).
function periodDateRange(period, customFrom, customTo) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  if (period === "today") return { start: today, end: today };
  if (period === "yesterday") {
    const y = new Date(today); y.setDate(y.getDate() - 1);
    return { start: y, end: y };
  }
  if (period === "custom") {
    if (!customFrom || !customTo) return { start: new Date(today.getTime() - 29 * 86400000), end: today };
    const a = new Date(`${customFrom}T00:00:00`);
    const b = new Date(`${customTo}T00:00:00`);
    return a <= b ? { start: a, end: b } : { start: b, end: a };
  }
  const days = Number(period);
  const start = new Date(today); start.setDate(start.getDate() - (days - 1));
  return { start, end: today };
}
function daysUntil(dateStr) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(`${dateStr}T00:00:00`);
  return Math.round((d - today) / 86400000);
}
function calendarDateStr(isoOrDate) {
  const d = new Date(isoOrDate);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function shiftDateStr(dateStr, delta) {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + delta);
  return calendarDateStr(d);
}
function formatRelativeTime(date) {
  const sec = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
  if (sec < 60) return "только что";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} мин назад`;
  const hrs = Math.round(min / 60);
  return `${hrs} ч назад`;
}
function formatWaitMinutes(totalMin) {
  if (totalMin < 60) return `${totalMin} мин`;
  if (totalMin < 1440) {
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return m ? `${h} ч ${m} мин` : `${h} ч`;
  }
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  return h ? `${d} дн ${h} ч` : `${d} дн`;
}
function subscriptionTone(status) {
  if (!status) return "neutral";
  const s = status.toLowerCase();
  if (s.includes("актив") || s.includes("работ")) return "green";
  if (s.includes("блок")) return "red";
  if (s.includes("удал")) return "neutral";
  return "amber";
}
function riskOf({ openCount, closedRate, overdue }) {
  if (overdue > 0 || (openCount >= 4 && closedRate < 0.6)) return { label: "риск", tone: "red" };
  if (openCount >= 3) return { label: "внимание", tone: "amber" };
  return { label: "норма", tone: "neutral" };
}
// Делит период на недельные бакеты (последний бакет может быть короче 7
// дней, если период не кратен неделе) и раскладывает по ним тикеты по
// реальной дате first_message_at — не по фиксированным "последним 6
// неделям от сегодня", а по фактически выбранному диапазону.
function periodBuckets(tickets, start, end, maxBuckets = 20) {
  const msDay = 86400000;
  const totalDays = Math.max(1, Math.round((end - start) / msDay) + 1);
  const numWeeks = Math.min(maxBuckets, Math.max(1, Math.ceil(totalDays / 7)));

  const buckets = Array.from({ length: numWeeks }, (_, i) => {
    const wStart = new Date(start); wStart.setDate(wStart.getDate() + i * 7);
    const wEnd = new Date(wStart);
    const daysLeft = totalDays - i * 7;
    wEnd.setDate(wEnd.getDate() + Math.min(6, daysLeft - 1));
    return { in: 0, out: 0, start: wStart, end: wEnd };
  });

  tickets.forEach((t) => {
    const d = new Date(t.first_message_at);
    const dayIdx = Math.floor((d - start) / msDay);
    const wIdx = Math.floor(dayIdx / 7);
    if (wIdx >= 0 && wIdx < buckets.length) {
      buckets[wIdx].in += 1;
      if (t.status === "closed") buckets[wIdx].out += 1;
    }
  });
  return buckets;
}
function toneStyle(tone) {
  if (tone === "red") return { color: C.red, background: C.redSoft, border: `1px solid ${C.redBorder}` };
  if (tone === "amber") return { color: C.amber, background: C.amberSoft, border: `1px solid ${C.amberBorder}` };
  if (tone === "green") return { color: C.green, background: C.greenSoft, border: `1px solid ${C.greenBorder}` };
  if (tone === "accent") return { color: C.accent, background: C.accentSoft, border: `1px solid ${C.accentBorder}` };
  return { color: C.textSecondary, background: C.surfaceMuted, border: `1px solid ${C.border}` };
}

function useIsNarrow(breakpoint = 880) {
  const [narrow, setNarrow] = useState(typeof window !== "undefined" ? window.innerWidth < breakpoint : false);
  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < breakpoint);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [breakpoint]);
  return narrow;
}

/* ---------- small UI atoms ---------- */

function Pill({ children, tone }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "2px 8px", borderRadius: 6, fontSize: 11.5, fontWeight: 500, whiteSpace: "nowrap", ...toneStyle(tone) }}>
      {children}
    </span>
  );
}
function StatusBadge({ status }) {
  const meta = STATUS_META[status] || STATUS_META.open;
  const Icon = meta.icon;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 9px", borderRadius: 6, fontSize: 12, fontWeight: 500, color: meta.color, background: meta.soft, border: `1px solid ${meta.border}`, whiteSpace: "nowrap" }}>
      <Icon size={12} strokeWidth={2.2} />
      {meta.label}
    </span>
  );
}
function StatusSelect({ value, onChange, compact }) {
  const [open, setOpen] = useState(false);
  const meta = STATUS_META[value] || STATUS_META.open;
  return (
    <div style={{ position: "relative" }}>
      <button onClick={() => setOpen(!open)}
        style={{ display: "flex", alignItems: "center", gap: 7, padding: compact ? "5px 8px 5px 9px" : "7px 10px 7px 11px", border: "1px solid transparent", borderRadius: 7, background: "transparent", color: meta.color, fontSize: compact ? 12.5 : 13, fontWeight: 500, cursor: "pointer" }}
        onMouseEnter={(e) => (e.currentTarget.style.background = C.surfaceMuted)}
        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: meta.color, flexShrink: 0 }} />
        {meta.label}
        <ChevronDown size={10} color={C.textFaint} />
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 50 }} />
          <div style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, width: 190, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, boxShadow: "0 18px 36px -18px rgba(20,23,26,0.4)", padding: 6, zIndex: 51 }}>
            {Object.keys(STATUS_META).map((k) => {
              const m = STATUS_META[k];
              return (
                <button key={k} onClick={() => { onChange(k); setOpen(false); }}
                  style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", border: "none", borderRadius: 7, background: "transparent", fontSize: 13, color: C.textPrimary, textAlign: "left", cursor: "pointer" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = C.surfaceMuted)}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: m.color, flexShrink: 0 }} />
                  {m.label}
                  <span style={{ flex: 1 }} />
                  {k === value && <span style={{ color: C.accent, fontSize: 12 }}>✓</span>}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
// Обычный одиночный выбор в стиле категории, но без поиска и без
// добавления/редактирования — этого достаточно для всех select'ов в
// приложении, кроме категории (там нужно уметь заводить новые значения).
function StyledSelect({ value, options, onChange, placeholder, width }) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState(null);
  const triggerRef = useRef(null);
  const selected = options.find((o) => o.value === value);

  const openPanel = () => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (r) setRect({ top: r.bottom + 5, left: r.left, width: r.width });
    setOpen(true);
  };

  return (
    <div style={{ width: width || "100%" }}>
      <button ref={triggerRef} onClick={() => (open ? setOpen(false) : openPanel())}
        style={{ width: "100%", boxSizing: "border-box", display: "flex", alignItems: "center", gap: 9, padding: "9px 11px", border: `1px solid ${C.border}`, borderRadius: 7, background: C.surfaceMuted, fontSize: 13, color: selected ? C.textPrimary : C.textFaint, cursor: "pointer", textAlign: "left" }}>
        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{selected ? selected.label : (placeholder || "Выберите…")}</span>
        <ChevronDown size={11} color={C.textFaint} style={{ flexShrink: 0 }} />
      </button>
      {open && rect && createPortal(
        <>
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 9998 }} />
          <div style={{ position: "fixed", top: rect.top, left: rect.left, width: rect.width, minWidth: 200, maxHeight: 260, overflowY: "auto", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, boxShadow: "0 18px 36px -18px rgba(20,23,26,0.4)", padding: 6, zIndex: 9999 }}>
            {options.map((o) => (
              <button key={o.value} onClick={() => { onChange(o.value); setOpen(false); }}
                style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "9px 10px", border: "none", borderRadius: 7, background: "transparent", fontSize: 13, color: C.textPrimary, textAlign: "left", cursor: "pointer" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = C.surfaceMuted)}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.label}</span>
                {o.value === value && <span style={{ color: C.accent, fontSize: 12, flexShrink: 0 }}>✓</span>}
              </button>
            ))}
            {options.length === 0 && <div style={{ padding: "10px", fontSize: 12, color: C.textFaint }}>Нет вариантов</div>}
          </div>
        </>,
        document.body
      )}
    </div>
  );
}
function KpiCard({ label, value, unit, hint, tone, onClick, active }) {
  return (
    <div onClick={onClick} style={{
      background: C.surface, border: `1px solid ${active ? C.accent : C.border}`, borderRadius: CARD_RADIUS,
      padding: "13px 15px", minWidth: 0, cursor: onClick ? "pointer" : "default",
      transition: "border-color .12s",
    }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 7 }}>
        <span style={{ fontFamily: MONO, fontSize: 21, fontWeight: 600, letterSpacing: "-0.3px", color: tone ? toneStyle(tone).color : C.textPrimary }}>{value}</span>
        {unit && <span style={{ fontSize: 12, color: C.textFaint }}>{unit}</span>}
      </div>
      <div style={{ fontSize: 11.5, color: C.textSecondary, marginTop: 5 }}>{label}</div>
      {hint && <div style={{ fontSize: 11, color: C.textFaint, marginTop: 3, fontFamily: MONO }}>{hint}</div>}
    </div>
  );
}
function SegButton({ active, children, onClick }) {
  return (
    <button onClick={onClick} style={{ padding: "6px 12px", borderRadius: 6, border: "none", fontSize: 12.5, fontWeight: active ? 600 : 400, cursor: "pointer", whiteSpace: "nowrap", background: active ? C.accentSoft : "transparent", color: active ? C.accent : C.textSecondary, fontFamily: SANS }}>
      {children}
    </button>
  );
}
function PeriodSelector({ period, setPeriod, customFrom, customTo, setCustomFrom, setCustomTo }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <div style={{ display: "flex", gap: 3, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: 3, flexWrap: "wrap" }}>
        {PERIOD_OPTIONS.map((o) => (
          <SegButton key={o.key} active={period === o.key} onClick={() => setPeriod(o.key)}>{o.label}</SegButton>
        ))}
      </div>
      {period === "custom" && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: C.textSecondary, flexWrap: "wrap" }}>
          <input type="date" value={customFrom} max={customTo || undefined} onChange={(e) => setCustomFrom(e.target.value)}
            style={{ padding: "6px 8px", borderRadius: 6, border: `1px solid ${C.border}`, background: C.surface, color: C.textPrimary, fontFamily: MONO, fontSize: 12.5 }} />
          <span>—</span>
          <input type="date" value={customTo} min={customFrom || undefined} onChange={(e) => setCustomTo(e.target.value)}
            style={{ padding: "6px 8px", borderRadius: 6, border: `1px solid ${C.border}`, background: C.surface, color: C.textPrimary, fontFamily: MONO, fontSize: 12.5 }} />
        </div>
      )}
    </div>
  );
}
function SearchBox({ value, onChange, placeholder, style }) {
  return (
    <div style={{ position: "relative", ...style }}>
      <Search size={14} color={C.textFaint} style={{ position: "absolute", left: 11, top: 10 }} />
      <input value={value} onChange={onChange} placeholder={placeholder}
        style={{ width: "100%", boxSizing: "border-box", padding: "8px 11px 8px 32px", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 13, color: C.textPrimary, fontFamily: SANS }} />
    </div>
  );
}
function Card({ children, style }) {
  return <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: CARD_RADIUS, ...style }}>{children}</div>;
}
function LoadingBlock({ label = "Загрузка…" }) {
  return <div style={{ padding: "40px 20px", textAlign: "center", fontSize: 13, color: C.textFaint }}>{label}</div>;
}
function ErrorBlock({ message, onRetry }) {
  return (
    <div style={{ padding: "16px 18px", border: `1px solid ${C.redBorder}`, background: C.redSoft, borderRadius: CARD_RADIUS, color: C.red, fontSize: 13, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
      <AlertTriangle size={15} style={{ flexShrink: 0 }} />
      <span style={{ flex: 1, minWidth: 200 }}>{message}</span>
      {onRetry && (
        <button onClick={onRetry} style={{ padding: "6px 12px", border: `1px solid ${C.redBorder}`, borderRadius: 7, background: "transparent", color: C.red, fontSize: 12, cursor: "pointer", flexShrink: 0 }}>
          Повторить
        </button>
      )}
    </div>
  );
}
function jiraDisplayLabel(value) {
  if (/^https?:\/\//i.test(value)) {
    const parts = value.replace(/\/+$/, "").split("/");
    return parts[parts.length - 1] || value;
  }
  return value;
}
function JiraLink({ value, baseUrl }) {
  if (!value) return <span style={{ color: C.textFaint }}>—</span>;
  const href = jiraHref(value, baseUrl);
  const label = jiraDisplayLabel(value);
  if (!href) {
    return (
      <span title={value} style={{ fontFamily: MONO, fontSize: 12, color: C.textSecondary, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" }}>
        {label}
      </span>
    );
  }
  return (
    <a href={href} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} title={value}
      style={{ fontFamily: MONO, fontSize: 12, color: C.accent, display: "inline-flex", alignItems: "center", gap: 4, textDecoration: "none", maxWidth: "100%", overflow: "hidden" }}>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{label}</span>
      <ExternalLink size={10} style={{ flexShrink: 0 }} />
    </a>
  );
}
function VipPill({ vip }) {
  if (!vip) return null;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 3, padding: "2px 7px", borderRadius: 6, fontSize: 11, fontWeight: 600, color: "#8A5A00", background: "#FBF0D9", border: "1px solid #EEDBA6" }}>
      <Star size={10} fill="#8A5A00" /> VIP
    </span>
  );
}
function ToggleSwitch({ on, onClick, disabled, size }) {
  const sm = size === "sm";
  const w = sm ? 34 : 44, h = sm ? 20 : 26, knob = sm ? 14 : 20, pad = sm ? 3 : 3;
  return (
    <button onClick={onClick} disabled={disabled} aria-pressed={on}
      style={{ width: w, height: h, borderRadius: h / 2, flexShrink: 0, padding: pad, border: "none", display: "flex", cursor: disabled ? "default" : "pointer", justifyContent: on ? "flex-end" : "flex-start", background: on ? C.accent : C.borderStrong, transition: "background .15s", opacity: disabled ? 0.6 : 1 }}>
      <span style={{ width: knob, height: knob, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 3px rgba(20,23,26,0.25)", display: "block" }} />
    </button>
  );
}

function PaidBadge() {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 3, padding: "2px 7px", borderRadius: 6, fontSize: 11, fontWeight: 600, color: C.green, background: C.greenSoft, border: `1px solid ${C.greenBorder}` }}>
      <Banknote size={10} /> Доработка
    </span>
  );
}

function MultiSelect({ options, selected, onChange, placeholder, width, searchable }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const toggle = (v) => {
    if (selected.includes(v)) onChange(selected.filter((x) => x !== v));
    else onChange([...selected, v]);
  };
  const label = selected.length === 0
    ? placeholder
    : selected.length === 1
      ? (options.find((o) => o.value === selected[0])?.label || selected[0])
      : `${selected.length} выбрано`;
  const filtered = searchable && query.trim()
    ? options.filter((o) => o.label.toLowerCase().includes(query.trim().toLowerCase()))
    : options;

  return (
    <div style={{ position: "relative" }}>
      <button onClick={() => setOpen(!open)}
        style={{ padding: "7px 12px", borderRadius: 7, border: `1px solid ${selected.length ? C.accentBorder : C.border}`, background: selected.length ? C.accentSoft : C.surface, color: selected.length ? C.accent : C.textSecondary, fontSize: 12.5, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
        {label} <ChevronDown size={12} />
      </button>
      {open && (
        <>
          <div onClick={() => { setOpen(false); setQuery(""); }} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
          <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 41, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: 6, minWidth: width || 200, maxHeight: 300, display: "flex", flexDirection: "column", boxShadow: "0 8px 24px rgba(20,23,26,0.14)" }}>
            {searchable && (
              <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Поиск…"
                style={{ boxSizing: "border-box", width: "100%", padding: "7px 9px", marginBottom: 6, border: `1px solid ${C.border}`, borderRadius: 6, background: C.surfaceMuted, fontSize: 12.5, color: C.textPrimary, flexShrink: 0 }} />
            )}
            <div style={{ overflowY: "auto" }}>
              {selected.length > 0 && (
                <button onClick={() => onChange([])} style={{ width: "100%", textAlign: "left", padding: "6px 8px", background: "none", border: "none", fontSize: 11.5, color: C.textFaint, cursor: "pointer" }}>Сбросить</button>
              )}
              {filtered.map((o) => (
                <label key={o.value}
                  style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", fontSize: 12.5, color: C.textPrimary, cursor: "pointer", borderRadius: 6 }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = C.surfaceMuted)}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                  <input type="checkbox" checked={selected.includes(o.value)} onChange={() => toggle(o.value)} />
                  {o.label}
                </label>
              ))}
              {filtered.length === 0 && <div style={{ padding: "8px", fontSize: 12, color: C.textFaint }}>Ничего не найдено</div>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* ---------- Sidebar ---------- */

function Sidebar({ view, setView, todayOpenCount, feedOpenCount, promisesOverdueCount, aiModel, clientsCount, narrow, mobileOpen, setMobileOpen, oracleLastSync, currentUser, onLogout }) {
  const items = [
    { key: "clients", label: "Клиенты", icon: LayoutGrid, count: clientsCount },
    { key: "feed", label: "Обращения", icon: Inbox, count: feedOpenCount },
    { key: "today", label: "Пульс поддержки", icon: Sun, count: todayOpenCount, tone: "amber" },
    { key: "promises", label: "Обещания", icon: FileCheck2, count: promisesOverdueCount, tone: promisesOverdueCount > 0 ? "red" : null },
    { key: "analytics", label: "Аналитика", icon: BarChart3, count: null },
    { key: "audit", label: "Журнал действий", icon: ScrollText, count: null },
    { key: "settings", label: "Настройки", icon: SettingsIcon, count: null },
  ];

  const navButton = (it, onNavigate) => {
    const Icon = it.icon;
    const active = view === it.key || (it.key === "clients" && view === "client");
    return (
      <button key={it.key} onClick={() => { setView(it.key); onNavigate && onNavigate(); }}
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "10px 12px", borderRadius: 8, border: "none", background: active ? C.inkActiveSoft : "transparent", color: active ? "#7FE3C6" : C.inkTextMuted, fontSize: 13.5, fontWeight: active ? 600 : 400, cursor: "pointer", textAlign: "left", fontFamily: SANS, width: "100%" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <Icon size={15} strokeWidth={2} />
          {it.label}
        </span>
        {it.count != null && (
          <span style={{ fontFamily: MONO, fontSize: 11, color: it.tone ? { red: "#E0917F", amber: "#E3C079" }[it.tone] : C.inkTextMuted }}>{it.count}</span>
        )}
      </button>
    );
  };

  if (narrow) {
    return (
      <>
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, height: 52, background: C.ink, display: "flex", alignItems: "center", padding: "0 14px", zIndex: 40, gap: 12, boxSizing: "border-box" }}>
          <button onClick={() => setMobileOpen(true)} style={{ background: "none", border: "none", color: C.inkText, cursor: "pointer", padding: 4, display: "flex" }}>
            <Menu size={20} />
          </button>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.inkText, fontFamily: SANS }}>Support Desk</div>
        </div>
        {mobileOpen && (
          <div style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(20,23,26,0.45)" }} onClick={() => setMobileOpen(false)}>
            <div onClick={(e) => e.stopPropagation()} style={{ width: 250, maxWidth: "82vw", height: "100%", background: C.ink, padding: "16px 10px", display: "flex", flexDirection: "column", gap: 3, boxSizing: "border-box" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "2px 6px 16px" }}>
                <div style={{ fontSize: 14.5, fontWeight: 700, color: C.inkText }}>Support Desk</div>
                <button onClick={() => setMobileOpen(false)} style={{ background: "none", border: "none", color: C.inkTextMuted, cursor: "pointer" }}><X size={18} /></button>
              </div>
              {items.map((it) => navButton(it, () => setMobileOpen(false)))}
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <div style={{ width: 224, flexShrink: 0, background: C.ink, padding: "18px 10px", display: "flex", flexDirection: "column", gap: 3, height: "100vh", position: "sticky", top: 0, overflowY: "auto", boxSizing: "border-box" }}>
      <div style={{ padding: "2px 10px 20px 10px" }}>
        <div style={{ fontSize: 14.5, fontWeight: 700, color: C.inkText, letterSpacing: "-0.01em" }}>Support Desk</div>
        <div style={{ fontSize: 11.5, color: C.inkTextMuted, marginTop: 2, fontFamily: MONO }}>ТГ-чаты поддержки</div>
      </div>
      {items.map((it) => navButton(it))}

      <div style={{ marginTop: "auto", padding: "14px 10px 2px", borderTop: `1px solid ${C.inkBorder}`, display: "flex", flexDirection: "column", gap: 5 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11, fontFamily: MONO, color: C.inkTextMuted }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: C.accent }} />
          Бот слушает {clientsCount ?? "…"} {clientsCount === 1 ? "чат" : "чата"}
        </div>
        <div style={{ fontSize: 11, fontFamily: MONO, color: C.inkTextMuted }}>Модель: {aiModel || "не задана"}</div>
        <div style={{ fontSize: 11, fontFamily: MONO, color: C.inkTextMuted }}>
          Синк БД: {oracleLastSync ? new Date(oracleLastSync).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "ещё не было"}
        </div>
        {currentUser && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, paddingTop: 10, borderTop: `1px solid ${C.inkBorder}` }}>
            <div style={{ width: 24, height: 24, borderRadius: "50%", background: C.inkActiveSoft, display: "grid", placeItems: "center", fontSize: 10.5, fontWeight: 600, color: "#7FE3C6", flexShrink: 0 }}>
              {currentUser.name.split(" ").slice(0, 2).map((w) => w[0]).join("").toUpperCase()}
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 11.5, color: C.inkText, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{currentUser.name}</div>
            </div>
            <button onClick={onLogout} title="Выйти" style={{ background: "none", border: "none", color: C.inkTextMuted, cursor: "pointer", padding: 3, display: "flex", flexShrink: 0 }}>
              <LogOut size={13} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- Clients page ---------- */

function AddClientModal({ onClose, onCreated }) {
  const [name, setName] = useState("");
  const [tgGroupId, setTgGroupId] = useState("");
  const [tariffName, setTariffName] = useState("");
  const [vip, setVip] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const submit = async () => {
    if (!name.trim() || !tgGroupId.trim()) {
      setError("Название и id группы обязательны");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.createClient({
        name: name.trim(),
        tg_group_id: Number(tgGroupId.trim()),
        tariff_name: tariffName.trim() || null,
        vip,
      });
      onCreated();
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(20,23,26,0.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 55 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 420, maxWidth: "92vw", background: C.surface, borderRadius: CARD_RADIUS, padding: 22, boxShadow: "0 16px 40px rgba(20,23,26,0.18)" }}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 16 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: C.textPrimary }}>Новый клиент</div>
          <button onClick={onClose} style={{ marginLeft: "auto", background: "none", border: "none", color: C.textFaint, cursor: "pointer" }}><X size={17} /></button>
        </div>
        {error && <div style={{ marginBottom: 12 }}><ErrorBlock message={error} /></div>}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <div style={{ fontSize: 11.5, color: C.textSecondary, marginBottom: 6 }}>Название *</div>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="ООО «Клиент»"
              style={{ width: "100%", boxSizing: "border-box", padding: "9px 11px", background: C.surfaceMuted, border: `1px solid ${C.border}`, borderRadius: 7, fontSize: 13, color: C.textPrimary }} />
          </div>
          <div>
            <div style={{ fontSize: 11.5, color: C.textSecondary, marginBottom: 6 }}>ID группы в Telegram *</div>
            <input value={tgGroupId} onChange={(e) => setTgGroupId(e.target.value)} placeholder="-1001234567890"
              style={{ width: "100%", boxSizing: "border-box", padding: "9px 11px", background: C.surfaceMuted, border: `1px solid ${C.border}`, borderRadius: 7, fontFamily: MONO, fontSize: 13, color: C.textPrimary }} />
          </div>
          <div>
            <div style={{ fontSize: 11.5, color: C.textSecondary, marginBottom: 6 }}>Тариф</div>
            <input value={tariffName} onChange={(e) => setTariffName(e.target.value)} placeholder="напр. Стандарт"
              style={{ width: "100%", boxSizing: "border-box", padding: "9px 11px", background: C.surfaceMuted, border: `1px solid ${C.border}`, borderRadius: 7, fontSize: 13, color: C.textPrimary }} />
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: C.textPrimary, cursor: "pointer" }}>
            <input type="checkbox" checked={vip} onChange={(e) => setVip(e.target.checked)} /> VIP-клиент
          </label>
        </div>
        <button onClick={submit} disabled={saving}
          style={{ width: "100%", marginTop: 18, padding: "10px 0", border: "none", borderRadius: 7, background: C.accent, color: "#fff", fontSize: 13, fontWeight: 600, cursor: saving ? "default" : "pointer", opacity: saving ? 0.6 : 1 }}>
          {saving ? "Создаю…" : "Создать клиента"}
        </button>
      </div>
    </div>
  );
}

function ClientsPage({ clientsAll, onOpenClient, goToday, promisesAll, refreshTick, onDataChanged }) {
  const [activeChats, setActiveChats] = useState(null);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [chips, setChips] = useState({ hasOpen: false, overdue: false, risk: false, vip: false, active: false });
  const [sortKey, setSortKey] = useState("open_count");
  const [sortDir, setSortDir] = useState("desc");
  const [tariffFilter, setTariffFilter] = useState([]);
  const [statusFilter, setStatusFilter] = useState(null); // null = ещё не проинициализирован дефолтом
  const [showAdd, setShowAdd] = useState(false);
  const clients = clientsAll; // тот же список, что уже загружен на уровне App — второй раз не запрашиваем

  useEffect(() => {
    let cancelled = false;
    setError(null);
    api.getActiveChats({ days: 30 })
      .then((activeData) => { if (!cancelled) setActiveChats(activeData); })
      .catch((e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [refreshTick]);

  // По умолчанию — только "активные" статусы биллинга (без Блокирована/Удалена
  // и т.п.), один раз при первой загрузке данных, дальше пользователь управляет сам.
  useEffect(() => {
    if (clients && statusFilter === null) {
      const active = [...new Set(clients.map((c) => c.subscription_status).filter(Boolean))]
        .filter((s) => subscriptionTone(s) === "green");
      setStatusFilter(active);
    }
  }, [clients, statusFilter]);

  const deleteClient = async (id, name) => {
    if (!window.confirm(`Удалить клиента «${name}» вместе со всей историей обращений? Это необратимо.`)) return;
    try {
      await api.deleteClient(id);
      onDataChanged();
    } catch (e) {
      setError(e.message);
    }
  };

  if (error) return <div style={{ padding: "26px 28px" }}><ErrorBlock message={error} /></div>;
  if (!clients || !activeChats || statusFilter === null) return <LoadingBlock label="Загружаю клиентов…" />;

  const activeIds = new Set(activeChats.chats.map((c) => c.client_id));

  const rows = clients.map((c) => {
    const own = promisesAll.filter((p) => p.client_id === c.id);
    const overdue = own.filter((p) => p.bucket === "overdue").length;
    const risk = riskOf({ openCount: c.open_count, closedRate: c.closed_rate, overdue });
    return { ...c, overdue, promisesCount: own.length, risk, isActive: activeIds.has(c.id) };
  });

  const tariffOptions = [...new Set(rows.map((r) => r.tariff_name).filter(Boolean))].sort().map((t) => ({ value: t, label: t }));
  const statusOptions = [...new Set(rows.map((r) => r.subscription_status).filter(Boolean))].sort().map((s) => ({ value: s, label: s }));

  let filtered = rows.filter((r) => {
    const q = search.trim().toLowerCase();
    if (q && !(r.name + r.tg_group_id).toLowerCase().includes(q)) return false;
    if (chips.hasOpen && r.open_count === 0) return false;
    if (chips.overdue && r.overdue === 0) return false;
    if (chips.risk && r.risk.label !== "риск") return false;
    if (chips.vip && !r.vip) return false;
    if (chips.active && !r.isActive) return false;
    if (tariffFilter.length && !tariffFilter.includes(r.tariff_name)) return false;
    if (statusFilter.length && r.subscription_status && !statusFilter.includes(r.subscription_status)) return false;
    return true;
  });
  filtered.sort((a, b) => {
    const dir = sortDir === "asc" ? 1 : -1;
    if (sortKey === "name") return a.name.localeCompare(b.name) * dir;
    return ((a[sortKey] ?? 0) - (b[sortKey] ?? 0)) * dir;
  });

  const totalOpen = filtered.reduce((s, r) => s + r.open_count, 0);
  const totalCount = filtered.reduce((s, r) => s + r.ticket_count, 0);
  const totalPromises = filtered.reduce((s, r) => s + r.promisesCount, 0);
  const totalAvg = filtered.length ? Math.round(filtered.reduce((s, r) => s + r.avg_response_min, 0) / filtered.length) : 0;
  const totalClosed = filtered.length ? Math.round((filtered.reduce((s, r) => s + r.closed_rate, 0) / filtered.length) * 100) : 0;

  const toggleChip = (key) => setChips({ ...chips, [key]: !chips[key] });
  const sortBy = (key, dir = "desc") => { setSortKey(key); setSortDir(dir); };

  const columns = [
    { key: "name", label: "Клиент" },
    { key: "open_count", label: "Открыто" },
    { key: "ticket_count", label: "Обращений" },
    { key: "avg_response_min", label: "Ср. ответ" },
    { key: "closed_rate", label: "Закрыто, %" },
    { key: null, label: "Тариф" },
    { key: "promisesCount", label: "Обещания" },
  ];
  const toggleSort = (key) => {
    if (!key) return;
    if (sortKey === key) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("desc"); }
  };

  return (
    <div style={{ padding: "26px 28px 44px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 16, flexWrap: "wrap", marginBottom: 18 }}>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: C.textPrimary, letterSpacing: "-0.4px" }}>Клиенты</h1>
          <div style={{ fontSize: 13, color: C.textSecondary, marginTop: 5 }}>Статистика по обращениям за последние 30 дней</div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
          {totalOpen > 0 && (
            <button onClick={goToday} style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "9px 14px", borderRadius: 8, border: `1px solid ${C.amberBorder}`, background: C.amberSoft, color: C.amber, fontSize: 12.5, fontWeight: 500, cursor: "pointer" }}>
              <CircleDot size={14} /> {totalOpen} открытых обращений требуют внимания
            </button>
          )}
          <button onClick={() => setShowAdd(true)} style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "9px 14px", borderRadius: 8, border: "none", background: C.accent, color: "#fff", fontSize: 12.5, fontWeight: 500, cursor: "pointer" }}>
            <Plus size={14} /> Добавить клиента
          </button>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
        <SearchBox value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Клиент или id группы…" style={{ flex: 1, minWidth: 200, maxWidth: 300 }} />
        {[
          { key: "hasOpen", label: "Есть открытые" },
          { key: "overdue", label: "Просрочены обещания" },
          { key: "risk", label: "В зоне риска" },
          { key: "vip", label: "VIP" },
        ].map((c) => (
          <button key={c.key} onClick={() => toggleChip(c.key)}
            style={{ padding: "7px 12px", borderRadius: 7, fontSize: 12.5, cursor: "pointer", whiteSpace: "nowrap", background: chips[c.key] ? C.amberSoft : C.surface, border: `1px solid ${chips[c.key] ? C.amberBorder : C.border}`, color: chips[c.key] ? C.amber : C.textSecondary }}>
            {c.label}
          </button>
        ))}
        <MultiSelect options={tariffOptions} selected={tariffFilter} onChange={setTariffFilter} placeholder="Тариф" />
        <MultiSelect options={statusOptions} selected={statusFilter} onChange={setStatusFilter} placeholder="Статус подписки" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 11, marginBottom: 18 }}>
        <KpiCard label="Открыто сейчас" value={totalOpen} tone={totalOpen > 0 ? "amber" : null} active={chips.hasOpen} onClick={() => toggleChip("hasOpen")} />
        <KpiCard label="Обращений за период" value={totalCount} onClick={() => { setChips({ hasOpen: false, overdue: false, risk: false, vip: false, active: false }); setSearch(""); }} />
        <KpiCard label="Ср. время ответа" value={totalAvg} unit="мин" active={sortKey === "avg_response_min"} onClick={() => sortBy("avg_response_min")} />
        <KpiCard label="Доля закрытых" value={`${totalClosed}%`} active={sortKey === "closed_rate"} onClick={() => sortBy("closed_rate", "asc")} />
        <KpiCard label="Обещаний на нас" value={totalPromises} active={sortKey === "promisesCount"} onClick={() => sortBy("promisesCount")} />
        <KpiCard label="Активные уникальные чаты" value={activeChats.count} hint="сообщение от клиента за период" tone="accent" active={chips.active} onClick={() => toggleChip("active")} />
      </div>

      <Card style={{ overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <div style={{ minWidth: 960 }}>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(220px,1.6fr) 100px 120px 120px 100px 140px 100px 32px", gap: 12, padding: "10px 16px", background: C.surfaceMuted, borderBottom: `1px solid ${C.border}` }}>
              {columns.map((col, i) => (
                <button key={i} onClick={() => toggleSort(col.key)}
                  style={{ display: "flex", alignItems: "center", gap: 4, background: "none", border: "none", padding: 0, fontSize: 10.5, letterSpacing: "0.05em", textTransform: "uppercase", color: col.key && sortKey === col.key ? C.accent : C.textFaint, cursor: col.key ? "pointer" : "default", textAlign: "left", fontFamily: SANS }}>
                  {col.label}
                  {col.key && sortKey === col.key && (sortDir === "asc" ? <ChevronUp size={11} /> : <ChevronDown size={11} />)}
                </button>
              ))}
              <div />
            </div>

            {filtered.map((c, i) => (
              <div key={c.id} onClick={() => onOpenClient(c.id)}
                style={{ display: "grid", gridTemplateColumns: "minmax(220px,1.6fr) 100px 120px 120px 100px 140px 100px 32px", gap: 12, alignItems: "center", padding: "13px 16px", borderTop: i === 0 ? "none" : `1px solid ${C.border}`, cursor: "pointer" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = C.surfaceMuted)}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 14, fontWeight: 500, color: C.textPrimary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.name}</span>
                    <VipPill vip={c.vip} />
                    <Pill tone={c.risk.tone}>{c.risk.label}</Pill>
                    {c.isActive && <Pill tone="accent">активен</Pill>}
                  </div>
                  <div style={{ fontFamily: MONO, fontSize: 11, color: C.textFaint, marginTop: 3 }}>
                    группа {c.tg_group_id}{c.chat_label ? ` · «${c.chat_label}»` : ""}
                  </div>
                </div>
                <div style={{ fontFamily: MONO, fontSize: 15, fontWeight: 500, color: c.open_count === 0 ? C.textFaint : c.open_count >= 4 ? C.red : C.amber }}>{c.open_count}</div>
                <div style={{ fontFamily: MONO, fontSize: 13.5, color: C.textSecondary }}>{c.ticket_count}</div>
                <div>
                  <div style={{ fontFamily: MONO, fontSize: 13.5, color: C.textSecondary }}>{c.avg_response_min} мин</div>
                  <div style={{ height: 4, borderRadius: 2, background: C.surfaceMuted, marginTop: 5, overflow: "hidden" }}>
                    <div style={{ width: `${Math.min(100, (c.avg_response_min / 60) * 100)}%`, height: "100%", borderRadius: 2, background: c.avg_response_min <= 20 ? C.green : c.avg_response_min <= 45 ? C.amber : C.red }} />
                  </div>
                </div>
                <div style={{ fontFamily: MONO, fontSize: 13.5, color: C.textSecondary }}>{Math.round(c.closed_rate * 100)}%</div>
                <div style={{ minWidth: 0, overflow: "hidden" }}>
                  {c.tariff_name
                    ? <span style={{ fontSize: 12.5, color: C.textPrimary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "block" }}>{c.tariff_name}</span>
                    : <span style={{ fontSize: 12.5, color: C.textFaint }}>—</span>}
                </div>
                <div style={{ fontFamily: MONO, fontSize: 12, color: c.overdue ? C.red : c.promisesCount ? C.textSecondary : C.textFaint }}>
                  {c.overdue ? `${c.overdue} просроч.` : c.promisesCount ? `${c.promisesCount} в срок` : "—"}
                </div>
                <button onClick={(e) => { e.stopPropagation(); deleteClient(c.id, c.name); }} title="Удалить клиента"
                  style={{ background: "none", border: "none", color: C.textFaint, cursor: "pointer", padding: 4, display: "flex" }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = C.red)}
                  onMouseLeave={(e) => (e.currentTarget.style.color = C.textFaint)}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}

            {filtered.length === 0 && (
              <div style={{ padding: "40px 20px", textAlign: "center" }}>
                <div style={{ fontSize: 14, fontWeight: 500, color: C.textPrimary }}>
                  {clients.length === 0 ? "Клиентов пока нет" : "Нет клиентов по этому фильтру"}
                </div>
                <div style={{ fontSize: 12.5, color: C.textSecondary, marginTop: 4 }}>
                  {clients.length === 0
                    ? "Зарегистрируйте первого клиента через Oracle-синк или кнопку «Добавить клиента»"
                    : "Сбросьте фильтры."}
                </div>
              </div>
            )}
          </div>
        </div>
      </Card>

      {showAdd && <AddClientModal onClose={() => setShowAdd(false)} onCreated={onDataChanged} />}
    </div>
  );
}

/* ---------- Client detail page ---------- */

function ClientDetailPage({ clientId, period, setPeriod, from, to, setFrom, setTo, onBack, onOpenTicket, promisesAll, refreshTick, onDataChanged, onDeleted }) {
  const [client, setClient] = useState(null);
  const [historyTickets, setHistoryTickets] = useState(null);
  const [categoryStats, setCategoryStats] = useState(null);
  const [error, setError] = useState(null);
  const [histFilter, setHistFilter] = useState("Все");
  const [histSortWait, setHistSortWait] = useState(false);
  const [vipSaving, setVipSaving] = useState(false);
  const [chatLabelDraft, setChatLabelDraft] = useState(null); // null — не редактируется
  const [chatLabelSaving, setChatLabelSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [tgInfo, setTgInfo] = useState(null); // { ok, title, error } | null пока грузится

  // Ключ "что сейчас загружено" — чтобы отличить настоящую навигацию (сменился
  // клиент или период — тогда честно показываем экран загрузки) от фонового
  // обновления по refreshTick (тогда просто тихо подменяем данные, без сброса
  // в null и без мигания всей карточки).
  const loadedKeyRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);

    const key = `${clientId}|${period}|${from}|${to}`;
    const isNavigation = loadedKeyRef.current !== key;
    if (isNavigation) {
      setClient(null);
      setHistoryTickets(null);
      setCategoryStats(null);
      setTgInfo(null);
    }

    const params = periodParams(period, from, to);
    Promise.all([
      api.getClient(clientId, params),
      api.getClientTickets(clientId, params),
      api.getCategoryStats(clientId),
    ])
      .then(([clientData, hist, cats]) => {
        if (cancelled) return;
        loadedKeyRef.current = key;
        setClient(clientData);
        setHistoryTickets(hist.map(normalizeTicket));
        setCategoryStats(cats);
      })
      .catch((e) => { if (!cancelled) setError(e.message); });

    if (isNavigation) {
      api.getTelegramInfo(clientId).then((r) => { if (!cancelled) setTgInfo(r); }).catch(() => { if (!cancelled) setTgInfo({ ok: false, error: "Не удалось выполнить запрос" }); });
    }

    return () => { cancelled = true; };
  }, [clientId, period, from, to, refreshTick]);

  if (error) {
    return (
      <div style={{ padding: "22px 28px" }}>
        <button onClick={onBack} style={{ background: "none", border: "none", padding: 0, fontSize: 12.5, color: C.textSecondary, cursor: "pointer", marginBottom: 14, display: "flex", alignItems: "center", gap: 5 }}>
          <ChevronLeft size={14} /> Все клиенты
        </button>
        <ErrorBlock message={error} />
      </div>
    );
  }
  if (!client || !historyTickets || !categoryStats) return <LoadingBlock label="Загружаю карточку клиента…" />;

  const own = promisesAll.filter((p) => p.client_id === clientId);
  const overdue = own.filter((p) => p.bucket === "overdue").length;
  const risk = riskOf({ openCount: client.open_count, closedRate: client.closed_rate, overdue });
  const { start: periodStart, end: periodEnd } = periodDateRange(period, from, to);
  const weeks = periodBuckets(historyTickets, periodStart, periodEnd);
  const maxWeek = Math.max(...weeks.map((w) => w.in), 1);

  let hist = historyTickets.filter((t) => histFilter === "Все" || STATUS_META[t.status].label === histFilter);
  hist = histSortWait ? [...hist].sort((a, b) => b.waitMin - a.waitMin) : [...hist].sort((a, b) => a.daysAgo - b.daysAgo);

  const toggleVip = async () => {
    setVipSaving(true);
    try {
      const updated = await api.updateClient(clientId, { vip: !client.vip });
      setClient(updated);
      onDataChanged(); // фоном подтягивает клиента в общих списках — эту страницу больше не затрагивает
    } catch (e) {
      setError(e.message);
    } finally {
      setVipSaving(false);
    }
  };

  const saveChatLabel = async () => {
    setChatLabelSaving(true);
    try {
      const updated = await api.updateClient(clientId, { chat_label: chatLabelDraft.trim() || null });
      setClient(updated);
      onDataChanged();
      setChatLabelDraft(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setChatLabelSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(`Удалить клиента «${client.name}» вместе со всей историей обращений? Это необратимо.`)) return;
    setDeleting(true);
    try {
      await api.deleteClient(clientId);
      onDataChanged();
      onDeleted();
    } catch (e) {
      setError(e.message);
      setDeleting(false);
    }
  };

  const tariffText = client.tariff_name
    ? `${client.tariff_name} – ${client.tariff_price || "цена не указана"}`
    : "Тариф не указан";

  return (
    <div style={{ padding: "22px 28px 44px" }}>
      <button onClick={onBack} style={{ background: "none", border: "none", padding: 0, fontSize: 12.5, color: C.textSecondary, cursor: "pointer", marginBottom: 14, display: "flex", alignItems: "center", gap: 5 }}>
        <ChevronLeft size={14} /> Все клиенты
      </button>

      <div style={{ display: "flex", alignItems: "flex-start", gap: 14, flexWrap: "wrap", marginBottom: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: C.textPrimary, letterSpacing: "-0.3px" }}>{client.name}</h1>
            <VipPill vip={client.vip} />
            <Pill tone={risk.tone}>{risk.label}</Pill>
          </div>
          <div style={{ fontFamily: MONO, fontSize: 11.5, color: C.textFaint, marginTop: 5, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span>группа {client.tg_group_id}</span>
            {chatLabelDraft === null ? (
              <button onClick={() => setChatLabelDraft(client.chat_label || "")}
                style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: client.chat_label ? C.textFaint : C.accent, fontFamily: MONO, fontSize: 11.5, textDecoration: "underline dotted" }}>
                {client.chat_label ? `«${client.chat_label}»` : "+ указать название чата в TG"}
              </button>
            ) : (
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <input autoFocus value={chatLabelDraft} onChange={(e) => setChatLabelDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") saveChatLabel(); if (e.key === "Escape") setChatLabelDraft(null); }}
                  placeholder="напр. СЛ · поддержка"
                  style={{ padding: "3px 7px", borderRadius: 5, border: `1px solid ${C.accentBorder}`, background: C.surface, color: C.textPrimary, fontFamily: MONO, fontSize: 11.5, width: 160 }} />
                <button onClick={saveChatLabel} disabled={chatLabelSaving} style={{ padding: "3px 9px", border: "none", borderRadius: 5, background: C.accent, color: "#fff", fontSize: 11, cursor: "pointer" }}>
                  {chatLabelSaving ? "…" : "OK"}
                </button>
                <button onClick={() => setChatLabelDraft(null)} style={{ padding: "3px 7px", border: "none", background: "none", color: C.textFaint, fontSize: 11, cursor: "pointer" }}>✕</button>
              </span>
            )}
          </div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 14 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 12, color: C.textSecondary }}>VIP</span>
            <ToggleSwitch on={client.vip} onClick={toggleVip} disabled={vipSaving} />
          </span>
          <button onClick={handleDelete} disabled={deleting}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 11px", border: `1px solid ${C.redBorder}`, borderRadius: 7, background: "transparent", color: C.red, fontSize: 12, cursor: deleting ? "default" : "pointer", opacity: deleting ? 0.6 : 1 }}>
            <Trash2 size={13} /> {deleting ? "Удаляю…" : "Удалить клиента"}
          </button>
        </div>
      </div>

      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center", marginBottom: 18, fontSize: 12.5 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, color: C.textSecondary }}>
          <MessageCircle size={13} />
          {tgInfo === null && "загружаю название чата…"}
          {tgInfo && tgInfo.ok && <span>чат «{tgInfo.title}»</span>}
          {tgInfo && !tgInfo.ok && <span style={{ color: C.textFaint }} title={tgInfo.error}>название чата недоступно</span>}
        </div>
        <div style={{ color: C.textSecondary }}>
          Тариф: <span style={{ color: client.tariff_name ? C.textPrimary : C.textFaint, fontWeight: client.tariff_name ? 600 : 400 }}>{tariffText}</span>
        </div>
        {client.subscription_status && <Pill tone={subscriptionTone(client.subscription_status)}>{client.subscription_status}</Pill>}
        <div style={{ color: C.textSecondary }}>
          Подключён: <span style={{ color: client.connected_at ? C.textPrimary : C.textFaint, fontFamily: MONO }}>
            {client.connected_at ? fmtDate(new Date(`${client.connected_at}T00:00:00`)) : "не указано"}
          </span>
        </div>
        {client.billing_contract_number && (
          <span style={{ fontFamily: MONO, fontSize: 11, color: C.textFaint }} title={client.billing_contract_id ? `id подписки: ${client.billing_contract_id}` : undefined}>
            договор {client.billing_contract_number}
          </span>
        )}
      </div>

      <div style={{ marginBottom: 16 }}>
        <PeriodSelector period={period} setPeriod={setPeriod} customFrom={from} customTo={to} setCustomFrom={setFrom} setCustomTo={setTo} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 11, marginBottom: 18 }}>
        <KpiCard label="Открыто сейчас" value={client.open_count} tone={client.open_count > 0 ? "amber" : "green"} hint={client.open_count ? "есть ожидающие" : "всё закрыто"} active={histFilter === "Открыто"} onClick={() => setHistFilter("Открыто")} />
        <KpiCard label="Обращений за период" value={client.ticket_count} active={histFilter === "Все"} onClick={() => setHistFilter("Все")} />
        <KpiCard label="Среднее время ответа" value={client.avg_response_min} unit="мин" tone={client.avg_response_min <= 20 ? "green" : client.avg_response_min <= 45 ? "amber" : "red"} active={histSortWait} onClick={() => setHistSortWait(!histSortWait)} />
        <KpiCard label="Доля закрытых" value={`${Math.round(client.closed_rate * 100)}%`} tone={client.closed_rate < 0.7 ? "amber" : null} active={histFilter === "Закрыто"} onClick={() => setHistFilter("Закрыто")} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))", gap: 12, marginBottom: 16 }}>
        <Card style={{ padding: "15px 16px" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 3 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: C.textPrimary, display: "flex", alignItems: "center", gap: 6 }}><Tag size={13} color={C.textSecondary} /> Темы обращений</div>
            <div style={{ fontSize: 11, color: C.textFaint, marginLeft: "auto" }}>ср. в месяц · 90 дней</div>
          </div>
          <div style={{ fontSize: 11.5, color: C.textSecondary, marginBottom: 13 }}>Категории ставит нейросеть при разборе сообщений</div>
          {categoryStats.length === 0 && <div style={{ fontSize: 12.5, color: C.textFaint }}>Нет данных за последние 90 дней</div>}
          <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
            {categoryStats.map((r) => (
              <div key={r.category}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, fontSize: 12.5, flexWrap: "wrap" }}>
                  <span style={{ color: C.textPrimary }}>{r.category}</span>
                  <span style={{ marginLeft: "auto", fontFamily: MONO, color: C.textSecondary }}>{r.avg_per_month}</span>
                  <span style={{ fontFamily: MONO, color: C.textFaint, width: 52, textAlign: "right" }}>{r.avg_response_min} мин</span>
                </div>
                <div style={{ height: 6, borderRadius: 3, background: C.surfaceMuted, marginTop: 6, overflow: "hidden" }}>
                  <div style={{ width: `${(r.avg_per_month / (categoryStats[0]?.avg_per_month || 1)) * 100}%`, height: "100%", borderRadius: 3, background: r.avg_response_min > 35 ? C.amber : C.accent }} />
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card style={{ padding: "15px 16px" }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: C.textPrimary, marginBottom: 3 }}>Динамика по неделям</div>
          <div style={{ fontSize: 11.5, color: C.textSecondary, marginBottom: 14 }}>
            Поступило и закрыто, обращений в неделю · {weeks.length === 1 ? "1 неделя" : `${weeks.length} нед.`} в выбранном периоде
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: weeks.length > 10 ? 4 : 8, height: 128, overflowX: weeks.length > 16 ? "auto" : "visible" }}>
            {weeks.map((w, i) => {
              const sameDay = w.start.getTime() === w.end.getTime();
              return (
                <div key={i} style={{ flex: "1 0 0", minWidth: weeks.length > 16 ? 26 : 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 7 }}>
                  <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 92, width: "100%", justifyContent: "center" }}>
                    <div title={`поступило: ${w.in}`} style={{ width: 12, height: `${Math.max(4, (w.in / maxWeek) * 88)}px`, borderRadius: "3px 3px 0 0", background: C.accent }} />
                    <div title={`закрыто: ${w.out}`} style={{ width: 12, height: `${Math.max(4, (w.out / maxWeek) * 88)}px`, borderRadius: "3px 3px 0 0", background: C.green }} />
                  </div>
                  <span style={{ fontSize: 8.5, color: C.textFaint, fontFamily: MONO, textAlign: "center", lineHeight: 1.35, whiteSpace: "nowrap" }}>
                    {sameDay ? fmtDate(w.start) : <>{fmtDate(w.start)}<br />{fmtDate(w.end)}</>}
                  </span>
                </div>
              );
            })}
          </div>
          <div style={{ display: "flex", gap: 14, marginTop: 12, fontSize: 11.5, color: C.textSecondary }}>
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 9, height: 9, borderRadius: 2, background: C.accent }} /> Поступило</span>
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 9, height: 9, borderRadius: 2, background: C.green }} /> Закрыто</span>
          </div>
        </Card>
      </div>

      <Card style={{ overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "13px 16px", flexWrap: "wrap", borderBottom: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: C.textPrimary }}>История обращений</div>
          <div style={{ display: "flex", gap: 6, marginLeft: "auto", flexWrap: "wrap" }}>
            {["Все", "Открыто", "Ожидание ответа клиента", "Закрыто"].map((f) => (
              <button key={f} onClick={() => setHistFilter(f)}
                style={{ padding: "5px 11px", borderRadius: 7, fontSize: 11.5, cursor: "pointer", background: histFilter === f ? C.accentSoft : "transparent", border: `1px solid ${histFilter === f ? C.accentBorder : C.border}`, color: histFilter === f ? C.accent : C.textSecondary }}>
                {f}
              </button>
            ))}
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <div style={{ minWidth: 815 }}>
            <div style={{ display: "grid", gridTemplateColumns: "108px 130px minmax(200px,1fr) 90px 185px", gap: 12, padding: "9px 16px", background: C.surfaceMuted, fontSize: 10.5, letterSpacing: "0.05em", textTransform: "uppercase", color: C.textFaint }}>
              <div>Когда</div><div>Категория</div><div>Обращение</div><div>Ожидание</div><div>Статус</div>
            </div>
            {hist.length === 0 && <div style={{ padding: "22px 16px", fontSize: 13, color: C.textFaint }}>Нет обращений за выбранный период</div>}
            {hist.map((t, i) => (
              <div key={t.id} onClick={() => onOpenTicket(t)}
                style={{ display: "grid", gridTemplateColumns: "108px 130px minmax(200px,1fr) 90px 185px", gap: 12, alignItems: "center", padding: "12px 16px", borderTop: i === 0 ? "none" : `1px solid ${C.border}`, cursor: "pointer", borderLeft: t.status === "open" ? `2px solid ${C.amber}` : "2px solid transparent" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = C.surfaceMuted)}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                <div>
                  <div style={{ fontFamily: MONO, fontSize: 12, color: C.textSecondary }}>{dateLabel(t.daysAgo)}</div>
                  <div style={{ fontFamily: MONO, fontSize: 10.5, color: C.textFaint, marginTop: 2 }}>{t.time}</div>
                </div>
                <div style={{ fontSize: 12.5, color: C.textSecondary }}>{t.category}</div>
                <div>
                  <div style={{ fontSize: 13, color: C.textPrimary }}>{t.text}</div>
                  <div style={{ fontFamily: MONO, fontSize: 11, color: C.textFaint, marginTop: 3 }}>{t.code} · уверенность ИИ {t.confidence}%</div>
                </div>
                <div style={{ fontFamily: MONO, fontSize: 12, color: C.textSecondary }}>
                  {t.status === "closed" ? (t.first_response_at ? `ответ за ${formatWaitMinutes(t.waitMin)}` : `закрыто за ${formatWaitMinutes(t.waitMin)}`) : `ждёт ${formatWaitMinutes(t.waitMin)}`}
                </div>
                <div style={{ minWidth: 0, overflow: "hidden" }}><StatusBadge status={t.status} /></div>
              </div>
            ))}
          </div>
        </div>
      </Card>
    </div>
  );
}

/* ---------- Feed page (Обращения) ---------- */

const FEED_VIEWS = ["Все", "Открытые", "Нарушен SLA", "Ждут клиента", "Задачи со сроком", "Закрытые"];

function csvEscape(v) {
  const s = String(v ?? "");
  return `"${s.replace(/"/g, '""')}"`;
}
function ticketsToCSV(rows, clientsById, jiraBaseUrl) {
  const header = ["Тикет", "Тема", "Комментарий", "Обещание клиенту", "Срок исполнения", "Клиент", "Категория", "Создано", "Ожидание (мин)", "Статус", "Jira", "Платная доработка"];
  const lines = [header.map(csvEscape).join(";")];
  rows.forEach((t) => {
    const client = clientsById[t.clientId];
    lines.push([
      t.code,
      t.text,
      t.comment || "",
      t.promiseText || "",
      t.dueDate ? new Date(`${t.dueDate}T00:00:00`).toLocaleDateString("ru-RU") : "",
      client?.name || "",
      t.category,
      new Date(t.first_message_at).toLocaleString("ru-RU"),
      t.waitMin,
      STATUS_META[t.status]?.label || t.status,
      jiraHref(t.jiraUrl, jiraBaseUrl) || t.jiraUrl || "", // полная ссылка, а не только ключ
      t.isPaidWork ? "да" : "нет",
    ].map(csvEscape).join(";"));
  });
  return lines.join("\r\n");
}
function downloadCSV(text, filename) {
  const blob = new Blob(["\uFEFF" + text], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Название обращения: растёт по высоте под текст, чтобы длинное название
// читалось целиком, а не обрезалось в одной строке. Переводы строк в названии
// не допускаем (Enter игнорируется, вставленные переносы заменяются пробелом).
function TitleInput({ value, onChange, placeholder, hasError }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current) return;
    ref.current.style.height = "auto";
    ref.current.style.height = `${ref.current.scrollHeight}px`;
  }, [value]);
  return (
    <textarea ref={ref} rows={1} value={value} placeholder={placeholder}
      onChange={(e) => onChange(e.target.value.replace(/\s*\n\s*/g, " "))}
      onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }}
      style={{ display: "block", width: "100%", boxSizing: "border-box", padding: "11px 13px", background: C.surfaceMuted, border: `1px solid ${hasError ? C.red : C.border}`, borderRadius: 9, fontSize: 14.5, fontWeight: 600, lineHeight: 1.35, color: C.textPrimary, fontFamily: SANS, resize: "none", overflow: "hidden", overflowWrap: "anywhere" }} />
  );
}

function ClientAutocomplete({ clientsById, value, onChange, error }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const list = Object.values(clientsById).sort((a, b) => a.name.localeCompare(b.name));

  useEffect(() => {
    const onDocClick = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const filtered = query.trim()
    ? list.filter((c) => c.name.toLowerCase().includes(query.trim().toLowerCase()))
    : list;
  const selectedClient = value ? clientsById[value] : null;

  const pick = (c) => {
    onChange(c.id);
    setQuery(c.name);
    setOpen(false);
  };

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, height: 40, border: `1px solid ${error ? C.red : C.border}`, borderRadius: 8, padding: "0 12px", background: C.surfaceMuted }}>
        <Search size={14} color={C.textFaint} />
        <input
          value={open ? query : (selectedClient?.name || query)}
          onChange={(e) => { setQuery(e.target.value); onChange(""); setOpen(true); }}
          onFocus={() => { setOpen(true); setQuery(""); }}
          placeholder="Начните вводить название клиента"
          style={{ border: "none", outline: "none", background: "transparent", flex: 1, minWidth: 0, fontSize: 13.5, color: C.textPrimary }} />
      </div>
      {open && (
        <div style={{ position: "absolute", left: 0, right: 0, top: "calc(100% + 6px)", maxHeight: 240, overflowY: "auto", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, boxShadow: "0 12px 32px rgba(20,23,26,0.14)", padding: 6, zIndex: 20 }}>
          {filtered.slice(0, 50).map((c) => (
            <button key={c.id} onClick={() => pick(c)}
              style={{ display: "flex", width: "100%", alignItems: "center", gap: 10, padding: "8px 10px", border: "none", background: "transparent", borderRadius: 6, cursor: "pointer", fontSize: 13, color: C.textPrimary, textAlign: "left" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = C.surfaceMuted)}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
              <span style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.name}</span>
              {c.tariff_name && <span style={{ fontFamily: MONO, fontSize: 11, color: C.textFaint, whiteSpace: "nowrap" }}>{c.tariff_name}</span>}
            </button>
          ))}
          {filtered.length === 0 && <div style={{ padding: 10, color: C.textFaint, fontSize: 13 }}>Клиент не найден</div>}
        </div>
      )}
      {error && <div style={{ fontSize: 12, color: C.red, marginTop: 5 }}>Выберите клиента из списка</div>}
    </div>
  );
}

function CreateTicketDrawer({ clientsById, categories, onClose, onCreated }) {
  const [clientId, setClientId] = useState("");
  const [category, setCategory] = useState(categories[0] || "Вопрос по функционалу");
  const [subject, setSubject] = useState("");
  const [comment, setComment] = useState("");
  const [status, setStatus] = useState("open");
  const [dueDate, setDueDate] = useState("");
  const [jiraUrl, setJiraUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [touched, setTouched] = useState(false);

  const clientError = touched && !clientId;
  const subjectError = touched && !subject.trim();

  const submit = async () => {
    setTouched(true);
    if (!clientId || !subject.trim()) {
      setError("Проверьте обязательные поля");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.createTicket({
        client_id: clientId,
        category,
        subject: subject.trim(),
        comment: comment.trim() || null,
        status,
        due_date: dueDate || null,
        jira_url: jiraUrl.trim() || null,
      });
      onCreated();
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, category, subject, comment, status, dueDate, jiraUrl]);

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(20,23,26,0.3)", zIndex: 55 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: "min(460px,100vw)", background: C.surface, boxShadow: "-16px 0 48px rgba(20,23,26,0.14)", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, padding: "20px 24px 16px", borderBottom: `1px solid ${C.border}` }}>
          <div>
            <div style={{ fontSize: 16.5, fontWeight: 600, color: C.textPrimary }}>Новое обращение</div>
            <div style={{ fontSize: 12, color: C.textFaint, marginTop: 3 }}>Появится в таблице сразу после создания</div>
          </div>
          <button onClick={onClose} style={{ width: 28, height: 28, border: "none", background: "transparent", borderRadius: 6, cursor: "pointer", color: C.textSecondary }}><X size={17} /></button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px", display: "flex", flexDirection: "column", gap: 18 }}>
          {error && <ErrorBlock message={error} />}

          <div>
            <label style={{ fontSize: 12.5, fontWeight: 500, color: C.textPrimary, display: "block", marginBottom: 6 }}>Клиент <span style={{ color: C.red }}>*</span></label>
            <ClientAutocomplete clientsById={clientsById} value={clientId} onChange={setClientId} error={clientError} />
          </div>

          <div>
            <label style={{ fontSize: 12.5, fontWeight: 500, color: C.textPrimary, display: "block", marginBottom: 6 }}>Категория</label>
            <CategorySelect value={category} onChange={setCategory} options={categories.length ? categories : [category]} />
          </div>

          <div>
            <label style={{ fontSize: 12.5, fontWeight: 500, color: C.textPrimary, display: "block", marginBottom: 6 }}>Наименование обращения <span style={{ color: C.red }}>*</span></label>
            <TitleInput value={subject} onChange={setSubject} placeholder="Коротко, о чём обращение" hasError={subjectError} />
            {subjectError && <div style={{ fontSize: 12, color: C.red, marginTop: 5 }}>Укажите наименование обращения</div>}
          </div>

          <div>
            <label style={{ fontSize: 12.5, fontWeight: 500, color: C.textPrimary, display: "block", marginBottom: 6 }}>Комментарий</label>
            <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={4} placeholder="Подробности, заметки по обращению"
              style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 12px", background: C.surfaceMuted, fontSize: 13, resize: "vertical", lineHeight: 1.5, color: C.textPrimary, fontFamily: SANS }} />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={{ fontSize: 12.5, fontWeight: 500, color: C.textPrimary, display: "block", marginBottom: 6 }}>Статус</label>
              <StyledSelect value={status} onChange={setStatus} options={Object.keys(STATUS_META).map((k) => ({ value: k, label: STATUS_META[k].label }))} />
            </div>
            <div>
              <label style={{ fontSize: 12.5, fontWeight: 500, color: C.textPrimary, display: "block", marginBottom: 6 }}>Срок исполнения</label>
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)}
                style={{ width: "100%", boxSizing: "border-box", height: 40, border: `1px solid ${C.border}`, borderRadius: 8, padding: "0 12px", background: C.surfaceMuted, fontSize: 13.5, color: C.textPrimary }} />
            </div>
          </div>

          <div>
            <label style={{ fontSize: 12.5, fontWeight: 500, color: C.textPrimary, display: "block", marginBottom: 6 }}>Задача в Jira <span style={{ fontWeight: 400, color: C.textFaint }}>· необязательно</span></label>
            <input value={jiraUrl} onChange={(e) => setJiraUrl(e.target.value)} placeholder="SUP-XXXX или полный URL"
              style={{ width: "100%", boxSizing: "border-box", height: 40, border: `1px solid ${C.border}`, borderRadius: 8, padding: "0 12px", background: C.surfaceMuted, fontFamily: MONO, fontSize: 12.5, color: C.textPrimary }} />
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "14px 24px", borderTop: `1px solid ${C.border}`, background: C.surfaceMuted }}>
          <span style={{ fontFamily: MONO, fontSize: 11, color: C.textFaint }}>⌘↵ создать</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={onClose} style={{ height: 38, padding: "0 16px", border: `1px solid ${C.border}`, background: C.surface, borderRadius: 8, fontSize: 13.5, cursor: "pointer" }}>Отмена</button>
            <button onClick={submit} disabled={saving}
              style={{ height: 38, padding: "0 18px", border: "none", background: C.accent, color: "#fff", borderRadius: 8, fontSize: 13.5, fontWeight: 500, cursor: saving ? "default" : "pointer", opacity: saving ? 0.6 : 1 }}>
              {saving ? "Создаю…" : "Создать обращение"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const FEED_PERIODS = [
  { key: "today", label: "Сегодня" },
  { key: "yesterday", label: "Вчера" },
  { key: "7", label: "7 дней" },
  { key: "30", label: "30 дней" },
  { key: "90", label: "90 дней" },
  { key: "all", label: "Всё время" },
  { key: "custom", label: "Произвольный" },
];
function feedPeriodQuery(period, from, to) {
  if (period === "all") return { date_from: "2000-01-01", date_to: isoToday() };
  return periodParams(period, from, to);
}
const ddmm = (iso) => { const [, m, d] = String(iso).split("-"); return `${d}.${m}`; };

// Выбор периода — кнопка в строке фильтров + панель через портал (не режется
// прокручиваемыми/overflow-контейнерами таблицы).
function FeedPeriodMenu({ period, setPeriod, customFrom, customTo, setCustomFrom, setCustomTo }) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState(null);
  const btnRef = useRef(null);
  const label = period === "custom"
    ? `${customFrom ? ddmm(customFrom) : "…"} – ${customTo ? ddmm(customTo) : "…"}`
    : FEED_PERIODS.find((p) => p.key === period)?.label;

  const toggle = () => {
    if (!open) {
      const r = btnRef.current?.getBoundingClientRect();
      if (r) setRect({ top: r.bottom + 6, left: r.left });
    }
    setOpen(!open);
  };

  return (
    <>
      <button ref={btnRef} onClick={toggle}
        style={{ display: "flex", alignItems: "center", gap: 6, height: 34, padding: "0 12px", border: `1px solid ${C.border}`, background: C.surface, borderRadius: 8, fontSize: 13, cursor: "pointer", color: C.textPrimary, whiteSpace: "nowrap" }}>
        <span style={{ color: C.textFaint }}>Период:</span>
        <span style={{ fontWeight: 500 }}>{label}</span>
        <span style={{ fontSize: 10, color: C.textFaint }}>▾</span>
      </button>
      {open && rect && createPortal(
        <>
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 9998 }} />
          <div style={{ position: "fixed", top: rect.top, left: rect.left, width: 240, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, boxShadow: "0 12px 32px rgba(20,23,26,0.14)", padding: 6, zIndex: 9999 }}>
            {FEED_PERIODS.map((p) => (
              <button key={p.key} onClick={() => { setPeriod(p.key); if (p.key !== "custom") setOpen(false); }}
                style={{ display: "flex", width: "100%", alignItems: "center", justifyContent: "space-between", padding: "8px 10px", border: "none", background: period === p.key ? C.surfaceMuted : "transparent", borderRadius: 6, cursor: "pointer", fontSize: 13.5, color: C.textPrimary, textAlign: "left" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = C.surfaceMuted)}
                onMouseLeave={(e) => (e.currentTarget.style.background = period === p.key ? C.surfaceMuted : "transparent")}>
                <span>{p.label}</span>
                {period === p.key && <span style={{ color: C.accent, fontSize: 12 }}>✓</span>}
              </button>
            ))}
            {period === "custom" && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, padding: "8px 4px 4px", borderTop: `1px solid ${C.border}`, marginTop: 4 }}>
                <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)}
                  style={{ height: 32, border: `1px solid ${C.border}`, borderRadius: 6, padding: "0 6px", fontSize: 12, minWidth: 0, background: C.surface, color: C.textPrimary }} />
                <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)}
                  style={{ height: 32, border: `1px solid ${C.border}`, borderRadius: 6, padding: "0 6px", fontSize: 12, minWidth: 0, background: C.surface, color: C.textPrimary }} />
              </div>
            )}
          </div>
        </>,
        document.body
      )}
    </>
  );
}

const SORT_COLUMNS = [
  { key: "id", label: "Тикет" },
  { key: "subject", label: "Тема" },
  { key: "client", label: "Клиент" },
  { key: "category", label: "Категория" },
  { key: "created", label: "Создано" },
  { key: "wait", label: "Ожидание" },
  { key: "due", label: "Срок" },
  { key: "status", label: "Статус" },
];
const PAGE_SIZE_OPTIONS = [10, 25, 50];

function FeedPage({ onOpenTicket, attentionAfterMin, refreshTick, clientsById, jiraBaseUrl, onDataChanged }) {
  const [tickets, setTickets] = useState(null);
  const [categories, setCategories] = useState([]);
  const [error, setError] = useState(null);
  const [view, setView] = useState("Все");
  const [period, setPeriod] = useState("30");
  const [customFrom, setCustomFrom] = useState(isoDaysAgo(14));
  const [customTo, setCustomTo] = useState(isoToday());
  const [search, setSearch] = useState("");
  const [vipOnly, setVipOnly] = useState(false);
  const [paidOnly, setPaidOnly] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [sortKey, setSortKey] = useState("created");
  const [sortDir, setSortDir] = useState("desc");
  const [selected, setSelected] = useState(new Set());
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [exportOpen, setExportOpen] = useState(false);
  const [toast, setToast] = useState(null);

  const load = useCallback(() => {
    setError(null);
    api.getTickets(feedPeriodQuery(period, customFrom, customTo))
      .then((data) => setTickets(data.map(normalizeTicket)))
      .catch((e) => setError(e.message));
  }, [period, customFrom, customTo]);

  useEffect(() => { load(); }, [load, refreshTick]);
  useEffect(() => { api.getCategories().then(setCategories).catch(() => {}); }, [refreshTick]);
  useEffect(() => { setPage(1); }, [view, period, customFrom, customTo, search, vipOnly, paidOnly, categoryFilter]);

  if (error) return <div style={{ padding: "26px 28px" }}><ErrorBlock message={error} onRetry={load} /></div>;
  if (!tickets) return <LoadingBlock label="Загружаю обращения…" />;

  const matchesView = (t, v) => {
    if (v === "Открытые") return t.status === "open";
    if (v === "Нарушен SLA") return t.status !== "closed" && t.status !== "waiting_client" && !t.dueDate && t.waitMin > attentionAfterMin;
    if (v === "Ждут клиента") return t.status === "waiting_client";
    if (v === "Задачи со сроком") return t.status !== "closed" && !!t.dueDate;
    if (v === "Закрытые") return t.status === "closed";
    return true;
  };
  const filtered = tickets.filter((t) => {
    const clientName = clientsById[t.clientId]?.name || "";
    const q = search.trim().toLowerCase();
    if (q && !(t.text + t.code + clientName + (t.jiraUrl || "")).toLowerCase().includes(q)) return false;
    if (vipOnly && !clientsById[t.clientId]?.vip) return false;
    if (paidOnly && !t.isPaidWork) return false;
    if (categoryFilter.length && !categoryFilter.includes(t.category)) return false;
    return matchesView(t, view);
  });

  const sortValue = (t, key) => {
    switch (key) {
      case "id": return t.id;
      case "subject": return (t.text || "").toLowerCase();
      case "client": return (clientsById[t.clientId]?.name || "").toLowerCase();
      case "category": return t.category;
      case "created": return new Date(t.first_message_at).getTime();
      case "wait": return t.waitMin;
      case "status": return t.status;
      default: return 0;
    }
  };
  const sorted = [...filtered].sort((a, b) => {
    if (sortKey === "due") {
      const ad = a.dueDate ? new Date(a.dueDate).getTime() : null;
      const bd = b.dueDate ? new Date(b.dueDate).getTime() : null;
      if (ad === null && bd === null) return 0;
      if (ad === null) return 1;
      if (bd === null) return -1;
      return sortDir === "asc" ? ad - bd : bd - ad;
    }
    const av = sortValue(a, sortKey), bv = sortValue(b, sortKey);
    const cmp = av < bv ? -1 : av > bv ? 1 : 0;
    return sortDir === "asc" ? cmp : -cmp;
  });

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRows = sorted.slice((safePage - 1) * pageSize, safePage * pageSize);

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  };
  const toggleOne = (id) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const pageIds = pageRows.map((t) => t.id);
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const toggleAllOnPage = () => setSelected((prev) => {
    const next = new Set(prev);
    if (allPageSelected) pageIds.forEach((id) => next.delete(id));
    else pageIds.forEach((id) => next.add(id));
    return next;
  });

  const doExport = (rows, label) => {
    downloadCSV(ticketsToCSV(rows, clientsById, jiraBaseUrl), `tickets_${isoToday()}.csv`);
    setExportOpen(false);
    setToast(`Экспортировано: ${label}`);
    setTimeout(() => setToast(null), 3500);
  };

  const slaBreaches = tickets.filter((t) => t.status !== "closed" && t.status !== "waiting_client" && !t.dueDate && t.waitMin > attentionAfterMin);
  const categoryOptions = categories.map((c) => ({ value: c, label: c, count: tickets.filter((t) => t.category === c).length }));
  const hasFilters = !!(search || vipOnly || paidOnly || categoryFilter.length || view !== "Все");
  const resetFilters = () => { setSearch(""); setVipOnly(false); setPaidOnly(false); setCategoryFilter([]); setView("Все"); };

  const sortArrow = (key) => sortKey !== key ? "" : (sortDir === "asc" ? "↑" : "↓");
  const rangeText = sorted.length === 0 ? "Ничего не найдено" : `${(safePage - 1) * pageSize + 1}–${Math.min(safePage * pageSize, sorted.length)} из ${sorted.length}`;

  return (
    <div style={{ padding: "26px 28px 44px", display: "flex", flexDirection: "column", gap: 14, height: "100%", boxSizing: "border-box" }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: C.textPrimary, letterSpacing: "-0.4px" }}>Обращения</h1>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, color: C.textSecondary }}>Всё, что бот распознал в чатах · {tickets.length} обращений</span>
            {slaBreaches.length > 0 && (
              <button onClick={() => setView("Нарушен SLA")}
                style={{ display: "flex", alignItems: "center", gap: 7, height: 26, padding: "0 10px", border: `1px solid ${C.redBorder}`, background: C.redSoft, color: C.red, borderRadius: 999, fontSize: 12, cursor: "pointer" }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: C.red }} />
                {slaBreaches.length} превысили SLA
                <span style={{ fontWeight: 600, textDecoration: "underline" }}>Показать</span>
              </button>
            )}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ position: "relative" }}>
            <button onClick={() => setExportOpen(!exportOpen)} title="Экспорт в CSV"
              style={{ display: "grid", placeItems: "center", width: 36, height: 36, border: `1px solid ${C.border}`, background: C.surface, borderRadius: 8, cursor: "pointer" }}>
              <Download size={15} color={C.green} />
            </button>
            {exportOpen && (
              <>
                <div onClick={() => setExportOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 19 }} />
                <div style={{ position: "absolute", right: 0, top: 42, width: 260, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, boxShadow: "0 12px 32px rgba(20,23,26,0.14)", padding: 6, zIndex: 20 }}>
                  <div style={{ padding: "8px 10px 6px", fontSize: 11, letterSpacing: "0.05em", textTransform: "uppercase", color: C.textFaint }}>Что выгрузить</div>
                  <button onClick={() => doExport(sorted, "по текущим фильтрам")}
                    style={{ display: "flex", width: "100%", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "9px 10px", border: "none", background: "transparent", borderRadius: 6, cursor: "pointer", fontSize: 13.5, color: C.textPrimary, textAlign: "left" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = C.surfaceMuted)} onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                    <span>По текущим фильтрам</span><span style={{ fontFamily: MONO, fontSize: 12, color: C.textFaint }}>{sorted.length}</span>
                  </button>
                  <button onClick={() => doExport(tickets, "все обращения")}
                    style={{ display: "flex", width: "100%", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "9px 10px", border: "none", background: "transparent", borderRadius: 6, cursor: "pointer", fontSize: 13.5, color: C.textPrimary, textAlign: "left" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = C.surfaceMuted)} onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                    <span>Все обращения</span><span style={{ fontFamily: MONO, fontSize: 12, color: C.textFaint }}>{tickets.length}</span>
                  </button>
                  <div style={{ padding: "8px 10px 4px", borderTop: `1px solid ${C.border}`, marginTop: 4, fontSize: 11, color: C.textFaint }}>Файл .csv — открывается в Excel</div>
                </div>
              </>
            )}
          </div>
          <button onClick={() => setShowCreate(true)} style={{ display: "inline-flex", alignItems: "center", gap: 7, height: 36, padding: "0 16px", borderRadius: 8, border: "none", background: C.accent, color: "#fff", fontSize: 13.5, fontWeight: 500, cursor: "pointer" }}>
            <Plus size={14} /> Создать обращение
          </button>
        </div>
      </div>


      <Card style={{ overflow: "hidden", flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", gap: 2, padding: "0 12px", borderBottom: `1px solid ${C.border}`, overflowX: "auto", flexShrink: 0 }}>
          {FEED_VIEWS.map((v) => (
            <button key={v} onClick={() => setView(v)}
              style={{ display: "flex", alignItems: "center", gap: 7, height: 44, padding: "0 10px", border: "none", borderBottom: `2px solid ${view === v ? C.accent : "transparent"}`, marginBottom: -1, background: "transparent", color: view === v ? C.accent : C.textSecondary, fontSize: 13.5, fontWeight: view === v ? 600 : 400, cursor: "pointer", whiteSpace: "nowrap" }}>
              {v}
              <span style={{ fontFamily: MONO, fontSize: 11, padding: "1px 6px", borderRadius: 999, background: view === v ? C.accentSoft : C.surfaceMuted, color: view === v ? C.accent : C.textFaint }}>
                {tickets.filter((t) => matchesView(t, v)).length}
              </span>
            </button>
          ))}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "10px 12px", borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
          <SearchBox value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Тема, клиент, SUP-1053 или задача Jira" style={{ flex: "1 1 260px", maxWidth: 400 }} />
          <FeedPeriodMenu period={period} setPeriod={setPeriod} customFrom={customFrom} customTo={customTo} setCustomFrom={setCustomFrom} setCustomTo={setCustomTo} />
          <MultiSelect options={categoryOptions.map((c) => ({ value: c.value, label: `${c.label} (${c.count})` }))} selected={categoryFilter} onChange={setCategoryFilter} placeholder="Категория" searchable />
          <button onClick={() => setVipOnly(!vipOnly)}
            style={{ height: 34, padding: "0 12px", borderRadius: 8, fontSize: 13, cursor: "pointer", background: vipOnly ? C.amberSoft : C.surface, border: `1px solid ${vipOnly ? C.amberBorder : C.border}`, color: vipOnly ? C.amber : C.textSecondary }}>
            VIP
          </button>
          <button onClick={() => setPaidOnly(!paidOnly)}
            style={{ height: 34, padding: "0 12px", borderRadius: 8, fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, background: paidOnly ? C.greenSoft : C.surface, border: `1px solid ${paidOnly ? C.greenBorder : C.border}`, color: paidOnly ? C.green : C.textSecondary }}>
            <Banknote size={12} /> Платная доработка
          </button>
          {hasFilters && (
            <button onClick={resetFilters} style={{ height: 34, padding: "0 8px", border: "none", background: "transparent", color: C.accent, fontSize: 13, cursor: "pointer", fontWeight: 500 }}>Сбросить</button>
          )}
          <div style={{ marginLeft: "auto", color: C.textFaint, fontSize: 12.5, whiteSpace: "nowrap" }}>Найдено: <span style={{ color: C.textPrimary, fontWeight: 500 }}>{sorted.length}</span></div>
        </div>

        {selected.size > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "0 16px", height: 50, background: C.accentSoft, borderBottom: `1px solid ${C.accentBorder}`, flexShrink: 0 }}>
            <span style={{ fontSize: 13.5, fontWeight: 500, color: C.textPrimary }}>Выбрано: {selected.size}</span>
            <button onClick={() => doExport(tickets.filter((t) => selected.has(t.id)), `выбранные (${selected.size})`)}
              style={{ display: "flex", alignItems: "center", gap: 7, height: 30, padding: "0 12px", border: "none", background: C.accent, color: "#fff", borderRadius: 7, fontSize: 12.5, fontWeight: 500, cursor: "pointer" }}>
              <Download size={12} /> Экспорт выбранных
            </button>
            <button onClick={() => setSelected(new Set())} style={{ height: 30, padding: "0 8px", border: "none", background: "transparent", color: C.green, fontSize: 12.5, cursor: "pointer" }}>Снять выделение</button>
          </div>
        )}

        <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
          <div style={{ minWidth: 1230 }}>
            <div style={{ display: "grid", gridTemplateColumns: "34px 90px minmax(220px,2.4fr) minmax(150px,1.3fr) 140px 110px 140px 100px 120px 100px", gap: 10, alignItems: "center", height: 36, padding: "0 12px", position: "sticky", top: 0, zIndex: 2, background: C.surfaceMuted, borderBottom: `1px solid ${C.border}`, fontSize: 10.5, letterSpacing: "0.05em", textTransform: "uppercase", color: C.textFaint }}>
              <button onClick={toggleAllOnPage} title="Выбрать все на странице"
                style={{ width: 15, height: 15, borderRadius: 4, border: `1.5px solid ${allPageSelected ? C.accent : C.borderStrong}`, background: allPageSelected ? C.accent : "transparent", color: "#fff", display: "grid", placeItems: "center", cursor: "pointer", fontSize: 10 }}>
                {allPageSelected ? "✓" : ""}
              </button>
              {SORT_COLUMNS.map((col) => (
                <button key={col.key} onClick={() => toggleSort(col.key)}
                  style={{ display: "flex", alignItems: "center", gap: 4, border: "none", background: "transparent", padding: 0, cursor: "pointer", fontSize: 10.5, letterSpacing: "0.05em", textTransform: "uppercase", color: sortKey === col.key ? C.accent : C.textFaint, textAlign: "left", fontFamily: SANS }}>
                  {col.label}<span>{sortArrow(col.key)}</span>
                </button>
              ))}
              <span>Jira</span>
            </div>

            {pageRows.map((t, i) => {
              const client = clientsById[t.clientId];
              const breach = t.status !== "closed" && t.status !== "waiting_client" && !t.dueDate && t.waitMin > attentionAfterMin;
              const slaExempt = t.status !== "closed" && !!t.dueDate;
              const dueDays = t.dueDate ? daysUntil(t.dueDate) : null;
              const dueColor = !t.dueDate ? C.borderStrong : t.status === "closed" ? C.textFaint : dueDays < 0 ? C.red : dueDays <= 3 ? C.amber : C.textPrimary;
              const checked = selected.has(t.id);
              const created = new Date(t.first_message_at);
              const meta = STATUS_META[t.status] || STATUS_META.open;
              return (
                <div key={t.id} onClick={() => onOpenTicket(t)}
                  style={{ display: "grid", gridTemplateColumns: "34px 90px minmax(220px,2.4fr) minmax(150px,1.3fr) 140px 110px 140px 100px 120px 100px", gap: 10, alignItems: "center", padding: "9px 12px", borderTop: i === 0 ? "none" : `1px solid ${C.border}`, cursor: "pointer", background: checked ? C.accentSoft : "transparent", borderLeft: breach ? `2px solid ${C.red}` : "2px solid transparent" }}
                  onMouseEnter={(e) => { if (!checked) e.currentTarget.style.background = C.surfaceMuted; }}
                  onMouseLeave={(e) => { if (!checked) e.currentTarget.style.background = "transparent"; }}>
                  <button onClick={(e) => { e.stopPropagation(); toggleOne(t.id); }}
                    style={{ width: 15, height: 15, borderRadius: 4, border: `1.5px solid ${checked ? C.accent : C.borderStrong}`, background: checked ? C.accent : "transparent", color: "#fff", display: "grid", placeItems: "center", cursor: "pointer", fontSize: 10, flexShrink: 0 }}>
                    {checked ? "✓" : ""}
                  </button>
                  <div style={{ fontFamily: MONO, fontSize: 12, color: C.textSecondary }}>{t.code}</div>
                  <div style={{ minWidth: 0, paddingRight: 12 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 500, color: C.textPrimary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={t.text}>{t.text}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3 }}>
                      <span style={{ fontFamily: MONO, fontSize: 11, color: C.textFaint }}>уверенность ИИ {t.confidence}%</span>
                      {client?.vip && <VipPill vip />}
                      {t.isPaidWork && <PaidBadge />}
                    </div>
                  </div>
                  <div style={{ minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: C.textPrimary, fontSize: 13 }} title={client?.name}>{client?.name || "—"}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
                    <span style={{ width: 7, height: 7, borderRadius: "50%", background: C.accent, flexShrink: 0 }} />
                    <span style={{ fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.category}</span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <span style={{ fontSize: 13 }}>{created.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" })}</span>
                    <span style={{ fontFamily: MONO, fontSize: 11, color: C.textFaint }}>{created.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })} · {dateLabel(t.daysAgo)}</span>
                  </div>
                  <div title={slaExempt ? "Задан срок исполнения — SLA не считается" : undefined} style={{ fontFamily: MONO, fontSize: 12, fontWeight: breach ? 600 : 400, color: t.status === "closed" || slaExempt ? C.textFaint : breach ? C.red : C.green }}>
                    {t.status === "closed" ? (t.first_response_at ? `ответ за ${formatWaitMinutes(t.waitMin)}` : `закрыто за ${formatWaitMinutes(t.waitMin)}`) : slaExempt ? "SLA не считается" : `ждёт ${formatWaitMinutes(t.waitMin)}`}
                  </div>
                  <div style={{ fontFamily: MONO, fontSize: 12, color: dueColor, fontWeight: dueDays !== null && dueDays < 0 && t.status !== "closed" ? 600 : 400 }}>
                    {t.dueDate ? new Date(`${t.dueDate}T00:00:00`).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit" }) : "—"}
                  </div>
                  <div>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 24, padding: "0 9px", borderRadius: 6, background: meta.soft, color: meta.color, fontSize: 12, fontWeight: 500, whiteSpace: "nowrap" }}>
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: meta.color }} />{meta.label}
                    </span>
                  </div>
                  <div style={{ minWidth: 0, overflow: "hidden" }}>
                    {t.jiraUrl ? <JiraLink value={t.jiraUrl} baseUrl={jiraBaseUrl} /> : <span style={{ color: C.borderStrong }}>—</span>}
                  </div>
                </div>
              );
            })}

            {sorted.length === 0 && (
              <div style={{ padding: "64px 20px", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
                <div style={{ fontSize: 15, fontWeight: 500, color: C.textPrimary }}>Ничего не найдено</div>
                <div style={{ color: C.textFaint, fontSize: 13 }}>Попробуйте изменить запрос или период</div>
                <button onClick={resetFilters} style={{ marginTop: 6, height: 32, padding: "0 14px", border: `1px solid ${C.border}`, background: C.surface, borderRadius: 8, fontSize: 13, cursor: "pointer" }}>Сбросить все фильтры</button>
              </div>
            )}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "0 14px", height: 46, borderTop: `1px solid ${C.border}`, flexShrink: 0, fontSize: 12.5, color: C.textFaint }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span>{rangeText}</span>
            <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
              style={{ border: `1px solid ${C.border}`, borderRadius: 6, background: C.surface, fontSize: 12, color: C.textSecondary, padding: "3px 6px" }}>
              {PAGE_SIZE_OPTIONS.map((n) => <option key={n} value={n}>{n} на странице</option>)}
            </select>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <button onClick={() => setPage(Math.max(1, safePage - 1))} disabled={safePage === 1}
              style={{ width: 30, height: 30, border: `1px solid ${C.border}`, background: C.surface, borderRadius: 6, cursor: safePage === 1 ? "default" : "pointer", color: C.textSecondary, opacity: safePage === 1 ? 0.5 : 1 }}>‹</button>
            {Array.from({ length: totalPages }, (_, i) => i + 1).filter((n) => Math.abs(n - safePage) <= 2 || n === 1 || n === totalPages).map((n, idx, arr) => (
              <React.Fragment key={n}>
                {idx > 0 && arr[idx - 1] !== n - 1 && <span style={{ padding: "0 3px" }}>…</span>}
                <button onClick={() => setPage(n)}
                  style={{ minWidth: 30, height: 30, border: `1px solid ${n === safePage ? C.accent : C.border}`, background: n === safePage ? C.accentSoft : C.surface, color: n === safePage ? C.accent : C.textSecondary, borderRadius: 6, cursor: "pointer", fontFamily: MONO, fontSize: 12 }}>
                  {n}
                </button>
              </React.Fragment>
            ))}
            <button onClick={() => setPage(Math.min(totalPages, safePage + 1))} disabled={safePage === totalPages}
              style={{ width: 30, height: 30, border: `1px solid ${C.border}`, background: C.surface, borderRadius: 6, cursor: safePage === totalPages ? "default" : "pointer", color: C.textSecondary, opacity: safePage === totalPages ? 0.5 : 1 }}>›</button>
          </div>
        </div>
      </Card>

      {showCreate && (
        <CreateTicketDrawer
          clientsById={clientsById}
          categories={categories}
          onClose={() => setShowCreate(false)}
          onCreated={() => { onDataChanged(); load(); setToast("Обращение создано"); setTimeout(() => setToast(null), 3000); }}
        />
      )}

      {toast && (
        <div style={{ position: "fixed", left: "50%", bottom: 24, transform: "translateX(-50%)", background: C.ink, color: "#fff", padding: "10px 16px", borderRadius: 10, fontSize: 13, display: "flex", alignItems: "center", gap: 10, zIndex: 60, boxShadow: "0 10px 30px rgba(0,0,0,0.2)" }}>
          <span style={{ color: C.accent }}>✓</span>{toast}
        </div>
      )}
    </div>
  );
}

/* ---------- Today page ---------- */

/* ---------- Today page ("Пульс поддержки") ---------- */

function TodayPage({ onOpenTicket, onOpenTicketId, refreshTick, onDataChanged, clientsById, promisesAll, jiraBaseUrl, aiProviders, onGoSettings }) {
  const [selectedDate, setSelectedDate] = useState(isoToday());
  const [allTickets, setAllTickets] = useState(null);
  const [digest, setDigest] = useState(null);
  const [activeToday, setActiveToday] = useState(null);
  const [activeYesterday, setActiveYesterday] = useState(null);
  const [error, setError] = useState(null);
  const [regenerating, setRegenerating] = useState(false);
  const [sending, setSending] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [, forceTick] = useState(0); // чтобы "обновлено N назад" тикало само

  const [aiEnabled, setAiEnabled] = useState(() => {
    try { return localStorage.getItem("sd_ai_enabled") !== "0"; } catch { return true; }
  });
  const [summaryOpen, setSummaryOpen] = useState(false);

  const [tab, setTab] = useState("all"); // all | open | prev | waiting | closed
  const [search, setSearch] = useState("");
  const [vipOnly, setVipOnly] = useState(false);
  const [hasNewOnly, setHasNewOnly] = useState(false);
  const [tariffFilter, setTariffFilter] = useState([]);
  const [statusFilter, setStatusFilter] = useState([]);
  const [clientFilter, setClientFilter] = useState([]);
  const [categoryFilter, setCategoryFilter] = useState([]);
  const [categories, setCategories] = useState([]);
  const [waitingExpanded, setWaitingExpanded] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState(new Set());
  const toggleGroup = (key) => setCollapsedGroups((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const [toast, setToast] = useState(null);
  const toastTimerRef = useRef(null);

  useEffect(() => {
    try { localStorage.setItem("sd_ai_enabled", aiEnabled ? "1" : "0"); } catch { /* приватный режим и т.п. — не критично */ }
  }, [aiEnabled]);

  // "обновлено N назад" — тикаем раз в минуту, без лишних перерисовок остального
  useEffect(() => {
    const id = setInterval(() => forceTick((n) => n + 1), 60000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    api.getCategories().then(setCategories).catch(() => {});
  }, []);

  const load = useCallback(() => {
    setError(null);
    const from = shiftDateStr(selectedDate, -60);
    const yesterday = shiftDateStr(selectedDate, -1);
    Promise.all([
      api.getTickets({ date_from: from, date_to: selectedDate }),
      api.getDigestToday({ date: selectedDate }),
      api.getActiveChats({ date_from: selectedDate, date_to: selectedDate }),
      api.getActiveChats({ date_from: yesterday, date_to: yesterday }),
    ])
      .then(([t, d, actToday, actYesterday]) => {
        setAllTickets(t.map(normalizeTicket));
        setDigest(d);
        setActiveToday(actToday.count);
        setActiveYesterday(actYesterday.count);
        setLastUpdated(new Date());
      })
      .catch((e) => setError(e.message));
  }, [selectedDate]);

  useEffect(() => { load(); }, [load, refreshTick]);

  if (error) return <div style={{ padding: "26px 28px" }}><ErrorBlock message={error} onRetry={load} /></div>;
  if (!allTickets || !digest || activeToday === null) return <LoadingBlock label="Собираю сводку…" />;

  const aiConfigured = (aiProviders || []).some((p) => p.enabled && p.api_key);
  const isToday = selectedDate === isoToday();
  const canGoNext = selectedDate < isoToday();

  const passesFilters = (t) => {
    const client = clientsById[t.clientId];
    const q = search.trim().toLowerCase();
    if (q && !(t.text + t.code + (client?.name || "")).toLowerCase().includes(q)) return false;
    if (vipOnly && !client?.vip) return false;
    if (hasNewOnly && !(t.newMessageCount > 0)) return false;
    if (tariffFilter.length && !tariffFilter.includes(client?.tariff_name)) return false;
    if (statusFilter.length && !statusFilter.includes(client?.subscription_status)) return false;
    if (clientFilter.length && !clientFilter.includes(t.clientId)) return false;
    if (categoryFilter.length && !categoryFilter.includes(t.category)) return false;
    return true;
  };

  const dayTickets = allTickets.filter((t) => calendarDateStr(t.first_message_at) === selectedDate);
  const yesterdayTickets = allTickets.filter((t) => calendarDateStr(t.first_message_at) === shiftDateStr(selectedDate, -1));

  // Все обращения, показанные на экране сегодня — независимо от прочих
  // фильтров — источник для списка клиентов в фильтре (пункт 8: только те,
  // кто реально есть на экране, а не вообще все клиенты в системе).
  const screenTicketsRaw = [
    ...dayTickets,
    ...allTickets.filter((t) => calendarDateStr(t.first_message_at) < selectedDate && t.status !== "closed"),
  ];

  // Обращения со сроком исполнения уже показаны в блоках обязательств
  // справа (просроченные / ближайшие / со сроком и Jira) — здесь их не
  // дублируем.
  const isObligation = (t) => !!t.dueDate;

  const open = dayTickets.filter((t) => t.status === "open" && !isObligation(t) && passesFilters(t)).sort((a, b) => b.waitMin - a.waitMin);
  // По дате ЗАКРЫТИЯ, не создания — иначе обращение, открытое позавчера и
  // закрытое сегодня, пропадало бы с экрана вовсе (не "создано сегодня",
  // но уже и не "открыто"/"ожидание клиента").
  const closedToday = allTickets.filter((t) => t.status === "closed" && t.closed_at && calendarDateStr(t.closed_at) === selectedDate && passesFilters(t));
  const previousOpen = allTickets
    .filter((t) => calendarDateStr(t.first_message_at) < selectedDate && t.status === "open" && !isObligation(t) && passesFilters(t))
    .sort((a, b) => new Date(a.first_message_at) - new Date(b.first_message_at));
  // "Ждут ответа клиента" — отдельная, не привязанная к дню группа: важно
  // не когда обращение создано, а что сейчас ход за клиентом.
  const waitingClient = allTickets
    .filter((t) => t.status === "waiting_client" && !isObligation(t) && passesFilters(t))
    .sort((a, b) => new Date(a.first_response_at || 0) - new Date(b.first_response_at || 0));

  const avgWait = dayTickets.length ? Math.round(dayTickets.reduce((s, t) => s + t.waitMin, 0) / dayTickets.length) : 0;
  const overdueObligations = allTickets
    .filter((t) => t.status !== "closed" && t.dueDate && daysUntil(t.dueDate) < 0)
    .sort((a, b) => daysUntil(a.dueDate) - daysUntil(b.dueDate));
  const totalDelta = digest.total - yesterdayTickets.length;
  const activeDelta = activeToday - (activeYesterday || 0);

  // "Обязательства" (со сроком и Jira) и "Ближайшие обязательства" не должны
  // пересекаться: если у обращения уже есть задача в Jira — оно живёт только
  // в "Обязательствах", даже если срок близко. Просроченные — отдельный
  // блок выше, сюда попадают только те, что ещё не просрочены.
  const scheduledWithJira = allTickets
    .filter((t) => t.status !== "closed" && t.dueDate && t.jiraUrl && daysUntil(t.dueDate) >= 0)
    .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
  const promisesSoon = promisesAll
    .filter((p) => p.status !== "closed" && p.due_date && !p.jira_url && daysUntil(p.due_date) >= 0 && daysUntil(p.due_date) <= 3)
    .sort((a, b) => new Date(a.due_date) - new Date(b.due_date));

  const regenerate = async () => {
    setRegenerating(true);
    try { await api.regenerateDigest({ date: selectedDate }); load(); }
    catch (e) { setError(e.message); }
    finally { setRegenerating(false); }
  };
  const send = async () => {
    setSending(true);
    try { await api.sendDigest(); load(); }
    catch (e) { setError(e.message); }
    finally { setSending(false); }
  };

  const setStatus = async (ticketId, status) => {
    try { await api.updateTicket(ticketId, { status }); onDataChanged(); load(); }
    catch (e) { setError(e.message); }
  };
  const markSeen = async (t) => {
    try { await api.markSeen(t.id); load(); }
    catch (e) { setError(e.message); }
  };

  const closeWithUndo = async (t) => {
    try {
      await api.updateTicket(t.id, { status: "closed" });
      onDataChanged();
      load();
      clearTimeout(toastTimerRef.current);
      setToast({ id: t.id, code: t.code, prevStatus: t.status });
      toastTimerRef.current = setTimeout(() => setToast(null), 6000);
    } catch (e) { setError(e.message); }
  };
  const undoClose = async () => {
    if (!toast) return;
    clearTimeout(toastTimerRef.current);
    const { id, prevStatus } = toast;
    setToast(null);
    try { await api.updateTicket(id, { status: prevStatus }); onDataChanged(); load(); }
    catch (e) { setError(e.message); }
  };

  const tariffOptions = [...new Set(Object.values(clientsById).map((c) => c.tariff_name).filter(Boolean))].sort().map((t) => ({ value: t, label: t }));
  const statusOptions = [...new Set(Object.values(clientsById).map((c) => c.subscription_status).filter(Boolean))].sort().map((s) => ({ value: s, label: s }));
  // Только клиенты, чьи обращения реально показаны на этом экране сегодня —
  // не весь список клиентов в системе.
  const screenClientIds = new Set(screenTicketsRaw.map((t) => t.clientId));
  const clientOptions = Object.values(clientsById)
    .filter((c) => screenClientIds.has(c.id))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => ({ value: c.id, label: c.name }));
  const categoryOptions = categories.map((c) => ({ value: c, label: c }));

  // Внутри группы — сначала обращения без единого ответа, дальше по
  // убыванию времени ожидания.
  const sortQueue = (list) => [...list].sort((a, b) => {
    if (a.responseKind !== b.responseKind) {
      if (a.responseKind === "no_response") return -1;
      if (b.responseKind === "no_response") return 1;
    }
    return b.waitMin - a.waitMin;
  });

  const tabs = [
    { key: "all", label: "Все", count: open.length + previousOpen.length + waitingClient.length + closedToday.length },
    { key: "open", label: "Открытые", count: open.length },
    { key: "prev", label: "С прошлых дней", count: previousOpen.length },
    { key: "waiting", label: "Ждут клиента", count: waitingClient.length },
    { key: "closed", label: "Закрытые", count: closedToday.length },
  ];

  // Порядок: С прошлых дней → Открыто сегодня → Ждут ответа клиента →
  // Закрыто (закрытые — завершающие, рендерятся отдельно ниже).
  const groups = [];
  if (tab === "all" || tab === "prev") {
    if (previousOpen.length) groups.push({ key: "prev", title: "С прошлых дней — разобрать в первую очередь", dot: C.red, items: sortQueue(previousOpen) });
  }
  if (tab === "all" || tab === "open") {
    if (open.length) groups.push({ key: "open", title: "Открыто сегодня — по времени ожидания", dot: C.amber, items: sortQueue(open) });
  }
  const showClosedGroup = (tab === "all" || tab === "closed") && closedToday.length > 0;
  const queueEmpty = tab === "waiting"
    ? waitingClient.length === 0
    : groups.length === 0 && !showClosedGroup && !(tab === "all" && waitingClient.length > 0);

  const TicketRow = ({ t, group }) => {
    const client = clientsById[t.clientId];
    const rk = t.responseKind;
    return (
      <div onClick={() => onOpenTicket(t)}
        style={{ display: "grid", gridTemplateColumns: "72px minmax(0,1fr) auto", gap: 14, alignItems: "center", padding: "11px 16px", borderTop: `1px solid ${C.border}`, cursor: "pointer" }}
        onMouseEnter={(e) => (e.currentTarget.style.background = C.surfaceMuted)}
        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
        <span style={{ fontFamily: MONO, fontSize: 12, color: C.textSecondary }}>{t.code}</span>
        <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, flexWrap: "wrap" }}>
            {client?.vip && <VipPill vip />}
            {t.isPaidWork && <PaidBadge />}
            <span style={{ fontSize: 14, fontWeight: 500, color: C.textPrimary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.text}</span>
            {t.newMessageCount > 0 && (
              <button onClick={(e) => { e.stopPropagation(); markSeen(t); }} title="Отметить прочитанным"
                style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "2px 8px", borderRadius: 999, fontSize: 11, fontWeight: 600, color: C.green, background: C.greenSoft, border: `1px solid ${C.greenBorder}`, whiteSpace: "nowrap", cursor: "pointer" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = C.greenBorder)}
                onMouseLeave={(e) => (e.currentTarget.style.background = C.greenSoft)}>
                <span style={{ width: 5, height: 5, borderRadius: "50%", background: C.green, display: "inline-block" }} />
                {t.newMessageCount} {pluralRu(t.newMessageCount, "новое", "новых", "новых")}
              </button>
            )}
          </div>
          <div style={{ fontSize: 12, color: C.textSecondary, display: "flex", gap: 6, flexWrap: "wrap" }}>
            <span>{client?.name || "—"}</span><span style={{ color: C.borderStrong }}>·</span><span>{t.category}</span>
            {t.promiseText && <><span style={{ color: C.borderStrong }}>·</span><span style={{ color: C.amber }}>{t.promiseText}</span></>}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3 }}>
          {group === "prev" && (
            <span style={{ fontFamily: MONO, fontSize: 10.5, color: C.textFaint, whiteSpace: "nowrap" }}>создано {dateLabel(t.daysAgo)}</span>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {rk === "no_response" && (
              <span style={{ display: "flex", alignItems: "center", gap: 5, fontFamily: MONO, fontSize: 12, color: t.waitMin > 60 ? C.red : C.amber, whiteSpace: "nowrap" }}>
                <span style={{ width: 5, height: 5, borderRadius: "50%", background: t.waitMin > 60 ? C.red : C.amber, display: "inline-block" }} />
                без ответа · {formatWaitMinutes(t.waitMin)}
              </span>
            )}
            {rk === "waiting_us" && (
              <span style={{ fontFamily: MONO, fontSize: 12, color: C.textSecondary, whiteSpace: "nowrap" }}>ждёт {formatWaitMinutes(t.waitMin)}</span>
            )}
            {rk === "waiting_client" && (
              <span style={{ fontFamily: MONO, fontSize: 12, color: t.waitMin > 60 ? C.amber : C.textSecondary, whiteSpace: "nowrap" }}>1-й ответ за {formatWaitMinutes(t.waitMin)}</span>
            )}
            {t.status !== "closed" && (
              <button onClick={(e) => { e.stopPropagation(); closeWithUndo(t); }} title="Закрыть обращение"
                style={{ height: 24, padding: "0 8px", border: `1px solid ${C.border}`, borderRadius: 6, background: C.surface, color: C.green, fontSize: 12, fontWeight: 500, cursor: "pointer", display: "flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}>
                ✓ Закрыть
              </button>
            )}
            {t.status === "closed" && (
              <button onClick={(e) => { e.stopPropagation(); setStatus(t.id, "open"); }}
                style={{ height: 24, padding: "0 8px", border: "none", borderRadius: 6, background: "transparent", color: C.textSecondary, fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" }}>
                Вернуть в работу
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div style={{ padding: "0 0 44px" }}>
      <div style={{ position: "sticky", top: 0, zIndex: 5, background: C.bg, borderBottom: `1px solid ${C.border}`, padding: "14px 28px", display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, letterSpacing: "-0.3px", color: C.textPrimary }}>Пульс поддержки</h1>

        <div style={{ display: "flex", alignItems: "center", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, height: 32 }}>
          <button onClick={() => setSelectedDate(shiftDateStr(selectedDate, -1))}
            style={{ border: "none", background: "transparent", width: 30, height: 30, cursor: "pointer", color: C.textSecondary, fontSize: 15 }}>‹</button>
          <input type="date" value={selectedDate} max={isoToday()} onChange={(e) => e.target.value && setSelectedDate(e.target.value)}
            style={{ border: "none", background: "transparent", fontFamily: MONO, fontSize: 12, padding: "0 4px", color: C.textPrimary, cursor: "pointer", width: 118 }} />
          {isToday && <span style={{ fontSize: 12, color: C.textSecondary, paddingRight: 6 }}>сегодня</span>}
          <button onClick={() => canGoNext && setSelectedDate(shiftDateStr(selectedDate, 1))} disabled={!canGoNext}
            style={{ border: "none", background: "transparent", width: 30, height: 30, cursor: canGoNext ? "pointer" : "default", color: canGoNext ? C.textSecondary : C.borderStrong, fontSize: 15 }}>›</button>
        </div>

        {lastUpdated && (
          <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, color: C.textSecondary }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: C.green }} />
            <span>Обновлено {formatRelativeTime(lastUpdated)}</span>
          </div>
        )}

        <div style={{ flex: 1 }} />

        <button onClick={() => setAiEnabled(!aiEnabled)}
          style={{ display: "flex", alignItems: "center", gap: 9, height: 30, padding: "0 11px 0 9px", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, cursor: "pointer", color: C.textPrimary, fontSize: 12.5, transition: "border-color .12s" }}
          onMouseEnter={(e) => (e.currentTarget.style.borderColor = C.accent)}
          onMouseLeave={(e) => (e.currentTarget.style.borderColor = C.border)}>
          <ToggleSwitch on={aiEnabled} onClick={() => setAiEnabled(!aiEnabled)} size="sm" />
          <span>ИИ-ассистент</span>
          <span style={{ fontSize: 11.5, color: aiConfigured ? C.green : C.amber }}>{aiConfigured ? "подключен" : "не настроен"}</span>
        </button>
      </div>

      <main style={{ padding: "20px 28px 0", display: "flex", flexDirection: "column", gap: 16 }}>

        {aiEnabled && aiConfigured && (
          <section style={{ background: C.accentSoft, border: `1px solid ${C.accentBorder}`, borderRadius: 10, padding: "12px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: C.green, whiteSpace: "nowrap" }}>Сводка от ИИ</span>
              {!summaryOpen && (
                <span style={{ flex: 1, minWidth: 200, fontSize: 13, color: C.textPrimary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {digest.summary_text || "Сводка ещё не собрана — нажмите «Перегенерировать»."}
                </span>
              )}
              {summaryOpen && <span style={{ flex: 1 }} />}
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <button onClick={() => setSummaryOpen(!summaryOpen)} style={{ height: 28, padding: "0 10px", border: "none", background: "transparent", color: C.green, fontSize: 12, cursor: "pointer", borderRadius: 6 }}>
                  {summaryOpen ? "Свернуть" : "Развернуть"}
                </button>
                <button onClick={regenerate} disabled={regenerating} style={{ height: 28, padding: "0 10px", border: `1px solid ${C.accentBorder}`, background: C.surface, color: C.green, fontSize: 12, cursor: "pointer", borderRadius: 6, opacity: regenerating ? 0.6 : 1 }}>
                  {regenerating ? "Собираю…" : "Перегенерировать"}
                </button>
                {isToday && (
                  <button onClick={send} disabled={sending} style={{ height: 28, padding: "0 12px", border: "none", background: C.accent, color: "#fff", fontSize: 12, fontWeight: 500, cursor: "pointer", borderRadius: 6, opacity: sending ? 0.6 : 1 }}>
                    {sending ? "Отправляю…" : "Отправить в чат"}
                  </button>
                )}
              </div>
            </div>
            {summaryOpen && (
              <div style={{ fontSize: 13.5, lineHeight: 1.6, color: C.textPrimary, maxWidth: 900 }}>
                {digest.summary_text || "Сводка ещё не собрана — нажмите «Перегенерировать»."}
              </div>
            )}
          </section>
        )}

        {aiEnabled && !aiConfigured && (
          <section style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "9px 14px", border: `1px dashed ${C.borderStrong}`, borderRadius: 10, fontSize: 13, color: C.textSecondary }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: C.borderStrong }} />
            <span style={{ flex: 1, minWidth: 240 }}>ИИ не настроен — добавьте ключ провайдера в настройках, чтобы получать сводки и подсказки.</span>
            {onGoSettings && (
              <button onClick={onGoSettings} style={{ border: "none", background: "none", color: C.accent, cursor: "pointer", fontSize: 13, padding: 0 }}>Перейти в настройки</button>
            )}
            <button onClick={() => setAiEnabled(false)} style={{ border: "none", background: "transparent", color: C.textSecondary, fontSize: 12, cursor: "pointer" }}>Скрыть ИИ-блоки</button>
          </section>
        )}

        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          <section style={{ flex: "1 1 420px", display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontSize: 12, color: C.textSecondary, fontWeight: 500 }}>Требуют внимания</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 8 }}>
              <button onClick={() => setTab("open")} style={{ textAlign: "left", background: C.surface, border: `1px solid ${tab === "open" ? C.amberBorder : C.border}`, borderRadius: 10, padding: "12px 14px", cursor: "pointer", display: "flex", flexDirection: "column", gap: 4, font: "inherit", color: "inherit" }}>
                <span style={{ fontFamily: MONO, fontSize: 24, fontWeight: 600, color: C.amber }}>{open.length}</span>
                <span style={{ fontSize: 12, color: C.textSecondary }}>Открыто сейчас</span>
              </button>
              <button onClick={() => setTab("prev")} style={{ textAlign: "left", background: C.surface, border: `1px solid ${tab === "prev" ? C.redBorder : C.border}`, borderRadius: 10, padding: "12px 14px", cursor: "pointer", display: "flex", flexDirection: "column", gap: 4, font: "inherit", color: "inherit" }}>
                <span style={{ fontFamily: MONO, fontSize: 24, fontWeight: 600, color: C.red }}>{previousOpen.length}</span>
                <span style={{ fontSize: 12, color: C.textSecondary }}>С прошлых дней</span>
              </button>
              <Card style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 4, border: overdueObligations.length ? `1px solid ${C.redBorder}` : `1px solid ${C.border}` }}>
                <span style={{ fontFamily: MONO, fontSize: 24, fontWeight: 600, color: overdueObligations.length ? C.red : C.textPrimary }}>{overdueObligations.length}</span>
                <span style={{ fontSize: 12, color: C.textSecondary }}>Просрочено обязательств</span>
              </Card>
            </div>
          </section>

          <section style={{ flex: "1.35 1 560px", display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontSize: 12, color: C.textSecondary, fontWeight: 500 }}>Итоги дня</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 8 }}>
              <Card style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontFamily: MONO, fontSize: 24, fontWeight: 600, color: C.textPrimary }}>{digest.total}</span>
                  {totalDelta !== 0 && (
                    <span title={`Вчера: ${yesterdayTickets.length}`} style={{ fontSize: 12, fontWeight: 500, color: totalDelta > 0 ? C.amber : C.green, whiteSpace: "nowrap" }}>
                      {totalDelta > 0 ? "↑" : "↓"} {Math.abs(totalDelta)} к вчера
                    </span>
                  )}
                </span>
                <span style={{ fontSize: 12, color: C.textSecondary }}>Обращений всего</span>
              </Card>
              <button onClick={() => setTab("closed")} style={{ textAlign: "left", background: C.surface, border: `1px solid ${tab === "closed" ? C.accentBorder : C.border}`, borderRadius: 10, padding: "12px 14px", cursor: "pointer", display: "flex", flexDirection: "column", gap: 4, font: "inherit", color: "inherit" }}>
                <span style={{ fontFamily: MONO, fontSize: 24, fontWeight: 600, color: C.green }}>{digest.closed_count}</span>
                <span style={{ fontSize: 12, color: C.textSecondary }}>Закрыто</span>
              </button>
              <Card style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontFamily: MONO, fontSize: 24, fontWeight: 600, color: C.textPrimary }}>{activeToday}</span>
                  {activeDelta !== 0 && (
                    <span title={`Вчера: ${activeYesterday}`} style={{ fontSize: 12, fontWeight: 500, color: activeDelta > 0 ? C.amber : C.green, whiteSpace: "nowrap" }}>
                      {activeDelta > 0 ? "↑" : "↓"} {Math.abs(activeDelta)} к вчера
                    </span>
                  )}
                </span>
                <span style={{ fontSize: 12, color: C.textSecondary }}>Активных чатов</span>
              </Card>
              <Card style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                  <span style={{ fontFamily: MONO, fontSize: 24, fontWeight: 600, color: C.textPrimary }}>{avgWait}</span>
                  <span style={{ fontSize: 12, color: C.textSecondary }}>мин</span>
                </span>
                <span style={{ fontSize: 12, color: C.textSecondary }}>Среднее время ответа</span>
              </Card>
            </div>
          </section>
        </div>

        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}>

          <section style={{ flex: "3 1 620px", minWidth: 0, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "12px 16px", borderBottom: `1px solid ${C.border}` }}>
              <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: C.textPrimary }}>Очередь</h2>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {tabs.map((tb) => (
                  <button key={tb.key} onClick={() => setTab(tb.key)}
                    style={{ height: 28, padding: "0 10px", borderRadius: 6, border: `1px solid ${tab === tb.key ? C.accentBorder : C.border}`, background: tab === tb.key ? C.accentSoft : C.surface, color: tab === tb.key ? C.accent : C.textSecondary, fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
                    <span>{tb.label}</span>
                    <span style={{ fontFamily: MONO, fontSize: 11, opacity: 0.75 }}>{tb.count}</span>
                  </button>
                ))}
              </div>
              <div style={{ flex: 1 }} />
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                <SearchBox value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Поиск: тикет, клиент, текст" style={{ width: 200 }} />
                <button onClick={() => setVipOnly(!vipOnly)}
                  style={{ height: 28, padding: "0 10px", borderRadius: 6, border: `1px solid ${vipOnly ? C.amberBorder : C.border}`, background: vipOnly ? C.amberSoft : C.surface, color: vipOnly ? C.amber : C.textSecondary, fontSize: 12, cursor: "pointer" }}>
                  VIP
                </button>
                <button onClick={() => setHasNewOnly(!hasNewOnly)}
                  style={{ height: 28, padding: "0 10px", borderRadius: 6, border: `1px solid ${hasNewOnly ? C.accentBorder : C.border}`, background: hasNewOnly ? C.accentSoft : C.surface, color: hasNewOnly ? C.green : C.textSecondary, fontSize: 12, cursor: "pointer" }}>
                  Есть новые сообщения
                </button>
                <MultiSelect options={categoryOptions} selected={categoryFilter} onChange={setCategoryFilter} placeholder="Категория" width={170} searchable />
                <MultiSelect options={tariffOptions} selected={tariffFilter} onChange={setTariffFilter} placeholder="Тариф" width={140} searchable />
                <MultiSelect options={statusOptions} selected={statusFilter} onChange={setStatusFilter} placeholder="Статус подписки" width={170} searchable />
                <MultiSelect options={clientOptions} selected={clientFilter} onChange={setClientFilter} placeholder="Клиент" width={180} searchable />
              </div>
            </div>

            {groups.map((g) => {
              const isCollapsed = collapsedGroups.has(g.key);
              return (
                <div key={g.key}>
                  <div onClick={() => toggleGroup(g.key)}
                    style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 16px", background: C.surfaceMuted, borderBottom: `1px solid ${C.border}`, cursor: "pointer" }}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: g.dot }} />
                    <span style={{ fontSize: 12, fontWeight: 600, color: g.dot }}>{g.title}</span>
                    <span style={{ flex: 1 }} />
                    <span style={{ fontFamily: MONO, fontSize: 11, color: C.textFaint }}>{g.items.length}</span>
                    {isCollapsed ? <ChevronDown size={13} color={C.textFaint} /> : <ChevronUp size={13} color={C.textFaint} />}
                  </div>
                  {!isCollapsed && g.items.map((t) => <TicketRow key={t.id} t={t} group={g.key} />)}
                </div>
              );
            })}

            {waitingClient.length > 0 && (tab === "all" || tab === "waiting") && (
              <div>
                <div onClick={() => tab === "all" && setWaitingExpanded(!waitingExpanded)}
                  style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 16px", background: C.surfaceMuted, borderBottom: `1px solid ${C.border}`, cursor: tab === "all" ? "pointer" : "default" }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#3f7a63" }} />
                  <span style={{ fontSize: 12, fontWeight: 600, color: "#3f7a63" }}>Ждут ответа клиента</span>
                  <span style={{ flex: 1 }} />
                  <span style={{ fontFamily: MONO, fontSize: 11, color: C.textFaint }}>{waitingClient.length}</span>
                  {tab === "all" && (waitingExpanded ? <ChevronUp size={13} color={C.textFaint} /> : <ChevronDown size={13} color={C.textFaint} />)}
                </div>
                {(tab === "waiting" || waitingExpanded) && waitingClient.map((t) => <TicketRow key={t.id} t={t} group="waiting" />)}
              </div>
            )}

            {showClosedGroup && (
              <div>
                <div onClick={() => toggleGroup("closed")}
                  style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 16px", background: C.surfaceMuted, borderBottom: `1px solid ${C.border}`, cursor: "pointer" }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: C.green }} />
                  <span style={{ fontSize: 12, fontWeight: 600, color: C.green }}>Закрытые</span>
                  <span style={{ flex: 1 }} />
                  <span style={{ fontFamily: MONO, fontSize: 11, color: C.textFaint }}>{closedToday.length}</span>
                  {collapsedGroups.has("closed") ? <ChevronDown size={13} color={C.textFaint} /> : <ChevronUp size={13} color={C.textFaint} />}
                </div>
                {!collapsedGroups.has("closed") && closedToday.map((t) => <TicketRow key={t.id} t={t} group="closed" />)}
              </div>
            )}

            {queueEmpty && (
              <div style={{ padding: "48px 16px", textAlign: "center", display: "flex", flexDirection: "column", gap: 6, alignItems: "center" }}>
                <span style={{ fontSize: 15, fontWeight: 500, color: C.textPrimary }}>Здесь пусто</span>
                <span style={{ fontSize: 13, color: C.textFaint }}>Нет обращений по выбранным условиям</span>
              </div>
            )}
          </section>

          <aside style={{ flex: "1 1 320px", minWidth: 0, display: "flex", flexDirection: "column", gap: 16 }}>
            {overdueObligations.length > 0 && (
              <section style={{ background: C.surface, border: `1px solid ${C.redBorder}`, borderRadius: 10, overflow: "hidden" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 16px", borderBottom: `1px solid ${C.redBorder}`, background: C.redSoft }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: C.red }} />
                  <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: C.red }}>Просроченные обязательства</h3>
                  <span style={{ flex: 1 }} />
                  <span style={{ fontFamily: MONO, fontSize: 11, color: C.red }}>{overdueObligations.length}</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column" }}>
                  {overdueObligations.map((t, i) => (
                    <div key={t.id} onClick={() => onOpenTicket(t)} style={{ display: "flex", flexDirection: "column", gap: 6, padding: "12px 16px", borderTop: i === 0 ? "none" : `1px solid ${C.border}`, cursor: "pointer" }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = C.redSoft)}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                      <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                        {t.isPaidWork && <PaidBadge />}
                        <span style={{ fontSize: 14, fontWeight: 500, lineHeight: 1.4, color: C.textPrimary }}>{t.text}</span>
                      </span>
                      <div style={{ fontSize: 12, color: C.textSecondary, display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <span style={{ fontFamily: MONO }}>{t.code}</span><span style={{ color: C.borderStrong }}>·</span><span>{clientsById[t.clientId]?.name || "—"}</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginTop: 2 }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: C.red, whiteSpace: "nowrap" }}>
                          просрочено на {Math.abs(daysUntil(t.dueDate))} {pluralRu(Math.abs(daysUntil(t.dueDate)), "день", "дня", "дней")}
                        </span>
                        <span style={{ fontSize: 12, color: C.textSecondary, whiteSpace: "nowrap" }}>срок <span style={{ fontFamily: MONO, color: C.red }}>{t.dueDate}</span></span>
                      </div>
                      {t.jiraUrl && <span style={{ minWidth: 0, overflow: "hidden" }}><JiraLink value={t.jiraUrl} baseUrl={jiraBaseUrl} /></span>}
                    </div>
                  ))}
                </div>
              </section>
            )}
            {promisesSoon.length > 0 && (
              <section style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 16px", borderBottom: `1px solid ${C.border}` }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: C.amber }} />
                  <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: C.amber }}>Ближайшие обязательства · 3 дня</h3>
                  <span style={{ flex: 1 }} />
                  <span style={{ fontFamily: MONO, fontSize: 11, color: C.textFaint }}>{promisesSoon.length}</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column" }}>
                  {promisesSoon.map((p, i) => (
                    <div key={p.ticket_id} onClick={() => onOpenTicketId(p.ticket_id)}
                      style={{ display: "flex", flexDirection: "column", gap: 4, padding: "12px 16px", borderTop: i === 0 ? "none" : `1px solid ${C.border}`, cursor: "pointer" }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = C.surfaceMuted)}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
                        <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                          {p.is_paid_work && <PaidBadge />}
                          <span style={{ fontSize: 14, fontWeight: 500, color: C.textPrimary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.text}</span>
                        </span>
                        <span style={{ fontFamily: MONO, fontSize: 12, color: C.amber, whiteSpace: "nowrap" }}>{daysUntil(p.due_date) === 0 ? "сегодня" : daysUntil(p.due_date) === 1 ? "завтра" : p.due_date}</span>
                      </div>
                      <div style={{ fontSize: 12, color: C.textSecondary, display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <span style={{ fontFamily: MONO }}>{p.code}</span><span style={{ color: C.borderStrong }}>·</span><span>{clientsById[p.client_id]?.name || "—"}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {scheduledWithJira.length > 0 && (
              <section style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 16px", borderBottom: `1px solid ${C.border}` }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: C.green }} />
                  <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: C.green }}>Обязательства</h3>
                  <span style={{ flex: 1 }} />
                  <span style={{ fontFamily: MONO, fontSize: 11, color: C.textFaint }}>{scheduledWithJira.length}</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column" }}>
                  {scheduledWithJira.map((t, i) => (
                    <div key={t.id} onClick={() => onOpenTicket(t)} style={{ display: "flex", flexDirection: "column", gap: 6, padding: "12px 16px", borderTop: i === 0 ? "none" : `1px solid ${C.border}`, cursor: "pointer" }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = C.surfaceMuted)}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                      <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                        {t.isPaidWork && <PaidBadge />}
                        <span style={{ fontSize: 14, fontWeight: 500, lineHeight: 1.4, color: C.textPrimary }}>{t.text}</span>
                      </span>
                      <div style={{ fontSize: 12, color: C.textSecondary, display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <span style={{ fontFamily: MONO }}>{t.code}</span><span style={{ color: C.borderStrong }}>·</span><span>{clientsById[t.clientId]?.name || "—"}</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginTop: 2 }}>
                        <span style={{ minWidth: 0, overflow: "hidden" }}><JiraLink value={t.jiraUrl} baseUrl={jiraBaseUrl} /></span>
                        <span style={{ fontSize: 12, color: C.textSecondary, whiteSpace: "nowrap" }}>срок <span style={{ fontFamily: MONO, color: C.green }}>{t.dueDate}</span></span>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </aside>
        </div>
      </main>

      {toast && (
        <div style={{ position: "fixed", left: "50%", bottom: 24, transform: "translateX(-50%)", zIndex: 60, display: "flex", alignItems: "center", gap: 16, background: C.ink, color: "#fff", borderRadius: 8, padding: "10px 12px 10px 16px", fontSize: 13, boxShadow: "0 6px 24px rgba(0,0,0,.25)" }}>
          <span><span style={{ fontFamily: MONO }}>{toast.code}</span> закрыто</span>
          <button onClick={undoClose} style={{ border: "none", background: "rgba(255,255,255,.14)", color: "#fff", height: 26, padding: "0 10px", borderRadius: 5, fontSize: 12, cursor: "pointer" }}>Отменить</button>
        </div>
      )}
    </div>
  );
}

/* ---------- Promises page ---------- */

function PromisesPage({ refreshTick, onDataChanged, clientsById, onOpenTicketId, jiraBaseUrl }) {
  const [promises, setPromises] = useState(null);
  const [error, setError] = useState(null);
  const [statusFilter, setStatusFilter] = useState("active"); // active | closed | all
  const [soonOnly, setSoonOnly] = useState(false);
  const [vipOnly, setVipOnly] = useState(false);
  const [paidOnly, setPaidOnly] = useState(false);
  const [clientFilter, setClientFilter] = useState([]);
  const [chatFilter, setChatFilter] = useState([]);

  const load = useCallback(() => {
    setError(null);
    api.getPromises().then(setPromises).catch((e) => setError(e.message));
  }, []);
  useEffect(() => { load(); }, [load, refreshTick]);

  if (error) return <div style={{ padding: "26px 28px" }}><ErrorBlock message={error} onRetry={load} /></div>;
  if (!promises) return <LoadingBlock label="Загружаю обещания…" />;

  const markDone = async (ticketId) => {
    try {
      await api.markPromiseDone(ticketId);
      onDataChanged();
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  const clientOptions = Object.values(clientsById).sort((a, b) => a.name.localeCompare(b.name)).map((c) => ({ value: c.id, label: c.name }));
  const chatOptions = [...new Set(Object.values(clientsById).map((c) => c.chat_label).filter(Boolean))].sort().map((c) => ({ value: c, label: c }));

  const filtered = promises.filter((p) => {
    if (statusFilter === "active" && p.status === "closed") return false;
    if (statusFilter === "closed" && p.status !== "closed") return false;
    if (soonOnly && !(p.due_date && daysUntil(p.due_date) <= 3)) return false;
    if (vipOnly && !clientsById[p.client_id]?.vip) return false;
    if (paidOnly && !p.is_paid_work) return false;
    if (clientFilter.length && !clientFilter.includes(p.client_id)) return false;
    if (chatFilter.length && !chatFilter.includes(clientsById[p.client_id]?.chat_label)) return false;
    return true;
  });

  const groups = [
    { title: "Просрочены", bucket: "overdue", color: C.red },
    { title: "Срок сегодня", bucket: "today", color: C.amber },
    { title: "Предстоящие", bucket: "week", color: C.accent },
    { title: "Выполнены", bucket: "done", color: C.green },
  ].map((g) => ({ ...g, items: filtered.filter((p) => p.bucket === g.bucket) })).filter((g) => g.items.length);

  return (
    <div style={{ padding: "26px 28px 44px" }}>
      <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: C.textPrimary, letterSpacing: "-0.4px" }}>Обещания</h1>
      <div style={{ fontSize: 13, color: C.textSecondary, marginTop: 6, marginBottom: 16 }}>
        Тикеты со сроком исполнения — то, что мы должны клиентам
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 18, alignItems: "center" }}>
        <div style={{ display: "flex", gap: 3, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: 3 }}>
          <SegButton active={statusFilter === "active"} onClick={() => setStatusFilter("active")}>Открытые</SegButton>
          <SegButton active={statusFilter === "closed"} onClick={() => setStatusFilter("closed")}>Закрытые</SegButton>
          <SegButton active={statusFilter === "all"} onClick={() => setStatusFilter("all")}>Все</SegButton>
        </div>
        <button onClick={() => setSoonOnly(!soonOnly)}
          style={{ padding: "7px 12px", borderRadius: 7, fontSize: 12.5, cursor: "pointer", background: soonOnly ? C.amberSoft : C.surface, border: `1px solid ${soonOnly ? C.amberBorder : C.border}`, color: soonOnly ? C.amber : C.textSecondary }}>
          Срок ≤ 3 дней
        </button>
        <button onClick={() => setVipOnly(!vipOnly)}
          style={{ padding: "7px 12px", borderRadius: 7, fontSize: 12.5, cursor: "pointer", background: vipOnly ? C.amberSoft : C.surface, border: `1px solid ${vipOnly ? C.amberBorder : C.border}`, color: vipOnly ? C.amber : C.textSecondary }}>
          VIP
        </button>
        <button onClick={() => setPaidOnly(!paidOnly)}
          style={{ padding: "7px 12px", borderRadius: 7, fontSize: 12.5, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, background: paidOnly ? C.greenSoft : C.surface, border: `1px solid ${paidOnly ? C.greenBorder : C.border}`, color: paidOnly ? C.green : C.textSecondary }}>
          <Banknote size={12} /> Платная доработка
        </button>
        <MultiSelect options={clientOptions} selected={clientFilter} onChange={setClientFilter} placeholder="Клиент" width={220} />
        <MultiSelect options={chatOptions} selected={chatFilter} onChange={setChatFilter} placeholder="Чат в TG" width={220} />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        {groups.map((g) => (
          <div key={g.title}>
            <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 10 }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: g.color }} />
              <div style={{ fontSize: 13, fontWeight: 600, color: g.color }}>{g.title}</div>
              <span style={{ fontFamily: MONO, fontSize: 11.5, color: C.textFaint }}>{g.items.length}</span>
            </div>
            <Card style={{ overflow: "hidden" }}>
              <div style={{ overflowX: "auto" }}>
                <div style={{ minWidth: 720 }}>
                  {g.items.map((p, i) => (
                    <div key={p.ticket_id} onClick={() => onOpenTicketId(p.ticket_id)}
                      style={{ display: "grid", gridTemplateColumns: "100px 120px minmax(200px,1fr) 120px 130px 90px", gap: 12, alignItems: "center", padding: "13px 16px", borderTop: i === 0 ? "none" : `1px solid ${C.border}`, cursor: "pointer" }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = C.surfaceMuted)}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                      <div style={{ fontFamily: MONO, fontSize: 12, color: C.textSecondary }}>{p.code}</div>
                      <div style={{ fontSize: 12, color: C.textSecondary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.category}</div>
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                          <span style={{ fontSize: 13, color: C.textPrimary }}>{p.text}</span>
                          {p.is_paid_work && <PaidBadge />}
                        </div>
                        <div style={{ fontSize: 11.5, color: C.textFaint, marginTop: 3, display: "flex", alignItems: "center", gap: 6 }}>
                          {clientsById[p.client_id]?.name || "—"} {clientsById[p.client_id]?.vip && <VipPill vip />}
                          {clientsById[p.client_id]?.chat_label && <span>· «{clientsById[p.client_id].chat_label}»</span>}
                        </div>
                      </div>
                      <div style={{ fontFamily: MONO, fontSize: 12, color: g.color }}>{p.due_date}</div>
                      <div style={{ minWidth: 0, overflow: "hidden" }}><JiraLink value={p.jira_url} baseUrl={jiraBaseUrl} /></div>
                      <div style={{ textAlign: "right" }}>
                        {p.status !== "closed" && (
                          <button onClick={(e) => { e.stopPropagation(); markDone(p.ticket_id); }}
                            style={{ padding: "5px 10px", border: `1px solid ${C.border}`, borderRadius: 7, background: "transparent", fontSize: 11.5, cursor: "pointer", color: C.textSecondary }}>
                            Выполнено
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </Card>
          </div>
        ))}
        {groups.length === 0 && <div style={{ fontSize: 13, color: C.textFaint }}>Обещаний по этому фильтру нет.</div>}
      </div>
    </div>
  );
}

/* ---------- Analytics page ---------- */

const BUCKET_META = {
  new: { title: "Новые клиенты", hint: `подключены < ${60} дней назад`, color: C.accent },
  active: { title: "Действующие клиенты", hint: "подключены давно, писали в одном или обоих периодах", color: C.green },
  churned: { title: "Замолчавшие", hint: "писали в прошлом периоде, в этом — тишина", color: C.red },
};

function DeltaPill({ value, pct }) {
  const positive = value > 0;
  const zero = value === 0;
  // Рост числа обращений — тревожный сигнал (больше нагрузки на поддержку),
  // снижение — хороший. Красим так же, как везде в приложении: кирпичный
  // для роста, зелёный для снижения — а не наоборот.
  const color = zero ? C.textSecondary : positive ? C.red : C.green;
  const bg = zero ? C.surfaceMuted : positive ? C.redSoft : C.greenSoft;
  const Icon = zero ? null : positive ? ChevronUp : ChevronDown;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, background: bg, color, fontFamily: MONO, fontSize: 13, fontWeight: 600, padding: "3px 9px", borderRadius: 6 }}>
      {Icon && <Icon size={13} />}
      {positive && value !== 0 ? "+" : ""}{value}
      {pct !== null && pct !== undefined && <span style={{ opacity: 0.75 }}>&nbsp;({positive ? "+" : ""}{pct}%)</span>}
    </span>
  );
}

function AnalyticsPage({ clientsById, onOpenClient, refreshTick }) {
  const [period, setPeriod] = useState("7");
  const [customFrom, setCustomFrom] = useState(isoDaysAgo(6));
  const [customTo, setCustomTo] = useState(isoToday());
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [openBucket, setOpenBucket] = useState(null);
  const loadedKeyRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    const key = `${period}|${customFrom}|${customTo}`;
    const isNavigation = loadedKeyRef.current !== key;
    if (isNavigation) {
      setData(null);
      setOpenBucket(null);
    }
    api.getPeriodComparison(periodParams(period, customFrom, customTo))
      .then((d) => { if (cancelled) return; loadedKeyRef.current = key; setData(d); })
      .catch((e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [period, customFrom, customTo, refreshTick]);

  if (error) return <div style={{ padding: "26px 28px" }}><ErrorBlock message={error} /></div>;
  if (!data) return <LoadingBlock label="Считаю аналитику…" />;

  const buckets = [
    { key: "new", value: data.new_clients_delta },
    { key: "active", value: data.active_clients_delta },
    { key: "churned", value: data.churned_delta },
  ];
  const maxCatCount = Math.max(...data.categories.map((c) => Math.max(c.current_count, c.previous_count)), 1);
  const bucketClients = openBucket ? data.clients.filter((c) => c.bucket === openBucket) : [];

  return (
    <div style={{ padding: "26px 28px 44px" }}>
      <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: C.textPrimary, letterSpacing: "-0.4px" }}>Аналитика</h1>
      <div style={{ fontSize: 13, color: C.textSecondary, marginTop: 6, marginBottom: 18 }}>
        Сравнение с предыдущим периодом такой же длины — что изменилось и за счёт чего
      </div>

      <div style={{ marginBottom: 20 }}>
        <PeriodSelector period={period} setPeriod={setPeriod} customFrom={customFrom} customTo={customTo} setCustomFrom={setCustomFrom} setCustomTo={setCustomTo} />
      </div>

      <Card style={{ padding: "18px 20px", marginBottom: 16 }}>
        <div style={{ fontSize: 11.5, color: C.textFaint, fontFamily: MONO, marginBottom: 10 }}>
          {data.current_start} — {data.current_end} · сравнение с {data.previous_start} — {data.previous_end}
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap" }}>
          <span style={{ fontFamily: MONO, fontSize: 34, fontWeight: 600, color: C.textPrimary }}>{data.current_total}</span>
          <DeltaPill value={data.delta} pct={data.delta_pct} />
          <span style={{ fontSize: 12.5, color: C.textSecondary }}>
            обращений за период{data.previous_total > 0 ? `, было ${data.previous_total}` : " — нет предыдущего периода для сравнения"}
          </span>
        </div>
      </Card>

      <div style={{ fontSize: 11, letterSpacing: "0.05em", textTransform: "uppercase", color: C.textFaint, marginBottom: 10 }}>За счёт чего</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 11, marginBottom: 12 }}>
        {buckets.map((b) => {
          const meta = BUCKET_META[b.key];
          const active = openBucket === b.key;
          const count = data.clients.filter((c) => c.bucket === b.key).length;
          return (
            <div key={b.key} onClick={() => setOpenBucket(active ? null : b.key)}
              style={{ background: C.surface, border: `1px solid ${active ? meta.color : C.border}`, borderRadius: CARD_RADIUS, padding: "13px 15px", cursor: count ? "pointer" : "default", opacity: count ? 1 : 0.55 }}>
              <div style={{ fontFamily: MONO, fontSize: 20, fontWeight: 600, color: C.textPrimary }}>
                {b.value > 0 ? "+" : ""}{b.value}
              </div>
              <div style={{ fontSize: 12, color: C.textPrimary, fontWeight: 500, marginTop: 4 }}>{meta.title}</div>
              <div style={{ fontSize: 10.5, color: C.textFaint, marginTop: 2 }}>{meta.hint} · {count} {count === 1 ? "клиент" : "клиентов"}</div>
            </div>
          );
        })}
      </div>

      {openBucket && (
        <Card style={{ overflow: "hidden", marginBottom: 20 }}>
          <div style={{ padding: "11px 16px", background: C.surfaceMuted, borderBottom: `1px solid ${C.border}`, fontSize: 12.5, fontWeight: 600, color: C.textPrimary, display: "flex", alignItems: "center", gap: 8 }}>
            {BUCKET_META[openBucket].title}
            <button onClick={() => setOpenBucket(null)} style={{ marginLeft: "auto", background: "none", border: "none", color: C.textFaint, cursor: "pointer" }}><X size={14} /></button>
          </div>
          <div style={{ overflowX: "auto" }}>
            <div style={{ minWidth: 480 }}>
              {bucketClients.length === 0 && <div style={{ padding: "18px 16px", fontSize: 12.5, color: C.textFaint }}>Нет клиентов в этой группе.</div>}
              {bucketClients.map((c, i) => (
                <div key={c.client_id} onClick={() => onOpenClient(c.client_id)}
                  style={{ display: "grid", gridTemplateColumns: "1.4fr 90px 90px 90px", gap: 12, alignItems: "center", padding: "11px 16px", borderTop: i === 0 ? "none" : `1px solid ${C.border}`, cursor: "pointer" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = C.surfaceMuted)}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                  <div style={{ fontSize: 13, color: C.textPrimary, display: "flex", alignItems: "center", gap: 6 }}>
                    {c.client_name} {clientsById[c.client_id]?.vip && <VipPill vip />}
                  </div>
                  <div style={{ fontFamily: MONO, fontSize: 12, color: C.textFaint }}>было {c.previous_count}</div>
                  <div style={{ fontFamily: MONO, fontSize: 12, color: C.textSecondary }}>стало {c.current_count}</div>
                  <div><DeltaPill value={c.delta} /></div>
                </div>
              ))}
            </div>
          </div>
        </Card>
      )}

      <div style={{ fontSize: 11, letterSpacing: "0.05em", textTransform: "uppercase", color: C.textFaint, marginBottom: 10 }}>По категориям</div>
      <Card style={{ overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <div style={{ minWidth: 520 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1.4fr 60px 60px 90px 1fr", gap: 10, padding: "9px 16px", background: C.surfaceMuted, fontSize: 10.5, textTransform: "uppercase", color: C.textFaint }}>
              <div>Категория</div><div>Было</div><div>Стало</div><div>Дельта</div><div />
            </div>
            {data.categories.map((c, i) => {
              const delta = c.current_count - c.previous_count;
              const pct = c.previous_count ? Math.round((delta / c.previous_count) * 100) : null;
              return (
                <div key={c.category} style={{ display: "grid", gridTemplateColumns: "1.4fr 60px 60px 90px 1fr", gap: 10, padding: "10px 16px", alignItems: "center", borderTop: i === 0 ? "none" : `1px solid ${C.border}` }}>
                  <div style={{ fontSize: 12.5, color: C.textPrimary }}>{c.category}</div>
                  <div style={{ fontFamily: MONO, fontSize: 12.5, color: C.textFaint }}>{c.previous_count}</div>
                  <div style={{ fontFamily: MONO, fontSize: 12.5, color: C.textSecondary }}>{c.current_count}</div>
                  <div style={{ fontFamily: MONO, fontSize: 12, color: delta > 0 ? C.red : delta < 0 ? C.green : C.textFaint }}>
                    {delta > 0 ? "+" : ""}{delta}{pct !== null ? ` (${pct > 0 ? "+" : ""}${pct}%)` : ""}
                  </div>
                  <div style={{ height: 5, background: C.surfaceMuted, borderRadius: 3, overflow: "hidden" }}>
                    <div style={{ width: `${(c.current_count / maxCatCount) * 100}%`, height: "100%", background: delta > 0 ? C.red : C.accent, borderRadius: 3 }} />
                  </div>
                </div>
              );
            })}
            {data.categories.length === 0 && <div style={{ padding: "20px 16px", fontSize: 12.5, color: C.textFaint }}>Нет данных за выбранный период.</div>}
          </div>
        </div>
      </Card>
    </div>
  );
}

/* ---------- Settings page ---------- */

/* ---------- Audit log page ---------- */

function AuditLogPage() {
  const [entries, setEntries] = useState(null);
  const [error, setError] = useState(null);
  const [actionFilter, setActionFilter] = useState([]);
  const [actions, setActions] = useState([]);
  const [offset, setOffset] = useState(0);
  const PAGE_SIZE = 50;

  useEffect(() => {
    api.getAuditActions().then(setActions).catch(() => {});
  }, []);

  const load = useCallback(() => {
    setError(null);
    api.getAuditLog({ limit: PAGE_SIZE, offset, action: actionFilter[0] })
      .then(setEntries)
      .catch((e) => setError(e.message));
  }, [offset, actionFilter]);
  useEffect(() => { load(); }, [load]);

  if (error) return <div style={{ padding: "26px 28px" }}><ErrorBlock message={error} onRetry={load} /></div>;
  if (!entries) return <LoadingBlock label="Загружаю журнал…" />;

  const actionOptions = actions.map((a) => ({ value: a, label: a }));

  return (
    <div style={{ padding: "26px 28px 44px" }}>
      <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: C.textPrimary, letterSpacing: "-0.4px" }}>Журнал действий</h1>
      <div style={{ fontSize: 13, color: C.textSecondary, marginTop: 6, marginBottom: 18 }}>Кто, что и когда менял в системе</div>

      <div style={{ marginBottom: 16 }}>
        <MultiSelect options={actionOptions} selected={actionFilter} onChange={(v) => { setActionFilter(v.slice(-1)); setOffset(0); }} placeholder="Тип действия" width={220} searchable />
      </div>

      <Card style={{ overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <div style={{ minWidth: 780 }}>
            <div style={{ display: "grid", gridTemplateColumns: "150px 180px 220px 1fr", gap: 12, padding: "10px 16px", background: C.surfaceMuted, borderBottom: `1px solid ${C.border}`, fontSize: 10.5, letterSpacing: "0.05em", textTransform: "uppercase", color: C.textFaint }}>
              <div>Когда</div><div>Кто</div><div>Действие</div><div>Детали</div>
            </div>
            {entries.map((e, i) => (
              <div key={e.id} style={{ display: "grid", gridTemplateColumns: "150px 180px 220px 1fr", gap: 12, padding: "11px 16px", borderTop: i === 0 ? "none" : `1px solid ${C.border}`, alignItems: "start" }}>
                <div style={{ fontFamily: MONO, fontSize: 11.5, color: C.textSecondary }}>{new Date(e.created_at).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</div>
                <div style={{ fontSize: 12.5, color: C.textPrimary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{e.user_email || "система"}</div>
                <div style={{ fontFamily: MONO, fontSize: 12, color: C.accent }}>{e.action}{e.target_id ? ` · ${e.target_id}` : ""}</div>
                <div style={{ fontSize: 11.5, color: C.textFaint, fontFamily: MONO, wordBreak: "break-all" }}>{e.details ? JSON.stringify(e.details) : ""}</div>
              </div>
            ))}
            {entries.length === 0 && <div style={{ padding: "40px 20px", textAlign: "center", fontSize: 13, color: C.textFaint }}>Записей пока нет</div>}
          </div>
        </div>
      </Card>

      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        <button onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))} disabled={offset === 0}
          style={{ padding: "7px 12px", border: `1px solid ${C.border}`, borderRadius: 7, background: C.surface, color: C.textSecondary, fontSize: 12.5, cursor: offset === 0 ? "default" : "pointer", opacity: offset === 0 ? 0.5 : 1 }}>
          ← Раньше
        </button>
        <button onClick={() => setOffset(offset + PAGE_SIZE)} disabled={entries.length < PAGE_SIZE}
          style={{ padding: "7px 12px", border: `1px solid ${C.border}`, borderRadius: 7, background: C.surface, color: C.textSecondary, fontSize: 12.5, cursor: entries.length < PAGE_SIZE ? "default" : "pointer", opacity: entries.length < PAGE_SIZE ? 0.5 : 1 }}>
          Позже →
        </button>
      </div>
    </div>
  );
}

function Settings({ onSaved, currentUser, onUserUpdated }) {
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState(null);
  const [savingKey, setSavingKey] = useState(null);
  const [promptsOpen, setPromptsOpen] = useState(false);
  const [agentIdsText, setAgentIdsText] = useState("");
  const [sendersOpen, setSendersOpen] = useState(false);
  const [senders, setSenders] = useState(null);
  const [sendersError, setSendersError] = useState(null);
  const [pendingAdds, setPendingAdds] = useState(new Set()); // добавлены в поле выше, но ещё не сохранены
  const [fixingId, setFixingId] = useState(null);
  const [fixResults, setFixResults] = useState({}); // tg_id -> текст результата

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPassword2, setNewPassword2] = useState("");
  const [pwSaving, setPwSaving] = useState(false);
  const [pwResult, setPwResult] = useState(null); // {ok, text}

  const [users, setUsers] = useState(null);
  const [usersError, setUsersError] = useState(null);
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserName, setNewUserName] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [creatingUser, setCreatingUser] = useState(false);
  const [userActionId, setUserActionId] = useState(null);

  const loadUsers = useCallback(() => {
    api.getUsers().then(setUsers).catch((e) => setUsersError(e.message));
  }, []);
  useEffect(() => { loadUsers(); }, [loadUsers]);

  const load = useCallback(() => {
    setError(null);
    api.getSettings()
      .then((data) => {
        setSettings(data);
        setAgentIdsText((data.agent_tg_ids || []).join(", "));
      })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => { load(); }, [load]);

  if (error) return <div style={{ padding: "26px 28px" }}><ErrorBlock message={error} onRetry={load} /></div>;
  if (!settings) return <LoadingBlock label="Загружаю настройки…" />;

  const submitPasswordChange = async (e) => {
    e.preventDefault();
    setPwResult(null);
    if (newPassword !== newPassword2) {
      setPwResult({ ok: false, text: "Пароли не совпадают" });
      return;
    }
    setPwSaving(true);
    try {
      await api.changePassword(currentUser.has_password ? currentPassword : null, newPassword);
      setPwResult({ ok: true, text: "Пароль изменён" });
      setCurrentPassword(""); setNewPassword(""); setNewPassword2("");
      if (onUserUpdated) onUserUpdated({ ...currentUser, has_password: true });
    } catch (e) {
      setPwResult({ ok: false, text: e.message });
    } finally {
      setPwSaving(false);
    }
  };

  const submitCreateUser = async (e) => {
    e.preventDefault();
    setUsersError(null);
    setCreatingUser(true);
    try {
      await api.createUser(newUserEmail.trim(), newUserName.trim(), newUserPassword);
      setNewUserEmail(""); setNewUserName(""); setNewUserPassword("");
      loadUsers();
    } catch (e) {
      setUsersError(e.message);
    } finally {
      setCreatingUser(false);
    }
  };

  const toggleUserActive = async (u) => {
    setUserActionId(u.id);
    try {
      if (u.is_active) await api.deactivateUser(u.id);
      else await api.activateUser(u.id);
      loadUsers();
    } catch (e) {
      setUsersError(e.message);
    } finally {
      setUserActionId(null);
    }
  };

  const resetPassword = async (u) => {
    const newPw = window.prompt(`Новый пароль для ${u.email} (не короче 8 символов):`);
    if (!newPw) return;
    setUserActionId(u.id);
    try {
      await api.resetUserPassword(u.id, newPw);
      alert("Пароль сброшен");
    } catch (e) {
      setUsersError(e.message);
    } finally {
      setUserActionId(null);
    }
  };

  const set = (patch) => setSettings({ ...settings, ...patch });

  const save = async (cardKey, patch) => {
    setSavingKey(cardKey);
    try {
      const updated = await api.updateSettings(patch);
      setSettings(updated);
      onSaved();
    } catch (e) {
      setError(e.message);
    } finally {
      setSavingKey(null);
    }
  };

  const providerModels = {
    gemini: ["gemini-2.5-flash-lite", "gemini-2.5-flash", "gemini-2.0-flash-lite"],
    groq: ["llama-3.3-70b-versatile", "qwen-2.5-72b"],
    openrouter: ["deepseek-v4", "anthropic/claude-sonnet-4", "qwen/qwen-2.5-72b"],
  };
  const providerLabels = { gemini: "Gemini", groq: "Groq", openrouter: "OpenRouter" };
  const aiProviders = settings.ai_providers || [];

  const updateProvider = (idx, patch) => {
    const next = aiProviders.map((p, i) => (i === idx ? { ...p, ...patch } : p));
    set({ ai_providers: next });
  };

  const sliders = [
    { key: "target_first_response_min", label: "Цель первого ответа", min: 5, max: 60, step: 5, unit: "мин", hint: "Быстрее цели — зелёный в списках, медленнее — жёлтый" },
    { key: "attention_after_min", label: "Порог «требует внимания»", min: 15, max: 180, step: 15, unit: "мин", hint: "Обращение без ответа дольше порога поднимается в «Обращениях» красным" },
    { key: "auto_confidence_pct", label: "Порог уверенности для автозакрытия", min: 50, max: 100, step: 5, unit: "%", hint: "Ниже порога ИИ не закрывает сам, а выносит на подтверждение" },
  ];
  const toggleDefs = [
    { key: "auto_close", label: "Закрывать обращения самостоятельно", hint: "Только при уверенности выше порога и отсутствии активности" },
    { key: "auto_promise", label: "Ловить обещания клиенту и ставить срок", hint: "Пока поле promise_text заполняется вручную из карточки тикета" },
    { key: "remind_before_due", label: "Напоминать за час до срока обещания", hint: "Пока не подключено — появится вместе с bot-digest" },
  ];

  return (
    <div style={{ padding: "26px 28px 44px", maxWidth: 720 }}>
      <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: C.textPrimary, letterSpacing: "-0.4px" }}>Настройки</h1>
      <div style={{ fontSize: 13, color: C.textSecondary, marginTop: 6, marginBottom: 20 }}>Как бот разбирает чаты, что считает нарушением и когда присылает сводку</div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <Card style={{ padding: "16px 18px" }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: C.textPrimary, marginBottom: 3, display: "flex", alignItems: "center", gap: 7 }}><LogOut size={14} color={C.accent} style={{ transform: "rotate(180deg)" }} /> Мой аккаунт</div>
          <div style={{ fontSize: 11.5, color: C.textSecondary, marginBottom: 15 }}>
            {currentUser?.email}{currentUser?.has_google && !currentUser?.has_password && " · вход только через Google"}
          </div>
          <form onSubmit={submitPasswordChange} style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 340 }}>
            {currentUser?.has_password && (
              <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} placeholder="Текущий пароль" required
                style={{ boxSizing: "border-box", padding: "9px 11px", border: `1px solid ${C.border}`, borderRadius: 7, background: C.surfaceMuted, fontSize: 13, color: C.textPrimary }} />
            )}
            <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Новый пароль (от 8 символов)" required minLength={8}
              style={{ boxSizing: "border-box", padding: "9px 11px", border: `1px solid ${C.border}`, borderRadius: 7, background: C.surfaceMuted, fontSize: 13, color: C.textPrimary }} />
            <input type="password" value={newPassword2} onChange={(e) => setNewPassword2(e.target.value)} placeholder="Повторите новый пароль" required minLength={8}
              style={{ boxSizing: "border-box", padding: "9px 11px", border: `1px solid ${C.border}`, borderRadius: 7, background: C.surfaceMuted, fontSize: 13, color: C.textPrimary }} />
            {pwResult && <div style={{ fontSize: 12, color: pwResult.ok ? C.green : C.red }}>{pwResult.text}</div>}
            <button type="submit" disabled={pwSaving}
              style={{ alignSelf: "flex-start", padding: "8px 16px", border: "none", borderRadius: 7, background: C.accent, color: "#fff", fontSize: 12.5, fontWeight: 500, cursor: pwSaving ? "default" : "pointer", opacity: pwSaving ? 0.6 : 1 }}>
              {pwSaving ? "Сохраняю…" : (currentUser?.has_password ? "Сменить пароль" : "Задать пароль")}
            </button>
          </form>
        </Card>

        <Card style={{ padding: "16px 18px" }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: C.textPrimary, marginBottom: 3, display: "flex", alignItems: "center", gap: 7 }}><Users size={14} color={C.accent} /> Пользователи</div>
          <div style={{ fontSize: 11.5, color: C.textSecondary, marginBottom: 15 }}>
            Ролевой модели пока нет — все, кто вошёл, имеют одинаковый доступ.
          </div>
          {usersError && <div style={{ marginBottom: 12 }}><ErrorBlock message={usersError} /></div>}
          {!users && <div style={{ fontSize: 12.5, color: C.textFaint }}>Загружаю…</div>}
          {users && (
            <div style={{ display: "flex", flexDirection: "column", marginBottom: 16 }}>
              {users.map((u, i) => (
                <div key={u.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 4px", borderTop: i === 0 ? "none" : `1px solid ${C.border}` }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, color: C.textPrimary, display: "flex", alignItems: "center", gap: 6 }}>
                      {u.name}
                      {!u.is_active && <Pill tone="red">деактивирован</Pill>}
                      {u.id === currentUser?.id && <span style={{ fontSize: 11, color: C.textFaint }}>(вы)</span>}
                    </div>
                    <div style={{ fontSize: 11, color: C.textFaint, fontFamily: MONO }}>
                      {u.email} · {[u.has_password && "пароль", u.has_google && "Google"].filter(Boolean).join(" + ")}
                    </div>
                  </div>
                  <button onClick={() => resetPassword(u)} disabled={userActionId === u.id}
                    style={{ padding: "5px 9px", border: `1px solid ${C.border}`, borderRadius: 6, background: "transparent", color: C.textSecondary, fontSize: 11.5, cursor: "pointer", whiteSpace: "nowrap" }}>
                    Сбросить пароль
                  </button>
                  {u.id !== currentUser?.id && (
                    <button onClick={() => toggleUserActive(u)} disabled={userActionId === u.id}
                      style={{ padding: "5px 9px", border: `1px solid ${u.is_active ? C.redBorder : C.border}`, borderRadius: 6, background: "transparent", color: u.is_active ? C.red : C.textSecondary, fontSize: 11.5, cursor: "pointer", whiteSpace: "nowrap" }}>
                      {u.is_active ? "Деактивировать" : "Включить"}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          <form onSubmit={submitCreateUser} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end", paddingTop: 14, borderTop: `1px solid ${C.border}` }}>
            <div style={{ flex: "1 1 160px" }}>
              <div style={{ fontSize: 11, color: C.textSecondary, marginBottom: 5 }}>Имя</div>
              <input value={newUserName} onChange={(e) => setNewUserName(e.target.value)} required
                style={{ width: "100%", boxSizing: "border-box", padding: "8px 10px", border: `1px solid ${C.border}`, borderRadius: 7, background: C.surfaceMuted, fontSize: 12.5, color: C.textPrimary }} />
            </div>
            <div style={{ flex: "1 1 200px" }}>
              <div style={{ fontSize: 11, color: C.textSecondary, marginBottom: 5 }}>Email</div>
              <input type="email" value={newUserEmail} onChange={(e) => setNewUserEmail(e.target.value)} required
                style={{ width: "100%", boxSizing: "border-box", padding: "8px 10px", border: `1px solid ${C.border}`, borderRadius: 7, background: C.surfaceMuted, fontSize: 12.5, color: C.textPrimary }} />
            </div>
            <div style={{ flex: "1 1 160px" }}>
              <div style={{ fontSize: 11, color: C.textSecondary, marginBottom: 5 }}>Пароль</div>
              <input type="password" value={newUserPassword} onChange={(e) => setNewUserPassword(e.target.value)} required minLength={8}
                style={{ width: "100%", boxSizing: "border-box", padding: "8px 10px", border: `1px solid ${C.border}`, borderRadius: 7, background: C.surfaceMuted, fontSize: 12.5, color: C.textPrimary }} />
            </div>
            <button type="submit" disabled={creatingUser}
              style={{ padding: "8px 14px", border: "none", borderRadius: 7, background: C.accent, color: "#fff", fontSize: 12.5, fontWeight: 500, cursor: creatingUser ? "default" : "pointer", opacity: creatingUser ? 0.6 : 1 }}>
              {creatingUser ? "Создаю…" : "+ Пользователь"}
            </button>
          </form>
        </Card>

        <Card style={{ padding: "16px 18px" }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: C.textPrimary, marginBottom: 3, display: "flex", alignItems: "center", gap: 7 }}><LogOut size={14} color={C.accent} style={{ transform: "rotate(180deg)" }} /> Вход через Google</div>
          <div style={{ fontSize: 11.5, color: C.textSecondary, marginBottom: 13, lineHeight: 1.5 }}>
            Client ID из Google Cloud Console (OAuth consent screen) — не секрет, его видно в исходном коде
            любой страницы с кнопкой «Войти через Google». Секретный ключ (client secret) тут не нужен —
            используется id_token-флоу, целиком на стороне браузера.
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input value={settings.google_client_id || ""} onChange={(e) => set({ google_client_id: e.target.value })} placeholder="XXXXXXXXXXXX.apps.googleusercontent.com"
              style={{ flex: "1 1 320px", boxSizing: "border-box", padding: "9px 11px", border: `1px solid ${C.border}`, borderRadius: 7, background: C.surfaceMuted, fontFamily: MONO, fontSize: 12.5, color: C.textPrimary }} />
            <button onClick={() => save("google", { google_client_id: settings.google_client_id })}
              disabled={savingKey === "google"} style={{ padding: "9px 16px", border: "none", borderRadius: 7, background: C.accent, color: "#fff", fontSize: 12.5, fontWeight: 500, cursor: "pointer", opacity: savingKey === "google" ? 0.6 : 1 }}>
              {savingKey === "google" ? "Сохраняю…" : "Сохранить"}
            </button>
          </div>
        </Card>

        <Card style={{ padding: "16px 18px" }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: C.textPrimary, marginBottom: 3, display: "flex", alignItems: "center", gap: 7 }}><Cpu size={14} color={C.accent} /> Провайдеры ИИ — по приоритету</div>
          <div style={{ fontSize: 11.5, color: C.textSecondary, marginBottom: 15, lineHeight: 1.5 }}>
            Пробуем сверху вниз: если провайдер выключен, без ключа или не ответил (сеть, лимит запросов) — переходим
            к следующему. Если ни один не ответил — работает эвристика по ключевым словам вместо ИИ.
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {aiProviders.map((p, idx) => (
              <div key={p.provider} style={{ border: `1px solid ${p.enabled ? C.accentBorder : C.border}`, borderRadius: 8, padding: "12px 14px", background: p.enabled ? C.accentSoft : C.surfaceMuted }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: p.enabled ? 12 : 0, flexWrap: "wrap" }}>
                  <span style={{ fontFamily: MONO, fontSize: 11, color: C.textFaint, width: 18 }}>{idx + 1}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: C.textPrimary }}>{providerLabels[p.provider]}</span>
                  {p.enabled && p.api_key && <Pill tone="green">ключ задан</Pill>}
                  {p.enabled && !p.api_key && <Pill tone="amber">нет ключа</Pill>}
                  <span style={{ marginLeft: "auto" }}>
                    <ToggleSwitch on={p.enabled} onClick={() => updateProvider(idx, { enabled: !p.enabled })} />
                  </span>
                </div>
                {p.enabled && (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 10 }}>
                    <StyledSelect
                      value={p.model}
                      onChange={(v) => updateProvider(idx, { model: v })}
                      options={(providerModels[p.provider] || []).map((m) => ({ value: m, label: m }))} />
                    <input type="password" value={p.api_key} onChange={(e) => updateProvider(idx, { api_key: e.target.value })} placeholder="API-ключ"
                      style={{ width: "100%", boxSizing: "border-box", padding: "8px 10px", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 7, fontFamily: MONO, fontSize: 12, color: C.textPrimary }} />
                  </div>
                )}
              </div>
            ))}
          </div>
          <button onClick={() => save("ai", { ai_providers: aiProviders })} style={{ marginTop: 14, padding: "8px 14px", border: "none", borderRadius: 7, background: C.accent, color: "#fff", fontSize: 12.5, fontWeight: 500, cursor: "pointer", opacity: savingKey === "ai" ? 0.6 : 1 }}
            disabled={savingKey === "ai"}>
            {savingKey === "ai" ? "Сохраняю…" : "Сохранить провайдеров"}
          </button>
        </Card>

        <Card style={{ padding: "16px 18px" }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: C.textPrimary, marginBottom: 3, display: "flex", alignItems: "center", gap: 7 }}><Bot size={14} color={C.accent} /> Токены ботов и агенты</div>
          <div style={{ fontSize: 11.5, color: C.textSecondary, marginBottom: 14 }}>Боты сами переподключаются при смене токена — перезапускать ничего не нужно</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12, marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 11.5, color: C.textSecondary, marginBottom: 6, display: "flex", alignItems: "center", gap: 7 }}>
                Bot-collector (сборщик)
                <span style={{ marginLeft: "auto" }}><Pill tone={settings.bot_collector_token ? "green" : "neutral"}>{settings.bot_collector_token ? "задан" : "не задан"}</Pill></span>
              </div>
              <input type="password" value={settings.bot_collector_token} onChange={(e) => set({ bot_collector_token: e.target.value })} placeholder="токен от @BotFather"
                style={{ width: "100%", boxSizing: "border-box", padding: "9px 10px", background: C.surfaceMuted, border: `1px solid ${C.border}`, borderRadius: 7, fontFamily: MONO, fontSize: 12.5, color: C.textPrimary }} />
            </div>
            <div>
              <div style={{ fontSize: 11.5, color: C.textSecondary, marginBottom: 6, display: "flex", alignItems: "center", gap: 7 }}>
                Bot-digest (сводки)
                <span style={{ marginLeft: "auto" }}><Pill tone={settings.bot_digest_token ? "green" : "neutral"}>{settings.bot_digest_token ? "задан" : "не задан"}</Pill></span>
              </div>
              <input type="password" value={settings.bot_digest_token} onChange={(e) => set({ bot_digest_token: e.target.value })} placeholder="ещё не используется"
                style={{ width: "100%", boxSizing: "border-box", padding: "9px 10px", background: C.surfaceMuted, border: `1px solid ${C.border}`, borderRadius: 7, fontFamily: MONO, fontSize: 12.5, color: C.textPrimary }} />
            </div>
          </div>
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11.5, color: C.textSecondary, marginBottom: 6, display: "flex", alignItems: "center", gap: 7 }}><Users size={12} /> Telegram id агентов (через запятую)</div>
            <input value={agentIdsText} onChange={(e) => setAgentIdsText(e.target.value)} placeholder="123456789, 987654321"
              style={{ width: "100%", boxSizing: "border-box", padding: "9px 10px", background: C.surfaceMuted, border: `1px solid ${C.border}`, borderRadius: 7, fontFamily: MONO, fontSize: 12.5, color: C.textPrimary }} />
            <div style={{ fontSize: 11, color: C.textFaint, marginTop: 6 }}>Свой id можно узнать у @userinfobot. Сообщения от этих id считаются ответом агента, а не клиента.</div>
          </div>

          <div style={{ marginBottom: 14 }}>
            <button onClick={() => {
              setSendersOpen(!sendersOpen);
              if (!sendersOpen && senders === null) {
                api.getSenders().then(setSenders).catch((e) => setSendersError(e.message));
              }
            }}
              style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", padding: 0, color: C.accent, fontSize: 12, cursor: "pointer" }}>
              {sendersOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              Известные участники переписки — найти id по имени
            </button>
            {sendersOpen && (
              <div style={{ marginTop: 10, border: `1px solid ${C.border}`, borderRadius: 8, overflow: "hidden" }}>
                {sendersError && <div style={{ padding: 12 }}><ErrorBlock message={sendersError} /></div>}
                {!sendersError && senders === null && <div style={{ padding: 12, fontSize: 12, color: C.textFaint }}>Загружаю…</div>}
                {senders && senders.length === 0 && <div style={{ padding: 12, fontSize: 12, color: C.textFaint }}>Пока никто не писал — список появится, как только пойдут сообщения.</div>}
                {senders && senders.map((s, i) => {
                  const pending = pendingAdds.has(s.sender_tg_id);
                  return (
                    <div key={s.sender_tg_id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderTop: i === 0 ? "none" : `1px solid ${C.border}`, background: C.surfaceMuted }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ fontSize: 12.5, color: C.textPrimary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.sender_name || "без имени"}</span>
                          {s.is_agent && <Pill tone="green">агент</Pill>}
                        </div>
                        <div style={{ fontFamily: MONO, fontSize: 11, color: C.textFaint, marginTop: 2 }}>id {s.sender_tg_id} · {s.message_count} сообщ.</div>
                        {fixResults[s.sender_tg_id] && <div style={{ fontSize: 11, color: C.green, marginTop: 3 }}>{fixResults[s.sender_tg_id]}</div>}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                        <button onClick={async () => {
                          setFixingId(s.sender_tg_id);
                          try {
                            const r = await api.recomputeSenderRole(s.sender_tg_id);
                            const roleLabel = r.new_role === "agent" ? "команда PRM" : "клиент";
                            setFixResults({ ...fixResults, [s.sender_tg_id]: `Синхронизировано как «${roleLabel}»: сообщений ${r.messages_updated}, тикетов пересчитано ${r.tickets_fixed}` });
                            onSaved();
                          } catch (e) {
                            setFixResults({ ...fixResults, [s.sender_tg_id]: `Ошибка: ${e.message}` });
                          } finally {
                            setFixingId(null);
                          }
                        }} disabled={fixingId === s.sender_tg_id} title="Привести старые сообщения этого человека в соответствие с его текущим статусом (агент/клиент) — работает в обе стороны"
                          style={{ padding: "5px 10px", border: `1px solid ${C.border}`, borderRadius: 6, background: C.surface, color: C.textSecondary, fontSize: 11.5, cursor: "pointer", whiteSpace: "nowrap", opacity: fixingId === s.sender_tg_id ? 0.6 : 1 }}>
                          {fixingId === s.sender_tg_id ? "Синхронизирую…" : "Синхронизировать историю"}
                        </button>
                        {s.sender_name && (
                          <button onClick={async () => {
                            const fixId = `name:${s.sender_name}`;
                            setFixingId(fixId);
                            try {
                              const targetType = s.is_agent ? "agent" : "client";
                              const r = await api.fixRoleByName(s.sender_name, targetType);
                              const roleLabel = r.new_role === "agent" ? "команда PRM" : "клиент";
                              setFixResults({ ...fixResults, [s.sender_tg_id]: `По имени «${s.sender_name}» как «${roleLabel}»: сообщений ${r.messages_updated}, тикетов пересчитано ${r.tickets_fixed}` });
                              onSaved();
                            } catch (e) {
                              setFixResults({ ...fixResults, [s.sender_tg_id]: `Ошибка: ${e.message}` });
                            } finally {
                              setFixingId(null);
                            }
                          }} disabled={fixingId === `name:${s.sender_name}`} title="Для сообщений, принятых ДО того, как бот стал сохранять числовой id — обычная синхронизация их не находит. Осторожно: совпадение по имени менее надёжно (бывают тёзки)."
                            style={{ padding: "5px 10px", border: `1px solid ${C.border}`, borderRadius: 6, background: "transparent", color: C.textFaint, fontSize: 11.5, cursor: "pointer", whiteSpace: "nowrap", opacity: fixingId === `name:${s.sender_name}` ? 0.6 : 1 }}>
                            {fixingId === `name:${s.sender_name}` ? "…" : "…и по имени (старые)"}
                          </button>
                        )}
                        {s.is_agent && (
                          pendingAdds.has(-s.sender_tg_id) ? (
                            <span style={{ fontSize: 11.5, color: C.amber, whiteSpace: "nowrap" }}>убрано — сохраните ниже</span>
                          ) : (
                            <button onClick={() => {
                              const ids = agentIdsText.split(",").map((x) => x.trim()).filter(Boolean).filter((x) => x !== String(s.sender_tg_id));
                              setAgentIdsText(ids.join(", "));
                              setPendingAdds(new Set([...pendingAdds, -s.sender_tg_id])); // отрицательный id — маркер "убран", чтобы не путать с "добавлен"
                            }}
                              style={{ padding: "5px 10px", border: `1px solid ${C.redBorder}`, borderRadius: 6, background: "transparent", color: C.red, fontSize: 11.5, cursor: "pointer", whiteSpace: "nowrap" }}>
                              − убрать из агентов
                            </button>
                          )
                        )}
                        {!s.is_agent && (
                          pending ? (
                            <span style={{ fontSize: 11.5, color: C.amber, whiteSpace: "nowrap" }}>добавлено — сохраните ниже</span>
                          ) : (
                            <button onClick={() => {
                              const ids = new Set(agentIdsText.split(",").map((x) => x.trim()).filter(Boolean));
                              ids.add(String(s.sender_tg_id));
                              setAgentIdsText([...ids].join(", "));
                              setPendingAdds(new Set([...pendingAdds, s.sender_tg_id]));
                            }}
                              style={{ padding: "5px 10px", border: `1px solid ${C.accentBorder}`, borderRadius: 6, background: C.accentSoft, color: C.accent, fontSize: 11.5, cursor: "pointer", whiteSpace: "nowrap" }}>
                              + в агенты
                            </button>
                          )
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <button
            onClick={() => {
              const ids = agentIdsText.split(",").map((s) => s.trim()).filter(Boolean).map(Number).filter((n) => !Number.isNaN(n));
              save("bots", { bot_collector_token: settings.bot_collector_token, bot_digest_token: settings.bot_digest_token, agent_tg_ids: ids });
            }}
            disabled={savingKey === "bots"} style={{ padding: "8px 14px", border: "none", borderRadius: 7, background: C.accent, color: "#fff", fontSize: 12.5, fontWeight: 500, cursor: "pointer", opacity: savingKey === "bots" ? 0.6 : 1 }}>
            {savingKey === "bots" ? "Сохраняю…" : "Сохранить токены и агентов"}
          </button>
        </Card>

        <Card style={{ padding: "16px 18px" }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: C.textPrimary, marginBottom: 3, display: "flex", alignItems: "center", gap: 7 }}><Link2 size={14} color={C.accent} /> Jira</div>
          <div style={{ fontSize: 11.5, color: C.textSecondary, marginBottom: 13 }}>
            Базовый URL нужен, чтобы короткие коды задач (SUP-1039) превращались в кликабельные ссылки — если ссылка на задачу уже полный URL, base_url не требуется
          </div>
          <input value={settings.jira_base_url} onChange={(e) => set({ jira_base_url: e.target.value })} placeholder="https://mycompany.atlassian.net/browse"
            style={{ width: "100%", boxSizing: "border-box", padding: "9px 11px", background: C.surfaceMuted, border: `1px solid ${C.border}`, borderRadius: 7, fontFamily: MONO, fontSize: 12.5, color: C.textPrimary, marginBottom: 12 }} />
          <button onClick={() => save("jira", { jira_base_url: settings.jira_base_url })}
            disabled={savingKey === "jira"} style={{ padding: "8px 14px", border: "none", borderRadius: 7, background: C.accent, color: "#fff", fontSize: 12.5, fontWeight: 500, cursor: "pointer", opacity: savingKey === "jira" ? 0.6 : 1 }}>
            {savingKey === "jira" ? "Сохраняю…" : "Сохранить"}
          </button>
        </Card>

        <Card style={{ padding: "16px 18px" }}>
          <div onClick={() => setPromptsOpen(!promptsOpen)} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
            <MessageSquareText size={14} color={C.accent} />
            <div style={{ fontSize: 13.5, fontWeight: 600, color: C.textPrimary }}>Промпты ИИ</div>
            <span style={{ marginLeft: "auto", color: C.textFaint }}>{promptsOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}</span>
          </div>
          <div style={{ fontSize: 11.5, color: C.textSecondary, marginTop: 3, marginBottom: promptsOpen ? 14 : 0 }}>
            Категоризация, предложение автозакрытия и дневная сводка — меняются здесь, без изменения кода backend
          </div>
          {promptsOpen && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {[
                { key: "prompt_categorize", label: "Категоризация обращения", hint: "Вызывается при каждом новом тикете" },
                { key: "prompt_autoclose", label: "Предложение автозакрытия", hint: "Планировщик раз в 10 минут проверяет открытые тикеты" },
                { key: "prompt_summary", label: "Дневная сводка", hint: "Генерируется в 23:00 или по кнопке «Перегенерировать»" },
              ].map((p) => (
                <div key={p.key}>
                  <div style={{ fontSize: 12, color: C.textPrimary, marginBottom: 3 }}>{p.label}</div>
                  <div style={{ fontSize: 11, color: C.textFaint, marginBottom: 7 }}>{p.hint}</div>
                  <textarea value={settings[p.key]} onChange={(e) => set({ [p.key]: e.target.value })}
                    style={{ width: "100%", minHeight: 92, resize: "vertical", boxSizing: "border-box", padding: "10px 11px", background: C.surfaceMuted, border: `1px solid ${C.border}`, borderRadius: 7, fontFamily: MONO, fontSize: 12, lineHeight: 1.55, color: C.textPrimary }} />
                </div>
              ))}
              <div>
                <button onClick={() => save("prompts", { prompt_categorize: settings.prompt_categorize, prompt_autoclose: settings.prompt_autoclose, prompt_summary: settings.prompt_summary })}
                  disabled={savingKey === "prompts"} style={{ padding: "8px 14px", border: "none", borderRadius: 7, background: C.accent, color: "#fff", fontSize: 12.5, fontWeight: 500, cursor: "pointer", opacity: savingKey === "prompts" ? 0.6 : 1 }}>
                  {savingKey === "prompts" ? "Сохраняю…" : "Сохранить промпты"}
                </button>
              </div>
            </div>
          )}
        </Card>

        <Card style={{ padding: "16px 18px" }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: C.textPrimary, marginBottom: 3 }}>Пороги и SLA</div>
          <div style={{ fontSize: 11.5, color: C.textSecondary, marginBottom: 15 }}>От них зависят цвета в списках и что попадёт в «требуют внимания»</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 16, marginBottom: 14 }}>
            {sliders.map((sl) => (
              <div key={sl.key}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, fontSize: 12.5, marginBottom: 8 }}>
                  <span style={{ color: C.textPrimary }}>{sl.label}</span>
                  <span style={{ marginLeft: "auto", fontFamily: MONO, color: C.amber }}>{settings[sl.key]}{sl.unit}</span>
                </div>
                <input type="range" min={sl.min} max={sl.max} step={sl.step} value={settings[sl.key]} onChange={(e) => set({ [sl.key]: Number(e.target.value) })} style={{ width: "100%", accentColor: C.accent, cursor: "pointer" }} />
                <div style={{ fontSize: 11, color: C.textFaint, marginTop: 6 }}>{sl.hint}</div>
              </div>
            ))}
          </div>
          <button onClick={() => save("thresholds", { target_first_response_min: settings.target_first_response_min, attention_after_min: settings.attention_after_min, auto_confidence_pct: settings.auto_confidence_pct })}
            disabled={savingKey === "thresholds"} style={{ padding: "8px 14px", border: "none", borderRadius: 7, background: C.accent, color: "#fff", fontSize: 12.5, fontWeight: 500, cursor: "pointer", opacity: savingKey === "thresholds" ? 0.6 : 1 }}>
            {savingKey === "thresholds" ? "Сохраняю…" : "Сохранить пороги"}
          </button>
        </Card>

        <Card style={{ padding: "16px 18px" }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: C.textPrimary, marginBottom: 3 }}>Автоматика</div>
          <div style={{ fontSize: 11.5, color: C.textSecondary, marginBottom: 13 }}>Каждый тумблер сохраняется сразу при клике</div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "13px 2px", flexWrap: "wrap" }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 13, color: C.textPrimary, fontWeight: 500 }}>Дневная сводка</div>
                <div style={{ fontSize: 11.5, color: C.textFaint, marginTop: 3 }}>Планировщик проверяет каждые 5 минут и собирает сводку, как только наступит указанное время</div>
              </div>
              {!!settings.daily_digest && (
                <input type="time" value={`${String(settings.daily_digest_hour).padStart(2, "0")}:${String(settings.daily_digest_minute).padStart(2, "0")}`}
                  onChange={(e) => {
                    const [h, m] = e.target.value.split(":").map(Number);
                    save("digest_time", { daily_digest_hour: h, daily_digest_minute: m });
                  }}
                  style={{ padding: "7px 10px", border: `1px solid ${C.border}`, borderRadius: 7, background: C.surfaceMuted, fontFamily: MONO, fontSize: 13, color: C.textPrimary }} />
              )}
              <ToggleSwitch on={!!settings.daily_digest} disabled={savingKey === "daily_digest"} onClick={() => save("daily_digest", { daily_digest: !settings.daily_digest })} />
            </div>
            {toggleDefs.map((tg) => {
              const on = !!settings[tg.key];
              return (
                <div key={tg.key} style={{ display: "flex", alignItems: "center", gap: 14, padding: "13px 2px", borderTop: `1px solid ${C.border}` }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 13, color: C.textPrimary, fontWeight: 500 }}>{tg.label}</div>
                    <div style={{ fontSize: 11.5, color: C.textFaint, marginTop: 3 }}>{tg.hint}</div>
                  </div>
                  <ToggleSwitch on={on} disabled={savingKey === tg.key} onClick={() => save(tg.key, { [tg.key]: !on })} />
                </div>
              );
            })}
          </div>
        </Card>

        <Card style={{ padding: "16px 18px" }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: C.textPrimary, marginBottom: 3 }}>Рабочие часы и SLA</div>
          <div style={{ fontSize: 11.5, color: C.textSecondary, marginBottom: 15, lineHeight: 1.5 }}>
            Время ожидания ответа считается только в рабочие часы рабочих дней — выходные, праздники и нерабочее время в простой не засчитываются
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 12, marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 11.5, color: C.textSecondary, marginBottom: 6 }}>Начало рабочего дня</div>
              <input type="time" value={settings.work_hours_start} onChange={(e) => set({ work_hours_start: e.target.value })}
                style={{ width: "100%", boxSizing: "border-box", padding: "8px 10px", background: C.surfaceMuted, border: `1px solid ${C.border}`, borderRadius: 7, fontFamily: MONO, fontSize: 12.5, color: C.textPrimary }} />
            </div>
            <div>
              <div style={{ fontSize: 11.5, color: C.textSecondary, marginBottom: 6 }}>Конец рабочего дня</div>
              <input type="time" value={settings.work_hours_end} onChange={(e) => set({ work_hours_end: e.target.value })}
                style={{ width: "100%", boxSizing: "border-box", padding: "8px 10px", background: C.surfaceMuted, border: `1px solid ${C.border}`, borderRadius: 7, fontFamily: MONO, fontSize: 12.5, color: C.textPrimary }} />
            </div>
          </div>

          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11.5, color: C.textSecondary, marginBottom: 8 }}>Рабочие дни</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((d, idx) => {
                const on = (settings.work_days || []).includes(idx);
                return (
                  <button key={d} onClick={() => {
                    const days = on ? settings.work_days.filter((x) => x !== idx) : [...(settings.work_days || []), idx];
                    set({ work_days: days.sort() });
                  }}
                    style={{ width: 40, padding: "7px 0", borderRadius: 7, fontSize: 12, cursor: "pointer", background: on ? C.accentSoft : C.surfaceMuted, border: `1px solid ${on ? C.accentBorder : C.border}`, color: on ? C.accent : C.textSecondary }}>
                    {d}
                  </button>
                );
              })}
            </div>
          </div>

          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11.5, color: C.textSecondary, marginBottom: 8 }}>Праздничные дни (через запятую, ГГГГ-ММ-ДД)</div>
            <input
              value={(settings.holidays || []).join(", ")}
              onChange={(e) => set({ holidays: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
              placeholder="2026-01-01, 2026-05-09"
              style={{ width: "100%", boxSizing: "border-box", padding: "8px 10px", background: C.surfaceMuted, border: `1px solid ${C.border}`, borderRadius: 7, fontFamily: MONO, fontSize: 12.5, color: C.textPrimary }} />
          </div>

          <button onClick={() => save("work_hours", { work_hours_start: settings.work_hours_start, work_hours_end: settings.work_hours_end, work_days: settings.work_days, holidays: settings.holidays })}
            disabled={savingKey === "work_hours"} style={{ padding: "8px 14px", border: "none", borderRadius: 7, background: C.accent, color: "#fff", fontSize: 12.5, fontWeight: 500, cursor: "pointer", opacity: savingKey === "work_hours" ? 0.6 : 1 }}>
            {savingKey === "work_hours" ? "Сохраняю…" : "Сохранить рабочие часы"}
          </button>
        </Card>

        <Card style={{ padding: "16px 18px" }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: C.textPrimary, marginBottom: 3, display: "flex", alignItems: "center", gap: 7 }}><Database size={14} color={C.accent} /> Синхронизация клиентов из Oracle</div>
          <div style={{ fontSize: 11.5, color: C.textSecondary, lineHeight: 1.55, marginBottom: 13 }}>
            Запрос выполняет локальный агент (`oracle-sync/`) на машине с доступом к Oracle — он сам забирает
            этот SQL отсюда, выполняет и присылает результат. Кнопка ниже просто ставит отметку — агент подхватит
            её при следующей проверке (раз в минуту в режиме ожидания).
          </div>
          <textarea value={settings.oracle_sql} onChange={(e) => set({ oracle_sql: e.target.value })}
            style={{ width: "100%", minHeight: 96, resize: "vertical", boxSizing: "border-box", padding: "11px 12px", background: C.surfaceMuted, border: `1px solid ${C.border}`, borderRadius: 7, fontFamily: MONO, fontSize: 12, lineHeight: 1.6, color: C.textPrimary, marginBottom: 12 }} />
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <button onClick={() => save("oracle", { oracle_sql: settings.oracle_sql })}
              disabled={savingKey === "oracle"} style={{ padding: "8px 14px", border: "none", borderRadius: 7, background: C.accent, color: "#fff", fontSize: 12.5, fontWeight: 500, cursor: "pointer", opacity: savingKey === "oracle" ? 0.6 : 1 }}>
              {savingKey === "oracle" ? "Сохраняю…" : "Сохранить запрос"}
            </button>
            <button onClick={() => save("oracle_run", { oracle_sync_requested: true })}
              disabled={savingKey === "oracle_run" || settings.oracle_sync_requested}
              style={{ padding: "8px 14px", border: `1px solid ${C.accentBorder}`, borderRadius: 7, background: C.accentSoft, color: C.accent, fontSize: 12.5, fontWeight: 500, cursor: settings.oracle_sync_requested ? "default" : "pointer", opacity: savingKey === "oracle_run" ? 0.6 : 1, display: "flex", alignItems: "center", gap: 7 }}>
              <RefreshCw size={13} />
              {settings.oracle_sync_requested ? "Ожидает агента…" : "Запустить синхронизацию"}
            </button>
            <span style={{ fontSize: 11.5, color: C.textFaint, fontFamily: MONO, marginLeft: "auto" }}>
              {settings.oracle_last_sync ? `последний синк: ${new Date(settings.oracle_last_sync).toLocaleString("ru-RU")}` : "синка ещё не было"}
            </span>
          </div>
        </Card>
      </div>
    </div>
  );
}

/* ---------- Ticket drawer ---------- */

function CategorySelect({ value, onChange, options, onRenamed }) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState(null);
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [editingIdx, setEditingIdx] = useState(null);
  const [editDraft, setEditDraft] = useState("");
  const [renaming, setRenaming] = useState(false);
  const triggerRef = useRef(null);

  const list = options.includes(value) || !value ? options : [...options, value];
  const filtered = query.trim() ? list.filter((c) => c.toLowerCase().includes(query.trim().toLowerCase())) : list;

  const openPanel = () => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (r) setRect({ top: r.bottom + 6, left: r.left, width: Math.max(r.width, 260) });
    setOpen(true);
  };
  const closeAll = () => { setOpen(false); setAdding(false); setEditingIdx(null); setQuery(""); };
  const pick = (c) => { onChange(c); closeAll(); };

  const commitNew = () => {
    const name = newName.trim();
    if (name) onChange(name);
    setAdding(false);
    setNewName("");
    closeAll();
  };

  const commitRename = async (oldName) => {
    const newVal = editDraft.trim();
    setEditingIdx(null);
    if (!newVal || newVal === oldName) return;
    setRenaming(true);
    try {
      await api.renameCategory(oldName, newVal);
      if (onRenamed) onRenamed(oldName, newVal);
      if (value === oldName) onChange(newVal);
    } catch (e) {
      alert(`Не удалось переименовать категорию: ${e.message}`);
    } finally {
      setRenaming(false);
    }
  };

  return (
    <div>
      <button ref={triggerRef} onClick={() => (open ? closeAll() : openPanel())}
        style={{ width: "100%", boxSizing: "border-box", display: "flex", alignItems: "center", gap: 9, padding: "11px 13px", border: `1px solid ${C.border}`, borderRadius: 9, background: C.surfaceMuted, fontSize: 14, color: C.textPrimary, cursor: "pointer", textAlign: "left" }}>
        <span style={{ width: 8, height: 8, borderRadius: 3, background: C.accent, flexShrink: 0 }} />
        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value || "Выберите категорию"}</span>
        <ChevronDown size={11} color={C.textFaint} />
      </button>
      {open && rect && createPortal(
        <>
          <div onClick={closeAll} style={{ position: "fixed", inset: 0, zIndex: 9998 }} />
          <div style={{ position: "fixed", top: rect.top, left: rect.left, width: rect.width, maxHeight: 340, display: "flex", flexDirection: "column", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 11, boxShadow: "0 22px 44px -20px rgba(20,23,26,0.4)", zIndex: 9999, overflow: "hidden" }}>
            <div style={{ flex: "0 0 auto", padding: "9px 10px", borderBottom: `1px solid ${C.border}` }}>
              <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Поиск категории…"
                style={{ width: "100%", boxSizing: "border-box", padding: "8px 10px", border: `1px solid ${C.border}`, borderRadius: 7, background: C.surfaceMuted, fontSize: 13, color: C.textPrimary }} />
            </div>
            <div style={{ flex: "1 1 auto", minHeight: 44, overflowY: "auto", padding: 6 }}>
              {filtered.map((c, idx) => (
                editingIdx === idx ? (
                  <div key={c} style={{ display: "flex", alignItems: "center", gap: 6, padding: 4, border: `1px solid ${C.accent}`, borderRadius: 7, background: C.surface, boxShadow: `0 0 0 3px ${C.accentSoft}`, margin: "2px 0" }}>
                    <input autoFocus value={editDraft} onChange={(e) => setEditDraft(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") commitRename(c); if (e.key === "Escape") setEditingIdx(null); }}
                      style={{ flex: 1, minWidth: 0, border: "none", background: "transparent", fontSize: 13.5, outline: "none", color: C.textPrimary, padding: "4px 4px 4px 8px" }} />
                    <button onClick={() => commitRename(c)} disabled={renaming} style={{ padding: "5px 9px", border: "none", borderRadius: 6, background: C.accent, color: "#fff", fontSize: 12, fontWeight: 500, cursor: "pointer" }}>Готово</button>
                    <button onClick={() => setEditingIdx(null)} style={{ padding: "5px 7px", border: "none", borderRadius: 6, background: "transparent", color: C.textFaint, fontSize: 12, cursor: "pointer" }}>Отмена</button>
                  </div>
                ) : (
                  <div key={c} style={{ display: "flex", alignItems: "center", borderRadius: 7 }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = C.surfaceMuted)}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                    <button onClick={() => pick(c)} style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 9, padding: "9px 4px 9px 10px", border: "none", background: "transparent", fontSize: 13.5, color: C.textPrimary, textAlign: "left", cursor: "pointer" }}>
                      <span style={{ width: 14, color: C.accent, fontSize: 12, flexShrink: 0 }}>{c === value ? "✓" : ""}</span>
                      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c}</span>
                    </button>
                    <button onClick={() => { setEditingIdx(idx); setEditDraft(c); }} title="Переименовать"
                      style={{ marginRight: 6, width: 26, height: 26, display: "grid", placeItems: "center", border: "1px solid transparent", borderRadius: 6, background: "transparent", color: C.textFaint, fontSize: 12, cursor: "pointer", flexShrink: 0 }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = C.surface; e.currentTarget.style.color = C.accent; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = C.textFaint; }}>
                      ✎
                    </button>
                  </div>
                )
              ))}
              {filtered.length === 0 && <div style={{ padding: "14px 10px", fontSize: 12.5, color: C.textFaint }}>Ничего не найдено — создайте новую категорию ниже.</div>}
            </div>
            <div style={{ flex: "0 0 auto", borderTop: `1px solid ${C.border}`, padding: 8, background: C.bg }}>
              {adding ? (
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") commitNew(); if (e.key === "Escape") setAdding(false); }}
                    placeholder="Название категории"
                    style={{ flex: 1, minWidth: 0, padding: "8px 10px", border: `1px solid ${C.accent}`, borderRadius: 7, background: C.surface, fontSize: 13, outline: "none", boxShadow: `0 0 0 3px ${C.accentSoft}` }} />
                  <button onClick={commitNew} style={{ padding: "8px 11px", border: "none", borderRadius: 7, background: C.accent, color: "#fff", fontSize: 12.5, fontWeight: 500, cursor: "pointer" }}>Создать</button>
                  <button onClick={() => setAdding(false)} style={{ padding: "8px 8px", border: "none", borderRadius: 7, background: "transparent", color: C.textFaint, fontSize: 12.5, cursor: "pointer" }}>Отмена</button>
                </div>
              ) : (
                <button onClick={() => setAdding(true)}
                  style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "9px 10px", border: `1px dashed ${C.borderStrong}`, borderRadius: 8, background: "transparent", color: C.green, fontSize: 13, fontWeight: 500, cursor: "pointer" }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = C.accentSoft; e.currentTarget.style.borderColor = C.accentBorder; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.borderColor = C.borderStrong; }}>
                  <span style={{ fontSize: 15, lineHeight: 1 }}>+</span> Добавить категорию
                </button>
              )}
            </div>
          </div>
        </>,
        document.body
      )}
    </div>
  );
}

const SPLIT_STEPS = ["Сообщения", "Тема и категория", "Создание"];

function pluralRu(n, one, few, many) {
  const mod10 = n % 10, mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

function TicketDrawer({ ticket, client, onClose, onSaved, jiraBaseUrl, onOpenClient, onOpenTicket, attentionAfterMin }) {
  const [status, setStatus] = useState(ticket.status);
  const [category, setCategory] = useState(ticket.category);
  const [subject, setSubject] = useState(ticket.text);
  const [promiseText, setPromiseText] = useState(ticket.promiseText);
  const [comment, setComment] = useState(ticket.comment);
  const [due, setDue] = useState(ticket.dueDate);
  const [jira, setJira] = useState(ticket.jiraUrl);
  const [isPaidWork, setIsPaidWork] = useState(ticket.isPaidWork);
  const [plannedCost, setPlannedCost] = useState(ticket.plannedCost);
  const [actualHours, setActualHours] = useState(ticket.actualHours);
  const [actualCost, setActualCost] = useState(ticket.actualCost);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  const [messages, setMessages] = useState(null);
  const [messagesError, setMessagesError] = useState(null);
  const [categories, setCategories] = useState([ticket.category]);

  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [mergeOpen, setMergeOpen] = useState(false);
  const [otherOpenTickets, setOtherOpenTickets] = useState(null);
  const [mergeTargetId, setMergeTargetId] = useState("");
  const [merging, setMerging] = useState(false);

  const [splitMode, setSplitMode] = useState(false);
  const [selectedMsgIds, setSelectedMsgIds] = useState([]);
  const [lastPickedIdx, setLastPickedIdx] = useState(null);
  const [splitCategory, setSplitCategory] = useState(ticket.category);
  const [splitSubjectManual, setSplitSubjectManual] = useState("");
  const [splitSubjectTouched, setSplitSubjectTouched] = useState(false);
  const [moveMode, setMoveMode] = useState("move"); // move | copy
  const [splitting, setSplitting] = useState(false);
  const [toast, setToast] = useState(null); // { text, newTicket }

  const PROMISE_SNIPPETS = ["Передали в разработку", "Уточняем у команды", "Ждём ответа от клиента", "Исправим в ближайшем релизе"];

  useEffect(() => {
    let cancelled = false;
    setMessages(null);
    setMessagesError(null);
    api.getTicketMessages(ticket.id)
      .then((data) => { if (!cancelled) setMessages(data); })
      .catch((e) => { if (!cancelled) setMessagesError(e.message); });
    api.getCategories().then((data) => { if (!cancelled) setCategories(data); }).catch(() => {});
    // Открыли панель — если были непрочитанные сообщения от клиента, гасим
    // чип "N новых" в очереди. Не влияет на статус/SLA — это отдельная,
    // чисто визуальная отметка.
    if (ticket.newMessageCount > 0) {
      api.markSeen(ticket.id).then(() => onSaved()).catch(() => {});
    }
    return () => { cancelled = true; };
  }, [ticket.id]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.updateTicket(ticket.id, {
        status,
        category,
        subject,
        promise_text: promiseText || null,
        comment: comment || null,
        jira_url: jira || null,
        due_date: due || null,
        is_paid_work: isPaidWork,
        planned_cost: isPaidWork ? (plannedCost || null) : null,
        actual_hours: isPaidWork && actualHours !== "" ? Number(actualHours) : null,
        actual_cost: isPaidWork ? (actualCost || null) : null,
      });
      onSaved();
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const jiraLinkHref = jiraHref(jira, jiraBaseUrl);

  const clipboardWrite = (text, onDone) => {
    const fallback = () => {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      try { document.execCommand("copy"); onDone(); } catch (e) { /* нечего больше сделать */ }
      document.body.removeChild(ta);
    };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(onDone).catch(fallback);
    } else {
      fallback();
    }
  };
  const copyCode = () => clipboardWrite(ticket.code, () => { setCopied(true); setTimeout(() => setCopied(false), 1600); });
  const copyLink = () => {
    setMenuOpen(false);
    clipboardWrite(window.location.href, () => { setLinkCopied(true); setTimeout(() => setLinkCopied(false), 1600); });
  };

  const isDirty = (
    status !== ticket.status ||
    category !== ticket.category ||
    subject !== ticket.text ||
    (promiseText || "") !== (ticket.promiseText || "") ||
    (comment || "") !== (ticket.comment || "") ||
    (due || "") !== (ticket.dueDate || "") ||
    (jira || "") !== (ticket.jiraUrl || "") ||
    isPaidWork !== ticket.isPaidWork ||
    (isPaidWork && (plannedCost || "") !== (ticket.plannedCost || "")) ||
    (isPaidWork && String(actualHours ?? "") !== String(ticket.actualHours ?? "")) ||
    (isPaidWork && (actualCost || "") !== (ticket.actualCost || ""))
  );
  const resetFields = () => {
    setStatus(ticket.status);
    setCategory(ticket.category);
    setSubject(ticket.text);
    setPromiseText(ticket.promiseText);
    setComment(ticket.comment);
    setDue(ticket.dueDate);
    setJira(ticket.jiraUrl);
    setIsPaidWork(ticket.isPaidWork);
    setPlannedCost(ticket.plannedCost);
    setActualHours(ticket.actualHours);
    setActualCost(ticket.actualCost);
  };

  // Если задан срок исполнения — SLA по обращению не считаем (ориентир
  // теперь срок, а не порог ответа).
  const slaExempt = !!ticket.dueDate && ticket.status !== "closed";
  const slaPct = attentionAfterMin && !slaExempt ? Math.min(100, Math.round((ticket.waitMin / attentionAfterMin) * 100)) : null;
  const slaColor = slaPct === null ? C.textFaint : slaPct >= 100 ? C.red : slaPct >= 70 ? C.amber : C.green;

  const doDelete = async () => {
    setDeleting(true);
    setError(null);
    try {
      await api.deleteTicket(ticket.id);
      onSaved();
      onClose();
    } catch (e) {
      setError(e.message);
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  const openMergeUi = async () => {
    setMenuOpen(false);
    setSplitMode(false);
    setMergeOpen(true);
    if (otherOpenTickets === null) {
      try {
        const all = await api.getClientTickets(ticket.clientId, { status: "open" });
        setOtherOpenTickets(all.map(normalizeTicket).filter((t) => t.id !== ticket.id));
      } catch (e) {
        setError(e.message);
      }
    }
  };
  const doMerge = async () => {
    if (!mergeTargetId) return;
    setMerging(true);
    setError(null);
    try {
      await api.mergeTickets(ticket.id, Number(mergeTargetId));
      onSaved();
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setMerging(false);
    }
  };

  // ---- режим разделения ----
  const toggleMsgSelected = (id, shiftKey) => {
    if (!messages) return;
    const idx = messages.findIndex((m) => m.id === id);
    if (shiftKey && lastPickedIdx !== null) {
      const from = Math.min(lastPickedIdx, idx), to = Math.max(lastPickedIdx, idx);
      const rangeIds = messages.slice(from, to + 1).map((m) => m.id);
      setSelectedMsgIds((prev) => [...new Set([...prev, ...rangeIds])]);
    } else {
      setSelectedMsgIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    }
    setLastPickedIdx(idx);
  };
  const enterSplit = () => {
    setMenuOpen(false);
    setMergeOpen(false);
    setSplitMode(true);
    setSelectedMsgIds([]);
    setLastPickedIdx(null);
    setSplitCategory(category);
    setSplitSubjectManual("");
    setSplitSubjectTouched(false);
    setMoveMode("move");
  };
  const exitSplit = () => setSplitMode(false);

  const selectedInOrder = messages ? messages.filter((m) => selectedMsgIds.includes(m.id)) : [];
  // Название по умолчанию — начало первого выбранного сообщения: переносы
  // строк схлопываем, длинное обрезаем (название можно отредактировать).
  const derivedSplitSubject = (() => {
    const t = (selectedInOrder[0]?.text || "").replace(/\s+/g, " ").trim();
    return t.length > 120 ? `${t.slice(0, 117)}…` : t;
  })();
  const splitSubjectValue = splitSubjectTouched ? splitSubjectManual : derivedSplitSubject;
  const n = selectedMsgIds.length;
  const splitStep = splitting ? 2 : (n > 0 ? 1 : 0);

  const doSplit = async () => {
    if (n === 0) return;
    setSplitting(true);
    setError(null);
    try {
      const newTicket = await api.splitTicket(ticket.id, {
        message_ids: selectedMsgIds,
        category: splitCategory,
        subject: splitSubjectValue || undefined,
        mode: moveMode,
      });
      if (moveMode === "move") {
        setMessages((prev) => prev.filter((m) => !selectedMsgIds.includes(m.id)));
      }
      setSplitMode(false);
      const verb = moveMode === "move" ? "перенесено" : "скопировано";
      setToast({ text: `Создан ${newTicket.code} — ${verb} ${n} ${pluralRu(n, "сообщение", "сообщения", "сообщений")}`, newTicket });
      setSelectedMsgIds([]);
      onSaved();
    } catch (e) {
      setError(e.message);
    } finally {
      setSplitting(false);
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(20,23,26,0.35)", display: "flex", justifyContent: "flex-end", zIndex: 50 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 560, maxWidth: "94vw", height: "100%", background: C.bg, borderLeft: `1px solid ${C.border}`, display: "flex", flexDirection: "column", boxShadow: "-18px 0 40px rgba(20,23,26,0.08)" }}>

        <div style={{ padding: "14px 16px 12px", borderBottom: `1px solid ${C.border}`, display: "flex", flexDirection: "column", gap: 10, background: C.bg, flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ position: "relative" }}>
              <button onClick={copyCode} title="Скопировать номер обращения"
                style={{ display: "flex", alignItems: "center", gap: 7, padding: "5px 8px 5px 9px", marginLeft: -9, border: `1px solid ${copied ? C.accentBorder : "transparent"}`, borderRadius: 7, background: copied ? C.accentSoft : "transparent", color: C.textPrimary, cursor: "pointer", transition: "background .15s ease, border-color .15s ease" }}
                onMouseEnter={(e) => { if (!copied) e.currentTarget.style.background = C.surfaceMuted; }}
                onMouseLeave={(e) => { if (!copied) e.currentTarget.style.background = "transparent"; }}>
                <span style={{ fontFamily: MONO, fontSize: 13, fontWeight: 600, letterSpacing: "0.02em" }}>{ticket.code}</span>
                {copied ? <Check size={14} color={C.accent} strokeWidth={2.6} /> : <Copy size={14} color={C.textFaint} />}
              </button>
              {copied && (
                <div style={{ position: "absolute", top: "calc(100% + 6px)", left: "50%", transform: "translateX(-50%)", padding: "4px 8px", borderRadius: 6, background: C.ink, color: C.bg, fontSize: 11.5, whiteSpace: "nowrap", zIndex: 55, pointerEvents: "none" }}>
                  Скопировано
                </div>
              )}
            </div>
            <span style={{ flex: 1 }} />
            <StatusSelect value={status} onChange={setStatus} compact />
            <div style={{ position: "relative" }}>
              <button onClick={() => { setMenuOpen(!menuOpen); setConfirmDelete(false); }} title="Ещё действия"
                style={{ width: 30, height: 30, display: "grid", placeItems: "center", border: `1px solid ${menuOpen ? C.border : "transparent"}`, borderRadius: 8, background: menuOpen ? C.surfaceMuted : "transparent", color: C.textSecondary, fontSize: 17, lineHeight: 1, cursor: "pointer" }}>
                ⋯
              </button>
              {menuOpen && (
                <>
                  <div onClick={() => { setMenuOpen(false); setConfirmDelete(false); }} style={{ position: "fixed", inset: 0, zIndex: 45 }} />
                  <div style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, width: 260, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 11, boxShadow: "0 22px 44px -20px rgba(20,23,26,0.4)", padding: 5, zIndex: 50 }}>
                    {!confirmDelete ? (
                      <>
                        {[
                          { icon: "⑂", label: "Разделить обращение", kbd: "S", run: enterSplit },
                          { icon: "⇄", label: "Объединить с тикетом клиента", kbd: "M", run: openMergeUi },
                          { icon: "⧉", label: "Скопировать ссылку", kbd: "⌘L", run: copyLink },
                        ].map((it) => (
                          <button key={it.label} onClick={it.run}
                            style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", border: "none", borderRadius: 7, background: "transparent", fontSize: 13, color: C.textPrimary, textAlign: "left", cursor: "pointer" }}
                            onMouseEnter={(e) => (e.currentTarget.style.background = C.surfaceMuted)}
                            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                            <span style={{ width: 16, textAlign: "center", color: C.textFaint, fontSize: 13 }}>{it.icon}</span>
                            <span style={{ flex: 1 }}>{it.label}</span>
                            <span style={{ fontSize: 11, color: C.textFaint, fontFamily: MONO }}>{it.kbd}</span>
                          </button>
                        ))}
                        <div style={{ height: 1, background: C.border, margin: "5px 4px" }} />
                        <button onClick={() => setConfirmDelete(true)}
                          style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", border: "none", borderRadius: 7, background: "transparent", fontSize: 13, color: C.red, textAlign: "left", cursor: "pointer" }}
                          onMouseEnter={(e) => (e.currentTarget.style.background = C.redSoft)}
                          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                          <span style={{ width: 16, textAlign: "center", fontSize: 13 }}>⌫</span>
                          <span style={{ flex: 1 }}>Удалить обращение</span>
                        </button>
                      </>
                    ) : (
                      <div style={{ padding: "9px 9px 7px", display: "flex", flexDirection: "column", gap: 10 }}>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 600, color: C.textPrimary }}>Удалить {ticket.code}?</div>
                          <div style={{ fontSize: 12, lineHeight: 1.4, color: C.textSecondary, marginTop: 3 }}>Обращение и вся переписка будут удалены без возможности восстановления.</div>
                        </div>
                        <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                          <button onClick={() => setConfirmDelete(false)} style={{ padding: "7px 11px", border: `1px solid ${C.border}`, borderRadius: 7, background: "transparent", fontSize: 12.5, color: C.textSecondary, cursor: "pointer" }}>Отмена</button>
                          <button onClick={doDelete} disabled={deleting} style={{ padding: "7px 11px", border: "none", borderRadius: 7, background: C.red, color: "#fff", fontSize: 12.5, fontWeight: 500, cursor: deleting ? "default" : "pointer", opacity: deleting ? 0.6 : 1 }}>
                            {deleting ? "Удаляю…" : "Удалить"}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
            <button onClick={onClose} title="Закрыть панель"
              style={{ width: 30, height: 30, display: "grid", placeItems: "center", border: "1px solid transparent", borderRadius: 8, background: "transparent", color: C.textSecondary, cursor: "pointer" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = C.surfaceMuted)}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
              <X size={16} />
            </button>
          </div>

          {!splitMode && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              {client && (
                <div style={{ width: 26, height: 26, borderRadius: "50%", background: C.accentSoft, border: `1px solid ${C.accentBorder}`, display: "grid", placeItems: "center", fontSize: 10.5, fontWeight: 600, color: C.green, flexShrink: 0 }}>
                  {client.name.split(" ").slice(0, 2).map((w) => w[0]).join("").toUpperCase()}
                </div>
              )}
              {client ? (
                <button onClick={() => { onOpenClient(client.id); onClose(); }}
                  style={{ background: "none", border: "none", padding: 0, color: C.textPrimary, cursor: "pointer", fontSize: 13.5, fontWeight: 500, borderBottom: `1px solid ${C.accentBorder}` }}>
                  {client.name}
                </button>
              ) : <span style={{ fontSize: 13.5, color: C.textFaint }}>—</span>}
              {client?.tariff_name && (
                <span style={{ padding: "3px 8px", borderRadius: 999, background: C.surfaceMuted, border: `1px solid ${C.border}`, fontSize: 11, color: C.textSecondary }}>тариф «{client.tariff_name}»</span>
              )}
              <span style={{ fontSize: 11.5, color: C.textFaint }}>{dateLabel(ticket.daysAgo)} {ticket.time}</span>
            </div>
          )}
        </div>

        {splitMode && (
          <div style={{ flexShrink: 0, padding: "10px 16px 8px", borderBottom: `1px solid ${C.accentBorder}`, background: C.accentSoft, display: "flex", flexDirection: "column", gap: 9 }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14.5, fontWeight: 600, color: "#123f31" }}>Разделение обращения</div>
                <div style={{ fontSize: 12.5, color: "#4f6f63", marginTop: 2 }}>Отметьте сообщения, которые нужно вынести в новый тикет</div>
              </div>
              <button onClick={exitSplit} style={{ padding: "6px 10px", border: `1px solid ${C.accentBorder}`, borderRadius: 7, background: C.surface, color: "#4f6f63", fontSize: 12.5, cursor: "pointer", flexShrink: 0 }}>Отмена</button>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {SPLIT_STEPS.map((name, idx) => {
                const done = idx < splitStep, activeStep = idx === splitStep;
                return (
                  <div key={name} style={{ display: "flex", alignItems: "center", gap: 6, flex: idx < 2 ? 1 : "0 0 auto" }}>
                    <span style={{ width: 20, height: 20, flexShrink: 0, borderRadius: "50%", display: "grid", placeItems: "center", fontSize: 11, fontWeight: 600, background: done || activeStep ? C.accent : C.surface, color: done || activeStep ? "#fff" : C.textFaint, border: `1.5px solid ${done || activeStep ? C.accent : C.accentBorder}` }}>
                      {done ? "✓" : idx + 1}
                    </span>
                    <span style={{ fontSize: 12, whiteSpace: "nowrap", color: activeStep ? "#123f31" : "#4f6f63", fontWeight: activeStep ? 600 : 400 }}>{name}</span>
                    {idx < 2 && <span style={{ flex: 1, minWidth: 12, height: 1.5, background: C.accentBorder, borderRadius: 2 }} />}
                  </div>
                );
              })}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
              <button onClick={() => setSelectedMsgIds(messages ? messages.map((m) => m.id) : [])} style={{ padding: "4px 8px", border: "none", borderRadius: 6, background: "transparent", color: C.green, fontSize: 12, fontWeight: 500, cursor: "pointer" }}>Выбрать все</button>
              <button onClick={() => { setSelectedMsgIds([]); setLastPickedIdx(null); }} style={{ padding: "4px 8px", border: "none", borderRadius: 6, background: "transparent", color: C.green, fontSize: 12, fontWeight: 500, cursor: "pointer" }}>Снять выбор</button>
              <span style={{ flex: 1 }} />
              <span style={{ fontSize: 11.5, color: "#7d978c" }}>Shift + клик — выбрать диапазон</span>
            </div>
          </div>
        )}

        <div style={{ flex: "1 1 0", minHeight: splitMode ? 150 : 0, overflowY: "auto", overflowX: "hidden", padding: "4px 16px 16px" }}>
          {!splitMode ? (
            <>
              {toast && (
                <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", border: `1px solid ${C.accentBorder}`, borderRadius: 10, background: C.accentSoft }}>
                  <span style={{ width: 20, height: 20, flexShrink: 0, borderRadius: "50%", background: C.accent, color: "#fff", display: "grid", placeItems: "center", fontSize: 11, fontWeight: 700 }}>✓</span>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: "#123f31" }}>{toast.text}</span>
                  <button onClick={() => onOpenTicket(normalizeTicket(toast.newTicket))} style={{ background: "none", border: "none", padding: 0, fontSize: 12.5, fontWeight: 500, color: C.green, cursor: "pointer" }}>Открыть</button>
                  <button onClick={() => setToast(null)} title="Скрыть" style={{ width: 22, height: 22, border: "none", borderRadius: 6, background: "transparent", color: "#6f8a7f", cursor: "pointer", fontSize: 11, flexShrink: 0 }}>✕</button>
                </div>
              )}

              <div style={{ marginBottom: 14, paddingTop: 14 }}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, marginBottom: 7 }}>
                  <div style={{ fontSize: 11.5, color: C.textSecondary }}>Наименование обращения</div>
                  {slaExempt && (
                    <span title="Задан срок исполнения — ориентир срок, а не порог ответа" style={{ fontSize: 11, color: C.textFaint }}>SLA не считается · задан срок</span>
                  )}
                  {slaPct !== null && (
                    <div title="Время ожидания от порога «требует внимания»" style={{ display: "flex", alignItems: "center", gap: 7 }}>
                      <span style={{ fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: C.textFaint }}>SLA</span>
                      <div style={{ width: 54, height: 5, borderRadius: 99, background: C.surfaceMuted, overflow: "hidden" }}>
                        <div style={{ width: `${slaPct}%`, height: "100%", background: slaColor, borderRadius: 99 }} />
                      </div>
                      <span style={{ fontSize: 11.5, fontWeight: 600, color: slaColor }}>{slaPct}%</span>
                    </div>
                  )}
                </div>
                <TitleInput value={subject} onChange={setSubject} />
              </div>

              <div style={{ marginBottom: 18 }}>
                <div style={{ fontSize: 11.5, color: C.textSecondary, marginBottom: 7 }}>Категория</div>
                <CategorySelect value={category} onChange={setCategory} options={categories} />
              </div>

              <div style={{ marginBottom: 18, border: `1px solid ${isPaidWork ? "#b3d1c4" : C.border}`, borderRadius: 11, overflow: "hidden", background: isPaidWork ? "#cfe5da" : C.surfaceMuted }}>
                <div onClick={() => setIsPaidWork(!isPaidWork)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 13px", cursor: "pointer" }}>
                  <span style={{ fontSize: 13, color: isPaidWork ? C.green : C.textFaint, flexShrink: 0 }}>₽</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: isPaidWork ? "#123f31" : C.textPrimary }}>Платная доработка</div>
                    <div style={{ fontSize: 11.5, color: isPaidWork ? "#3f6656" : C.textFaint, marginTop: 2 }}>
                      {isPaidWork ? "Укажите плановую и фактическую стоимость работ" : "Отметьте, если обращение — оплачиваемая доработка"}
                    </div>
                  </div>
                  <ToggleSwitch on={isPaidWork} onClick={() => setIsPaidWork(!isPaidWork)} />
                </div>
                {isPaidWork && (
                  <div style={{ padding: "0 13px 13px", display: "flex", flexDirection: "column", gap: 11 }}>
                    <div>
                      <div style={{ fontSize: 11.5, color: "#3f6656", marginBottom: 5 }}>Плановая стоимость</div>
                      <input value={plannedCost} onChange={(e) => setPlannedCost(e.target.value)} placeholder="напр. 25 000 ₽"
                        style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", background: "#fffefb", border: "1px solid #b3d1c4", borderRadius: 8, fontSize: 13.5, color: C.textPrimary }} />
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 11 }}>
                      <div>
                        <div style={{ fontSize: 11.5, color: "#3f6656", marginBottom: 5 }}>Факт. часы</div>
                        <input type="number" min="0" step="0.5" value={actualHours} onChange={(e) => setActualHours(e.target.value)} placeholder="напр. 6.5"
                          style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", background: "#fffefb", border: "1px solid #b3d1c4", borderRadius: 8, fontSize: 13.5, color: C.textPrimary }} />
                      </div>
                      <div>
                        <div style={{ fontSize: 11.5, color: "#3f6656", marginBottom: 5 }}>Факт. стоимость</div>
                        <input value={actualCost} onChange={(e) => setActualCost(e.target.value)} placeholder="напр. 27 000 ₽"
                          style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", background: "#fffefb", border: "1px solid #b3d1c4", borderRadius: 8, fontSize: 13.5, color: C.textPrimary }} />
                      </div>
                    </div>
                    {(() => {
                      const planNum = parseFloat(String(plannedCost || "").replace(/[^\d.]/g, ""));
                      const factNum = parseFloat(String(actualCost || "").replace(/[^\d.]/g, ""));
                      if (!Number.isFinite(planNum) || !Number.isFinite(factNum)) return null;
                      const delta = factNum - planNum;
                      return (
                        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#3f6656" }}>
                          <span style={{ padding: "3px 8px", borderRadius: 999, background: "#fffefb", border: "1px solid #b3d1c4", fontVariantNumeric: "tabular-nums" }}>
                            {delta > 0 ? "+" : ""}{delta.toLocaleString("ru-RU")} ₽
                          </span>
                          расхождение план / факт
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>

              {error && <div style={{ marginBottom: 14 }}><ErrorBlock message={error} /></div>}

              <div style={{ marginBottom: 18 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 9 }}>
                  <span style={{ fontSize: 10.5, letterSpacing: "0.1em", textTransform: "uppercase", color: C.textFaint }}>Переписка</span>
                  {messages && <span style={{ fontSize: 11.5, color: C.textFaint }}>{messages.length}</span>}
                </div>
                {messagesError && <ErrorBlock message={messagesError} />}
                {!messagesError && !messages && <div style={{ fontSize: 12.5, color: C.textFaint }}>Загружаю сообщения…</div>}
                {messages && messages.length === 0 && <div style={{ fontSize: 12.5, color: C.textFaint }}>Сообщений нет</div>}
                {messages && messages.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {messages.map((m) => {
                      const isAgent = m.sender_type === "agent";
                      const initials = (m.sender_name || (isAgent ? "Команда PRM" : "Клиент")).trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
                      return (
                        <div key={m.id} style={{ display: "flex", gap: 9 }}>
                          <div style={{ width: 26, height: 26, flex: "0 0 26px", marginTop: 2, borderRadius: "50%", background: C.surfaceMuted, display: "grid", placeItems: "center", fontSize: 10, fontWeight: 600, color: C.textSecondary }}>
                            {initials}
                          </div>
                          <div style={{ flex: 1, minWidth: 0, border: `1px solid ${isAgent ? C.accentBorder : C.border}`, borderLeft: `3px solid ${isAgent ? C.accent : C.borderStrong}`, borderRadius: 9, background: "#f4f2ec", padding: "9px 11px" }}>
                            <div style={{ display: "flex", alignItems: "baseline", gap: 7, marginBottom: 4, flexWrap: "wrap" }}>
                              <span style={{ fontSize: 12, fontWeight: 600, color: C.textPrimary }}>{m.sender_name || (isAgent ? "Команда PRM" : "Клиент")}</span>
                              <span style={{ fontSize: 10.5, color: isAgent ? C.green : C.textSecondary, background: isAgent ? C.accentSoft : C.surfaceMuted, borderRadius: 4, padding: "1px 5px" }}>{isAgent ? "команда PRM" : "клиент"}</span>
                              <span style={{ flex: 1 }} />
                              <span style={{ fontSize: 10.5, color: C.textFaint, fontVariantNumeric: "tabular-nums" }}>{new Date(m.sent_at).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
                            </div>
                            <div style={{ fontSize: 13, lineHeight: 1.45, color: "#2b2a26", whiteSpace: "pre-wrap", overflowWrap: "anywhere", wordBreak: "break-word" }}>{m.text}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11.5, color: C.textSecondary, marginBottom: 7 }}>Обещание клиенту</div>
                <textarea value={promiseText} onChange={(e) => setPromiseText(e.target.value)} placeholder="напр. пришлём фикс в релизе 4.2"
                  style={{ width: "100%", minHeight: 76, resize: "vertical", boxSizing: "border-box", padding: "9px 11px", background: C.surfaceMuted, border: `1px solid ${C.border}`, borderRadius: 7, fontSize: 12.5, color: C.textPrimary, fontFamily: SANS, lineHeight: 1.5 }} />
                <div style={{ display: "flex", gap: 6, marginTop: 7, flexWrap: "wrap" }}>
                  {PROMISE_SNIPPETS.map((s) => (
                    <button key={s} onClick={() => setPromiseText(promiseText ? `${promiseText} ${s}` : s)}
                      style={{ padding: "5px 9px", border: `1px solid ${C.border}`, borderRadius: 999, background: C.bg, color: C.textSecondary, fontSize: 11.5, cursor: "pointer" }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = C.accentSoft; e.currentTarget.style.borderColor = C.accentBorder; e.currentTarget.style.color = C.accent; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = C.bg; e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.textSecondary; }}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11.5, color: C.textSecondary, marginBottom: 7 }}>Комментарий</div>
                <textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Внутренние заметки по обращению"
                  style={{ width: "100%", minHeight: 96, resize: "vertical", boxSizing: "border-box", padding: "9px 11px", background: C.surfaceMuted, border: `1px solid ${C.border}`, borderRadius: 7, fontSize: 12.5, color: C.textPrimary, fontFamily: SANS, lineHeight: 1.5 }} />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 11, marginBottom: 20 }}>
                <div>
                  <div style={{ fontSize: 11.5, color: C.textSecondary, marginBottom: 7, display: "flex", alignItems: "center", gap: 5 }}><CalendarClock size={12} /> Срок исполнения</div>
                  <input type="date" value={due} onChange={(e) => setDue(e.target.value)}
                    style={{ width: "100%", boxSizing: "border-box", padding: "9px 11px", background: C.surfaceMuted, border: `1px solid ${C.border}`, borderRadius: 7, fontFamily: MONO, fontSize: 12, color: C.textPrimary }} />
                </div>
                <div>
                  <div style={{ fontSize: 11.5, color: C.textSecondary, marginBottom: 7, display: "flex", alignItems: "center", gap: 5 }}><Link2 size={12} /> Задача в Jira</div>
                  <input value={jira} onChange={(e) => setJira(e.target.value)} placeholder="SUP-XXXX или полный URL"
                    style={{ width: "100%", boxSizing: "border-box", padding: "9px 11px", background: C.surfaceMuted, border: `1px solid ${C.border}`, borderRadius: 7, fontFamily: MONO, fontSize: 12, color: C.textPrimary }} />
                  {jiraLinkHref && (
                    <a href={jiraLinkHref} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: C.accent, display: "inline-flex", alignItems: "center", gap: 4, marginTop: 6 }}>
                      Открыть в Jira <ExternalLink size={10} />
                    </a>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingTop: 12 }}>
              {messages && messages.map((m) => {
                const picked = selectedMsgIds.includes(m.id);
                const isAgent = m.sender_type === "agent";
                return (
                  <div key={m.id} onClick={(e) => toggleMsgSelected(m.id, e.shiftKey)}
                    style={{ display: "flex", gap: 11, padding: "10px 12px 11px 11px", border: `1px solid ${picked ? C.accent : C.border}`, borderRadius: 10, background: picked ? C.accentSoft : C.surface, cursor: "pointer", userSelect: "none" }}>
                    <span style={{ width: 18, height: 18, flex: "0 0 18px", marginTop: 1, borderRadius: 5, border: `1.5px solid ${picked ? C.accent : C.borderStrong}`, background: picked ? C.accent : "transparent", display: "grid", placeItems: "center", color: "#fff", fontSize: 11, fontWeight: 700 }}>
                      {picked ? "✓" : ""}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 7, marginBottom: 4 }}>
                        <span style={{ fontSize: 12, fontWeight: 600 }}>{m.sender_name || (isAgent ? "Команда PRM" : "Клиент")}</span>
                        <span style={{ fontSize: 10.5, color: isAgent ? C.green : C.textSecondary, background: isAgent ? C.accentSoft : C.surfaceMuted, borderRadius: 4, padding: "1px 5px" }}>{isAgent ? "команда PRM" : "клиент"}</span>
                        <span style={{ flex: 1 }} />
                        <span style={{ fontSize: 10.5, color: C.textFaint, fontVariantNumeric: "tabular-nums" }}>{new Date(m.sent_at).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
                      </div>
                      <div style={{ fontSize: 13, lineHeight: 1.45, color: "#2b2a26", whiteSpace: "pre-wrap", overflowWrap: "anywhere", wordBreak: "break-word" }}>{m.text}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {!splitMode && !mergeOpen ? (
          <div style={{ borderTop: `1px solid ${C.border}`, background: C.bg, padding: "11px 16px 13px", display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
            <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 7, fontSize: 11.5, color: C.textFaint, overflow: "hidden" }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: isDirty ? C.amber : C.green, flexShrink: 0 }} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{isDirty ? "Есть несохранённые изменения" : "Изменений нет"}</span>
            </div>
            {isDirty && (
              <button onClick={resetFields}
                style={{ padding: "10px 13px", border: `1px solid ${C.border}`, borderRadius: 9, background: "transparent", fontSize: 13, color: C.textSecondary, cursor: "pointer", flexShrink: 0, whiteSpace: "nowrap" }}>
                Отменить
              </button>
            )}
            <button onClick={save} disabled={saving}
              style={{ padding: "11px 20px", border: "none", borderRadius: 9, background: C.accent, color: "#fff", fontSize: 13.5, fontWeight: 600, cursor: saving ? "default" : "pointer", opacity: saving ? 0.6 : 1, flexShrink: 0, whiteSpace: "nowrap" }}>
              {saving ? "Сохраняю…" : "Сохранить изменения"}
            </button>
          </div>
        ) : mergeOpen && !splitMode ? (
          <div style={{ flex: "0 1 auto", minHeight: 0, borderTop: `1px solid ${C.border}`, background: "#fffefb", boxShadow: "0 -14px 30px -22px rgba(20,23,26,0.35)", padding: "12px 16px 13px", display: "flex", flexDirection: "column", gap: 10, flexShrink: 0 }}>
            <div style={{ flex: "0 0 auto", display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 13.5, fontWeight: 600, color: C.textPrimary }}>Объединение обращения</span>
              {otherOpenTickets && (
                <span style={{ padding: "2px 8px", borderRadius: 999, fontSize: 11.5, background: mergeTargetId ? C.accentSoft : C.surfaceMuted, color: mergeTargetId ? C.green : C.textFaint }}>
                  {mergeTargetId ? "тикет выбран" : "ничего не выбрано"}
                </span>
              )}
            </div>

            {otherOpenTickets === null && <div style={{ fontSize: 12.5, color: C.textFaint }}>Загружаю открытые тикеты клиента…</div>}
            {otherOpenTickets && otherOpenTickets.length === 0 && (
              <div style={{ padding: "12px 13px", border: `1px dashed ${C.borderStrong}`, borderRadius: 9, fontSize: 12.5, lineHeight: 1.45, color: C.textFaint }}>
                У этого клиента нет других открытых тикетов — объединять не с чем.
              </div>
            )}
            {otherOpenTickets && otherOpenTickets.length > 0 && (
              <div>
                <div style={{ fontSize: 12, color: C.textSecondary, marginBottom: 6 }}>Перенести переписку {ticket.code} в один из этих тикетов, этот — удалить:</div>
                <StyledSelect value={mergeTargetId} onChange={setMergeTargetId}
                  options={otherOpenTickets.map((t) => ({ value: String(t.id), label: `${t.code} · ${t.category} · ${t.text}` }))}
                  placeholder="Выберите тикет…" />
              </div>
            )}

            <div style={{ flex: "0 0 auto", display: "flex", alignItems: "center", gap: 10 }}>
              <button onClick={() => setMergeOpen(false)} style={{ padding: "10px 13px", border: `1px solid ${C.border}`, borderRadius: 9, background: "transparent", fontSize: 13, color: C.textSecondary, cursor: "pointer" }}>Отмена</button>
              <button onClick={doMerge} disabled={!mergeTargetId || merging}
                style={{ flex: 1, padding: "11px 16px", border: "none", borderRadius: 9, fontSize: 13.5, fontWeight: 600, background: mergeTargetId ? C.accent : C.border, color: mergeTargetId ? "#fff" : C.textFaint, cursor: mergeTargetId && !merging ? "pointer" : "default" }}>
                {merging ? "Объединяю…" : "Объединить"}
              </button>
            </div>
          </div>
        ) : (
          <div style={{ flex: "0 1 auto", minHeight: 0, borderTop: `1px solid ${C.border}`, background: "#fffefb", boxShadow: "0 -14px 30px -22px rgba(20,23,26,0.35)", padding: "12px 16px 13px", display: "flex", flexDirection: "column", gap: 10, flexShrink: 0 }}>
            <div style={{ flex: "0 0 auto", display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 13.5, fontWeight: 600, color: C.textPrimary }}>Новый тикет</span>
              <span style={{ padding: "2px 8px", borderRadius: 999, fontSize: 11.5, fontVariantNumeric: "tabular-nums", background: n ? C.accentSoft : C.surfaceMuted, color: n ? C.green : C.textFaint }}>
                {n ? `выбрано ${n} из ${messages ? messages.length : 0}` : "ничего не выбрано"}
              </span>
            </div>

            {n === 0 ? (
              <div style={{ padding: "12px 13px", border: `1px dashed ${C.borderStrong}`, borderRadius: 9, fontSize: 12.5, lineHeight: 1.45, color: C.textFaint }}>
                Выберите хотя бы одно сообщение в списке выше — здесь появятся тема и категория нового тикета.
              </div>
            ) : (
              <div className="sb" style={{ flex: "0 1 auto", minHeight: 0, overflowY: "auto", margin: "0 -4px", padding: "0 4px 2px", display: "flex", flexDirection: "column", gap: 10 }}>
                <div>
                  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, marginBottom: 6 }}>
                    <label style={{ fontSize: 12, color: C.textSecondary }}>Тема</label>
                    <span style={{ fontSize: 11, color: C.textFaint }}>{splitSubjectTouched ? "" : "подставлена из первого сообщения"}</span>
                  </div>
                  <input value={splitSubjectValue} onChange={(e) => { setSplitSubjectManual(e.target.value); setSplitSubjectTouched(true); }} placeholder="Тема нового тикета"
                    style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: `1px solid ${C.border}`, borderRadius: 9, background: C.surfaceMuted, fontSize: 13.5, fontWeight: 500, color: C.textPrimary }} />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 11 }}>
                  <div>
                    <label style={{ display: "block", fontSize: 12, color: C.textSecondary, marginBottom: 6 }}>Категория</label>
                    <CategorySelect value={splitCategory} onChange={setSplitCategory} options={categories} />
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: 12, color: C.textSecondary, marginBottom: 6 }}>Сообщения</label>
                    <div style={{ display: "flex", gap: 3, padding: 3, border: `1px solid ${C.border}`, borderRadius: 9, background: C.surfaceMuted }}>
                      <button onClick={() => setMoveMode("move")}
                        style={{ flex: 1, padding: "6px 6px", border: "none", borderRadius: 7, fontSize: 12.5, cursor: "pointer", background: moveMode === "move" ? C.surface : "transparent", color: moveMode === "move" ? C.textPrimary : C.textSecondary, fontWeight: moveMode === "move" ? 600 : 400, boxShadow: moveMode === "move" ? "0 1px 2px rgba(20,23,26,0.12)" : "none" }}>
                        Перенести
                      </button>
                      <button onClick={() => setMoveMode("copy")}
                        style={{ flex: 1, padding: "6px 6px", border: "none", borderRadius: 7, fontSize: 12.5, cursor: "pointer", background: moveMode === "copy" ? C.surface : "transparent", color: moveMode === "copy" ? C.textPrimary : C.textSecondary, fontWeight: moveMode === "copy" ? 600 : 400, boxShadow: moveMode === "copy" ? "0 1px 2px rgba(20,23,26,0.12)" : "none" }}>
                        Копировать
                      </button>
                    </div>
                  </div>
                </div>
                <div style={{ fontSize: 11.5, lineHeight: 1.4, color: C.textFaint }}>
                  {moveMode === "move"
                    ? `Сообщения уйдут из ${ticket.code} — вместо них останется ссылка на новый тикет.`
                    : `Сообщения останутся в ${ticket.code} и появятся в новом тикете.`}
                </div>
              </div>
            )}

            <div style={{ flex: "0 0 auto", display: "flex", alignItems: "center", gap: 10 }}>
              <button onClick={exitSplit} style={{ padding: "10px 13px", border: `1px solid ${C.border}`, borderRadius: 9, background: "transparent", fontSize: 13, color: C.textSecondary, cursor: "pointer" }}>Отмена</button>
              <button onClick={doSplit} disabled={n === 0 || splitting}
                style={{ flex: 1, padding: "11px 16px", border: "none", borderRadius: 9, fontSize: 13.5, fontWeight: 600, background: n ? C.accent : C.border, color: n ? "#fff" : C.textFaint, cursor: n && !splitting ? "pointer" : "default" }}>
                {splitting ? "Создаю…" : (n ? `Создать тикет из ${n} ${pluralRu(n, "сообщения", "сообщений", "сообщений")}` : "Создать тикет")}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- App ---------- */

function locationFromUrl() {
  const path = window.location.pathname;
  const ticketId = new URLSearchParams(window.location.search).get("ticket");
  const clientMatch = path.match(/^\/clients\/([^/]+)\/?$/);
  let view = "today";
  let clientId = null;
  if (clientMatch) { view = "client"; clientId = clientMatch[1]; }
  else if (path === "/clients") view = "clients";
  else if (path === "/feed") view = "feed";
  else if (path === "/promises") view = "promises";
  else if (path === "/analytics") view = "analytics";
  else if (path === "/settings") view = "settings";
  else if (path === "/audit-log") view = "audit";
  return { view, clientId, ticketId: ticketId || null };
}
function urlForView(view, clientId) {
  if (view === "client" && clientId) return `/clients/${clientId}`;
  if (view === "clients") return "/clients";
  if (view === "feed") return "/feed";
  if (view === "promises") return "/promises";
  if (view === "analytics") return "/analytics";
  if (view === "settings") return "/settings";
  if (view === "audit") return "/audit-log";
  return "/pulse";
}

function LoginScreen({ onLoggedIn }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [googleClientId, setGoogleClientId] = useState(null);
  const googleBtnRef = useRef(null);

  useEffect(() => {
    api.getAuthConfig().then((c) => setGoogleClientId(c.google_client_id || null)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!googleClientId) return;
    const scriptId = "google-identity-script";

    const init = () => {
      if (!window.google?.accounts?.id || !googleBtnRef.current) return;
      window.google.accounts.id.initialize({
        client_id: googleClientId,
        callback: async (response) => {
          setLoading(true);
          setError(null);
          try {
            const result = await api.loginWithGoogle(response.credential);
            setToken(result.access_token);
            onLoggedIn(result.user);
          } catch (e) {
            setError(e.message);
          } finally {
            setLoading(false);
          }
        },
      });
      window.google.accounts.id.renderButton(googleBtnRef.current, { theme: "outline", size: "large", width: 320 });
    };

    if (document.getElementById(scriptId)) {
      init();
    } else {
      const script = document.createElement("script");
      script.id = scriptId;
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.onload = init;
      document.head.appendChild(script);
    }
  }, [googleClientId]);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const result = await api.login(email.trim(), password);
      setToken(result.access_token);
      onLoggedIn(result.user);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ fontFamily: SANS, background: C.bg, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <style>{FONT_IMPORT}</style>
      <div style={{ width: 360, maxWidth: "100%", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: "32px 28px", boxShadow: "0 24px 60px -30px rgba(20,23,26,0.35)" }}>
        <div style={{ fontSize: 19, fontWeight: 700, color: C.textPrimary, marginBottom: 4 }}>Support Desk</div>
        <div style={{ fontSize: 13, color: C.textSecondary, marginBottom: 22 }}>Войдите, чтобы продолжить</div>

        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 11 }}>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" required autoFocus
            style={{ boxSizing: "border-box", padding: "10px 12px", border: `1px solid ${C.border}`, borderRadius: 8, background: C.surfaceMuted, fontSize: 13.5, color: C.textPrimary }} />
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Пароль" required
            style={{ boxSizing: "border-box", padding: "10px 12px", border: `1px solid ${C.border}`, borderRadius: 8, background: C.surfaceMuted, fontSize: 13.5, color: C.textPrimary }} />
          {error && <ErrorBlock message={error} />}
          <button type="submit" disabled={loading}
            style={{ padding: "11px 0", border: "none", borderRadius: 9, background: C.accent, color: "#fff", fontSize: 13.5, fontWeight: 600, cursor: loading ? "default" : "pointer", opacity: loading ? 0.6 : 1 }}>
            {loading ? "Вхожу…" : "Войти"}
          </button>
        </form>

        {googleClientId && (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "18px 0" }}>
              <div style={{ flex: 1, height: 1, background: C.border }} />
              <span style={{ fontSize: 11.5, color: C.textFaint }}>или</span>
              <div style={{ flex: 1, height: 1, background: C.border }} />
            </div>
            <div ref={googleBtnRef} style={{ display: "flex", justifyContent: "center" }} />
          </>
        )}
      </div>
    </div>
  );
}

function App({ currentUser, onLogout, onUserUpdated }) {
  const narrow = useIsNarrow(880);
  const [mobileOpen, setMobileOpen] = useState(false);

  const initialLoc = useMemo(() => locationFromUrl(), []);
  const [view, setViewState] = useState(initialLoc.view);
  const [clientId, setClientId] = useState(initialLoc.clientId);
  const [period, setPeriod] = useState("30");
  const [from, setFrom] = useState(isoDaysAgo(14));
  const [to, setTo] = useState(isoToday());
  const [drawerTicket, setDrawerTicket] = useState(null);
  const [refreshTick, setRefreshTick] = useState(0);

  const [clientsAll, setClientsAll] = useState(null);
  const [promisesAll, setPromisesAll] = useState([]);
  const [settingsLite, setSettingsLite] = useState(null);
  const [bootError, setBootError] = useState(null);

  const onDataChanged = useCallback(() => setRefreshTick((n) => n + 1), []);

  // Переход между разделами — обновляет и состояние, и адрес в браузере.
  const navigate = useCallback((nextView, nextClientId = null) => {
    setViewState(nextView);
    setClientId(nextClientId);
    const path = urlForView(nextView, nextClientId);
    if (window.location.pathname !== path) {
      window.history.pushState({}, "", path);
    }
  }, []);
  const goClient = useCallback((id) => navigate("client", id), [navigate]);
  const setViewSafe = useCallback((v) => navigate(v, null), [navigate]);

  // Открытие/закрытие панели тикета — тоже отражается в адресе (?ticket=id),
  // но через replaceState, чтобы не засорять историю переходов «туда-обратно».
  const openDrawerTicket = useCallback((ticket) => {
    setDrawerTicket(ticket);
    const params = new URLSearchParams(window.location.search);
    params.set("ticket", ticket.id);
    window.history.replaceState({}, "", `${window.location.pathname}?${params.toString()}`);
  }, []);
  const closeDrawerTicket = useCallback(() => {
    setDrawerTicket(null);
    const params = new URLSearchParams(window.location.search);
    params.delete("ticket");
    const search = params.toString();
    window.history.replaceState({}, "", window.location.pathname + (search ? `?${search}` : ""));
  }, []);
  const openTicketById = useCallback(async (ticketId) => {
    try {
      const t = await api.getTicket(ticketId);
      openDrawerTicket(normalizeTicket(t));
    } catch (e) {
      setBootError(e.message);
    }
  }, [openDrawerTicket]);

  // Открыть тикет из URL при первой загрузке страницы (?ticket=123)
  useEffect(() => {
    if (initialLoc.ticketId) openTicketById(initialLoc.ticketId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Кнопки "вперёд"/"назад" браузера — синхронизируем состояние с адресом
  useEffect(() => {
    const onPopState = () => {
      const loc = locationFromUrl();
      setViewState(loc.view);
      setClientId(loc.clientId);
      if (loc.ticketId) {
        api.getTicket(loc.ticketId).then((t) => setDrawerTicket(normalizeTicket(t))).catch(() => setDrawerTicket(null));
      } else {
        setDrawerTicket(null);
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.getClients({ days: 30 }), api.getPromises(), api.getSettings()])
      .then(([clients, promises, settings]) => {
        if (cancelled) return;
        setClientsAll(clients);
        setPromisesAll(promises);
        setSettingsLite(settings);
        setBootError(null);
      })
      .catch((e) => { if (!cancelled) setBootError(e.message); });
    return () => { cancelled = true; };
  }, [refreshTick]);

  const clientsById = useMemo(() => {
    const map = {};
    (clientsAll || []).forEach((c) => { map[c.id] = c; });
    return map;
  }, [clientsAll]);

  if (bootError) {
    return (
      <div style={{ fontFamily: SANS, background: C.bg, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <style>{FONT_IMPORT}</style>
        <div style={{ maxWidth: 480 }}>
          <ErrorBlock message={`Не удалось загрузить дашборд: ${bootError}`} onRetry={() => setRefreshTick((n) => n + 1)} />
        </div>
      </div>
    );
  }
  if (!clientsAll || !settingsLite) {
    return (
      <div style={{ fontFamily: SANS, background: C.bg, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <style>{FONT_IMPORT}</style>
        <LoadingBlock label="Подключаюсь к backend…" />
      </div>
    );
  }

  const todayOpenCount = clientsAll.reduce((s, c) => s + (c.open_count || 0), 0);
  const feedOpenCount = clientsAll.reduce((s, c) => s + (c.open_count || 0), 0);
  const promisesOverdueCount = promisesAll.filter((p) => p.bucket === "overdue").length;
  const jiraBaseUrl = settingsLite.jira_base_url || "";

  let content;
  if (view === "clients") {
    content = <ClientsPage clientsAll={clientsAll} onOpenClient={goClient} goToday={() => setViewSafe("today")} promisesAll={promisesAll} refreshTick={refreshTick} onDataChanged={onDataChanged} />;
  } else if (view === "client" && clientId) {
    content = <ClientDetailPage clientId={clientId} period={period} setPeriod={setPeriod} from={from} to={to} setFrom={setFrom} setTo={setTo} onBack={() => setViewSafe("clients")} onOpenTicket={openDrawerTicket} promisesAll={promisesAll} refreshTick={refreshTick} onDataChanged={onDataChanged} onDeleted={() => setViewSafe("clients")} />;
  } else if (view === "feed") {
    content = <FeedPage onOpenTicket={openDrawerTicket} attentionAfterMin={settingsLite.attention_after_min ?? 45} refreshTick={refreshTick} clientsById={clientsById} jiraBaseUrl={jiraBaseUrl} onDataChanged={onDataChanged} />;
  } else if (view === "promises") {
    content = <PromisesPage refreshTick={refreshTick} onDataChanged={onDataChanged} clientsById={clientsById} onOpenTicketId={openTicketById} jiraBaseUrl={jiraBaseUrl} />;
  } else if (view === "analytics") {
    content = <AnalyticsPage clientsById={clientsById} onOpenClient={goClient} refreshTick={refreshTick} />;
  } else if (view === "settings") {
    content = <Settings onSaved={onDataChanged} currentUser={currentUser} onUserUpdated={onUserUpdated} />;
  } else if (view === "audit") {
    content = <AuditLogPage />;
  } else {
    content = <TodayPage onOpenTicket={openDrawerTicket} onOpenTicketId={openTicketById} refreshTick={refreshTick} onDataChanged={onDataChanged} clientsById={clientsById} promisesAll={promisesAll} jiraBaseUrl={jiraBaseUrl} aiProviders={settingsLite.ai_providers} onGoSettings={() => setViewSafe("settings")} />;
  }

  const drawerClient = drawerTicket ? clientsById[drawerTicket.clientId] : null;

  return (
    <div style={{ fontFamily: SANS, background: C.bg, minHeight: "100vh", display: narrow ? "block" : "flex", color: C.textPrimary }}>
      <style>{FONT_IMPORT}</style>
      <Sidebar
        view={view}
        setView={setViewSafe}
        todayOpenCount={todayOpenCount}
        feedOpenCount={feedOpenCount}
        promisesOverdueCount={promisesOverdueCount}
        aiModel={(() => {
          const active = (settingsLite.ai_providers || []).find((p) => p.enabled && p.api_key);
          return active ? `${active.provider}: ${active.model}` : "эвристика (без ИИ)";
        })()}
        clientsCount={clientsAll.length}
        narrow={narrow}
        mobileOpen={mobileOpen}
        setMobileOpen={setMobileOpen}
        oracleLastSync={settingsLite.oracle_last_sync}
        currentUser={currentUser}
        onLogout={onLogout}
      />
      <div style={{ flex: 1, minWidth: 0, paddingTop: narrow ? 52 : 0, boxSizing: "border-box" }}>{content}</div>

      {drawerTicket && (
        <TicketDrawer
          key={drawerTicket.id}
          ticket={drawerTicket}
          client={drawerClient}
          onClose={closeDrawerTicket}
          onSaved={onDataChanged}
          jiraBaseUrl={jiraBaseUrl}
          onOpenClient={goClient}
          onOpenTicket={openDrawerTicket}
          attentionAfterMin={settingsLite.attention_after_min ?? 45}
        />
      )}
    </div>
  );
}

export default function AppRoot() {
  const [currentUser, setCurrentUser] = useState(null); // null — проверяем сессию, false — не вошли, объект — вошли

  useEffect(() => {
    setUnauthorizedHandler(() => setCurrentUser(false));
    const token = getToken();
    if (!token) { setCurrentUser(false); return; }
    api.me().then(setCurrentUser).catch(() => { setToken(null); setCurrentUser(false); });
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setCurrentUser(false);
  }, []);

  if (currentUser === null) {
    return (
      <div style={{ fontFamily: SANS, background: C.bg, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <style>{FONT_IMPORT}</style>
        <LoadingBlock label="Проверяю сессию…" />
      </div>
    );
  }
  if (!currentUser) {
    return <LoginScreen onLoggedIn={setCurrentUser} />;
  }
  return <App currentUser={currentUser} onLogout={logout} onUserUpdated={setCurrentUser} />;
}
