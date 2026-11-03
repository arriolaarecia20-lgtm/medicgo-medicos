const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
function startServer(port = 4173) {
    return new Promise((resolve, reject) => {
        const server = http.createServer((req, res) => {
            const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
            const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
            if (!file.startsWith(root + path.sep)) {
                res.writeHead(403);
                return res.end();
            }
            fs.readFile(file, (err, data) => {
                if (err) {
                    res.writeHead(404);
                    return res.end('Not found');
                }
                res.setHeader('Content-Type', ({
                    'html': 'text/html; charset=utf-8', 'css': 'text/css; charset=utf-8', 'js': 'text/javascript; charset=utf-8'
                })[path.extname(file).slice(1)] || 'text/plain');
                res.end(data);
            });
        });
        server.on('error', reject);
        server.listen(port, '127.0.0.1', () => resolve(server));
    });
}
module.exports = {
    startServer
};
if (require.main === module)
    startServer().then(server => console.log('http://127.0.0.1:' + server.address().port)).catch(error => {
        console.error(error.message);
        process.exitCode = 1;
    });
