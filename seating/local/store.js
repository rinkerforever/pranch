import {DatabaseSync} from 'node:sqlite';
import {readFileSync,mkdirSync,chmodSync} from 'node:fs';
import {join} from 'node:path';
import {randomBytes,scryptSync,timingSafeEqual,createHash} from 'node:crypto';
export const hash=value=>createHash('sha256').update(value).digest('hex');
export function pinHash(pin,salt=randomBytes(16).toString('hex')){return `${salt}:${scryptSync(pin,salt,32).toString('hex')}`;}
export function pinMatches(pin,encoded){const[salt,value]=String(encoded).split(':');if(!salt||!value)return false;const actual=scryptSync(pin,salt,32),expected=Buffer.from(value,'hex');return actual.length===expected.length&&timingSafeEqual(actual,expected);}
export function openStore(directory){
 mkdirSync(directory,{recursive:true,mode:0o700});const filename=join(directory,'seating.sqlite'),db=new DatabaseSync(filename);try{chmodSync(filename,0o600);}catch{}
 db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;');
 db.exec(readFileSync(new URL('../migrations/0001_seating.sql',import.meta.url),'utf8'));
 db.exec(`CREATE TABLE IF NOT EXISTS user_profiles(id TEXT PRIMARY KEY,auth_user_id TEXT,email TEXT,display_name TEXT,system_admin INTEGER,active INTEGER);
 CREATE TABLE IF NOT EXISTS locations(id TEXT PRIMARY KEY,name TEXT,active INTEGER);
 CREATE TABLE IF NOT EXISTS local_pins(user_id TEXT PRIMARY KEY,verifier TEXT NOT NULL,expires_at INTEGER NOT NULL,pin_key TEXT UNIQUE NOT NULL);
 CREATE TABLE IF NOT EXISTS local_sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,expires_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS local_receipts(id TEXT PRIMARY KEY,response_json TEXT NOT NULL,created_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS local_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS local_attempts(client TEXT PRIMARY KEY,attempts INTEGER NOT NULL,window_start INTEGER NOT NULL);`);
 const adapter={prepare(sql){let args=[];return {bind(...values){args=values;return this;},async first(){return db.prepare(sql).get(...args)||null;},async all(){return {results:db.prepare(sql).all(...args)};},async run(){return {meta:{changes:Number(db.prepare(sql).run(...args).changes)}};}};}};
 return {db,adapter,meta(key,value){if(value!==undefined)db.prepare('INSERT OR REPLACE INTO local_meta VALUES(?,?)').run(key,String(value));return db.prepare('SELECT value FROM local_meta WHERE key=?').get(key)?.value;},snapshot(id){const r=db.prepare('SELECT version,state_json FROM seating_state WHERE location_id=?').get(id);return r?{version:r.version,state:JSON.parse(r.state_json)}:null;},close:()=>db.close()};
}
export function syncRoster(store,id,roster,now=Date.now()){
 if(!roster){if(now-Number(store.meta('rosterAt')||0)>=60000)store.meta('rosterAt',now);return;}
 const fingerprint=hash(JSON.stringify(roster));
 if(store.meta('rosterHash')===fingerprint){if(now-Number(store.meta('rosterAt')||0)>=60000)store.meta('rosterAt',now);return;}
 const db=store.db;db.exec('BEGIN IMMEDIATE');try{
  db.prepare('UPDATE user_profiles SET active=0').run();db.prepare('DELETE FROM seating_grants WHERE location_id=?').run(id);
  for(const user of roster){db.prepare('INSERT OR REPLACE INTO user_profiles VALUES(?,?,?,?,?,1)').run(user.id,user.auth_user_id,user.email,user.display_name,user.system_admin?1:0);if(!user.system_admin)db.prepare('INSERT INTO seating_grants VALUES(?,?,?)').run(user.id,id,user.role);}
  db.prepare('DELETE FROM local_sessions WHERE expires_at<? OR user_id IN(SELECT id FROM user_profiles WHERE active=0)').run(now);
  store.meta('rosterAt',now);store.meta('rosterHash',fingerprint);db.exec('COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e;}
}
export function processCommand(store,id,command,now=Date.now()){
 const db=store.db,receipt=db.prepare('SELECT response_json FROM local_receipts WHERE id=?').get(command.id);if(receipt)return JSON.parse(receipt.response_json);
 db.exec('BEGIN IMMEDIATE');try{
  const current=store.snapshot(id);let response;
  if(now>=command.expires_at)response={error:'This request expired before it reached the restaurant. Refresh and try again.',status:409};
  else if(!current||current.version!==command.expected_version)response={error:'Another host changed this floor. Refresh before trying again.',status:409};
  else{
   const state=JSON.parse(command.state_json);if(!Array.isArray(state.tables)||!Array.isArray(state.parties))throw Error('Invalid cloud command');
   db.prepare("UPDATE seating_state SET version=version+1,state_json=?,updated_by='cloud-command' WHERE location_id=? AND version=?").run(command.state_json,id,current.version);
   response={state,version:current.version+1};
  }
  db.prepare('INSERT INTO local_receipts VALUES(?,?,?)').run(command.id,JSON.stringify(response),now);db.exec('COMMIT');return response;
 }catch(e){db.exec('ROLLBACK');throw e;}
}
