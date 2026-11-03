// Comprobación local sin dependencias: node verify.cjs
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const memory = new Map([['medicgo-medicos:selected:v1', 'm1']]);
const context = vm.createContext({
    console, Date, URLSearchParams, location: {
        search: ''
    }, setTimeout, localStorage: {
        getItem: k => memory.get(k) || null, setItem: (k, v) => memory.set(k, v)
    }, document: {
        body: {
            dataset: {
                page: 'resumen'
            }
        }, querySelector: () => null
    }
});
const source = fs.readFileSync('app.js', 'utf8');
// Ejecuta las funciones y los datos sin arrancar la interfaz del navegador.
const logic = source.replace(/\nstart\(\);\s*$/, '\n');
vm.runInContext(logic, context);
function run(code) {
    return vm.runInContext(code, context);
}
assert.equal(run('data.visits.length'), 27);
assert.equal(run('own().length'), 9);
assert.equal(run('own().every(v=>v.doctor===doctor.id)'), true);
assert.equal(run("own().filter(v=>v.status==='aceptada'&&v.date===relative(0)).length"), 1);
assert.equal(run("overlaps({start:'08:00',end:'10:00'},{start:'09:00',end:'11:00'})"), true);
assert.equal(run("overlaps({start:'08:00',end:'10:00'},{start:'10:00',end:'11:00'})"), false);
assert.equal(run("own().filter(v=>v.status==='aceptada').every(v=>fits(v,data.schedules[doctor.id]))"), true);
// Recorrido completo con una visita pasada, sin depender de la hora de ejecución.
run("own()[0].date=relative(-1);data.schedules[doctor.id][parseDate(relative(-1)).getDay()].blocks=[{start:'00:00',end:'23:59'}]");
assert.equal(run("transition(own()[0].id,'aceptada')"), '');
assert.equal(run("agendaVisits([own()[0].date]).some(v=>v.id===own()[0].id)"), true);
assert.equal(run("transition(own()[0].id,'completada')"), '');
assert.equal(run("historyVisits('completada').some(v=>v.id===own()[0].id)"), true);
assert.equal(run("agendaVisits([own()[0].date]).some(v=>v.id===own()[0].id)"), false);
assert.notEqual(run("transition(own()[0].id,'aceptada')"), '');
assert.equal(run("transition(own()[1].id,'rechazada','Agenda completa')"), '');
assert.equal(run("historyVisits('rechazada').some(v=>v.id===own()[1].id)"), true);
assert.equal(run("transition(own()[3].id,'cancelada')"), '');
assert.equal(run("agendaVisits([own()[3].date]).some(v=>v.id===own()[3].id)"), false);
run("own()[2].date=own()[3].date;own()[2].time=own()[3].time");
assert.equal(run("transition(own()[2].id,'aceptada')"), ''); // el horario se liberó
run("own()[3].status='pendiente'");
assert.notEqual(run("transition(own()[3].id,'aceptada')"), ''); // ahora hay conflicto
assert.equal(run("historyVisits('completada','2099-01-01').length"), 0);
assert.equal(run("requestVisits('pendiente').every(v=>v.status==='pendiente')"), true);
run("const scheduleCopy=JSON.parse(JSON.stringify(data.schedules[doctor.id]));scheduleCopy[1].blocks=[{start:'20:00',end:'21:00'}]");
assert.equal(run('persistSchedule(scheduleCopy)'), true);
run("scheduleCopy[1].blocks.push({start:'20:30',end:'22:00'})");
assert.equal(run('persistSchedule(scheduleCopy)'), false);
assert.equal(JSON.parse(memory.get('medicgo-medicos:data:v1')).visits[0].status, 'completada');
assert.equal(JSON.parse(memory.get('medicgo-medicos:data:v1')).visits[9].status, 'pendiente');
// Una ejecución nueva utiliza el almacenamiento guardado sin regenerarlo.
const saved = memory.get('medicgo-medicos:data:v1');
const reload = vm.createContext({
    Date, URLSearchParams, location: {
        search: '?estado=cancelada'
    }, localStorage: {
        getItem: k => memory.get(k) || null, setItem: (k, v) => memory.set(k, v)
    }, document: {
        body: {
            dataset: {
                page: 'historial'
            }
        }, querySelector: () => null
    }
});
vm.runInContext(logic, reload);
assert.equal(memory.get('medicgo-medicos:data:v1'), saved);
assert.equal(vm.runInContext('own()[0].status', reload), 'completada');
assert.equal(vm.runInContext('historyStatus', reload), 'cancelada');
// Un fallo de almacenamiento no cambia el estado en memoria ni anuncia éxito.
const beforeFailure = run('JSON.stringify(data)');
const originalSet = context.localStorage.setItem;
context.localStorage.setItem = () => {
    throw Error('Cuota agotada');
};
run('toast=()=>{}');
assert.notEqual(run("transition(own()[4].id,'cancelada')"), '');
assert.equal(run('JSON.stringify(data)'), beforeFailure);
context.localStorage.setItem = originalSet;
const pages = [
    'index', 'resumen', 'solicitudes', 'agenda', 'disponibilidad', 'historial'
];
for (const page of pages) {
    const html = fs.readFileSync(page + '.html', 'utf8');
    assert.ok(html.includes('src="app.js"'));
    assert.ok(html.includes('href="styles.css"'));
    assert.ok(html.includes('name="viewport"'));
    for (const match of html.matchAll(/(?:src|href)="([^"#]+)"/g)) {
        if (!/^https?:/.test(match[1])) assert.ok(fs.existsSync(match[1]), `Dependencia inexistente en ${page}: ${match[1]}`);
    }
}
for (const match of source.matchAll(/(?:href=|href\s*=\s*)["']([a-z]+\.html)/g))
    assert.ok(fs.existsSync(match[1]), match[1]);
assert.match(fs.readFileSync('styles.css', 'utf8'), /@media\s*\(max-width:\s*760px\)/);
assert.ok(fs.readFileSync('styles.css', 'utf8').includes('prefers-reduced-motion'));
console.log('Correcto: recorrido pendiente → aceptada → agenda → completada → historial; rechazo, cancelación, liberación de horario, filtros, aislamiento, solapamientos, persistencia y enlaces.');
