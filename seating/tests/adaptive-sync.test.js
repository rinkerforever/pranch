import test from 'node:test';
import assert from 'node:assert/strict';
import {adaptiveSync} from '../public/adaptive-sync.js';
import {readFileSync} from 'node:fs';
test('active cloud and local rates slow after idle and wake immediately without polling on every tap',()=>{
 for(const [mode,rate] of [['cloud',2000],['local',5000]]){
 const s=adaptiveSync(0);assert.equal(s.due(0,mode),true);assert.equal(s.due(rate-1,mode),false);assert.equal(s.due(rate,mode),true);
 assert.equal(s.due(90000,mode),true);assert.equal(s.due(99999,mode),false);assert.equal(s.due(100000,mode),true);
 assert.equal(s.activity(100001),true);assert.equal(s.due(100001,mode),true);assert.equal(s.activity(100002),false);assert.equal(s.due(100002,mode),false);assert.equal(s.due(100001+rate,mode),true);
 s.resume(200000);assert.equal(s.due(200000,mode),true);assert.equal(s.due(200000+rate,mode),true);
 }
});
test('ready glow is bounded with reduced motion support',()=>{
 const css=readFileSync(new URL('../public/style.css',import.meta.url),'utf8');assert.ok(css.includes('animation:ready-glow 3s ease-in-out 3 forwards'));assert.ok(!css.includes('ready-glow 3s ease-in-out infinite'));assert.ok(css.includes('.table-ready::after{animation:none;opacity:.4}'));
});
