// Збирає сторінку для публікації як Artifact: без <!doctype>/<html>/<head>/<body>,
// бо публікація сама додає цей каркас. Скрипти з src/ публікуються окремими файлами.
// Запуск: node tools/build-artifact.js <вихідний.html>
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const between = (a, b) => {
  const i = html.indexOf(a), j = html.indexOf(b);
  if (i < 0 || j < 0) throw new Error('немає маркерів ' + a + ' / ' + b);
  return html.slice(i + a.length, j).trim();
};
const page = between('<!-- page:start -->', '<!-- page:head-end -->') + '\n' + between('<!-- page:body -->', '<!-- page:end -->') + '\n';
const out = process.argv[2] || path.join(root, 'artifact.html');
fs.writeFileSync(out, page);
console.log('ok ->', out, page.length, 'байт');
