import http from 'node:http';
import { watch } from 'node:fs';
import { spawnSync } from 'node:child_process';
let revision = 0;
function rebuild() { const result=spawnSync(process.execPath,['scripts/build.mjs'],{stdio:'inherit'}); if(result.status) throw new Error('Build failed'); revision++; }
rebuild();
let pending;
for(const dir of ['src','public','worker']) watch(dir,{recursive:true},()=>{clearTimeout(pending);pending=setTimeout(()=>{try{rebuild();}catch(e){console.error(e.message);}},150);});
http.createServer(async(req,res)=>{
  try {
    const chunks=[];for await(const chunk of req) chunks.push(chunk);
    const body=Buffer.concat(chunks);
    const request=new Request(`http://127.0.0.1:4173${req.url}`,{method:req.method,headers:req.headers,...(body.length?{body}:{})});
    const {default:worker}=await import(`../dist/server/index.js?revision=${revision}`);
    const response=await worker.fetch(request,{},{});
    res.writeHead(response.status,Object.fromEntries(response.headers));
    if(response.body){const reader=response.body.getReader();res.on('close',()=>reader.cancel().catch(()=>{}));for(;;){const {value,done}=await reader.read();if(done)break;res.write(value);}}
    res.end();
  }catch(error){if(!res.headersSent)res.writeHead(500);res.end('Unable to serve request.');console.error(error.message);}
}).listen(4173,'127.0.0.1',()=>console.log('Local: http://127.0.0.1:4173'));
