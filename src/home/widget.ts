export const HOME_WIDGET_URI = "ui://home/listings-and-detail-v2.html";

export type HomeMapPoint = { latitude: number; longitude: number };

export function homeMapProject(latitude: number, longitude: number, zoom: number): { x: number; y: number } {
  const size = Math.pow(2, zoom) * 256;
  const sin = Math.sin(latitude * Math.PI / 180);
  return {
    x: (longitude + 180) / 360 * size,
    y: (.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size,
  };
}

/** Fit points to the measured map viewport and return pixel positions for both tiles and pins. */
export function homeMapLayout(points: HomeMapPoint[], width: number, height: number): {
  zoom: number; left: number; top: number; pins: Array<{ x: number; y: number }>;
} {
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  let zoom = 15;
  let projected: Array<{ x: number; y: number }> = [];
  for (; zoom > 4; zoom--) {
    projected = points.map((point) => homeMapProject(point.latitude, point.longitude, zoom));
    const xs = projected.map((point) => point.x);
    const ys = projected.map((point) => point.y);
    if (Math.max(...xs) - Math.min(...xs) <= Math.max(1, safeWidth - 72) &&
        Math.max(...ys) - Math.min(...ys) <= Math.max(1, safeHeight - 72)) break;
  }
  projected = points.map((point) => homeMapProject(point.latitude, point.longitude, zoom));
  const xs = projected.map((point) => point.x);
  const ys = projected.map((point) => point.y);
  const centerX = (Math.min(...xs) + Math.max(...xs)) / 2;
  const centerY = (Math.min(...ys) + Math.max(...ys)) / 2;
  const left = centerX - safeWidth / 2;
  const top = centerY - safeHeight / 2;
  return { zoom, left, top, pins: projected.map((point) => ({ x: point.x - left, y: point.y - top })) };
}

export function homePinLabel(price: unknown, rentalFrequency?: unknown, locale = "en-GB"): string | null {
  const amount = Number(price);
  if (!Number.isFinite(amount)) return null;
  if (rentalFrequency || amount < 10_000) {
    return new Intl.NumberFormat(locale, { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(amount);
  }
  return `£${Math.round(amount / 1000)}k`;
}

/**
 * A dependency-free MCP Apps component. Keeping the bundle inline means its
 * only remote resources are listing photographs and OpenStreetMap tiles.
 */
export const HOME_WIDGET_HTML = String.raw`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{color-scheme:light dark;font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;--ink:#18251d;--muted:#637068;--paper:#fff;--soft:#f2f5f2;--line:#dce3dd;--brand:#17643a;--accent:#e8f4ec}*{box-sizing:border-box}body{margin:0;background:transparent;color:var(--ink)}button,a{font:inherit}.shell{padding:10px;max-width:1100px;margin:auto}.heading{display:flex;align-items:end;justify-content:space-between;gap:12px;margin:0 0 12px}.heading h1{font-size:20px;line-height:1.2;margin:0}.count{color:var(--muted);font-size:13px}.results{display:grid;grid-template-columns:minmax(0,1.05fr) minmax(270px,.95fr);gap:14px}.cards{display:flex;gap:12px;overflow-x:auto;scroll-snap-type:x mandatory;padding:1px 1px 10px}.card{scroll-snap-align:start;min-width:min(78vw,290px);max-width:290px;border:1px solid var(--line);border-radius:15px;background:var(--paper);overflow:hidden;box-shadow:0 2px 8px #1220160d;transition:.15s}.card[aria-current=true]{border-color:var(--brand);box-shadow:0 0 0 2px #17643a2b}.photo{display:block;width:100%;aspect-ratio:16/10;object-fit:cover;background:var(--soft)}.photo-placeholder{display:grid;place-items:center;color:var(--muted)}.card-body{padding:12px}.badges{display:flex;flex-wrap:wrap;gap:5px;min-height:21px}.badge{font-size:11px;font-weight:700;border-radius:99px;padding:3px 7px;background:var(--accent);color:var(--brand)}.badge.offer{background:#fff0d7;color:#79500b}.price{font-size:20px;font-weight:750;margin-top:7px}.address{font-weight:600;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.facts,.secondary{font-size:13px;color:var(--muted);margin-top:5px}.card a,.detail-link{display:inline-block;color:var(--brand);font-weight:700;text-decoration:none;margin-top:9px}.map{height:360px;position:relative;overflow:hidden;border:1px solid var(--line);border-radius:15px;background:#dce8d8}.tile{position:absolute;width:256px;height:256px;max-width:none}.pin{position:absolute;transform:translate(-50%,-100%);border:2px solid white;border-radius:99px;background:var(--brand);color:white;padding:4px 7px;font-size:11px;font-weight:750;box-shadow:0 2px 5px #0005;cursor:pointer;z-index:2}.pin.active{background:#b84d1d;z-index:3}.map-note{position:absolute;left:8px;bottom:8px;background:#fffc;border-radius:7px;padding:4px 7px;color:#354239;font-size:11px;z-index:4}.detail{border:1px solid var(--line);border-radius:16px;overflow:hidden;background:var(--paper)}.hero{display:grid;grid-template-columns:2fr 1fr 1fr;gap:3px;height:340px;background:var(--soft)}.hero img{width:100%;height:100%;object-fit:cover;min-width:0}.hero img:first-child{grid-row:span 2}.hero-empty{display:grid;place-items:center;color:var(--muted);grid-column:1/-1}.detail-body{padding:18px}.detail-title{display:flex;justify-content:space-between;gap:18px;align-items:start}.detail h1{font-size:22px;margin:0}.detail-price{font-size:22px;font-weight:800;white-space:nowrap}.keyfacts{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin:16px 0}.fact{background:var(--soft);border-radius:10px;padding:10px}.fact b{display:block;font-size:15px}.fact span{font-size:11px;color:var(--muted)}.description{line-height:1.55;white-space:pre-line}.empty{padding:32px;text-align:center;color:var(--muted)}
@media(max-width:700px){.shell{padding:6px}.results{grid-template-columns:1fr}.map{height:250px;order:-1}.card{min-width:82vw}.hero{height:245px;grid-template-columns:2fr 1fr}.hero img:nth-of-type(n+4){display:none}.detail-title{display:block}.detail-price{margin-top:5px}.keyfacts{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(prefers-color-scheme:dark){:root{--ink:#edf4ee;--muted:#aebbb1;--paper:#172019;--soft:#222d25;--line:#354239;--brand:#78d59b;--accent:#243d2c}.map-note{background:#172019e8;color:#edf4ee}}
</style></head><body><main id="root" class="shell"><div class="empty">Loading homes…</div></main>
<script>
${homeMapProject.toString()}
${homeMapLayout.toString()}
${homePinLabel.toString()}
(function(){
  var root=document.getElementById('root'), latest=null, selected=0, mapObserver=null;
  function obj(v){return v&&typeof v==='object'&&!Array.isArray(v)?v:{}}
  function arr(v){return Array.isArray(v)?v:[]}
  function str(v){return typeof v==='string'?v:''}
  function safeUrl(v,kind){try{var u=new URL(str(v));if(u.protocol!=='https:')return '';var h=u.hostname.toLowerCase();if(kind==='image'&&(h==='home.co.uk'||h.endsWith('.home.co.uk')))return u.href;if(kind==='link'&&(h==='home.co.uk'||h.endsWith('.home.co.uk')))return u.href}catch(e){}return ''}
  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
  function money(v,freq){var n=Number(v);if(!Number.isFinite(n))return 'Price on application';var out=new Intl.NumberFormat(document.documentElement.lang||'en-GB',{style:'currency',currency:'GBP',maximumFractionDigits:0}).format(n);return out+(freq?' '+esc(freq):'')}
  function n(v){if(v==null||v==='')return null;var x=Number(v);return Number.isFinite(x)?x:null}
  function coords(h){var c=obj(h.coordinates);return {lat:n(c.latitude!=null?c.latitude:h.latitude),lon:n(c.longitude!=null?c.longitude:h.longitude)}}
  function badges(h){var b=[];if(h.new_listing)b.push('<span class="badge">New</span>');if(h.new_build)b.push('<span class="badge">New build</span>');if(h.reduced_date)b.push('<span class="badge">Reduced</span>');if(h.under_offer_date||/under offer|sold stc/i.test(str(h.status)))b.push('<span class="badge offer">Under offer</span>');return b.join('')}
  function photo(url,alt,cls){var u=safeUrl(url,'image');return u?'<img class="'+(cls||'photo')+'" src="'+esc(u)+'" alt="'+esc(alt)+'" loading="lazy">':'<div class="photo photo-placeholder">No photo</div>'}
  function card(h,i){var url=safeUrl(h.url,'link'), facts=[];if(n(h.bedrooms)!=null)facts.push(esc(h.bedrooms)+' bed');if(h.property_type)facts.push(esc(str(h.property_type).replace(/_/g,' ')));if(h.area||h.postcode)facts.push(esc(h.area||h.postcode));return '<article class="card" tabindex="0" data-index="'+i+'" aria-current="'+(i===selected)+'">'+photo(h.image,str(h.address)||'Home')+'<div class="card-body"><div class="badges">'+badges(h)+'</div><div class="price">'+money(h.price,h.rental_frequency)+'</div><div class="address">'+esc(h.address||h.postcode||'Home')+'</div><div class="facts">'+facts.join(' · ')+'</div>'+(h.agent?'<div class="secondary">Listed by '+esc(h.agent)+'</div>':'')+(url?'<a href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">View on home.co.uk</a>':'')+'</div></article>'}
  function mapPoints(homes){return homes.map(function(h,i){var c=coords(h);return {latitude:c.lat,longitude:c.lon,index:i,home:h}}).filter(function(p){return p.latitude!=null&&p.longitude!=null&&Math.abs(p.latitude)<=85&&Math.abs(p.longitude)<=180})}
  function drawMap(homes){return mapPoints(homes).length?'<div class="map" data-home-map aria-label="Map of homes"></div>':'<div class="map"><div class="empty">Map positions are not available for these homes.</div></div>'}
  function pinLabel(home,index){return homePinLabel(home.price,home.rental_frequency,document.documentElement.lang||'en-GB')||String(index+1)}
  function layoutMap(map,homes){var points=mapPoints(homes),width=map.clientWidth,height=map.clientHeight;if(!points.length||!width||!height)return;var layout=homeMapLayout(points,width,height),z=layout.zoom,tiles='';for(var tx=Math.floor(layout.left/256);tx<=Math.floor((layout.left+width)/256);tx++)for(var ty=Math.floor(layout.top/256);ty<=Math.floor((layout.top+height)/256);ty++){var max=Math.pow(2,z),wx=((tx%max)+max)%max;if(ty>=0&&ty<max)tiles+='<img class="tile" alt="" src="https://tile.openstreetmap.org/'+z+'/'+wx+'/'+ty+'.png" style="left:'+(tx*256-layout.left)+'px;top:'+(ty*256-layout.top)+'px">'}var pins=points.map(function(p,i){var q=layout.pins[i];return '<button class="pin '+(p.index===selected?'active':'')+'" data-index="'+p.index+'" style="left:'+q.x+'px;top:'+q.y+'px" aria-label="Select '+esc(p.home.address||'home')+'">'+esc(pinLabel(p.home,p.index))+'</button>'}).join('');map.innerHTML=tiles+pins+'<div class="map-note">© OpenStreetMap contributors</div>';bindInteractions(map)}
  function listings(data){var homes=arr(data.homes).map(obj).slice(0,20);if(!homes.length)return '<div class="empty">No homes to show.</div>';return '<header class="heading"><h1>'+esc(data.title||'Homes')+'</h1><span class="count">'+homes.length+' result'+(homes.length===1?'':'s')+'</span></header><section class="results"><div class="cards">'+homes.map(card).join('')+'</div>'+drawMap(homes)+'</section>'}
  function fact(label,value){return value==null||value===''?'':'<div class="fact"><b>'+esc(value)+'</b><span>'+esc(label)+'</span></div>'}
  function detail(data){var h=obj(data.home),photos=arr(h.photos).map(function(x){return safeUrl(x,'image')}).filter(Boolean).slice(0,5),hero=photos.length?photos.map(function(p,i){return '<img src="'+esc(p)+'" alt="'+esc((h.address||'Home')+' photo '+(i+1))+'">'}).join(''):'<div class="hero-empty">No photos available</div>',url=safeUrl(h.url,'link');return '<article class="detail"><div class="hero">'+hero+'</div><div class="detail-body"><div class="badges">'+badges(h)+'</div><div class="detail-title"><h1>'+esc(h.address||h.postcode||'Home')+'</h1><div class="detail-price">'+money(h.price,h.rental_frequency)+'</div></div><div class="keyfacts">'+fact('Bedrooms',h.bedrooms)+fact('Bathrooms',h.bathrooms)+fact('Property type',str(h.property_type).replace(/_/g,' '))+fact('Floor area',n(h.floor_area_sqm)!=null?h.floor_area_sqm+' m²':null)+fact('Tenure',h.tenure)+fact('Reception rooms',h.reception_rooms)+fact('EPC',obj(obj(h.enrichment).property).epc&&obj(obj(obj(h.enrichment).property).epc).rating)+fact('Council tax',obj(obj(h.enrichment).property).council_tax&&obj(obj(obj(h.enrichment).property).council_tax).band)+'</div>'+(h.description?'<p class="description">'+esc(h.description)+'</p>':'')+(url?'<a class="detail-link" href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">View listing on home.co.uk</a>':'')+'</div></article>'}
  function bindInteractions(scope){scope.querySelectorAll('[data-index]:not([data-bound])').forEach(function(el){el.setAttribute('data-bound','true');el.addEventListener('click',function(){selected=Number(el.getAttribute('data-index'))||0;render(latest);var cardEl=root.querySelector('.card[data-index="'+selected+'"]');if(el.classList.contains('pin')&&cardEl)cardEl.scrollIntoView({behavior:'smooth',block:'nearest',inline:'center'})})})}
  function render(data){latest=obj(data);if(mapObserver){mapObserver.disconnect();mapObserver=null}root.innerHTML=latest.view==='detail'?detail(latest):listings(latest);bindInteractions(root);var map=root.querySelector('[data-home-map]'),homes=arr(latest.homes).map(obj).slice(0,20);if(map){layoutMap(map,homes);if(typeof ResizeObserver!=='undefined'){mapObserver=new ResizeObserver(function(){layoutMap(map,homes)});mapObserver.observe(map)}else window.addEventListener('resize',function(){layoutMap(map,homes)},{once:true})}}
  window.addEventListener('message',function(event){if(event.source!==window.parent)return;var m=event.data;if(!m||m.jsonrpc!=='2.0')return;if(m.method==='ui/notifications/tool-result')render(obj(m.params).structuredContent);if(m.method==='ui/notifications/tool-input'&&!latest){var input=obj(m.params).arguments||m.params;if(obj(input).home)render({view:'detail',home:obj(input).home})}},{passive:true});
  if(window.openai&&window.openai.toolOutput)render(window.openai.toolOutput);
  var initId='home-ui-init';
  function initialized(event){if(event.source!==window.parent||!event.data||event.data.id!==initId)return;window.removeEventListener('message',initialized);window.parent.postMessage({jsonrpc:'2.0',method:'ui/notifications/initialized'},'*')}
  window.addEventListener('message',initialized);
  window.parent.postMessage({jsonrpc:'2.0',id:initId,method:'ui/initialize',params:{protocolVersion:'2026-01-26',appInfo:{name:'Home',version:'1.0.0'},appCapabilities:{availableDisplayModes:['inline','fullscreen']}}},'*');
})();
</script></body></html>`;
