'use strict';

// Configuración y datos iniciales. Las claves conservan los datos de versiones anteriores.
const KEY = 'medicgo-medicos:data:v1', SESSION = 'medicgo-medicos:selected:v1';
const doctors = [{
        id: 'm1', name: 'Dra. Andrea', initials: 'DA', specialty: 'Medicina general'
    }, {
        id: 'm2', name: 'Dr. Gabriel', initials: 'DG', specialty: 'Pediatría'
    }, {
        id: 'm3', name: 'Dra. Valentina', initials: 'DV', specialty: 'Medicina interna'
    }];
const days = [
    'Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'
];
// Fechas locales, sin conversiones UTC que desplacen la fecha de una visita.
function dateKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function relative(n) {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return dateKey(d);
}
function parseDate(s) {
    return new Date(`${s}T12:00:00`);
}
function pretty(s) {
    return parseDate(s).toLocaleDateString('es-CO', {
        day: 'numeric', month: 'short', year: 'numeric'
    });
}
function seed() {
    const visits = [];
    const schedules = {};
    doctors.forEach((d, i) => {
        schedules[d.id] = Array.from({
            length: 7
        }, (_, day) => ({
            day, blocks: day === 0 ? [] : [{
                    start: '08:00', end: '12:00'
                }, {
                    start: '14:00', end: '18:00'
                }]
        }));
        [
            ['pendiente', 0, '09:00'], ['pendiente', 1, '10:00'], ['pendiente', 2, '15:00'], ['aceptada', 0, '11:00'], ['aceptada', 1, '14:00'], ['aceptada', 3, '09:00'], ['completada', -2, '10:00'], ['rechazada', -3, '15:00'], ['cancelada', -1, '09:00']
        ].forEach(([status, offset, time], j) => {
            const date = relative(offset);
            if (status === 'aceptada' && parseDate(date).getDay() === 0)
                schedules[d.id][0].blocks = [{
                        start: '08:00', end: '12:00'
                    }, {
                        start: '14:00', end: '18:00'
                    }];
            visits.push({
                id: `MG-${i + 1}${String(j + 1).padStart(3, '0')}`, doctor: d.id, alias: `Paciente ${String(i * 9 + j + 1).padStart(3, '0')}`, specialty: d.specialty, date, time, duration: 30, status, reason: status === 'rechazada' ? 'Horario no disponible' : ''
            });
        });
    });
    return {
        visits, schedules
    };
}
let storageOK = true, data;
try {
    data = JSON.parse(localStorage.getItem(KEY));
    if (!data || !Array.isArray(data.visits) || !data.schedules) {
        data = seed();
        localStorage.setItem(KEY, JSON.stringify(data));
    }
}
catch {
    data = seed();
    storageOK = false;
}
// Persistencia: se revierte el cambio en memoria si falla el guardado.
function save() {
    try {
        localStorage.setItem(KEY, JSON.stringify(data));
        storageOK = true;
        return true;
    }
    catch {
        storageOK = false;
        toast('No se pudo guardar. Revisa el almacenamiento del navegador e inténtalo de nuevo.');
        return false;
    }
}
function commit(next) {
    const previous = data;
    data = next;
    if (save())
        return true;
    data = previous;
    return false;
}
const query = new URLSearchParams(location.search);
let requestStatus = [
    'pendiente', 'aceptada', 'completada', 'rechazada', 'cancelada', ''
].includes(query.get('estado')) ? query.get('estado') : 'pendiente';
let historyStatus = [
    'completada', 'rechazada', 'cancelada', 'aceptada'
].includes(query.get('estado')) ? query.get('estado') : 'closed';
let historyFrom = '', historyTo = '';
// Consultas y validaciones compartidas por todas las vistas.
function requestVisits(status) {
    return sorted(own().filter(v => !status || v.status === status));
}
function agendaVisits(dates) {
    return sorted(own().filter(v => v.status === 'aceptada' && dates.includes(v.date)));
}
function historyVisits(status, from = '', to = '') {
    return sorted(own().filter(v => (status === 'closed' ? ['completada', 'rechazada', 'cancelada'].includes(v.status) : v.status === status) && (!from || v.date >= from) && (!to || v.date <= to))).reverse();
}
function visitConflict(v) {
    return own().some(other => other.id !== v.id && other.status === 'aceptada' && other.date === v.date && minutes(v.time) < minutes(other.time) + other.duration && minutes(other.time) < minutes(v.time) + v.duration);
}
function isFutureVisit(v) {
    const now = new Date();
    return v.date + v.time > dateKey(now) + now.toTimeString().slice(0, 5);
}
function acceptanceError(v) {
    if (!fits(v, data.schedules[doctor.id]))
        return 'La visita debe estar dentro de tu disponibilidad. Ajusta los horarios antes de aceptarla.';
    if (visitConflict(v))
        return 'El horario coincide con otra visita aceptada.';
    return '';
}
function transition(id, status, reason = '') {
    const v = own().find(v => v.id === id);
    if (!v || !({
        pendiente: ['aceptada', 'rechazada'], aceptada: ['completada', 'cancelada']
    }[v.status] || []).includes(status))
        return 'Esta visita ya no permite ese cambio de estado.';
    if (status === 'rechazada' && !['Horario no disponible', 'Agenda completa', 'Fuera del ámbito de atención'].includes(reason))
        return 'Selecciona un motivo de rechazo.';
    if (status === 'aceptada') {
        const error = acceptanceError(v);
        if (error)
            return error;
    }
    if (status === 'completada' && isFutureVisit(v))
        return 'La visita podrá completarse a partir de su hora programada.';
    const next = JSON.parse(JSON.stringify(data));
    Object.assign(next.visits.find(v => v.id === id), {
        status, reason
    });
    return commit(next) ? '' : 'No se guardó el cambio. Inténtalo de nuevo.';
}
function persistSchedule(schedule) {
    for (const day of schedule) {
        for (let i = 0; i < day.blocks.length; i++) {
            const b = day.blocks[i];
            if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(b.start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(b.end) || minutes(b.start) >= minutes(b.end))
                return false;
            if (day.blocks.some((other, j) => i !== j && overlaps(b, other)))
                return false;
        }
    }
    const next = JSON.parse(JSON.stringify(data));
    next.schedules[doctor.id] = JSON.parse(JSON.stringify(schedule));
    return commit(next);
}
let selected;
try {
    selected = localStorage.getItem(SESSION);
}
catch {
}
const doctor = doctors.find(d => d.id === selected);
const page = document.body.dataset.page;
const app = document.querySelector('#app');
// Elementos visuales compartidos: iconos, tablas y estructura del portal.
const paths = {
    grid: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
    requests: 'M8 4H5v17h14V4h-3 M9 2h6v5H9z M8 12h8 M8 16h6',
    calendar: 'M4 5h16v16H4z M8 2v6 M16 2v6 M4 10h16',
    clock: 'M12 8v5l3 2 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
    history: 'M3 11a9 9 0 1 1 2 7 M3 4v7h7 M12 7v6l4 2',
    arrow: 'M5 12h14 M13 6l6 6-6 6',
    plus: 'M12 4v16 M4 12h16',
    check: 'M5 12l4 4L19 6'
};
function icon(name) {
    return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
<path d="${paths[name] || paths.calendar}"/>
</svg>`;
}
const brand = '<div class="brand">Medic <b>GO</b><small>Portal médico</small></div>';
function toast(msg) {
    document.querySelector('.toast')?.remove();
    const el = document.createElement('div');
    el.className = 'toast';
    el.role = 'status';
    el.textContent = msg;
    document.body.append(el);
    setTimeout(() => el.remove(), 5000);
}
function own() {
    return data.visits.filter(v => v.doctor === doctor.id);
}
function badge(status) {
    return `<span class="badge ${status}">${status[0].toUpperCase() + status.slice(1)}</span>`;
}
function empty(msg) {
    return `<div class="empty">${icon('calendar')}<p>${msg}</p>
</div>`;
}
function table(visits) {
    return visits.length ? `<div class="table-wrap">
<table>
<thead>
<tr>
<th>Solicitud / paciente</th>
<th>Especialidad</th>
<th>Fecha y hora</th>
<th>Estado</th>
<th>Acción</th>
</tr>
</thead>
<tbody>${visits.map(v => `<tr>
<td><strong>${v.alias}</strong><small>${v.id}</small>
</td>
<td>${v.specialty}</td>
<td><strong>${pretty(v.date)}</strong><small>${v.time} · ${v.duration} min</small>
</td>
<td>${badge(v.status)}</td>
<td>
<button class="btn secondary small" data-detail="${v.id}">Ver detalle</button>
</td>
</tr>`).join('')}</tbody>
</table>
</div>` : empty('No hay visitas para los filtros seleccionados.');
}
function sorted(v) {
    return [...v].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
}
function shell() {
    const nav = [
        ['resumen', 'Resumen', 'grid'], ['solicitudes', 'Solicitudes', 'requests'], ['agenda', 'Agenda', 'calendar'], ['disponibilidad', 'Disponibilidad', 'clock'], ['historial', 'Historial', 'history']
    ];
    app.innerHTML = `<aside class="sidebar">${brand}<nav aria-label="Navegación principal">${nav.map(([id, label, ico]) => `<a href="${id}.html" class="${page === id ? 'active' : ''}" ${page === id ? 'aria-current="page"' : ''}>${icon(ico)}${label}</a>`).join('')}</nav>
<div class="side-bottom">
<div class="profile">
<div class="avatar">${doctor.initials}</div>
<div><strong>${doctor.name}</strong><small>${doctor.specialty}</small>
</div>
</div>
<button class="btn ghost small" id="logout">Salir del portal ${icon('arrow')}</button>
</div>
</aside>
<main class="main">
<header class="topbar">
<div>
<div class="eyebrow">Tu espacio de atención</div>
<h1>${nav.find(n => n[0] === page)?.[1] || 'Resumen'}</h1>
</div>
<div class="topdate">${new Date().toLocaleDateString('es-CO', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    })}</div>
</header>
<div id="content">
</div>
<footer class="footer">Proyecto académico · Datos de ejemplo</footer>
</main>
<dialog id="modal" aria-labelledby="modal-title">
</dialog>`;
    document.querySelector('#logout').onclick = () => {
        try {
            localStorage.removeItem(SESSION);
        }
        catch {
        }
        location.href = 'index.html';
    };
}
// Vistas y controles específicos de cada página.
function access() {
    app.innerHTML = `<main class="login">
<div class="access-collage" aria-hidden="true">
<div class="collage-photo"><img src="assets/medica-clinica.jpg" alt="" width="1100" height="1650"></div>
<div class="collage-photo"><img src="assets/profesional-5998482.jpg" alt="" width="700" height="1049"></div>
<div class="collage-photo"><img src="assets/profesional-5327585.jpg" alt="" width="700" height="1050"></div>
<div class="collage-photo"><img src="assets/profesional-5452293.jpg" alt="" width="700" height="1050"></div>
</div>
<section class="login-story">${brand}<a class="access-shortcut" href="#access-form">Ir al acceso ${icon('arrow')}</a><div class="eyebrow story-eyebrow">Más orden. Mejor atención.</div>
<h1>Tu día médico,<br><span>en un solo lugar</span></h1>
<p>Organiza tus solicitudes, consulta tu agenda y define tus horarios de atención.</p>
<div class="access-benefits">
<div class="floating-card agenda-card"><span>${icon('calendar')}</span><strong>Tu agenda organizada</strong></div>
<div class="floating-card requests-card"><span>${icon('requests')}</span><strong>Gestiona tus solicitudes</strong></div>
</div>
</section>
<section class="login-panel">
<div class="access-mark" aria-hidden="true">${icon('plus')}</div>
<div class="eyebrow">Bienvenido a Medic GO</div>
<h1>Entra a tu portal médico</h1>
<p class="muted">Selecciona tu perfil para consultar las visitas y organizar tu jornada.</p>
<form id="access-form">
<label class="field">Médico<select id="doctor">${doctors.map(d => `<option value="${d.id}" ${d.id === selected ? 'selected' : ''}>${d.name} · ${d.specialty}</option>`).join('')}</select>
</label>
<div class="selected-doctor" aria-live="polite" aria-atomic="true"></div>
<button class="btn" type="submit">Entrar al panel ${icon('arrow')}</button>
</form>
<footer class="footer">Proyecto académico · Datos de ejemplo</footer>
</section>
</main>`;
    const selector = document.querySelector('#doctor');
    const updateProfile = () => {
        const profile = doctors.find(d => d.id === selector.value);
        document.querySelector('.selected-doctor').innerHTML = `<div class="avatar" aria-hidden="true">${profile.initials}</div><div><small>Perfil seleccionado</small><strong>${profile.name}</strong><span>${profile.specialty}</span></div>${icon('check')}`;
    };
    selector.addEventListener('change', updateProfile);
    updateProfile();
    document.querySelector('form').onsubmit = e => {
        e.preventDefault();
        try {
            localStorage.setItem(SESSION, document.querySelector('#doctor').value);
            location.href = 'resumen.html';
        }
        catch {
            toast('Activa el almacenamiento local del navegador para entrar.');
        }
    };
}
function medicalArt() {
    return `<svg class="medical-art" viewBox="0 0 300 210" fill="none" role="img" aria-label="Ilustración de un estetoscopio junto a una ficha de atención">
<circle cx="156" cy="107" r="92" fill="#fff" opacity=".45"/>
<circle cx="245" cy="45" r="18" fill="#44cfc4" opacity=".3"/>
<rect x="68" y="28" width="130" height="157" rx="18" fill="white" transform="rotate(-8 68 28)"/>
<rect x="94" y="30" width="58" height="17" rx="7" fill="#1B5BFF"/>
<path d="M108 88h36m-18-18v36" stroke="#10a99e" stroke-width="10" stroke-linecap="round"/>
<path d="M96 130h64m-64 16h44" stroke="#c4d5f6" stroke-width="7" stroke-linecap="round"/>
<path d="M192 69v28c0 34 54 34 54 0V69m-27 53v19c0 42-58 44-58 10" stroke="#263D69" stroke-width="8" stroke-linecap="round"/>
<rect x="186" y="59" width="12" height="22" rx="6" fill="#1B5BFF"/>
<rect x="240" y="59" width="12" height="22" rx="6" fill="#1B5BFF"/>
<circle cx="161" cy="148" r="16" fill="#14b8aa"/>
<circle cx="161" cy="148" r="8" fill="white"/>
<path d="M41 72v16m-8-8h16m197 82v16m-8-8h16" stroke="#1B5BFF" stroke-width="4" stroke-linecap="round" opacity=".55"/>
</svg>`;
}
function summary() {
    const v = own(), pending = v.filter(v => v.status === 'pendiente'), today = v.filter(v => v.status === 'aceptada' && v.date === relative(0)), up = sorted(v.filter(v => v.status === 'aceptada' && v.date >= relative(0)));
    const stats = [
        [
            pending.length, 'Solicitudes pendientes', 'requests', 'pending', 'solicitudes.html?estado=pendiente', 'Revisar pendientes'
        ],
        [
            today.length, 'Visitas aceptadas hoy', 'calendar', 'accepted', 'agenda.html?fecha=' + relative(0), 'Consultar el día'
        ],
        [
            v.filter(v => v.status === 'completada').length, 'Visitas completadas', 'check', 'completed', 'historial.html?estado=completada', 'Ver completadas'
        ],
        [
            v.filter(v => v.status === 'cancelada').length, 'Visitas canceladas', 'history', 'cancelled', 'historial.html?estado=cancelada', 'Ver canceladas'
        ]
    ];
    content.innerHTML = `<section class="card hero">
<div>
<div class="eyebrow">Tu jornada, bajo control</div>
<h1>Hola, ${doctor.name}</h1>
<p>Un nuevo día para cuidar. Tienes ${pending.length} solicitudes pendientes de revisión.</p>
<a class="btn" href="solicitudes.html?estado=pendiente">Revisar solicitudes ${icon('arrow')}</a>
</div>${medicalArt()}</section>
<section class="stats" aria-label="Indicadores de visitas">${stats.map(([n, label, ico, tone, href, action]) => `<a href="${href}" class="card stat ${tone}">
<div class="stat-icon">${icon(ico)}</div>
<div><strong>${n}</strong><span>${label}</span><small>${action} →</small>
</div>
</a>`).join('')}</section>
<section class="card">
<div class="section-head">
<div>
<h2>Próximas visitas</h2><span class="muted">Tu agenda de atención, a un vistazo</span>
</div>
<a class="text-link" href="agenda.html">Ver agenda →</a>
</div>${table(up.slice(0, 5))}</section>`;
}
function requests() {
    content.innerHTML = `<section class="card">
<div class="section-head">
<div>
<h2>Solicitudes de atención</h2><span class="muted">Revisa cada solicitud y organiza tus próximas visitas.</span>
</div>
</div>
<div class="filters">
<label>Estado<select id="request-status">
<option value="pendiente">Pendientes</option>
<option value="">Todos los estados</option>${[
        'aceptada', 'completada', 'rechazada', 'cancelada'
    ].map(s => `<option value="${s}">${s[0].toUpperCase() + s.slice(1)}</option>`).join('')}</select>
</label>
</div>
<div id="request-table">
</div>
</section>`;
    const update = () => document.querySelector('#request-table').innerHTML = table(requestVisits(requestStatus = document.querySelector('#request-status').value));
    document.querySelector('#request-status').value = requestStatus;
    document.querySelector('#request-status').onchange = update;
    update();
}
let agendaDate = /^\d{4}-\d{2}-\d{2}$/.test(query.get('fecha') || '') && !isNaN(parseDate(query.get('fecha'))) ? query.get('fecha') : relative(0), agendaMode = 'day';
function agenda() {
    content.innerHTML = `<section class="card">
<div class="section-head">
<div>
<h2>Tu agenda</h2><span class="muted">Solo visitas aceptadas · duración de 30 minutos</span>
</div>
</div>
<div class="filters">
<button class="btn ghost" id="prev" aria-label="Período anterior">←</button>
<label>Fecha<input type="date" id="agenda-date" value="${agendaDate}" required>
</label>
<button class="btn ghost" id="next" aria-label="Período siguiente">→</button>
<button class="btn secondary" id="today">Hoy</button>
<label>Vista<select id="agenda-mode">
<option value="day">Día</option>
<option value="week" ${agendaMode === 'week' ? 'selected' : ''}>Semana</option>
</select>
</label>
</div>
<div id="calendar">
</div>
</section>`;
    const update = () => {
        const date = parseDate(agendaDate);
        let dates = [agendaDate];
        if (agendaMode === 'week') {
            date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
            dates = Array.from({
                length: 7
            }, (_, i) => {
                const d = new Date(date);
                d.setDate(d.getDate() + i);
                return dateKey(d);
            });
        }
        const visits = agendaVisits(dates);
        document.querySelector('#calendar').innerHTML = agendaMode === 'day' ? table(visits) : `<div class="table-wrap">
<div class="week">${dates.map(d => `<section class="day">
<h3>${days[parseDate(d).getDay()]}<br><span class="muted">${pretty(d)}</span>
</h3>${visits.filter(v => v.date === d).map(v => `<button class="appointment" data-detail="${v.id}"><strong>${v.time}</strong>${v.alias}<br>${v.id}</button>`).join('') || '<small class="muted">Sin visitas</small>'}</section>`).join('')}</div>
</div>`;
    };
    document.querySelector('#agenda-date').onchange = e => {
        if (e.target.value) {
            agendaDate = e.target.value;
            update();
        }
    };
    document.querySelector('#agenda-mode').onchange = e => {
        agendaMode = e.target.value;
        update();
    };
    for (const [id, dir] of [['prev', -1], ['next', 1]])
        document.querySelector('#' + id).onclick = () => {
            const d = parseDate(agendaDate);
            d.setDate(d.getDate() + dir * (agendaMode === 'week' ? 7 : 1));
            agendaDate = dateKey(d);
            document.querySelector('#agenda-date').value = agendaDate;
            update();
        };
    document.querySelector('#today').onclick = () => {
        agendaDate = relative(0);
        document.querySelector('#agenda-date').value = agendaDate;
        update();
    };
    update();
}
function minutes(t) {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
}
function fits(v, schedule) {
    return schedule[parseDate(v.date).getDay()].blocks.some(b => minutes(v.time) >= minutes(b.start) && minutes(v.time) + v.duration <= minutes(b.end));
}
function overlaps(a, b) {
    return minutes(a.start) < minutes(b.end) && minutes(b.start) < minutes(a.end);
}
let scheduleDraft = null;
function availability() {
    if (!scheduleDraft)
        scheduleDraft = JSON.parse(JSON.stringify(data.schedules[doctor.id]));
    const schedule = scheduleDraft;
    const dirty = JSON.stringify(schedule) !== JSON.stringify(data.schedules[doctor.id]);
    content.innerHTML = `<section class="card">
<div class="section-head">
<div>
<h2>Horarios de atención</h2><span class="muted">Define los bloques que se repiten cada semana.</span>
</div><span class="save-status" role="status">${dirty ? 'Cambios sin guardar' : 'Horarios guardados'}</span>
</div>
<p class="notice">Los días sin bloques quedan sin atención. Revisa tus horarios y pulsa Guardar disponibilidad para aplicar los cambios.</p>
<form id="block-form" class="filters">
<label>Día<select id="block-day">${days.map((d, i) => `<option value="${i}">${d}</option>`).join('')}</select>
</label>
<label>Desde<input id="block-start" type="time" value="08:00" required>
</label>
<label>Hasta<input id="block-end" type="time" value="12:00" required>
</label>
<button class="btn secondary" type="submit">${icon('plus')} Agregar bloque</button>
</form>
<div class="schedule">${[
        1, 2, 3, 4, 5, 6, 0
    ].map(i => `<section class="schedule-day">
<h3>${days[i]}</h3>${schedule[i].blocks.map((b, j) => `<div class="block"><span>${b.start} — ${b.end}</span>
<button data-remove="${i},${j}" aria-label="Quitar bloque ${days[i]} de ${b.start} a ${b.end}">×</button>
</div>`).join('') || '<span class="muted">Sin atención</span>'}</section>`).join('')}</div>
<div class="actions">
<button class="btn ghost" id="discard-schedule" ${dirty ? '' : 'disabled'}>Descartar cambios</button>
<button class="btn" id="save-schedule" ${dirty ? '' : 'disabled'}>${icon('check')} Guardar disponibilidad</button>
</div>
</section>`;
    document.querySelector('#block-form').onsubmit = e => {
        e.preventDefault();
        const day = Number(document.querySelector('#block-day').value), block = {
            start: document.querySelector('#block-start').value, end: document.querySelector('#block-end').value
        };
        if (!block.start || !block.end || minutes(block.start) >= minutes(block.end)) {
            toast('La hora final debe ser posterior a la inicial.');
            return;
        }
        if (schedule[day].blocks.some(b => overlaps(b, block))) {
            toast('Este bloque se superpone con otro horario del mismo día.');
            return;
        }
        schedule[day].blocks.push(block);
        schedule[day].blocks.sort((a, b) => a.start.localeCompare(b.start));
        availability();
        document.querySelector('#block-day').value = day;
        toast('Bloque agregado. Guarda la disponibilidad para aplicar el cambio.');
    };
    document.querySelectorAll('[data-remove]').forEach(btn => btn.onclick = () => {
        const [day, index] = btn.dataset.remove.split(',').map(Number);
        schedule[day].blocks.splice(index, 1);
        availability();
    });
    document.querySelector('#discard-schedule').onclick = () => {
        scheduleDraft = null;
        availability();
        toast('Se recuperaron los horarios guardados.');
    };
    document.querySelector('#save-schedule').onclick = () => {
        const affected = own().filter(v => v.status === 'aceptada' && v.date >= relative(0) && fits(v, data.schedules[doctor.id]) && !fits(v, schedule));
        const persist = () => {
            if (!persistSchedule(schedule)) {
                toast('No se guardó la disponibilidad. Revisa los bloques o el almacenamiento.');
                return false;
            }
            scheduleDraft = null;
            availability();
            toast('Disponibilidad guardada.');
            return true;
        };
        if (affected.length)
            confirmDialog('Visitas fuera del nuevo horario', `Este cambio afecta ${affected.length} visita(s) aceptada(s): ${affected.map(v => v.id + ' (' + pretty(v.date) + ', ' + v.time + ')').join(', ')}. Seguirán aceptadas. Puedes conservar el horario actual o guardar el cambio.`, persist);
        else
            persist();
    };
}
function history() {
    content.innerHTML = `<section class="card">
<h2>Historial de visitas</h2>
<p class="muted">Consulta visitas cerradas o selecciona las aceptadas para marcar su finalización.</p>
<div class="filters">
<label>Desde<input type="date" id="from">
</label>
<label>Hasta<input type="date" id="to">
</label>
<label>Estado<select id="history-status">
<option value="closed">Completadas, rechazadas y canceladas</option>
<option value="completada">Completadas</option>
<option value="rechazada">Rechazadas</option>
<option value="cancelada">Canceladas</option>
<option value="aceptada">Aceptadas · por completar</option>
</select>
</label>
<button class="btn ghost" id="clear">Limpiar filtros</button>
</div>
<p id="filter-error" role="status">
</p>
<div id="history-table">
</div>
</section>`;
    const update = () => {
        const from = historyFrom = document.querySelector('#from').value, to = historyTo = document.querySelector('#to').value, status = historyStatus = document.querySelector('#history-status').value;
        document.querySelector('#filter-error').textContent = from && to && from > to ? 'La fecha inicial debe ser anterior o igual a la final.' : '';
        document.querySelector('#history-table').innerHTML = from && to && from > to ? empty('Corrige el intervalo de fechas para consultar las visitas.') : table(historyVisits(status, from, to));
    };
    document.querySelector('#from').value = historyFrom;
    document.querySelector('#to').value = historyTo;
    document.querySelector('#history-status').value = historyStatus;
    content.querySelectorAll('input,select').forEach(el => el.onchange = update);
    document.querySelector('#clear').onclick = () => {
        document.querySelector('#from').value = '';
        document.querySelector('#to').value = '';
        document.querySelector('#history-status').value = 'closed';
        update();
    };
    update();
}
// Detalles y confirmaciones. Las acciones vuelven a validar antes de guardar.
function openModal(html) {
    const modal = document.querySelector('#modal');
    modal.innerHTML = `<div class="dialog-head">
<h2 id="modal-title">
</h2>
<button class="close" aria-label="Cerrar">×</button>
</div>${html}`;
    modal.querySelector('.close').onclick = () => modal.close();
    if (!modal.open)
        modal.showModal();
    return modal;
}
function confirmDialog(title, message, action, extra = '') {
    const modal = openModal(`<p id="confirm-message">
</p>${extra}<div class="actions">
<button class="btn ghost" id="cancel">Volver</button>
<button class="btn" id="confirm">Confirmar</button>
</div>`);
    modal.querySelector('#modal-title').textContent = title;
    modal.querySelector('#confirm-message').textContent = message;
    modal.querySelector('#cancel').onclick = () => modal.close();
    modal.querySelector('#confirm').onclick = () => {
        if (action() !== false)
            modal.close();
    };
}
function detail(id) {
    const v = own().find(v => v.id === id);
    if (!v)
        return;
    const modal = openModal(`<div>${badge(v.status)}</div>
<div class="details">
<div><span>Paciente</span>${v.alias}</div>
<div><span>Código</span>${v.id}</div>
<div><span>Especialidad</span>${v.specialty}</div>
<div><span>Médico</span>${doctor.name}</div>
<div><span>Fecha</span>${pretty(v.date)}</div>
<div><span>Horario</span>${v.time} · ${v.duration} min</div>
</div>
<div id="reason-text">
</div>${v.status === 'aceptada' && isFutureVisit(v) ? '<p class="notice">Podrás completar esta visita a partir de su hora programada.</p>' : ''}${v.status === 'aceptada' && !fits(v, data.schedules[doctor.id]) ? '<p class="notice">Esta visita está fuera de tu disponibilidad actual.</p>' : ''}<div class="actions">${v.status === 'pendiente' ? '<button class="btn danger" id="reject">Rechazar</button><button class="btn" id="accept">Aceptar visita</button>' : ''}${v.status === 'aceptada' ? `<button class="btn danger" id="cancel-visit">Cancelar visita</button>
<button class="btn" id="complete" ${isFutureVisit(v) ? 'disabled' : ''}>Marcar como completada</button>` : ''}</div>`);
    modal.querySelector('#modal-title').textContent = 'Detalle de la visita';
    if (v.reason)
        modal.querySelector('#reason-text').textContent = 'Motivo: ' + v.reason;
    const change = (status, reason = '') => {
        const error = transition(v.id, status, reason);
        if (error) {
            toast(error);
            return false;
        }
        render();
        toast('Visita ' + status + '. Cambios guardados.');
        return true;
    };
    if (v.status === 'pendiente') {
        modal.querySelector('#accept').onclick = () => {
            const error = acceptanceError(v);
            if (error) {
                toast(error);
                return;
            }
            confirmDialog('Aceptar visita', `¿Confirmas la visita ${v.id} para el ${pretty(v.date)} a las ${v.time}?`, () => change('aceptada'));
        };
        modal.querySelector('#reject').onclick = () => confirmDialog('Rechazar solicitud', `¿Quieres rechazar la solicitud ${v.id}? Selecciona un motivo.`, () => change('rechazada', document.querySelector('#reject-reason').value), '<label class="field">Motivo<select id="reject-reason"><option>Horario no disponible</option><option>Agenda completa</option><option>Fuera del ámbito de atención</option></select></label>');
    }
    if (v.status === 'aceptada')
        modal.querySelector('#cancel-visit').onclick = () => confirmDialog('Cancelar visita', `¿Quieres cancelar la visita ${v.id} del ${pretty(v.date)} a las ${v.time}? Su horario quedará libre.`, () => change('cancelada'));
    if (v.status === 'aceptada')
        modal.querySelector('#complete').onclick = () => {
            if (isFutureVisit(v)) {
                toast('Puedes completar la visita a partir de su hora programada.');
                return;
            }
            confirmDialog('Completar visita', `¿Confirmas que la visita ${v.id} se ha completado?`, () => change('completada'));
        };
}
// Arranque único. Las pruebas de lógica cargan las funciones sin ejecutar start().
let content;
function render() {
    ({
        resumen: summary, solicitudes: requests, agenda, disponibilidad: availability, historial: history
    }[page] || summary)();
}
function start() {
    if (page === 'acceso')
        access();
    else if (!doctor)
        location.replace('index.html');
    else {
        shell();
        content = document.querySelector('#content');
        render();
        content.addEventListener('click', e => {
            const btn = e.target.closest('[data-detail]');
            if (btn)
                detail(btn.dataset.detail);
        });
    }
    if (!storageOK)
        toast('Almacenamiento no disponible: los cambios no se conservarán al recargar.');
    window.addEventListener('beforeunload', e => {
        if (scheduleDraft && JSON.stringify(scheduleDraft) !== JSON.stringify(data.schedules[doctor.id])) {
            e.preventDefault();
            e.returnValue = '';
        }
    });
}
start();
