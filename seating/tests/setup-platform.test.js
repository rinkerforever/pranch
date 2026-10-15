import test from 'node:test';
import assert from 'node:assert/strict';
import {detectSetupPlatform} from '../public/setup-platform.js';
test('setup selects Android tablets and phones without confusing desktop-mode iPads',()=>{
 assert.equal(detectSetupPlatform({userAgent:'Mozilla/5.0 (Linux; Android 14; SM-X610) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36'}),'android');
 assert.equal(detectSetupPlatform({userAgent:'Mozilla/5.0 (Linux; Android 15; Pixel 9) Mobile Safari/537.36'}),'android');
 assert.equal(detectSetupPlatform({userAgentData:{platform:'Android'},userAgent:'Reduced desktop user agent'}),'android');
 assert.equal(detectSetupPlatform({userAgent:'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)'}),'apple');
 assert.equal(detectSetupPlatform({userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'}),'apple');
 assert.equal(detectSetupPlatform({userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)',platform:'MacIntel',maxTouchPoints:5}),'apple');
 assert.equal(detectSetupPlatform({platform:'MacIntel',maxTouchPoints:0}),'');
 assert.equal(detectSetupPlatform({userAgent:'Mozilla/5.0 (Windows NT 10.0)',maxTouchPoints:10}),'');
 assert.equal(detectSetupPlatform(), '');
});
