import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(fileURLToPath(new URL('../site/',import.meta.url)));
const port=Number(process.env.PORT||54873);
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml','.ttf':'font/ttf','.mp4':'video/mp4','.json':'application/json'};
http.createServer((req,res)=>{
 let url;
 try{url=decodeURIComponent(new URL(req.url,'http://localhost').pathname);}catch{res.writeHead(400).end();return;}
 url=url.replace(/^\/avalia-oCliente(?=\/|$)/,'');
 const target=path.resolve(root,'.'+(url.endsWith('/')?url+'index.html':url));
 if(target!==root&&!target.startsWith(root+path.sep)){res.writeHead(403).end();return;}
 fs.stat(target,(err,stat)=>{
  if(err||!stat.isFile()){res.writeHead(404).end('Não encontrado');return;}
  res.setHeader('Content-Type',types[path.extname(target)]||'application/octet-stream');res.setHeader('Cache-Control','no-cache');res.setHeader('Accept-Ranges','bytes');
  const range=req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
  if(range){const start=Number(range[1]),end=range[2]?Math.min(Number(range[2]),stat.size-1):stat.size-1;if(start> end||start>=stat.size){res.writeHead(416,{'Content-Range':`bytes */${stat.size}`}).end();return;}res.writeHead(206,{'Content-Range':`bytes ${start}-${end}/${stat.size}`,'Content-Length':end-start+1});if(req.method==='HEAD')res.end();else fs.createReadStream(target,{start,end}).pipe(res);}
  else{res.setHeader('Content-Length',stat.size);if(req.method==='HEAD')res.end();else fs.createReadStream(target).pipe(res);}
 });
}).listen(port,'127.0.0.1',()=>console.log(`Local: http://127.0.0.1:${port}/avalia-oCliente/`));
