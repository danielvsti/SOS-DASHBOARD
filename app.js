const SOS_CONFIG = window.SOS_CONFIG || {};
const API_BASE = SOS_CONFIG.API_BASE || "https://sos.vsti.cl";
const TOKEN_KEY = "sos_dashboard_token";
const USER_KEY = "sos_dashboard_user";
const CC_KEY = "sos_dashboard_cc";

let currentData = null;
let isLoadingDashboard = false;
let autoRefreshTimer = null;
let autoRefreshSeconds = 15;
let nextRefreshAt = null;
let heatMap = null;
let heatLayer = null;
let heatMarkerLayer = null;
let heatBoundaryLayer = null;
let heatBounds = null;
let heatUserMoved = false;
let ticketsPage = 1;
let ticketsPagination = null;
const charts = {};

const $ = (id) => document.getElementById(id);
const nf = new Intl.NumberFormat("es-CL");
const dtf = new Intl.DateTimeFormat("es-CL", { dateStyle: "short", timeStyle: "short" });

function token() {
  const active = sessionStorage.getItem(TOKEN_KEY) || "";
  const legacy = localStorage.getItem(TOKEN_KEY) || "";
  if (!active && legacy) {
    sessionStorage.setItem(TOKEN_KEY, legacy);
    localStorage.removeItem(TOKEN_KEY);
    return legacy;
  }
  return active;
}
function storedUser() {
  try {
    const active = sessionStorage.getItem(USER_KEY);
    const legacy = localStorage.getItem(USER_KEY);
    if (!active && legacy) {
      sessionStorage.setItem(USER_KEY, legacy);
      localStorage.removeItem(USER_KEY);
      return JSON.parse(legacy || "null");
    }
    return JSON.parse(active || "null");
  }
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
function compactDate(v) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("es-CL", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(d);
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
  SIN_TIPO: "Sin tipo",
  SIN_ORIGEN: "Sin origen",
  AVAILABLE: "Disponible",
  BUSY: "Ocupado",
  SIN_UBICACION: "Sin ubicación",
  ONLINE: "Online",
  DESACTUALIZADO: "Desactualizado",
  OFFLINE: "Offline",
  GPS_INVALID: "GPS inválido",
  STALE_GPS: "GPS vencido",
  BLOCKED_NO_TICKET: "Bloqueado sin caso",
  NO_GPS: "Sin GPS"
};
function niceLabel(value) { return labelMap[value] || String(value || "—").replaceAll("_", " "); }

function sectorFromCoords(latitude, longitude) {
  const lat = Number(latitude);
  const lon = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return "Sector por determinar";

  if (lat > -32.9800 && lon < -71.5300) return "Reñaca Bajo / Jardín del Mar";
  if (lat > -33.0000 && lon > -71.5220) return "Gómez Carreño / Reñaca Alto / Glorias Navales";
  if (lat > -33.0020 && lon >= -71.5320 && lon <= -71.5050) return "Santa Julia / Achupallas / Canal Beagle";
  if (lat >= -33.0300 && lat <= -33.0100 && lon < -71.5400) return "Plan Viña / Libertad / Población Vergara";
  if (lat >= -33.0300 && lat <= -33.0050 && lon >= -71.5400 && lon <= -71.5150) return "Miraflores / Chorrillos / Viña Oriente";
  if (lat < -33.0350 && lon >= -71.5400 && lon <= -71.5150) return "Forestal";
  if (lat < -33.0300 && lon < -71.5400) return "Recreo / Nueva Aurora / Agua Santa";
  return "Sector por determinar dentro de la comuna";
}

function zoneLabelFromItem(item) {
  return item?.sector_aproximado || item?.event_sector_name || item?.zona_critica || sectorFromCoords(item?.latitude, item?.longitude);
}

function zoneMethodFromItem(item) {
  return String(item?.sector_method || item?.event_sector_method || "").trim();
}

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
    cache: "no-store",
    ...options,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-cache",
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
    sessionStorage.setItem(TOKEN_KEY, data.token);
    sessionStorage.setItem(USER_KEY, JSON.stringify(data.user));
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    if (data.user?.control_center_code) localStorage.setItem(CC_KEY, data.user.control_center_code);
    setMessage("Acceso correcto.", true);
    showApp();
    startAutoRefresh();
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
    sessionStorage.setItem(USER_KEY, JSON.stringify(data.user));
    localStorage.removeItem(USER_KEY);
    if (data.user?.control_center_code) localStorage.setItem(CC_KEY, data.user.control_center_code);
    return true;
  } catch {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(USER_KEY);
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    return false;
  }
}

async function loadDashboard(options = {}) {
  const silent = !!options.silent;
  if (isLoadingDashboard) return;
  if (!$('appView') || $('appView').classList.contains('hidden')) return;

  const days = $("periodSelect").value;
  const sessionUser = storedUser() || {};
  const cc = (sessionUser.control_center_code || localStorage.getItem(CC_KEY) || "CC-VINA").trim().toUpperCase();
  $("ccInput").value = cc;
  localStorage.setItem(CC_KEY, cc);

  isLoadingDashboard = true;
  $("refreshBtn").disabled = true;
  if (!silent) setLiveStatus("Actualizando indicadores...", true);

  try {
    const data = await api(`/dashboard/analytics?control_center_code=${encodeURIComponent(cc)}&days=${encodeURIComponent(days)}&_=${Date.now()}`);
    currentData = data;
    renderDashboard(data);
    await loadTicketsPage(1, { silent: true });
    scheduleNextRefresh();
    updateLiveStatus();
  } catch (error) {
    setLiveStatus(`Error actualización: ${error.message}`, false);
    if (!silent) alert(`No se pudo cargar el dashboard: ${error.message}`);
    if (/sesión|operator|admin|unauthorized/i.test(error.message)) logout(false);
  } finally {
    isLoadingDashboard = false;
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
  setText("kpiResolversOnline", `${fmt(r.resolvers_online)} online · ${fmt(r.resolvers_busy)} ocupados`);

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
  setText("healthResolversDetail", `${fmt(r.resolvers_total)} total · ${fmt(r.resolvers_available_now)} disponibles · ${fmt(r.resolvers_busy)} ocupados · ${fmt(r.resolvers_offline)} offline`);
  setText("healthSirens", fmt(s.sirens_active));
  setText("healthSirensDetail", `${fmt(s.sirens_total)} total · ${fmt(s.sirens_offline)} offline`);
  setText("healthDevices", fmt(d.devices_online));
  setText("healthDevicesDetail", `${fmt(d.devices_total)} total · ${fmt(d.devices_sos_active)} SOS activo`);

  renderCharts(data);
  renderHeatMap(data);
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


function getHeatMode() {
  return $("heatModeSelect")?.value || localStorage.getItem("sos_dashboard_heat_mode") || "heat-points";
}

function toLatLng(item) {
  const lat = Number(item?.latitude);
  const lng = Number(item?.longitude ?? item?.lon ?? item?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return [lat, lng];
}

function ensureHeatMap(center) {
  if (!window.L) return null;
  const mapEl = $("municipalHeatMap");
  if (!mapEl) return null;

  const fallback = toLatLng(center) || [-33.01895, -71.55090];
  if (!heatMap) {
    heatMap = L.map("municipalHeatMap", {
      zoomControl: true,
      scrollWheelZoom: true,
      preferCanvas: true
    }).setView(fallback, 14);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap"
    }).addTo(heatMap);

    heatMarkerLayer = L.layerGroup().addTo(heatMap);
    heatMap.on("dragstart zoomstart", () => { heatUserMoved = true; });
    setTimeout(() => heatMap.invalidateSize(), 120);
  }
  return heatMap;
}


function geoJsonLatLngsForBounds(geojson) {
  if (!geojson) return [];
  const geometry = geojson.type === "Feature" ? geojson.geometry
    : geojson.type === "FeatureCollection" ? (geojson.features || []).map(f => f.geometry)
    : geojson;
  const points = [];
  const walk = (value) => {
    if (!value) return;
    if (Array.isArray(value) && typeof value[0] === "number" && typeof value[1] === "number") {
      points.push([Number(value[1]), Number(value[0])]);
      return;
    }
    if (Array.isArray(value)) value.forEach(walk);
    else if (value.coordinates) walk(value.coordinates);
  };
  walk(geometry);
  return points.filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1]));
}


function normalizeGeoJsonGeometryList(geojson) {
  if (!geojson) return [];
  if (geojson.type === "FeatureCollection") return (geojson.features || []).map(f => f.geometry).filter(Boolean);
  if (geojson.type === "Feature") return geojson.geometry ? [geojson.geometry] : [];
  return geojson.type ? [geojson] : [];
}

function pointInRing(lng, lat, ring) {
  // Ray-casting algorithm. GeoJSON coordinates are [lng, lat].
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = Number(ring[i][0]);
    const yi = Number(ring[i][1]);
    const xj = Number(ring[j][0]);
    const yj = Number(ring[j][1]);
    const intersects = ((yi > lat) !== (yj > lat)) &&
      (lng < ((xj - xi) * (lat - yi)) / ((yj - yi) || 1e-12) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointInPolygonCoordinates(lng, lat, polygonCoords) {
  if (!Array.isArray(polygonCoords) || !polygonCoords.length) return false;
  // First ring is shell; subsequent rings are holes.
  if (!pointInRing(lng, lat, polygonCoords[0])) return false;
  for (let i = 1; i < polygonCoords.length; i++) {
    if (pointInRing(lng, lat, polygonCoords[i])) return false;
  }
  return true;
}

function pointInGeoJson(lng, lat, geojson) {
  const geometries = normalizeGeoJsonGeometryList(geojson);
  for (const geom of geometries) {
    if (!geom) continue;
    if (geom.type === "Polygon" && pointInPolygonCoordinates(lng, lat, geom.coordinates)) return true;
    if (geom.type === "MultiPolygon" && Array.isArray(geom.coordinates)) {
      if (geom.coordinates.some(poly => pointInPolygonCoordinates(lng, lat, poly))) return true;
    }
  }
  return false;
}

function normalizeHeatPoint(p) {
  const latitude = Number(p?.latitude ?? p?.lat);
  const longitude = Number(p?.longitude ?? p?.lon ?? p?.lng);
  const weight = Number(p?.weight || 0.65);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { ...p, latitude, longitude, weight };
}

function isOperationalHeatPoint(p, boundaryGeoJson) {
  const jurisdiction = String(p?.jurisdiction_status || p?.jurisdiction?.status || "").toUpperCase();
  if (jurisdiction === "OUT_OF_JURISDICTION") return false;
  if (!boundaryGeoJson) return true;
  return pointInGeoJson(Number(p.longitude), Number(p.latitude), boundaryGeoJson);
}

function renderHeatMap(data, forceFit = false) {
  const geo = data.geo || {};
  const center = {
    latitude: data.control_center?.latitude || geo.center?.latitude,
    longitude: data.control_center?.longitude || geo.center?.longitude
  };
  const map = ensureHeatMap(center);
  if (!map) return;

  const allPoints = (geo.event_points || [])
    .map(normalizeHeatPoint)
    .filter(Boolean);
  const points = allPoints.filter((p) => isOperationalHeatPoint(p, geo.boundary_geojson));
  const outOfJurisdictionCount = allPoints.length - points.length;
  const zones = geo.top_zones || [];
  const mode = getHeatMode();

  if (heatLayer) {
    map.removeLayer(heatLayer);
    heatLayer = null;
  }
  if (heatBoundaryLayer) {
    map.removeLayer(heatBoundaryLayer);
    heatBoundaryLayer = null;
  }
  if (heatMarkerLayer) heatMarkerLayer.clearLayers();

  heatBounds = null;

  if (geo.boundary_geojson && window.L.geoJSON) {
    heatBoundaryLayer = L.geoJSON(geo.boundary_geojson, {
      style: {
        color: "#0f172a",
        weight: 2,
        opacity: 0.82,
        fillColor: "#38bdf8",
        fillOpacity: 0.06,
        dashArray: "6 6"
      }
    }).addTo(map);
    heatBoundaryLayer.bindPopup(`Límite operacional ${dash(data.control_center?.name || data.control_center?.code)}`);
  }

  if (points.length && mode !== "points" && window.L.heatLayer) {
    const heatPoints = points.map((p) => [p.latitude, p.longitude, Math.max(0.35, Math.min(1, p.weight || 0.65))]);
    heatLayer = L.heatLayer(heatPoints, {
      radius: 34,
      blur: 26,
      minOpacity: 0.28,
      maxZoom: 17,
      gradient: { 0.25: "#38bdf8", 0.45: "#22c55e", 0.65: "#f59e0b", 0.9: "#ef4444" }
    }).addTo(map);
  }

  if (points.length && mode !== "heat") {
    points.slice(0, 500).forEach((p) => {
      const isOpen = !["CLOSED", "CANCELLED", "RESOLVED"].includes(String(p.state || "").toUpperCase());
      const marker = L.circleMarker([p.latitude, p.longitude], {
        radius: isOpen ? 8 : 6,
        weight: 2,
        color: isOpen ? "#dc2626" : "#2563eb",
        fillColor: isOpen ? "#fee2e2" : "#dbeafe",
        fillOpacity: 0.82
      });
      marker.bindPopup(`
        <div class="map-popup">
          <strong>${dash(p.title || niceLabel(p.alert_type))}</strong><br>
          <span>${badge(p.state)} ${badge(p.alert_type)}</span><br>
          <small>${dash(p.citizen_name)} · ${date(p.created_at)}</small><br>
          <small>${zoneLabelFromItem(p)}</small>
        </div>
      `);
      marker.addTo(heatMarkerLayer);
    });
  }

  const boundaryPoints = geoJsonLatLngsForBounds(geo.boundary_geojson);
  if (boundaryPoints.length) {
    // El límite comunal manda sobre los puntos. Esto evita que un evento de prueba
    // fuera de la comuna aleje el dashboard hasta La Serena, Arica, etc.
    heatBounds = L.latLngBounds(boundaryPoints);
    if (forceFit || !heatUserMoved) {
      map.fitBounds(heatBounds.pad(0.06), {
        maxZoom: Number(geo.map_zoom || data.control_center?.map_zoom || 13),
        animate: false
      });
    }
  } else if (points.length) {
    heatBounds = L.latLngBounds(points.map((p) => [p.latitude, p.longitude]));
    if (forceFit || !heatUserMoved) {
      map.fitBounds(heatBounds.pad(0.22), { maxZoom: 15, animate: false });
    }
  } else {
    const fallback = toLatLng(center) || [-33.01895, -71.55090];
    if (forceFit || !heatUserMoved) map.setView(fallback, Number(geo.map_zoom || data.control_center?.map_zoom || 14));
  }

  const total = points.length;
  const open = points.filter((p) => !["CLOSED", "CANCELLED", "RESOLVED"].includes(String(p.state || "").toUpperCase())).length;
  const top = zones[0];
  const jurisdictionNote = outOfJurisdictionCount > 0 ? ` · ${fmt(outOfJurisdictionCount)} fuera de jurisdicción excluidos` : "";
  setText("mapSummary", total
    ? `${fmt(total)} eventos georreferenciados dentro de la comuna · ${fmt(open)} abiertos/en gestión · Zona principal: ${top ? `${zoneLabelFromItem(top)} · ${fmt(top.tickets_count)} eventos (${niceLabel(top.top_alert_type)})` : "sin agrupación"}${jurisdictionNote}`
    : (geo.boundary_geojson ? `Sin eventos georreferenciados dentro de la comuna para el período seleccionado. Se muestra el límite operacional comunal.${jurisdictionNote}` : "Sin eventos georreferenciados para el período seleccionado.")
  );

  if ($("hotZonesTable")) {
    $("hotZonesTable").innerHTML = table(
      ["Zona crítica", "Eventos", "Abiertos", "Tipo principal", "Último evento"],
      zones.map((z, idx) => [
        `<div class="hot-zone-cell"><strong>#${idx + 1} · ${zoneLabelFromItem(z)}</strong></div>`,
        fmt(z.tickets_count),
        fmt(z.open_count),
        badge(z.top_alert_type || "SIN_TIPO"),
        compactDate(z.last_ticket_at)
      ])
    );
  }

  setTimeout(() => map.invalidateSize(), 50);
}

function fitHeatMap() {
  heatUserMoved = false;
  if (currentData) renderHeatMap(currentData, true);
}

function renderTables(data) {
  if ($("recentTicketsTable") && !ticketsPagination) {
    $("recentTicketsTable").innerHTML = `<tbody><tr><td class="empty">Cargando listado paginado...</td></tr></tbody>`;
  }

  const resolvers = data.operations?.resolver_status || [];
  $("resolverStatusTable").innerHTML = table(
    ["Resolutor", "Estado operativo", "Estado app", "GPS", "Casos activos", "Última actualización", "Activo"],
    resolvers.map(r => [
      `<strong>${dash(r.full_name)}</strong><br><small>${dash(r.phone)}</small>`,
      badge(r.operational_state || r.status),
      badge(r.status),
      `${badge(r.heartbeat)}<br><small>${r.accuracy != null ? `${Math.round(Number(r.accuracy))} m` : "—"}</small>`,
      fmt(r.active_tickets_count),
      date(r.updated_at),
      r.is_active ? badge("ACTIVO") : badge("INACTIVO")
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

function setLiveStatus(text, ok = true) {
  const el = $("liveStatus");
  if (!el) return;
  el.textContent = text || "Auto: —";
  el.className = ok ? "live-status ok" : "live-status error";
}

function updateLiveStatus() {
  const el = $("liveStatus");
  if (!el) return;
  if (!autoRefreshSeconds) {
    setLiveStatus("Auto: desactivado", true);
    return;
  }
  const remaining = nextRefreshAt ? Math.max(0, Math.ceil((nextRefreshAt - Date.now()) / 1000)) : autoRefreshSeconds;
  setLiveStatus(`Auto: cada ${autoRefreshSeconds}s · próxima en ${remaining}s`, true);
}

function scheduleNextRefresh() {
  if (!autoRefreshSeconds) {
    nextRefreshAt = null;
    updateLiveStatus();
    return;
  }
  nextRefreshAt = Date.now() + autoRefreshSeconds * 1000;
}

function startAutoRefresh() {
  stopAutoRefresh();
  const select = $("autoRefreshSelect");
  autoRefreshSeconds = Number(select?.value || localStorage.getItem("sos_dashboard_auto_refresh") || 15);
  if (select) select.value = String(autoRefreshSeconds || 0);
  scheduleNextRefresh();
  updateLiveStatus();

  autoRefreshTimer = setInterval(async () => {
    if (!autoRefreshSeconds) return updateLiveStatus();
    if (document.hidden) return updateLiveStatus();
    if (Date.now() >= (nextRefreshAt || 0)) {
      await loadDashboard({ silent: true });
    } else {
      updateLiveStatus();
    }
  }, 1000);
}

function stopAutoRefresh() {
  if (autoRefreshTimer) clearInterval(autoRefreshTimer);
  autoRefreshTimer = null;
}

function changeAutoRefresh() {
  autoRefreshSeconds = Number($("autoRefreshSelect")?.value || 0);
  localStorage.setItem("sos_dashboard_auto_refresh", String(autoRefreshSeconds));
  scheduleNextRefresh();
  updateLiveStatus();
}



function renderGenericTable(elementId, columns, rows) {
  const el = $(elementId);
  if (!el) return;
  if (!rows || !rows.length) {
    el.innerHTML = `<tbody><tr><td class="empty">Sin datos para mostrar.</td></tr></tbody>`;
    return;
  }
  const headers = columns.map(c => `<th>${dash(c).replaceAll("_", " ")}</th>`).join("");
  const body = rows.map(row => `<tr>${columns.map(c => `<td>${formatCell(row[c])}</td>`).join("")}</tr>`).join("");
  el.innerHTML = `<thead><tr>${headers}</tr></thead><tbody>${body}</tbody>`;
}

function formatCell(value) {
  if (value == null || value === "") return "—";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) return date(value);
  if (typeof value === "number") return Number.isInteger(value) ? fmt(value) : value.toFixed(2);
  const v = String(value);
  if (["ACTIVE","ASSIGNED","EN_ROUTE","ON_SITE","RESOLVED","CLOSED","CANCELLED","VIF","MEDICAL","FIRE","SECURITY","ACCIDENT","RISK","OTHER"].includes(v.toUpperCase())) return badge(v);
  return dash(v);
}

async function askLucia(questionFromButton = null) {
  const q = (questionFromButton || $("luciaQuestion")?.value || "").trim();
  if (!q) return;
  const btn = $("luciaAskBtn");
  const answer = $("luciaAnswer");
  const meta = $("luciaMeta");
  const actions = $("luciaReportActions");
  if (btn) btn.disabled = true;
  if (answer) answer.textContent = "Luc-IA está consultando la base segura...";
  if (meta) meta.textContent = "";
  try {
    const data = await api(`/dashboard/lucia/ask`, {
      method: "POST",
      body: JSON.stringify({ question: q })
    });
    const lucia = data.lucia || {};
    if (answer) answer.textContent = lucia.answer || "Luc-IA respondió sin texto.";
    if (meta) {
      meta.textContent = `${niceLabel(lucia.intent)} · ${fmt(lucia.row_count)} filas · ${lucia.duration_ms || 0} ms · ${lucia.safety?.forced_control_center_code || "centro autorizado"}${lucia.sector_method ? " · " + lucia.sector_method : ""}`;
    }
    if (actions) {
      actions.innerHTML = "";
      const report = lucia.report;
      if (report?.url) {
        const a = document.createElement("a");
        a.className = "btn secondary lucia-download";
        a.href = API_BASE + report.url;
        a.target = "_blank";
        a.rel = "noopener";
        a.textContent = "Descargar PDF Luc-IA";
        actions.appendChild(a);
      }
      const suggestions = Array.isArray(lucia.suggestions) ? lucia.suggestions : [];
      if (suggestions.length) {
        const wrap = document.createElement("div");
        wrap.className = "lucia-followups";
        suggestions.forEach(suggestion => {
          const b = document.createElement("button");
          b.type = "button";
          b.className = "chip lucia-followup";
          b.textContent = suggestion.label || suggestion.question || "Consultar";
          b.addEventListener("click", () => {
            if ($("luciaQuestion")) $("luciaQuestion").value = suggestion.question || suggestion.label || "";
            askLucia(suggestion.question || suggestion.label || "");
          });
          wrap.appendChild(b);
        });
        actions.appendChild(wrap);
      }
    }
    renderGenericTable("luciaTable", lucia.columns || [], lucia.rows || []);
  } catch (error) {
    console.error("Luc-IA error", error);
    if (answer) answer.textContent = "Luc-IA tuvo un problema técnico al procesar la consulta. Prueba con una sugerencia o intenta nuevamente.";
    if (actions) {
      actions.innerHTML = "";
      [
        { label: "Tickets sin asignar", question: "Qué tickets siguen sin asignar" },
        { label: "Resumen ejecutivo", question: "Dame un resumen ejecutivo" },
        { label: "Zonas críticas", question: "Identifica zonas críticas" }
      ].forEach(suggestion => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "chip lucia-followup";
        b.textContent = suggestion.label;
        b.addEventListener("click", () => askLucia(suggestion.question));
        actions.appendChild(b);
      });
    }
    renderGenericTable("luciaTable", [], []);
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function loadTicketsPage(page = ticketsPage, options = {}) {
  const silent = !!options.silent;
  const state = $("ticketStateFilter")?.value || "";
  const q = $("ticketSearch")?.value || "";
  ticketsPage = Math.max(1, Number(page || 1));
  try {
    const data = await api(`/dashboard/tickets?page=${ticketsPage}&page_size=10&state=${encodeURIComponent(state)}&q=${encodeURIComponent(q)}&_=${Date.now()}`);
    ticketsPagination = data.pagination;
    renderTicketsTable(data.tickets || []);
    renderTicketsPager(data.pagination || {});
  } catch (error) {
    if (!silent) alert(`No se pudo cargar el listado de tickets: ${error.message}`);
    const tableEl = $("recentTicketsTable");
    if (tableEl) tableEl.innerHTML = `<tbody><tr><td class="empty">Error cargando tickets: ${error.message}</td></tr></tbody>`;
  }
}

function renderTicketsTable(rows) {
  const el = $("recentTicketsTable");
  if (!el) return;
  el.innerHTML = table(
    ["Ticket", "Estado", "Origen", "Vecino", "Resolutor", "Edad", "Creado"],
    rows.map(t => [
      `<strong>${shortId(t.id)}</strong><br><small>${dash(t.title || niceLabel(t.alert_type))}</small>`,
      badge(t.state),
      `${badge(t.source_type)}<br><small>${niceLabel(t.alert_type)}</small>`,
      dash(t.citizen_name),
      dash(t.resolver_name),
      humanMinutes(t.age_minutes),
      date(t.created_at)
    ])
  );
}

function renderTicketsPager(p) {
  const label = $("ticketsPageLabel");
  const prev = $("ticketsPrevBtn");
  const next = $("ticketsNextBtn");
  if (label) label.textContent = `Página ${p.page || 1} de ${p.total_pages || 1} · ${fmt(p.total || 0)} tickets`;
  if (prev) prev.disabled = !p.has_prev;
  if (next) next.disabled = !p.has_next;
}

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
  stopAutoRefresh();
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(USER_KEY);
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  if (reload) location.reload();
  else showLogin();
}

window.addEventListener("DOMContentLoaded", async () => {
  $("loginBtn").addEventListener("click", login);
  $("loginPhone").addEventListener("keydown", (ev) => { if (ev.key === "Enter") login(); });
  $("refreshBtn").addEventListener("click", () => loadDashboard());
  $("periodSelect").addEventListener("change", () => loadDashboard());
  $("autoRefreshSelect").addEventListener("change", changeAutoRefresh);
  $("heatModeSelect")?.addEventListener("change", () => {
    localStorage.setItem("sos_dashboard_heat_mode", getHeatMode());
    if (currentData) renderHeatMap(currentData, true);
  });
  $("fitMapBtn")?.addEventListener("click", fitHeatMap);
  $("exportBtn").addEventListener("click", exportCsv);
  $("printBtn").addEventListener("click", () => window.print());
  $("logoutBtn").addEventListener("click", () => logout(true));
  $("luciaAskBtn")?.addEventListener("click", () => askLucia());
  $("luciaQuestion")?.addEventListener("keydown", (ev) => { if ((ev.metaKey || ev.ctrlKey) && ev.key === "Enter") askLucia(); });
  document.querySelectorAll(".lucia-suggestion").forEach(btn => {
    btn.addEventListener("click", () => {
      const q = btn.dataset.question || btn.textContent || "";
      if ($("luciaQuestion")) $("luciaQuestion").value = q;
      askLucia(q);
    });
  });
  $("ticketSearchBtn")?.addEventListener("click", () => loadTicketsPage(1));
  $("ticketSearch")?.addEventListener("keydown", (ev) => { if (ev.key === "Enter") loadTicketsPage(1); });
  $("ticketStateFilter")?.addEventListener("change", () => loadTicketsPage(1));
  $("ticketsPrevBtn")?.addEventListener("click", () => loadTicketsPage(Math.max(1, ticketsPage - 1)));
  $("ticketsNextBtn")?.addEventListener("click", () => loadTicketsPage(ticketsPage + 1));

  const user = storedUser();
  if (user?.phone) $("loginPhone").value = user.phone;
  $("ccInput").value = user?.control_center_code || localStorage.getItem(CC_KEY) || "CC-VINA";
  const storedAuto = localStorage.getItem("sos_dashboard_auto_refresh");
  if (storedAuto !== null) $("autoRefreshSelect").value = storedAuto;
  const storedHeatMode = localStorage.getItem("sos_dashboard_heat_mode");
  if (storedHeatMode && $("heatModeSelect")) $("heatModeSelect").value = storedHeatMode;

  if (await checkSession()) {
    showApp();
    startAutoRefresh();
    await loadDashboard();
  } else {
    showLogin();
  }
});


document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    scheduleNextRefresh();
    loadDashboard({ silent: true });
  }
});
