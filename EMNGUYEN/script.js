// --- Map init
const map = L.map('map').setView([10.775, 106.7], 12);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

let pickupMarker = null;
let dropMarker = null;
let routingControl = null;
let pickingOnMap = false; // toggle picking

const elPickup = document.getElementById('pickup');
const elDrop = document.getElementById('dropoff');
const sugPickup = document.getElementById('pickup-suggest');
const sugDrop = document.getElementById('dropoff-suggest');
const traffic = document.getElementById('traffic');
const trafficVal = document.getElementById('trafficVal');
const hourEl = document.getElementById('hour');
const vehicleEl = document.getElementById('vehicle');
const summaryEl = document.getElementById('summary');

traffic.addEventListener('input', () => trafficVal.textContent = traffic.value);

// --- Helper: create marker
function setMarker(type, latlng, label){
  const icon = L.icon({
    iconUrl: type === 'pickup' ? 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png'
                               : 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
    iconSize: [25,41], iconAnchor:[12,41], popupAnchor:[1,-34],
    shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png', shadowSize:[41,41]
  });
  if(type==='pickup'){
    if(pickupMarker) map.removeLayer(pickupMarker);
    pickupMarker = L.marker(latlng, {icon}).addTo(map).bindPopup('Điểm đón').openPopup();
  }else{
    if(dropMarker) map.removeLayer(dropMarker);
    dropMarker = L.marker(latlng, {icon}).addTo(map).bindPopup('Điểm đến').openPopup();
  }
}

// --- Nominatim search
async function searchPlace(q){
  if(!q || q.length < 3) return [];
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&countrycodes=vn&limit=5&addressdetails=1`;
  const res = await fetch(url, { headers: { 'Accept-Language': 'vi' } });
  return await res.json();
}

function renderSuggest(container, items, onPick){
  container.innerHTML = '';
  if(items.length === 0){ container.style.display='none'; return; }
  items.forEach(it=>{
    const btn = document.createElement('button');
    btn.type='button';
    btn.textContent = it.display_name;
    btn.onclick = ()=>{ onPick(it); container.style.display='none'; };
    container.appendChild(btn);
  });
  container.style.display='block';
}

let typingTimerPickup=null, typingTimerDrop=null;
elPickup.addEventListener('input', async ()=>{
  clearTimeout(typingTimerPickup);
  typingTimerPickup = setTimeout(async ()=>{
    const items = await searchPlace(elPickup.value);
    renderSuggest(sugPickup, items, (it)=>{
      elPickup.value = it.display_name;
      setMarker('pickup', [parseFloat(it.lat), parseFloat(it.lon)]);
      map.setView([it.lat, it.lon], 14);
    });
  }, 300);
});
elDrop.addEventListener('input', async ()=>{
  clearTimeout(typingTimerDrop);
  typingTimerDrop = setTimeout(async ()=>{
    const items = await searchPlace(elDrop.value);
    renderSuggest(sugDrop, items, (it)=>{
      elDrop.value = it.display_name;
      setMarker('drop', [parseFloat(it.lat), parseFloat(it.lon)]);
      map.setView([it.lat, it.lon], 14);
    });
  }, 300);
});

document.addEventListener('click', (e)=>{
  // hide suggests when clicking outside
  if(!e.target.closest('.search-group')){
    sugPickup.style.display='none';
    sugDrop.style.display='none';
  }
});

// --- Choose on map
document.getElementById('useMapBtn').addEventListener('click', ()=>{
  pickingOnMap = !pickingOnMap;
  alert(pickingOnMap ? 'Nhấn vào bản đồ để chọn: lượt 1 là Điểm đón, lượt 2 là Điểm đến.' : 'Tắt chọn trên bản đồ.');
});
map.on('click', (e)=>{
  if(!pickingOnMap) return;
  const latlng = e.latlng;
  if(!pickupMarker){
    setMarker('pickup', latlng);
    elPickup.value = `${latlng.lat.toFixed(6)}, ${latlng.lng.toFixed(6)}`;
  }else if(!dropMarker){
    setMarker('drop', latlng);
    elDrop.value = `${latlng.lat.toFixed(6)}, ${latlng.lng.toFixed(6)}`;
  }else{
    // reset cycle: start over
    if(pickupMarker){ map.removeLayer(pickupMarker); pickupMarker=null; }
    if(dropMarker){ map.removeLayer(dropMarker); dropMarker=null; }
    setMarker('pickup', latlng);
    elPickup.value = `${latlng.lat.toFixed(6)}, ${latlng.lng.toFixed(6)}`;
  }
});

// --- Swap
document.getElementById('swapBtn').addEventListener('click', ()=>{
  const a = elPickup.value; const b = elDrop.value;
  elPickup.value = b; elDrop.value = a;
  // swap markers if exist
  const aM = pickupMarker; const bM = dropMarker;
  pickupMarker = bM; dropMarker = aM;
  if(routingControl){ map.removeControl(routingControl); routingControl=null; }
  if(pickupMarker) pickupMarker.bindPopup('Điểm đón');
  if(dropMarker) dropMarker.bindPopup('Điểm đến');
});

// --- Pricing (approx fuzzy-like)
function estimateFare(km, vehicle, hour, trafficLevel){
  let cfg;
  switch(vehicle){
    case 'bike':
      cfg = { base: 10000, perkm: 8000, min: 15000 };
      break;
    case 'bike_premium':
      cfg = { base: 15000, perkm: 10000, min: 20000 };
      break;
    case 'car4':
      cfg = { base: 20000, perkm: 12000, min: 30000 };
      break;
    case 'car7':
      cfg = { base: 25000, perkm: 15000, min: 40000 };
      break;
    case 'car_luxury':
      cfg = { base: 50000, perkm: 25000, min: 100000 };
      break;
    default:
      cfg = { base: 15000, perkm: 12000, min: 30000 };
  }

  let fare = cfg.base + km * cfg.perkm;

  // giờ cao điểm
  if((hour>=7 && hour<=9) || (hour>=17 && hour<=19)){
    fare *= 1.2;
  }
  // hệ số tắc đường
  fare *= (1 + Math.min(10, Math.max(0, trafficLevel)) * 0.05 / 2);

  if(fare < cfg.min) fare = cfg.min;
  return Math.round(fare);
}


// --- Book
document.getElementById('bookBtn').addEventListener('click', ()=>{
  if(!pickupMarker || !dropMarker){
    alert('Vui lòng chọn điểm đón và điểm đến (tìm kiếm hoặc click trên bản đồ).');
    return;
  }
  if(routingControl){ map.removeControl(routingControl); routingControl=null; }

  routingControl = L.Routing.control({
    waypoints: [ pickupMarker.getLatLng(), dropMarker.getLatLng() ],
    router: L.Routing.osrmv1({ serviceUrl: 'https://router.project-osrm.org/route/v1' }),
    showAlternatives: false,
    addWaypoints: false,
    draggableWaypoints: true,
    routeWhileDragging: false,
    fitSelectedRoutes: true,
    createMarker: function() { return null; } // keep our own markers
  })
  .on('routesfound', function(e){
    const route = e.routes[0];
    const meters = route.summary.totalDistance;
    const km = meters / 1000.0;
    const mins = route.summary.totalTime / 60.0;

    const vehicle = vehicleEl.value;
    const hour = parseInt(hourEl.value || '8', 10);
    const trafficLevel = parseInt(traffic.value || '3', 10);
    const fare = estimateFare(km, vehicle, hour, trafficLevel);

    summaryEl.classList.remove('hidden');
    summaryEl.innerHTML = `
      <div><strong>📏 Quãng đường:</strong> ${km.toFixed(2)} km (~${Math.round(mins)} phút)</div>
      <div><strong>🚘 Loại xe:</strong> ${vehicle === 'bike' ? 'Xe máy' : 'Ô tô'}</div>
      <div><strong>🕒 Giờ đi:</strong> ${hour}:00 &nbsp; | &nbsp; <strong>🚦 Tắc đường:</strong> ${trafficLevel}/10</div>
      <div style="font-size:18px; margin-top:6px;"><strong>💰 Giá ước tính:</strong> ${fare.toLocaleString('vi-VN')} VNĐ</div>
    `;
  })
  .addTo(map);
});
