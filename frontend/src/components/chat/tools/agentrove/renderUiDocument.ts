import { FRAME_BASE_CSS } from '@/utils/frameTheme';

// Minimal MCP Apps client for model-authored HTML: performs the ui/initialize
// handshake, applies host theme variables, reports size, and exposes
// window.agentrove.sendMessage(text) for submitting results back to the chat.
const APP_CLIENT = `(function(){
var nextId=1,pending={};
function send(m){m.jsonrpc='2.0';parent.postMessage(m,'*');}
function request(method,params){var id=nextId++;send({id:id,method:method,params:params});return new Promise(function(res,rej){pending[id]={res:res,rej:rej};});}
function applyContext(ctx){if(!ctx)return;var root=document.documentElement;if(ctx.theme)root.style.colorScheme=ctx.theme;var vars=ctx.styles&&ctx.styles.variables;if(vars)for(var k in vars)root.style.setProperty(k,vars[k]);}
window.addEventListener('message',function(e){if(e.source!==parent)return;var m=e.data;if(!m||m.jsonrpc!=='2.0')return;
if(m.method==='ui/notifications/host-context-changed'){applyContext(m.params);return;}
if(m.id!=null&&pending[m.id]){var p=pending[m.id];delete pending[m.id];if(m.error)p.rej(m.error);else p.res(m.result);}});
window.agentrove={sendMessage:function(text){return request('ui/message',{role:'user',content:[{type:'text',text:String(text)}]});}};
request('ui/initialize',{protocolVersion:'2026-01-26',appInfo:{name:'agentrove-render-ui',version:'1.0.0'},appCapabilities:{}}).then(function(r){applyContext(r.hostContext);send({method:'ui/notifications/initialized'});});
var h=0;new ResizeObserver(function(){var n=Math.ceil(document.documentElement.getBoundingClientRect().height);if(n!==h){h=n;send({method:'ui/notifications/size-changed',params:{height:n}});}}).observe(document.documentElement);
})();`;

export const buildRenderUiDocument = (html: string): string =>
  `<style>${FRAME_BASE_CSS}</style><script>${APP_CLIENT}</script>${html}`;
