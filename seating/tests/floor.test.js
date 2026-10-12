import test from 'node:test';
import assert from 'node:assert/strict';
import {initialTables,WALL_PATH} from '../public/floor.js';

test('building walls clear every original table and its chairs',()=>{
  const tokens=WALL_PATH.match(/[MLHV]|-?\d+(?:\.\d+)?/g);
  const segments=[];let x=0,y=0;
  for(let i=0;i<tokens.length;){
    const command=tokens[i++];let nx=x,ny=y;
    if(command==='M'||command==='L'){nx=Number(tokens[i++]);ny=Number(tokens[i++]);}
    else if(command==='H')nx=Number(tokens[i++]);
    else if(command==='V')ny=Number(tokens[i++]);
    else throw new Error('Unsupported wall command: '+command);
    if(command!=='M')segments.push([x,y,nx,ny]);
    x=nx;y=ny;
  }
  for(const table of initialTables()){
    const booth=table.kind==='booth',across=table.orientation==='tb';
    const long=Math.max(38,Math.ceil((table.capacity||0)/2)*14+7);
    const w=booth?44:across?long:38,h=booth?44:across?38:long;
    const rx=w/2+(across?0:booth?9:11)+3,ry=h/2+(across?(booth?9:11):0)+3;
    for(const [x1,y1,x2,y2] of segments){
      const steps=Math.ceil(Math.hypot(x2-x1,y2-y1)*2);
      for(let i=0;i<=steps;i++){
        const x=x1+(x2-x1)*i/steps,y=y1+(y2-y1)*i/steps;
        assert.ok(Math.abs(x-table.x)>rx||Math.abs(y-table.y)>ry,`Wall overlaps ${table.id} at ${x},${y}`);
      }
    }
  }
});
