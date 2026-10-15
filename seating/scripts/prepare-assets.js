import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import {createHash} from 'node:crypto';
await mkdir(new URL('../public/vendor/', import.meta.url), { recursive: true });
for (const name of ['pdf.mjs', 'pdf.worker.mjs']) {
  await copyFile(new URL(`../node_modules/pdfjs-dist/build/${name}`, import.meta.url), new URL(`../public/vendor/${name}`, import.meta.url));
}
const model = await readFile(new URL('../src/model.js', import.meta.url), 'utf8');
await writeFile(new URL('../public/model.js', import.meta.url), model.replaceAll('../public/', './'));
const assets=['app.js','style.css','floor.js','areas.js','rooms.js','plan-cleanup.js','area-manager.js','floor-import.js','plan-detection.js','combinations.js','suggestions.js','wait-plan.js','ready-alert.js','device.js','ipad-setup.html','ipad-setup.js','ipad-setup.css','setup-platform.js','index.html','manifest.webmanifest','app-icon.svg'];
assets.push('plan-fit.js');
const hash=createHash('sha256');for(const name of assets)hash.update(await readFile(new URL('../public/'+name,import.meta.url)));
const template=await readFile(new URL('../public/sw.js',import.meta.url),'utf8');
await writeFile(new URL('../public/sw.js',import.meta.url),template.replace(/seating-shell-[\w-]+/,'seating-shell-'+hash.digest('hex').slice(0,12)));
