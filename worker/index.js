const mime = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml'};
export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/lichess/')) {
      const endpoint = url.pathname.slice('/lichess'.length);
      const allowed = /^\/api\/(?:tournament(?:\/[A-Za-z0-9]{8}(?:\/games)?)?|swiss\/[A-Za-z0-9]{8}(?:\/games)?|games\/export\/_ids)$/.test(endpoint);
      if (!allowed || !['GET','POST'].includes(request.method) || (request.method==='POST' && endpoint!=='/api/games/export/_ids')) return new Response('Unsupported endpoint',{status:400});
      let body;
      if(request.method==='POST'){
        body=await request.text();
        if(body.length>2700 || !/^[A-Za-z0-9]{8}(?:,[A-Za-z0-9]{8}){0,299}$/.test(body)) return new Response('Invalid game IDs',{status:400});
      }
      const query = new URLSearchParams();
      for (const key of ['clocks','opening','moves','page']) if(url.searchParams.has(key)) query.set(key,url.searchParams.get(key));
      try {
        const response=await fetch(`https://lichess.org${endpoint}?${query}`,{method:request.method,body,headers:{'Accept':request.headers.get('Accept')==='application/x-ndjson'?'application/x-ndjson':'application/json',...(body?{'Content-Type':'text/plain'}:{})},signal:request.signal});
        return new Response(response.body,{status:response.status,headers:{'Content-Type':response.headers.get('Content-Type')??'application/json','Cache-Control':'no-store',...(response.headers.has('Retry-After')?{'Retry-After':response.headers.get('Retry-After')}:{})}});
      } catch { return Response.json({error:'Lichess is temporarily unavailable. Try again shortly.'},{status:502}); }
    }
    if(request.method!=='GET' && request.method!=='HEAD') return new Response('Method not allowed',{status:405});
    const key=url.pathname==='/'?'/index.html':url.pathname;
    const asset=ASSETS[key];
    if(asset===undefined) return new Response('Not found',{status:404});
    const extension=key.slice(key.lastIndexOf('.'));
    return new Response(request.method==='HEAD'?null:asset,{headers:{'Content-Type':mime[extension]??'text/plain','X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin','Cache-Control':'no-cache'}});
  }
};
