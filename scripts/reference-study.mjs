// Further split the locally supplied reference for inspection. Fragments retain
// their original aliases and are dependency excerpts, never runnable modules.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
const root=path.resolve('artifacts/reference-audit'),out=path.resolve('artifacts/reference-study');
const manifest=JSON.parse(await fs.readFile(path.join(root,'manifest.json'),'utf8'));
const source=await fs.readFile(manifest.source.path);
const hash=buffer=>crypto.createHash('sha256').update(buffer).digest('hex');
if(hash(source)!==manifest.source.sha256)throw new Error('Reference changed: run audit:reference first.');
const readable=await fs.readFile('artifacts/reference-readable.js','utf8');
if(hash(readable)!==manifest.source.readableSha256)throw new Error('Readable source no longer matches the audited copy.');
const lines=readable.split('\n'),entries=[];
const ranges=[['render',17379,18409],['mats',18410,19553],['physics',19554,19795],['props',19796,21830],['level',21831,22547],['backdrop',22548,23495],['ground',23496,24172],['fx',24173,25338],['player-audio',25339,27036],['weapon',27037,27964],['enemies',27965,28837],['ui-game',28838,29749]];
await fs.mkdir(out,{recursive:true});
for(const [module,start,end] of ranges){
  const boundaries=[];
  for(let i=start-1;i<end;i++){
    const m=/^  (?:(?:async )?function ([\w$]+)\(|var ([\w$]+)\s*=)/.exec(lines[i]||'');
    if(m)boundaries.push({line:i+1,symbol:m[1]||m[2],kind:m[1]?'function':'declaration'});
  }
  if(boundaries[0]?.line!==start)boundaries.unshift({line:start,symbol:'module-header',kind:'header'});
  await fs.mkdir(path.join(out,module),{recursive:true});
  for(let i=0;i<boundaries.length;i++){
    const b=boundaries[i],last=(boundaries[i+1]?.line||end+1)-1;
    const filename=`${module}/${String(i+1).padStart(3,'0')}-${b.symbol.replace(/[^\w-]/g,'_')}.fragment.js`;
    const text=lines.slice(b.line-1,last).join('\n')+'\n';
    await fs.writeFile(path.join(out,filename),`// READ-ONLY DEPENDENCY EXCERPT, NOT A STANDALONE MODULE.\n// Original SHA256: ${manifest.source.sha256}\n// reference-readable.js:${b.line}-${last}; aliases require the original IIFE.\n${text}`);
    entries.push({module,symbol:b.symbol,kind:b.kind,startLine:b.line,endLine:last,bytes:Buffer.byteLength(text),file:filename});
  }
}
const index={schemaVersion:1,source:{filename:path.basename(manifest.source.path),sha256:hash(source)},format:'Dependency fragments; original declarations may contain several aliases. No executable reassembly is implied.',modules:ranges.map(([id,startLine,endLine])=>({id,startLine,endLine})),entries};
await fs.writeFile(path.join(out,'index.json'),JSON.stringify(index,null,2));
if(hash(await fs.readFile(manifest.source.path))!==manifest.source.sha256)throw new Error('Original changed during read-only extraction.');
console.log(`Indexed ${entries.length} declaration fragments across ${ranges.length} responsibility groups; original unchanged.`);
