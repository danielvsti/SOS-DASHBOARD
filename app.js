const API_BASE = "https://sos.vsti.cl";
const TOKEN_KEY = "sos_dashboard_token";
const USER_KEY = "sos_dashboard_user";
const CC_KEY = "sos_dashboard_cc";

let currentData = null;
const charts = {};

const $ = (id) => document.getElementById(id);
const nf = new Intl.NumberFormat("es-CL");
const dtf = new Intl.DateTimeFormat("es-CL", { dateStyle: "short", timeStyle: "short" });

function token() { return localStorage.getItem(TOKEN_KEY) || ""; }
function storedUser() {
  try { return JSON.parse(localStorage.getItem(USER_KEY) || "null"); }
  catch { return null; }
}
function setMessage(text, ok = false) {
  const el = $("loginMessage");
  el.textContent = text || "";
  el.style.color = ok ? "#16a34a" : "#b91c1c";
}
function authHeaders() {
  return token() ? { Authorization: `Bearer ${token()}` } : {};
}
function number(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function fmt(v) { return nf.format(number(v)); }
function pct(v) { return v == null || v === "" ? "—" : `${Number(v).toFixed(1)}%`; }
function dash(v) { return v == null || v === "" ? "—" : v; }
function date(v) {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "—" : dtf.format(d);
}
function humanMinutes(mins) {
  const n = number(mins);
  if (!n) return "—";
  if (n < 60) return `${Math.round(n)} min`;
  const h = Math.floor(n / 60);
  const m = Math.round(n % 60);
  return m ? `${h} h ${m} min` : `${h} h`;
}

const labelMap = {
  ACTIVE: "Activo",
  ASSIGNED: "Asignado",
  EN_ROUTE: "En camino",
  ON_SITE: "En sitio",
  RESOLVED: "Resuelto",
  CLOSED: "Cerrado",
  CANCELLED: "Cancelado",
  MOBILE_APP: "PWA Vecino",
  GPS_DEVICE: "Botón físico",
  SOS_GENERAL: "SOS general",
  SOS_DEVICE: "SOS físico",
  MEDICAL: "Médica",
  FIRE: "Incendio",
  SECURITY: "Seguridad",
  VIF: "VIF",
  ACCIDENT: "Accidente",
  RISK: "Riesgo",
  OTHER: "Otro",
  AVAILABLE: "Disponible",
  BUSY: "Ocupado",
  SIN_UBICACION: "Sin ubicación",
  ONLINE: "Online",
  DESACTUALIZADO: "Desactualizado",
  OFFLINE: "Offline"
};
function niceLabel(value) { return labelMap[value] || String(value || "—").replaceAll("_", " "); }

function badge(value) {
  const label = niceLabel(value);
  const v = String(value || "").toUpperCase();
  let cls = "dark";
  if (["VALIDATED", "AVAILABLE", "ONLINE", "RESOLVED", "CLOSED"].includes(v)) cls = "green";
  if (["PROVISIONAL_ACTIVE", "ASSIGNED", "EN_ROUTE", "ON_SITE", "DESACTUALIZADO"].includes(v)) cls = "amber";
  if (["REJECTED", "CANCELLED", "OFFLINE"].includes(v)) cls = "red";
  if (["ACTIVE", "MOBILE_APP", "GPS_DEVICE"].includes(v)) cls = "blue";
  return `<span class="badge ${cls}">${label}</span>`;
}

function showApp() {
  $("loginView").classList.add("hidden");
  $("appView").classList.remove("hidden");
}
function showLogin() {
  $("appView").classList.add("hidden");
  $("loginView").classList.remove("hidden");
}

async function api(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
      ...(options.headers || {})
    }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);
  return data;
}

async function login() {
  const phone = $("loginPhone").value.trim();
  if (!phone) return setMessage("Ingresa el teléfono del operador o administrador.");
  $("loginBtn").disabled = true;
  setMessage("Validando acceso...", true);
  try {
    const data = await api("/auth/panel-login", {
      method: "POST",
      body: JSON.stringify({ phone, panel_type: "CONTROL_CENTER" })
    });
    localStorage.setItem(TOKEN_KEY, data.token);
    localStorage.setItem(USER_KEY, JSON.stringify(data.user));
    if (data.user?.control_center_code) localStorage.setItem(CC_KEY, data.user.control_center_code);
    setMessage("Acceso correcto.", true);
    showApp();
    await loadDashboard();
  } catch (error) {
    setMessage(error.message);
  } finally {
    $("loginBtn").disabled = false;
  }
}

async function checkSession() {
  if (!token()) return false;
  try {
    const data = await api("/auth/session");
    localStorage.setItem(USER_KEY, JSON.stringify(data.user));
    if (data.user?.control_center_code) localStorage.setItem(CC_KEY, data.user.control_center_code);
    return true;
  } catch {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    return false;
  }
}

async function loadDashboard() {
  const days = $("periodSelect").value;
  const cc = ($("ccInput").value || localStorage.getItem(CC_KEY) || "CC-VINA").trim().toUpperCase();
  $("ccInput").value = cc;
  localStorage.setItem(CC_KEY, cc);
  $("refreshBtn").disabled = true;
  try {
    const data = await api(`/dashboard/analytics?control_center_code=${encodeURIComponent(cc)}&days=${encodeURIComponent(days)}`);
    currentData = data;
    renderDashboard(data);
  } catch (error) {
    alert(`No se pudo cargar el dashboard: ${error.message}`);
    if (/sesión|operator|admin|unauthorized/i.test(error.message)) logout(false);
  } finally {
    $("refreshBtn").disabled = false;
  }
}

function renderDashboard(data) {
  const user = storedUser() || data.generated_by || {};
  const t = data.summary?.tickets || {};
  const u = data.summary?.users || {};
  const r = data.summary?.resolvers || {};
  const s = data.summary?.sirens || {};
  const d = data.summary?.devices || {};

  $("subtitle").textContent = `${data.control_center?.name || data.control_center?.code || "Centro"} · Indicadores de operación y gestión`;
  $("userLabel").textContent = `${user.full_name || user.name || "Usuario"} · ${user.role || ""}`;
  $("updatedAt").textContent = `Actualizado: ${data.updated_at || "—"}`;
  $("periodLabel").textContent = `Período: últimos ${data.period_days} días`;

  setText("kpiTicketsPeriod", fmt(t.tickets_total_period));
  setText("kpiTicketsAll", fmt(t.tickets_total_all_time));
  setText("kpiOpen", fmt(t.tickets_open));
  setText("kpiOldestOpen", t.oldest_open_human || humanMinutes(t.oldest_open_minutes));
  setText("kpiResolveAvg", t.avg_resolve_human || humanMinutes(t.avg_resolve_minutes));
  setText("kpiSlaResolve", pct(t.sla_resolve_60m_pct));
  setText("kpiResolversAvailable", fmt(r.resolvers_available_now));
  setText("kpiResolversOnline", fmt(r.resolvers_online));

  setText("kpi24h", fmt(t.tickets_last_24h));
  setText("kpiPriority", fmt(t.tickets_high_priority));
  setText("kpiNeighborsValidated", `${fmt(u.neighbors_validated)} / ${fmt(u.neighbors_total)}`);
  setText("kpiNeighborsPending", fmt(number(u.neighbors_provisional)));
  setText("kpiSirensOnline", `${fmt(s.sirens_online)} / ${fmt(s.sirens_total)}`);
  setText("kpiDevicesOnline", `${fmt(d.devices_online)} / ${fmt(d.devices_total)}`);
  setText("kpiAssignAvg", t.avg_assign_human || humanMinutes(t.avg_assign_minutes));
  setText("kpiSlaAck", pct(t.sla_ack_5m_pct));

  setText("slaAck", pct(t.sla_ack_5m_pct));
  setText("slaAssign", pct(t.sla_assign_15m_pct));
  setText("slaResolve", pct(t.sla_resolve_60m_pct));
  setText("ackAvg", `Promedio ${t.avg_ack_human || humanMinutes(t.avg_ack_minutes)}`);
  setText("assignAvg", `Promedio ${t.avg_assign_human || humanMinutes(t.avg_assign_minutes)}`);
  setText("resolveAvg", `Promedio ${t.avg_resolve_human || humanMinutes(t.avg_resolve_minutes)}`);

  setText("healthUsers", fmt(u.users_active));
  setText("healthUsersDetail", `${fmt(u.users_total)} total · ${fmt(u.operators_total)} operadores · ${fmt(u.admins_total)} admin`);
  setText("healthResolvers", fmt(r.resolvers_online));
  setText("healthResolversDetail", `${fmt(r.resolvers_total)} total · ${fmt(r.resolvers_offline)} offline`);
  setText("healthSirens", fmt(s.sirens_active));
  setText("healthSirensDetail", `${fmt(s.sirens_total)} total · ${fmt(s.sirens_offline)} offline`);
  setText("healthDevices", fmt(d.devices_online));
  setText("healthDevicesDetail", `${fmt(d.devices_total)} total · ${fmt(d.devices_sos_active)} SOS activo`);

  renderCharts(data);
  renderTables(data);
}

function setText(id, value) { $(id).textContent = dash(value); }

function chart(id, config) {
  if (charts[id]) charts[id].destroy();
  const ctx = $(id);
  charts[id] = new Chart(ctx, config);
}
function palette(count) {
  const colors = ["#2563eb", "#16a34a", "#f59e0b", "#dc2626", "#7c3aed", "#0891b2", "#db2777", "#334155", "#65a30d", "#ea580c"];
  return Array.from({ length: count }, (_, i) => colors[i % colors.length]);
}
function noData(items) { return !items || items.length === 0 || items.every((x) => number(x.value ?? x.total) === 0); }

function renderCharts(data) {
  const byDay = data.charts?.tickets_by_day || [];
  chart("ticketsByDayChart", {
    type: "line",
    data: {
      labels: byDay.map(x => x.label),
      datasets: [
        { label: "Total", data: byDay.map(x => number(x.total)), tension: .35, fill: true },
        { label: "Abiertos", data: byDay.map(x => number(x.open)), tension: .35 },
        { label: "Resueltos/Cerrados", data: byDay.map(x => number(x.resolved)), tension: .35 }
      ]
    },
    options: chartOptions({ stacked: false })
  });

  renderDoughnut("ticketsByStateChart", data.charts?.tickets_by_state || [], "Tickets");
  renderBar("alertTypeChart", data.charts?.tickets_by_alert_type || [], "Tickets", true);
  renderDoughnut("sourceChart", data.charts?.tickets_by_source || [], "Origen");

  const hour = data.charts?.tickets_by_hour || [];
  chart("hourChart", {
    type: "bar",
    data: { labels: hour.map(x => x.label), datasets: [{ label: "Tickets", data: hour.map(x => number(x.value)) }] },
    options: chartOptions()
  });

  renderBar("actionsChart", data.charts?.actions_by_type || [], "Acciones", true);

  const neighbors = (data.rankings?.top_neighbors || []).map(x => ({ label: x.name, value: x.tickets_count }));
  renderBar("topNeighborsChart", neighbors, "Tickets", true);

  const resolvers = (data.rankings?.top_resolvers || []).map(x => ({ label: x.name, value: x.assigned_count }));
  renderBar("topResolversChart", resolvers, "Asignados", true);
}

function renderDoughnut(id, items, label) {
  const labels = items.map(x => niceLabel(x.label));
  const values = items.map(x => number(x.value));
  chart(id, {
    type: "doughnut",
    data: { labels, datasets: [{ label, data: values, backgroundColor: palette(values.length), borderWidth: 0 }] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: "bottom" }, tooltip: { callbacks: { label: ctx => `${ctx.label}: ${fmt(ctx.raw)}` } } },
      cutout: "58%"
    }
  });
}

function renderBar(id, items, label, horizontal = false) {
  const labels = items.map(x => niceLabel(x.label));
  const values = items.map(x => number(x.value));
  chart(id, {
    type: "bar",
    data: { labels, datasets: [{ label, data: values, backgroundColor: palette(values.length), borderWidth: 0, borderRadius: 8 }] },
    options: chartOptions({ horizontal })
  });
}

function chartOptions(opts = {}) {
  return {
    indexAxis: opts.horizontal ? "y" : "x",
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: true, position: "bottom" }, tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${fmt(ctx.raw)}` } } },
    scales: {
      x: { grid: { color: "rgba(148,163,184,.18)" }, stacked: !!opts.stacked, ticks: { maxRotation: 0, autoSkip: true } },
      y: { grid: { color: "rgba(148,163,184,.18)" }, stacked: !!opts.stacked, beginAtZero: true }
    }
  };
}

function renderTables(data) {
  const recent = data.operations?.recent_tickets || [];
  $("recentTicketsTable").innerHTML = table(
    ["Ticket", "Estado", "Origen", "Vecino", "Resolutor", "Edad", "Creado"],
    recent.map(t => [
      `<strong>${shortId(t.id)}</strong><br><small>${dash(t.title || niceLabel(t.alert_type))}</small>`,
      badge(t.state),
      `${badge(t.source_type)}<br><small>${niceLabel(t.alert_type)}</small>`,
      `${dash(t.citizen_name)}<br><small>${dash(t.citizen_phone)}</small>`,
      dash(t.resolver_name),
      humanMinutes(t.age_minutes),
      date(t.created_at)
    ])
  );

  const resolvers = data.operations?.resolver_status || [];
  $("resolverStatusTable").innerHTML = table(
    ["Resolutor", "Estado", "GPS", "Última actualización", "Activo"],
    resolvers.map(r => [
      `<strong>${dash(r.full_name)}</strong><br><small>${dash(r.phone)}</small>`,
      badge(r.status),
      badge(r.heartbeat),
      date(r.updated_at),
      r.is_active ? badge("VALIDATED") : badge("OFFLINE")
    ])
  );

  const pending = data.operations?.pending_validation_neighbors || [];
  $("pendingUsersTable").innerHTML = table(
    ["Vecino", "Teléfono", "RUT", "Dirección", "Estado", "Registro"],
    pending.map(u => [
      `<strong>${dash(u.full_name)}</strong>`,
      dash(u.phone),
      dash(u.rut),
      dash(u.declared_address),
      badge(u.validation_status),
      date(u.created_at)
    ])
  );
}

function table(headers, rows) {
  if (!rows.length) return `<tbody><tr><td class="empty">Sin datos para mostrar en este período.</td></tr></tbody>`;
  return `
    <thead><tr>${headers.map(h => `<th>${h}</th>`).join("")}</tr></thead>
    <tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${cell}</td>`).join("")}</tr>`).join("")}</tbody>
  `;
}
function shortId(id) { return String(id || "").slice(0, 8).toUpperCase(); }

function exportCsv() {
  if (!currentData) return;
  const rows = currentData.operations?.recent_tickets || [];
  const header = ["id", "titulo", "tipo", "origen", "estado", "prioridad", "vecino", "telefono", "resolutor", "creado"];
  const csvRows = [header, ...rows.map(t => [
    t.id, t.title, t.alert_type, t.source_type, t.state, t.priority, t.citizen_name, t.citizen_phone, t.resolver_name, t.created_at
  ])];
  const csv = csvRows.map(row => row.map(cell => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `sos-dashboard-tickets-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function logout(reload = true) {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  if (reload) location.reload();
  else showLogin();
}

window.addEventListener("DOMContentLoaded", async () => {
  $("loginBtn").addEventListener("click", login);
  $("loginPhone").addEventListener("keydown", (ev) => { if (ev.key === "Enter") login(); });
  $("refreshBtn").addEventListener("click", loadDashboard);
  $("periodSelect").addEventListener("change", loadDashboard);
  $("exportBtn").addEventListener("click", exportCsv);
  $("printBtn").addEventListener("click", () => window.print());
  $("logoutBtn").addEventListener("click", () => logout(true));

  const user = storedUser();
  if (user?.phone) $("loginPhone").value = user.phone;
  $("ccInput").value = localStorage.getItem(CC_KEY) || user?.control_center_code || "CC-VINA";

  if (await checkSession()) {
    showApp();
    await loadDashboard();
  } else {
    showLogin();
  }
});
