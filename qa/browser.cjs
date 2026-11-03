// Pruebas con Edge en un perfil temporal: node qa/browser.cjs
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { startServer } = require('./server.cjs');
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function main() {
    const server = await startServer(0);
    const origin = `http://127.0.0.1:${server.address().port}`;
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'medicgo-maintenance-'));
    const edge = process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
    const browser = spawn(edge, [
        '--headless', '--no-sandbox', '--disable-gpu', '--in-process-gpu',
        '--no-first-run', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
    ], {
        windowsHide: true, stdio: 'ignore'
    });
    let launchError;
    browser.on('error', (error) => {
        launchError = error;
    });
    let ws;
    const errors = [];
    const resources = new Set();
    try {
        let port;
        for (let attempt = 0; attempt < 80; attempt++) {
            if (launchError)
                throw launchError;
            try {
                port = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0];
                break;
            }
            catch {
            }
            await pause(250);
        }
        if (!port)
            throw Error('Edge no habilitó el canal local de pruebas.');
        const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
        ws = new WebSocket(targets.find((target) => target.type === 'page').webSocketDebuggerUrl);
        await new Promise((resolve, reject) => {
            ws.addEventListener('open', resolve);
            ws.addEventListener('error', reject);
        });
        let id = 0;
        const pending = new Map();
        ws.addEventListener('message', (event) => {
            const message = JSON.parse(event.data);
            if (message.id && pending.has(message.id)) {
                pending.get(message.id)(message);
                pending.delete(message.id);
            }
            if (message.method === 'Runtime.exceptionThrown')
                errors.push(message.params.exceptionDetails.text + ': ' + (message.params.exceptionDetails.exception?.description || ''));
            if (message.method === 'Log.entryAdded' && message.params.entry.source === 'network')
                resources.add(message.params.entry.url || message.params.entry.text);
        });
        const call = (method, params = {}) => new Promise((resolve, reject) => {
            const key = ++id;
            const timer = setTimeout(() => {
                pending.delete(key);
                reject(Error('Tiempo agotado: ' + method));
            }, 30000);
            pending.set(key, (message) => {
                clearTimeout(timer);
                message.error ? reject(Error(JSON.stringify(message.error))) : resolve(message.result);
            });
            ws.send(JSON.stringify({
                id: key, method, params
            }));
        });
        const evaluate = async (expression) => {
            const result = await call('Runtime.evaluate', {
                expression, returnByValue: true, awaitPromise: true
            });
            if (result.exceptionDetails)
                throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
            return result.result.value;
        };
        await call('Page.enable');
        await call('Runtime.enable');
        await call('Log.enable');
        await call('Page.navigate', {
            url: `${origin}/qa/interacciones.html`
        });
        let report;
        for (let attempt = 0; attempt < 160; attempt++) {
            await pause(250);
            try {
                report = await evaluate('document.querySelector("#report")?.textContent');
            }
            catch {
            }
            if (/^(PASS|FAIL)/.test(report || ''))
                break;
        }
        if (!report?.startsWith('PASS'))
            throw Error(report || 'Las pruebas de interacción no terminaron.');
        console.log(report);
        await evaluate("localStorage.setItem('medicgo-medicos:selected:v1','m1')");
        const snapshots = [];
        for (const width of [
            390, 760, 1100, 1200, 1440
        ]) {
            await call('Emulation.setDeviceMetricsOverride', {
                width, height: 1050, deviceScaleFactor: 1, mobile: width < 500
            });
            for (const page of [
                'index', 'resumen', 'solicitudes', 'agenda', 'disponibilidad', 'historial'
            ]) {
                await call('Page.navigate', {
                    url: `${origin}/${page}.html`
                });
                let ready = false;
                for (let attempt = 0; attempt < 120; attempt++) {
                    await pause(100);
                    try {
                        ready = await evaluate(`document.body?.dataset.page==='${page === 'index' ? 'acceso' : page}' && document.querySelector('#app')?.children.length > 0`);
                    }
                    catch {
                    }
                    if (ready)
                        break;
                }
                if (!ready)
                    throw Error(`La página ${page} no terminó de cargar.`);
                const snapshot = await evaluate(`({
          overflow: document.documentElement.scrollWidth > innerWidth,
          active: document.querySelector('nav a.active')?.getAttribute('href'),
          elements: [...document.querySelectorAll('#app *')].map(el=>({
            tag: el.tagName, class: el.getAttribute('class'),
            style: Object.fromEntries([...getComputedStyle(el)].map(key=>[key,getComputedStyle(el).getPropertyValue(key)]))
          }))
        })`);
                if (snapshot.overflow)
                    throw Error(`Desbordamiento en ${page} a ${width}px.`);
                if (page !== 'index' && snapshot.active !== `${page}.html`)
                    throw Error(`Menú incorrecto en ${page}.`);
                snapshots.push({
                    width, page, ...snapshot
                });
            }
        }
        if (errors.length)
            throw Error('Errores de la web:\n' + errors.join('\n'));
        if (process.argv.includes('--snapshot'))
            fs.writeFileSync(path.join(__dirname, 'snapshot.json'), JSON.stringify(snapshots));
        const compareAt = process.argv.indexOf('--compare');
        if (compareAt !== -1) {
            const before = JSON.parse(fs.readFileSync(process.argv[compareAt + 1], 'utf8'));
            const differences = [];
            snapshots.forEach((current, index) => {
                const previous = before[index];
                if (current.elements.length !== previous.elements.length)
                    throw Error(`Estructura distinta: ${current.page}`);
                current.elements.forEach((element, elementIndex) => {
                    const prior = previous.elements[elementIndex];
                    for (const [key, value] of Object.entries(element.style)) {
                        if (value !== prior.style[key])
                            differences.push(`${current.page}@${current.width} ${element.tag}.${element.class} ${key}: ${prior.style[key]} -> ${value}`);
                    }
                });
            });
            if (differences.length)
                throw Error('Cambios visuales detectados:\n' + differences.slice(0, 30).join('\n'));
            console.log('PASS · Estilos calculados idénticos en 30 combinaciones de página y tamaño.');
        }
        console.log('PASS · Seis páginas a 390, 760, 1100, 1200 y 1440 px; sin errores JavaScript de la web.');
        if (resources.size)
            console.log('Recursos no disponibles (separados de errores JavaScript):\n' + [...resources].join('\n'));
        await call('Browser.close');
    }
    finally {
        ws?.close();
        if (browser.exitCode === null)
            browser.kill();
        server.close();
        // Solo el perfil temporal creado por esta ejecución; nunca un perfil del usuario.
        await pause(300);
        const resolvedProfile = path.resolve(profile);
        const temporaryRoot = path.resolve(os.tmpdir()) + path.sep;
        if (resolvedProfile.startsWith(temporaryRoot) && path.basename(resolvedProfile).startsWith('medicgo-maintenance-')) {
            fs.rmSync(resolvedProfile, {
                recursive: true, force: true, maxRetries: 5, retryDelay: 200
            });
        }
    }
}
main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
});
