import { FRAME_BASE_CSS } from '@/utils/frameTheme';

// Minimal MCP Apps client for model-authored HTML: performs the ui/initialize
// handshake, applies host theme variables, reports size, and exposes
// window.agentrove.sendMessage(text) for submitting results back to the chat.
// Size is the bottom of the body's content, not the root or body box, which a
// document can tie to the frame (height: 100%) or fix below its content.
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
var h=0;function size(){var b=document.body,r=document.createRange(),s=getComputedStyle(b);r.selectNodeContents(b);var n=Math.ceil(r.getBoundingClientRect().bottom+window.scrollY+parseFloat(s.paddingBottom)+parseFloat(s.borderBottomWidth)+parseFloat(s.marginBottom));if(n!==h){h=n;send({method:'ui/notifications/size-changed',params:{height:n}});}}
var ro=new ResizeObserver(size);function watch(){ro.observe(document.documentElement);for(var c=document.body.children,i=0;i<c.length;i++)ro.observe(c[i]);}
document.addEventListener('DOMContentLoaded',function(){watch();size();new MutationObserver(function(){watch();size();}).observe(document.body,{childList:true});});
})();`;

export const buildRenderUiDocument = (html: string): string =>
  `<style>${FRAME_BASE_CSS}</style><script>${APP_CLIENT}</script>${html}`;
