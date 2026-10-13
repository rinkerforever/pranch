import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
await mkdir(new URL('../public/vendor/', import.meta.url), { recursive: true });
for (const name of ['pdf.mjs', 'pdf.worker.mjs']) {
  await copyFile(new URL(`../node_modules/pdfjs-dist/build/${name}`, import.meta.url), new URL(`../public/vendor/${name}`, import.meta.url));
}
const model = await readFile(new URL('../src/model.js', import.meta.url), 'utf8');
await writeFile(new URL('../public/model.js', import.meta.url), model.replaceAll('../public/', './'));
