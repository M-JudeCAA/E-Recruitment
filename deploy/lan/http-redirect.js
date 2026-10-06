// Sends plain http://<host>/... to https://<host>/... (the careers site on
// 443), so typing the bare name in a browser lands on the site. Port 80,
// every address; run by run-uat.ps1 (processes.ps1).
const http = require('http');

const port = Number(process.env.UAT_HTTP_REDIRECT_PORT || 80);

http.createServer((req, res) => {
  const host = (req.headers.host || '').replace(/:\d+$/, '');
  if (!host) {
    res.writeHead(400).end('Bad request');
    return;
  }
  res.writeHead(301, { Location: `https://${host}${req.url}` }).end();
}).listen(port, '::', () => console.log(`Redirecting http://*:${port} to https`));
