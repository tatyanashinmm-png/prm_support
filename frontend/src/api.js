// Тонкая обёртка над fetch под контракт backend (architecture.md, раздел 4).
// VITE_API_URL по умолчанию смотрит на локальный docker-compose backend.
const BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";

const TOKEN_KEY = "sd_token";
export function getToken() {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}
export function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* приватный режим и т.п. — не критично, просто разлогинит при перезагрузке */ }
}

// App подписывается сюда один раз при старте — если backend вернул 401
// (токен истёк/недействителен), сбрасываем сессию и показываем экран входа,
// не дожидаясь, пока пользователь наткнётся на ошибку сам.
let onUnauthorized = null;
export function setUnauthorizedHandler(fn) { onUnauthorized = fn; }

function qs(params = {}) {
  const entries = Object.entries(params).filter(
    ([, v]) => v !== undefined && v !== null && v !== ""
  );
  if (!entries.length) return "";
  return "?" + entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
}

async function request(path, options = {}) {
  let res;
  try {
    // Content-Type только при наличии тела запроса — иначе даже обычный
    // GET считается "непростым" запросом и браузер шлёт перед ним ещё и
    // preflight OPTIONS, задваивая число запросов на каждую загрузку страницы.
    const token = getToken();
    const headers = {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { "Authorization": `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    };
    res = await fetch(`${BASE}${path}`, {
      ...options,
      headers,
    });
  } catch (e) {
    throw new Error(
      `Нет связи с backend (${BASE}). Проверьте, что docker-compose up запущен. (${e.message})`
    );
  }

  if (res.status === 401) {
    setToken(null);
    if (onUnauthorized) onUnauthorized();
  }

  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail || JSON.stringify(body);
    } catch {
      // тело не JSON — оставляем statusText
    }
    throw new Error(`${res.status}: ${detail}`);
  }

  if (res.status === 204) return null;
  return res.json();
}

export function isoToday() {
  return new Date().toISOString().slice(0, 10);
}
export function isoDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

// Единый список периодов для всех фильтров в приложении.
export const PERIOD_OPTIONS = [
  { key: "today", label: "Сегодня" },
  { key: "yesterday", label: "Вчера" },
  { key: "7", label: "7 дней" },
  { key: "30", label: "30 дней" },
  { key: "90", label: "90 дней" },
  { key: "custom", label: "Произвольный" },
];

// Приводит выбранный период к параметрам, которые понимает backend:
// days для 7/30/90, date_from/date_to (реальные календарные даты) для
// сегодня/вчера/произвольного диапазона.
export function periodParams(period, customFrom, customTo) {
  const today = isoToday();
  if (period === "today") return { date_from: today, date_to: today };
  if (period === "yesterday") {
    const y = isoDaysAgo(1);
    return { date_from: y, date_to: y };
  }
  if (period === "custom") {
    if (!customFrom || !customTo) return { days: 30 };
    return customFrom <= customTo
      ? { date_from: customFrom, date_to: customTo }
      : { date_from: customTo, date_to: customFrom };
  }
  return { days: Number(period) };
}

// Дополняет тикет с backend полями, которых нет в TicketOut напрямую, но
// нужны интерфейсу (сколько дней назад, время, ожидание в минутах и т.д.),
// и приводит имена полей к тем, что использует UI.
export function normalizeTicket(t) {
  const firstMsg = new Date(t.first_message_at);
  const firstResp = t.first_response_at ? new Date(t.first_response_at) : null;
  const now = new Date();
  // По календарным датам, не по скользящему окну в 24 часа — иначе сообщение
  // с вечера вчера, на которое смотрят утром (прошло < 24ч), ошибочно
  // помечалось бы "Сегодня" вместо "Вчера".
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfMsgDay = new Date(firstMsg.getFullYear(), firstMsg.getMonth(), firstMsg.getDate());
  const daysAgo = Math.max(0, Math.round((startOfToday - startOfMsgDay) / 86400000));
  // wait_business_min считает backend, с учётом рабочих часов/выходных/
  // праздников (см. app/business_hours.py) — не пересчитываем на фронте.
  const waitMin = typeof t.wait_business_min === "number"
    ? t.wait_business_min
    : Math.max(0, Math.round(((firstResp || now) - firstMsg) / 60000));

  return {
    ...t,
    clientId: t.client_id,
    text: t.subject,
    daysAgo,
    waitMin,
    time: `${String(firstMsg.getHours()).padStart(2, "0")}:${String(firstMsg.getMinutes()).padStart(2, "0")}`,
    confidence: t.ai_confidence ?? 0,
    jiraUrl: t.jira_url || "",
    dueDate: t.due_date || "",
    promiseText: t.promise_text || "",
    comment: t.comment || "",
    isPaidWork: !!t.is_paid_work,
    plannedCost: t.planned_cost || "",
    actualHours: t.actual_hours ?? "",
    actualCost: t.actual_cost || "",
    responseKind: t.response_kind || "no_response", // no_response | waiting_us | waiting_client | closed
    newMessageCount: t.new_message_count || 0,
  };
}

// Строит кликабельную ссылку из значения jira_url: если это уже полный URL —
// используем как есть, если короткий код (SUP-1039) — приклеиваем к
// jira_base_url из настроек. Без base_url для кода ссылку не построить —
// вызывающий код в этом случае просто покажет текст без ссылки.
export function jiraHref(value, baseUrl) {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  if (baseUrl) return baseUrl.replace(/\/+$/, "") + "/" + value.replace(/^\/+/, "");
  return null;
}

export const api = {
  getClients: (params) => request(`/clients${qs(params)}`),
  createClient: (payload) => request(`/clients`, { method: "POST", body: JSON.stringify(payload) }),
  deleteClient: (id) => request(`/clients/${id}`, { method: "DELETE" }),
  getClient: (id, params) => request(`/clients/${id}${qs(params)}`),
  updateClient: (id, patch) => request(`/clients/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  getTelegramInfo: (id) => request(`/clients/${id}/telegram-info`),
  getClientTickets: (id, params) => request(`/clients/${id}/tickets${qs(params)}`),
  getCategoryStats: (id) => request(`/clients/${id}/category-stats`),
  syncClients: (clients) => request(`/clients/sync`, { method: "POST", body: JSON.stringify({ clients }) }),

  getTickets: (params) => request(`/tickets${qs(params)}`),
  createTicket: (payload) => request(`/tickets`, { method: "POST", body: JSON.stringify(payload) }),
  mergeTickets: (keepTicketId, mergeTicketId) => request(`/tickets/merge`, { method: "POST", body: JSON.stringify({ keep_ticket_id: keepTicketId, merge_ticket_id: mergeTicketId }) }),
  splitTicket: (ticketId, payload) => request(`/tickets/${ticketId}/split`, { method: "POST", body: JSON.stringify(payload) }),
  deleteTicket: (id) => request(`/tickets/${id}`, { method: "DELETE" }),
  getTicket: (id) => request(`/tickets/${id}`),
  getTicketMessages: (id) => request(`/tickets/${id}/messages`),
  updateTicket: (id, patch) => request(`/tickets/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  markSeen: (id) => request(`/tickets/${id}/mark-seen`, { method: "POST" }),
  runAutocloseCheck: () => request(`/tickets/run-autoclose-check`, { method: "POST" }),

  getCategories: () => request(`/categories`),
  renameCategory: (oldName, newName) => request(`/categories/rename`, { method: "PATCH", body: JSON.stringify({ old_name: oldName, new_name: newName }) }),
  getSenders: () => request(`/ingest/senders`),
  recomputeSenderRole: (tgId) => request(`/ingest/senders/${tgId}/recompute-role`, { method: "POST" }),

  login: (email, password) => request(`/auth/login`, { method: "POST", body: JSON.stringify({ email, password }) }),
  getAuthConfig: () => request(`/auth/config`),
  loginWithGoogle: (idToken) => request(`/auth/google`, { method: "POST", body: JSON.stringify({ id_token: idToken }) }),
  me: () => request(`/auth/me`),
  changePassword: (currentPassword, newPassword) => request(`/auth/change-password`, { method: "POST", body: JSON.stringify({ current_password: currentPassword || null, new_password: newPassword }) }),

  getUsers: () => request(`/users`),
  createUser: (email, name, password) => request(`/users`, { method: "POST", body: JSON.stringify({ email, name, password }) }),
  deactivateUser: (id) => request(`/users/${id}/deactivate`, { method: "PATCH" }),
  activateUser: (id) => request(`/users/${id}/activate`, { method: "PATCH" }),
  resetUserPassword: (id, newPassword) => request(`/users/${id}/reset-password`, { method: "POST", body: JSON.stringify({ new_password: newPassword }) }),

  getAuditLog: (params) => request(`/audit-log${qs(params)}`),
  getAuditActions: () => request(`/audit-log/actions`),
  fixRoleByName: (senderName, targetType) => request(`/ingest/senders/fix-by-name`, { method: "POST", body: JSON.stringify({ sender_name: senderName, target_type: targetType }) }),

  getActiveChats: (params) => request(`/metrics/active-chats${qs(params)}`),
  getPeriodComparison: (params) => request(`/metrics/period-comparison${qs(params)}`),

  getDigestToday: (params) => request(`/digest/today${qs(params)}`),
  regenerateDigest: (params) => request(`/digest/regenerate${qs(params)}`, { method: "POST" }),
  sendDigest: () => request(`/digest/send`, { method: "POST" }),

  getPromises: (params) => request(`/promises${qs(params)}`),
  markPromiseDone: (ticketId) => request(`/promises/${ticketId}`, { method: "PATCH" }),

  getSettings: () => request(`/settings`),
  updateSettings: (patch) => request(`/settings`, { method: "PATCH", body: JSON.stringify(patch) }),
  testKey: () => request(`/settings/test-key`, { method: "POST" }),
};
