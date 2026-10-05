import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import market from './api/market.js';
import push from './api/push.js';
// Mount the serverless handlers in the dev server with Vercel-style req/res helpers.
const mount=(server,path,handler)=>server.middlewares.use(path,async(req,res)=>{const url=new URL(req.url,'http://localhost');req.query=Object.fromEntries(url.searchParams);req.headers=req.headers||{};res.status=n=>{res.statusCode=n;return res};res.json=data=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));};await handler(req,res);});
export default defineConfig({plugins:[react(),{name:'local-api',configureServer(server){mount(server,'/api/market',market);mount(server,'/api/push',push);}}],server:{host:'127.0.0.1',port:5177,strictPort:true},build:{sourcemap:false,chunkSizeWarningLimit:600}});
