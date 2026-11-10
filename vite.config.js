import {defineConfig, loadEnv} from 'vite';
import react from '@vitejs/plugin-react';
import market from './api/market.js';
import push from './api/push.js';
import signup from './api/signup.js';
// Mount the serverless handlers in the dev server with Vercel-style req/res helpers.
const mount=(server,path,handler)=>server.middlewares.use(path,async(req,res)=>{const url=new URL(req.url,'http://localhost');req.query=Object.fromEntries(url.searchParams);req.headers=req.headers||{};res.status=n=>{res.statusCode=n;return res};res.json=data=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));};await handler(req,res);});
export default defineConfig({plugins:[react(),{name:'local-api',configureServer(server){
  // Server-only storage credential; never expose it as a VITE_ variable.
  const env = loadEnv(server.config.mode, server.config.root, 'BLOB_');
  if (!process.env.BLOB_READ_WRITE_TOKEN && env.BLOB_READ_WRITE_TOKEN) process.env.BLOB_READ_WRITE_TOKEN = env.BLOB_READ_WRITE_TOKEN;
  mount(server,'/api/market',market);mount(server,'/api/push',push);mount(server,'/api/signup',signup);
}}],server:{host:'127.0.0.1',port:5177,strictPort:true,proxy:{'/api/lodestar':'http://127.0.0.1:5189'}},build:{sourcemap:false,chunkSizeWarningLimit:600,
  rollupOptions: { output: { manualChunks(id) {
    // Stable dependencies stay cached when application code changes.
    if (/\/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'react-vendor';
    if (id.endsWith('/src/stocks.js')) return 'stock-directory';
  } } },
}});
