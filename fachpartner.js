(function () {
  // ======================================================
  //  Rennergy Map + Finsweet DOM-Safe (Außendienst + Partner)
  //  - sammelt ALLE Fachpartner aus nested lists
  //  - gruppiert Anzeige unter Außendienstlern
  //  - überlebt Finsweet Re-Renders (MutationObserver + Debounce)
  //  - Debug Panel per localStorage "rennergy_map_debug" = "1"
  //
  //  UPDATE:
  //  - Fix: Scroll im Modal -> scrollt den echten Scroll-Container zuverlässig
  // ======================================================

  if (!window.mapboxgl) {
    console.error('[Rennergy Map] mapboxgl fehlt. Bitte Mapbox GL JS + CSS laden.');
    return;
  }

  // ------------------------------------------------------
  //   CONFIG / SELECTORS (an dein DOM angepasst)
  // ------------------------------------------------------
  const SEL = {
    mapContainerId: 'map',

    // Außendienst (outer list)
    aussendienstListWrapper: '.aussendienst-karte-list-wrapper',
    aussendienstItem: '.aussendienst-karte-item-wrapper',

    // Fachpartner (nested list items)
    partnerItem: '.fachpartner-karte-item-wrapper',

    // Sidebar / Modal / Scrollcontainer (wir nehmen den ersten Treffer)
    // WICHTIG: hier stehen Wrapper-Kandidaten, aber wir suchen zusätzlich den echten Scroll-Container automatisch.
    sidebar:
      '.search_results_wrapper, .search-results_wrapper, .search_results, .search-results, .aussendienst-karte-list-wrapper, .fachpartner-karte-list-wrapper',

    // UI
    zoomIn:  '.zoom-controls .zoom-in',
    zoomOut: '.zoom-controls .zoom-out',
    zoomReset: '.zoom-controls .zoom-reset',
    zoomResetMain: '.zoom-reset-main',
    prevBtn: '.previous-card',
    nextBtn: '.next-card',
    searchReset: '.search-reset',

    plzInput: '[data-search-modul="plz"], .searchfield',
    radiusSelect: '[data-search-modul="radius"]',
    resultInfo: '[data-search-modul="ergebnis_nr"]',

    searchNone: '.search_none',
    zoomTarget: '.zoom-target'
  };

  // ------------------------------------------------------
  //   DEBUG PANEL
  // ------------------------------------------------------
  const DEBUG_ENABLED = (localStorage.getItem('rennergy_map_debug') === '1');
  const dbg = (function () {
    let el, box, pre;
    const logs = [];
    function ensure() {
      if (!DEBUG_ENABLED) return;
      if (el) return;

      el = document.createElement('div');
      el.style.cssText =
        'position:fixed;left:12px;bottom:12px;z-index:999999;' +
        'font:12px/1.35 ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace;' +
        'color:#d8d8d8;';

      box = document.createElement('div');
      box.style.cssText =
        'width:340px;max-width:80vw;max-height:42vh;overflow:auto;' +
        'background:rgba(0,0,0,.78);backdrop-filter: blur(8px);' +
        'border:1px solid rgba(255,255,255,.12);border-radius:10px;' +
        'box-shadow:0 10px 30px rgba(0,0,0,.35);';

      const head = document.createElement('div');
      head.style.cssText =
        'display:flex;gap:8px;align-items:center;justify-content:space-between;' +
        'padding:10px 10px 8px 10px;border-bottom:1px solid rgba(255,255,255,.10);';

      const title = document.createElement('div');
      title.textContent = 'Rennergy Debug (mapdebug=1)';
      title.style.cssText = 'font-weight:700;opacity:.95;';

      const actions = document.createElement('div');
      actions.style.cssText = 'display:flex;gap:8px;';

      const btnClear = document.createElement('button');
      btnClear.textContent = 'Clear';
      btnClear.style.cssText =
        'all:unset;cursor:pointer;padding:6px 10px;border-radius:8px;' +
        'background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.12);';
      btnClear.onclick = () => {
        logs.length = 0;
        render();
      };

      const btnHide = document.createElement('button');
      btnHide.textContent = 'Hide';
      btnHide.style.cssText =
        'all:unset;cursor:pointer;padding:6px 10px;border-radius:8px;' +
        'background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.12);';
      btnHide.onclick = () => { box.style.display = (box.style.display === 'none' ? 'block' : 'none'); };

      actions.appendChild(btnClear);
      actions.appendChild(btnHide);

      head.appendChild(title);
      head.appendChild(actions);

      pre = document.createElement('pre');
      pre.style.cssText = 'margin:0;padding:10px;white-space:pre-wrap;word-break:break-word;';

      box.appendChild(head);
      box.appendChild(pre);
      el.appendChild(box);
      document.body.appendChild(el);
    }

    function render() {
      if (!DEBUG_ENABLED) return;
      ensure();
      pre.textContent = logs.join('\n');
      box.scrollTop = box.scrollHeight;
    }

    function log(...args) {
      if (!DEBUG_ENABLED) return;
      const line = args.map(a => {
        if (typeof a === 'string') return a;
        try { return JSON.stringify(a); } catch(e) { return String(a); }
      }).join(' ');
      logs.push(line);
      if (logs.length > 300) logs.shift();
      render();
    }

    return { log };
  })();

  dbg.log('✅ Debug Panel aktiv');
  dbg.log('Tipp: localStorage.setItem("rennergy_map_debug","1")');

  // ------------------------------------------------------
  //   Mapbox Setup
  // ------------------------------------------------------
  mapboxgl.accessToken =
    'pk.eyJ1IjoiYnlzdGFyayIsImEiOiJjbHc2amJna2IwMWNiMm5vOW9nM3AxYWg1In0.mzRxy5Sib2iJKeJh7XHmZg';

  const lightStyle = 'mapbox://styles/bystark/cmicxkh5l00gn01pf7awy8xnv';
  const darkStyle  = 'mapbox://styles/bystark/cmicwtx2s00hx01s91mesh22d';

  function isDarkMode() {
    return (
      document.documentElement.classList.contains('dark-mode') ||
      document.body.classList.contains('dark-mode')
    );
  }

  let currentStyle = isDarkMode() ? darkStyle : lightStyle;

  const map = new mapboxgl.Map({
    container: SEL.mapContainerId,
    style: currentStyle,
    center: [10.4515, 51.1657],
    zoom: 5,
    bearing: 0,
    pitch: 0
  });

  // ------------------------------------------------------
  //   Timings
  // ------------------------------------------------------
  const FLY_MS              = 1400;
  const FIT_BOUNDS_MS       = 1000;
  const ZOOM_BTN_MS         = 650;
  const CLUSTER_FLY_MS      = 700;
  const LIST_HOVER_DELAY_MS = 1000;

  // ------------------------------------------------------
  //   State
  // ------------------------------------------------------
  let allGeoData = [];
  let geoData    = [];
  let cardCount  = 0;

  let lastOpen         = null;
  let hoveredFeatureId = null;
  let activeFeatureId  = null;
  let hoverFlyTimeout  = null;

  let currentQuery    = '';
  let currentRadiusKm = null;
  let searchCenter    = null;

  let isFilteredByPlz = false;

  let partnerElByIndex = new Map();
  let aussendienstEls  = [];

  let isApplyingDom = false;
  let rerenderTO = null;

  // Layout / Padding
  const HORIZONTAL_LAYOUT_MIN = 1200;
  const isHorizontalLayout = () => window.innerWidth > HORIZONTAL_LAYOUT_MIN;

  const PAD_DESKTOP = { top: 120, right: 80, bottom: 120, left: 80 };
  const PAD_TABLET  = { top: 90,  right: 48, bottom: 90,  left: 48 };

  // ------------------------------------------------------
  //   DOM-Referenzen
  // ------------------------------------------------------
  const zoomInBtn        = document.querySelector(SEL.zoomIn);
  const zoomOutBtn       = document.querySelector(SEL.zoomOut);
  const zoomResetBtn     = document.querySelector(SEL.zoomReset);
  const zoomResetMainBtn = document.querySelector(SEL.zoomResetMain);
  const prevBtn          = document.querySelector(SEL.prevBtn);
  const nextBtn          = document.querySelector(SEL.nextBtn);

  const plzSearchInput   = document.querySelector(SEL.plzInput);
  const radiusSelect     = document.querySelector(SEL.radiusSelect);
  const searchResetBtn   = document.querySelector(SEL.searchReset);

  const searchNoneEls    = Array.from(document.querySelectorAll(SEL.searchNone));
  const searchForm       = plzSearchInput ? plzSearchInput.closest('form') : null;

  function setSearchNoneVisible(show) {
    if (!searchNoneEls.length) return;
    searchNoneEls.forEach((el) => {
      el.style.setProperty('display', show ? 'block' : 'none', 'important');
    });
  }

  function updateNoResultsState() {
    const hasQ = !!(currentQuery || '').trim();
    const show = !!currentRadiusKm && hasQ && geoData.length === 0;
    setSearchNoneVisible(show);
  }

  setSearchNoneVisible(false);

  // ------------------------------------------------------
  //   Sidebar helpers
  // ------------------------------------------------------
  function getSidebarEl() {
    return document.querySelector(SEL.sidebar) || null;
  }

  function computeOffset() {
    const sidebar = getSidebarEl();

    if (isHorizontalLayout()) {
      const GAP_X = 24;
      const w = sidebar?.offsetWidth || 420;
      return [-(Math.round(w / 2) + GAP_X), 0];
    }

    const viewportH            = (window.visualViewport?.height) || window.innerHeight;
    const VERTICAL_SHIFT_RATIO = 0.15;
    const MIN_TOP_CLEARANCE    = 80;
    const EXTRA                = 16;
    const yOffset =
      Math.max(Math.round(viewportH * VERTICAL_SHIFT_RATIO), MIN_TOP_CLEARANCE) + EXTRA;
    return [0, yOffset];
  }

  function centerForAnchorWithOffset(anchorLngLat, offset) {
    const p = map.project(anchorLngLat);
    const desiredCenterScreen = new mapboxgl.Point(p.x - offset[0], p.y - offset[1]);
    return map.unproject(desiredCenterScreen);
  }

  // ------------------------------------------------------
  //   Farben
  // ------------------------------------------------------
  function getThemeScopeEl() {
    return (
      document.querySelector('[data-theme-scope]') ||
      document.querySelector('.page-wrapper') ||
      document.querySelector('.main-wrapper') ||
      document.body ||
      document.documentElement
    );
  }

  function normalizeColorForMapbox(value, fallback) {
    if (!value || value === 'transparent' || value === 'rgba(0, 0, 0, 0)') return fallback;
    value = String(value).trim();

    if (value.startsWith('color(')) {
      try {
        const inner  = value.slice(value.indexOf('(') + 1, value.lastIndexOf(')')).trim();
        const parts  = inner.split(/\s+/);
        const mode   = (parts[0] || '').toLowerCase();
        if (mode === 'srgb') {
          let r = parseFloat(parts[1]);
          let g = parseFloat(parts[2]);
          let b = parseFloat(parts[3]);
          if (isNaN(r) || isNaN(g) || isNaN(b)) return fallback;
          r = Math.round(Math.min(Math.max(r, 0), 1) * 255);
          g = Math.round(Math.min(Math.max(g, 0), 1) * 255);
          b = Math.round(Math.min(Math.max(b, 0), 1) * 255);
          return `rgb(${r}, ${g}, ${b})`;
        }
      } catch (err) {
        return fallback;
      }
    }
    return value;
  }

  function getMapboxColorFromVar(varName, fallback) {
    const scope = getThemeScopeEl();
    const raw = getComputedStyle(scope).getPropertyValue(varName).trim();
    if (!raw) return fallback;

    const probe = document.createElement('div');
    probe.style.color    = `var(${varName})`;
    probe.style.position = 'absolute';
    probe.style.left     = '-9999px';
    scope.appendChild(probe);
    const computed = getComputedStyle(probe).color;
    scope.removeChild(probe);

    return normalizeColorForMapbox(computed, fallback);
  }

  function getHighlightColor() {
    return getMapboxColorFromVar('--_theme---b-20', '#00ff00');
  }

  function getThemeColors() {
    const bubbleColor = getMapboxColorFromVar('--_theme---b-50', '#00ff00');
    const textColor   = getMapboxColorFromVar('--_theme---text', '#00ff00');
    const strokeColor = getMapboxColorFromVar('--_theme---background', '#00ff00');
    const activeColor = getMapboxColorFromVar('--_theme---n-100', '#00ff00');
    return { bubbleColor, textColor, strokeColor, activeColor };
  }

  function getUnclusteredPaint() {
    const { bubbleColor, strokeColor, activeColor } = getThemeColors();
    const highlightColor = getHighlightColor();

    return {
      "circle-color": [
        "case",
        ["boolean", ["feature-state", "active"], false],
        activeColor,
        ["boolean", ["feature-state", "hover"], false],
        highlightColor,
        bubbleColor
      ],
      "circle-radius": [
        "case",
        ["boolean", ["feature-state", "active"], false],
        26,
        ["boolean", ["feature-state", "hover"], false],
        24,
        18
      ],
      "circle-stroke-color": strokeColor,
      "circle-stroke-width": 2
    };
  }

  function updateLayerThemeColors() {
    if (!map.isStyleLoaded()) return;

    const { bubbleColor, textColor } = getThemeColors();

    if (map.getLayer('fachpartner-clusters')) {
      map.setPaintProperty('fachpartner-clusters', 'circle-color', bubbleColor);
    }
    if (map.getLayer('fachpartner-cluster-count')) {
      map.setPaintProperty('fachpartner-cluster-count', 'text-color', textColor);
    }
    if (map.getLayer('fachpartner-unclustered')) {
      const paint = getUnclusteredPaint();
      Object.keys(paint).forEach((prop) => {
        map.setPaintProperty('fachpartner-unclustered', prop, paint[prop]);
      });
    }

    if (map.getLayer('search-radius-fill')) {
      map.setPaintProperty('search-radius-fill', 'fill-color', getHighlightColor());
    }
    if (map.getLayer('search-radius-line')) {
      map.setPaintProperty('search-radius-line', 'line-color', getHighlightColor());
    }

    try { map.triggerRepaint(); } catch (e) {}
  }

  // ------------------------------------------------------
  //   Obfuscation (5km fuzzy)
  // ------------------------------------------------------
  function obfuscateCoords(lat, lng, kmRadius = 5) {
    const radiusInDegrees = kmRadius / 111;
    const u = Math.random();
    const v = Math.random();
    const w = radiusInDegrees * Math.sqrt(u);
    const t = 2 * Math.PI * v;

    const dLat = w * Math.sin(t);
    const dLng = w * Math.cos(t) / Math.cos(lat * Math.PI / 180);

    return { lat: lat + dLat, lng: lng + dLng };
  }

  // ------------------------------------------------------
  //   Geocoding + Distance
  // ------------------------------------------------------
  async function geocodeAddress(street, number, zip, city) {
    if (!zip || !city) return null;

    const fullStreet = street ? (number ? `${street} ${number}` : street) : '';
    const query      = fullStreet ? `${fullStreet}, ${zip} ${city}` : `${zip} ${city}`;

    const url =
      'https://api.mapbox.com/geocoding/v5/mapbox.places/' +
      encodeURIComponent(query) +
      '.json?limit=1&access_token=' +
      mapboxgl.accessToken;

    try {
      const res  = await fetch(url);
      const data = await res.json();
      if (data.features && data.features.length > 0) {
        const [lng, lat] = data.features[0].center;
        return { lat, lng };
      }
    } catch (err) {}
    return null;
  }

  function geocodeSearchQuery(query) {
    const full = `${query}, Deutschland`;
    const url =
      'https://api.mapbox.com/geocoding/v5/mapbox.places/' +
      encodeURIComponent(full) +
      '.json?limit=1&access_token=' +
      mapboxgl.accessToken;

    return fetch(url)
      .then(res => res.json())
      .then(data => {
        if (data.features && data.features.length > 0) {
          const [lng, lat] = data.features[0].center;
          return { lat, lng };
        }
        return null;
      })
      .catch(() => null);
  }

  function distanceKm(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const toRad = (deg) => deg * Math.PI / 180;

    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  // ------------------------------------------------------
  //   Radius Overlay
  // ------------------------------------------------------
  function makeCircleGeoJSON(centerLng, centerLat, radiusKm, steps = 96) {
    const coords = [];
    const distX = radiusKm / (111.320 * Math.cos(centerLat * Math.PI / 180));
    const distY = radiusKm / 110.574;

    for (let i = 0; i <= steps; i++) {
      const theta = (i / steps) * (Math.PI * 2);
      const x = distX * Math.cos(theta);
      const y = distY * Math.sin(theta);
      coords.push([centerLng + x, centerLat + y]);
    }

    return {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [coords] },
        properties: { radiusKm }
      }]
    };
  }

  function ensureRadiusLayers() {
    const srcId = 'search-radius';

    if (!map.getSource(srcId)) {
      map.addSource(srcId, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });
    }

    if (!map.getLayer('search-radius-fill')) {
      map.addLayer({
        id: 'search-radius-fill',
        type: 'fill',
        source: srcId,
        paint: {
          'fill-color': getHighlightColor(),
          'fill-opacity': 0.12
        }
      }, map.getLayer('fachpartner-unclustered') ? 'fachpartner-unclustered' : undefined);
    }

    if (!map.getLayer('search-radius-line')) {
      map.addLayer({
        id: 'search-radius-line',
        type: 'line',
        source: srcId,
        paint: {
          'line-color': getHighlightColor(),
          'line-width': 2,
          'line-opacity': 0.9
        }
      });
    }
  }

  function setRadiusOverlay(center, radiusKm) {
    if (!center || !radiusKm) {
      const src = map.getSource('search-radius');
      if (src) src.setData({ type: 'FeatureCollection', features: [] });
      return;
    }
    ensureRadiusLayers();
    const geo = makeCircleGeoJSON(center.lng, center.lat, radiusKm);
    map.getSource('search-radius').setData(geo);
    updateLayerThemeColors();
  }

  // ------------------------------------------------------
  //   GeoJSON + Cluster Layers
  // ------------------------------------------------------
  const sourceId = 'fachpartner';

  function geoDataToGeoJSON(data) {
    const arr = data || geoData;
    return {
      type: 'FeatureCollection',
      features: arr.map(p => ({
        type: 'Feature',
        id: p.cardIndex,
        geometry: {
          type: 'Point',
          coordinates: [p.longitude, p.latitude]
        },
        properties: {
          cardIndex: p.cardIndex,
          title:     p.title,
          link:      p.link,
          zip:       p.zip  || '',
          city:      p.city || ''
        }
      }))
    };
  }

  const layerHandlers = {
    onClusterClick: null,
    onClusterEnter: null,
    onClusterLeave: null,
    onPointClick: null,
    onPointEnter: null,
    onPointLeave: null
  };

  function clearMarkerStates() {
    const src = map.getSource(sourceId);
    if (!src) {
      hoveredFeatureId = null;
      activeFeatureId  = null;
      return;
    }

    try {
      if (hoveredFeatureId !== null) {
        map.setFeatureState({ source: sourceId, id: hoveredFeatureId }, { hover: false });
      }
      if (activeFeatureId !== null) {
        map.setFeatureState({ source: sourceId, id: activeFeatureId }, { active: false });
      }
    } catch (err) {}

    hoveredFeatureId = null;
    activeFeatureId  = null;
  }

  // ------------------------------------------------------
  //   Partner UI helpers (hover/active + scroll)
  // ------------------------------------------------------
  function clearPartnerHover() {
    document.querySelectorAll(SEL.partnerItem).forEach(el => el.classList.remove('is--hover'));
  }

  function highlightPartnerEl(el, hover) {
    if (!el) return;
    if (hover) {
      clearPartnerHover();
      el.classList.add('is--hover');
    } else {
      el.classList.remove('is--hover');
    }
  }

  function setActivePartnerEl(el) {
    document.querySelectorAll(SEL.partnerItem).forEach(x => x.classList.remove('is--active'));
    if (el) el.classList.add('is--active');
  }

  // ---------- SCROLL FIX (Modal-safe) ----------
  function isElementVisible(el) {
    if (!el) return false;
    if (!el.isConnected) return false;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    // offsetParent ist bei position:fixed manchmal null -> daher nur als Zusatz
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function isScrollable(el) {
    if (!el) return false;
    const cs = getComputedStyle(el);
    const oy = cs.overflowY;
    const ox = cs.overflowX;
    const canScrollY = (oy === 'auto' || oy === 'scroll' || oy === 'overlay');
    const canScrollX = (ox === 'auto' || ox === 'scroll' || ox === 'overlay');
    const hasY = el.scrollHeight > el.clientHeight + 1;
    const hasX = el.scrollWidth > el.clientWidth + 1;
    return (canScrollY && hasY) || (canScrollX && hasX);
  }

  // Sucht vom Card-Element nach oben den ersten wirklich scrollbaren Container.
  // stopAt = Sidebar-Kandidat (falls vorhanden), damit wir nicht bis body durchlaufen.
  function findScrollableAncestor(el, stopAt) {
    let cur = el ? el.parentElement : null;
    while (cur && cur !== document.body && cur !== document.documentElement) {
      if (isScrollable(cur)) return cur;
      if (stopAt && cur === stopAt) break;
      cur = cur.parentElement;
    }
    if (stopAt && isScrollable(stopAt)) return stopAt;
    return null;
  }

  function getScrollContainerFor(el) {
    const sidebarCandidate = el ? el.closest(SEL.sidebar) : null;
    const sidebarFallback  = getSidebarEl();
    const sidebar = sidebarCandidate || sidebarFallback || null;

    // Wichtig: echtes Scroll-Element finden (Modal hat oft inneren Scroller)
    const scroller = findScrollableAncestor(el, sidebar) || sidebar;
    return scroller || null;
  }

  function scrollPartnerIntoView(el, opts = {}) {
    const { behavior = 'smooth', align = 'center', retries = 18 } = opts;
    if (!el) return;

    const tryScroll = (n) => {
      const scroller = getScrollContainerFor(el);

      // Wenn Modal / Scroller noch nicht "sichtbar" (Animation), warten und retry
      if (!scroller || !isElementVisible(scroller) || scroller.clientHeight === 0) {
        if (n < retries) return setTimeout(() => tryScroll(n + 1), 80);
        // Fallback
        try { el.scrollIntoView({ behavior, block: 'nearest' }); } catch (e) {}
        return;
      }

      // Wenn das Element selbst noch unsichtbar ist (Finsweet rerender), retry
      if (!isElementVisible(el)) {
        if (n < retries) return setTimeout(() => tryScroll(n + 1), 80);
      }

      const sRect = scroller.getBoundingClientRect();
      const eRect = el.getBoundingClientRect();
      const currentTop = scroller.scrollTop;

      // Position des Elements relativ zum Scroller-Inhalt:
      const deltaTop = (eRect.top - sRect.top);
      const padding = 16;

      let targetTop;
      if (align === 'top') {
        targetTop = currentTop + deltaTop - padding;
      } else if (align === 'bottom') {
        targetTop = currentTop + deltaTop - (scroller.clientHeight - eRect.height) + padding;
      } else {
        // center
        targetTop = currentTop + deltaTop - (scroller.clientHeight / 2) + (eRect.height / 2);
      }

      // clamp
      targetTop = Math.max(0, Math.min(targetTop, scroller.scrollHeight - scroller.clientHeight));

      // Scroll wirklich den Container (nicht window)
      try {
        scroller.scrollTo({ top: targetTop, behavior });
      } catch (e) {
        scroller.scrollTop = targetTop;
      }
    };

    tryScroll(0);
  }
  // ---------- END SCROLL FIX ----------

  function bindLayerEvents() {
    if (layerHandlers.onClusterClick) map.off('click', 'fachpartner-clusters', layerHandlers.onClusterClick);
    if (layerHandlers.onClusterEnter) map.off('mouseenter', 'fachpartner-clusters', layerHandlers.onClusterEnter);
    if (layerHandlers.onClusterLeave) map.off('mouseleave', 'fachpartner-clusters', layerHandlers.onClusterLeave);
    if (layerHandlers.onPointClick)   map.off('click', 'fachpartner-unclustered', layerHandlers.onPointClick);
    if (layerHandlers.onPointEnter)   map.off('mouseenter', 'fachpartner-unclustered', layerHandlers.onPointEnter);
    if (layerHandlers.onPointLeave)   map.off('mouseleave', 'fachpartner-unclustered', layerHandlers.onPointLeave);

    layerHandlers.onClusterClick = (e) => {
      const feature   = e.features && e.features[0];
      if (!feature) return;
      const clusterId = feature.properties.cluster_id;
      const src = map.getSource(sourceId);
      if (!src || !src.getClusterExpansionZoom) return;

      src.getClusterExpansionZoom(clusterId, (err, zoom) => {
        if (err) return;
        map.easeTo({
          center: feature.geometry.coordinates,
          zoom: zoom,
          duration: CLUSTER_FLY_MS,
          easing: t => 1 - Math.pow(1 - t, 3)
        });
      });
    };

    layerHandlers.onClusterEnter = () => { map.getCanvas().style.cursor = 'pointer'; };
    layerHandlers.onClusterLeave = () => { map.getCanvas().style.cursor = ''; };

    layerHandlers.onPointClick = (e) => {
      const feature = e.features && e.features[0];
      if (!feature) return;
      const cardIndex  = parseInt(feature.properties.cardIndex, 10);
      const [lng, lat] = feature.geometry.coordinates;
      const targetZoom = Math.max(map.getZoom(), 11);
      zoomToCardIndex(cardIndex, targetZoom, { lng, lat });
    };

    layerHandlers.onPointEnter = (e) => {
      map.getCanvas().style.cursor = 'pointer';
      const feature = e.features && e.features[0];
      if (!feature) return;

      const id        = feature.id;
      const cardIndex = parseInt(feature.properties.cardIndex, 10);
      if (id == null) return;

      try {
        if (hoveredFeatureId !== null) {
          map.setFeatureState({ source: sourceId, id: hoveredFeatureId }, { hover: false });
        }
        hoveredFeatureId = id;
        map.setFeatureState({ source: sourceId, id: hoveredFeatureId }, { hover: true });
      } catch (err) {}

      const el = partnerElByIndex.get(cardIndex);
      if (el) {
        highlightPartnerEl(el, true);
        // Hover-Scroll (eher soft)
        scrollPartnerIntoView(el, { behavior: 'smooth', align: 'center', retries: 6 });
      }
    };

    layerHandlers.onPointLeave = () => {
      map.getCanvas().style.cursor = '';
      clearMarkerStates();
      clearPartnerHover();
    };

    map.on('click',      'fachpartner-clusters',    layerHandlers.onClusterClick);
    map.on('mouseenter', 'fachpartner-clusters',    layerHandlers.onClusterEnter);
    map.on('mouseleave', 'fachpartner-clusters',    layerHandlers.onClusterLeave);
    map.on('click',      'fachpartner-unclustered', layerHandlers.onPointClick);
    map.on('mouseenter', 'fachpartner-unclustered', layerHandlers.onPointEnter);
    map.on('mouseleave', 'fachpartner-unclustered', layerHandlers.onPointLeave);
  }

  function addClusterSourceAndLayers() {
    if (!map.isStyleLoaded()) return;

    const { bubbleColor, textColor } = getThemeColors();

    if (!map.getSource(sourceId)) {
      map.addSource(sourceId, {
        type: 'geojson',
        data: geoDataToGeoJSON(),
        cluster: true,
        clusterMaxZoom: 12,
        clusterRadius: 90
      });
    } else {
      map.getSource(sourceId).setData(geoDataToGeoJSON());
    }

    if (!map.getLayer('fachpartner-clusters')) {
      map.addLayer({
        id: 'fachpartner-clusters',
        type: 'circle',
        source: sourceId,
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': bubbleColor,
          'circle-radius': [
            'interpolate', ['linear'], ['get', 'point_count'],
            1, 22, 5, 30, 10, 38, 25, 46, 50, 56, 100, 70
          ]
        }
      });
    }

    if (!map.getLayer('fachpartner-cluster-count')) {
      map.addLayer({
        id: 'fachpartner-cluster-count',
        type: 'symbol',
        source: sourceId,
        filter: ['has', 'point_count'],
        layout: {
          'text-field': '{point_count_abbreviated}',
          'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'],
          'text-size': 14
        },
        paint: { 'text-color': textColor }
      });
    }

    if (!map.getLayer('fachpartner-unclustered')) {
      map.addLayer({
        id: 'fachpartner-unclustered',
        type: 'circle',
        source: sourceId,
        filter: ['!', ['has', 'point_count']],
        paint: getUnclusteredPaint()
      });
    }

    ensureRadiusLayers();
    bindLayerEvents();

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        updateLayerThemeColors();
        map.resize();
        try { map.triggerRepaint(); } catch(e) {}
      });
    });
  }

  // ------------------------------------------------------
  //   Kamera / Fit
  // ------------------------------------------------------
  function flyToWithSidebar(lng, lat, targetZoom) {
    map.easeTo({
      center: [lng, lat],
      zoom: targetZoom ?? Math.max(map.getZoom(), 6),
      duration: FLY_MS,
      curve: 1,
      easing: t => 1 - Math.pow(1 - t, 3),
      offset: computeOffset(),
      essential: true
    });
  }

  function zoomRelative(step) {
    const current    = map.getZoom();
    const targetZoom = Math.max(map.getMinZoom(), Math.min(map.getMaxZoom(), current + step));

    if (lastOpen) {
      const off    = computeOffset();
      const anchor = [lastOpen.lng, lastOpen.lat];
      const center = centerForAnchorWithOffset(anchor, off);
      map.easeTo({
        center,
        zoom: targetZoom,
        duration: ZOOM_BTN_MS,
        easing: t => 1 - Math.pow(1 - t, 3),
        around: anchor
      });
      return;
    }

    map.easeTo({
      center: map.getCenter(),
      zoom: targetZoom,
      duration: ZOOM_BTN_MS,
      easing: t => 1 - Math.pow(1 - t, 3)
    });
  }

  function fitAllProjects(animate = true) {
    if (!geoData.length) return;

    if (geoData.length === 1) {
      const p = geoData[0];
      map.easeTo({
        center: [p.longitude, p.latitude],
        zoom: 8,
        duration: animate ? FLY_MS : 0,
        easing: t => 1 - Math.pow(1 - t, 3)
      });
      return;
    }

    const bounds = new mapboxgl.LngLatBounds();
    geoData.forEach(p => bounds.extend([p.longitude, p.latitude]));
    map.fitBounds(bounds, {
      padding: isHorizontalLayout() ? PAD_DESKTOP : PAD_TABLET,
      duration: animate ? FIT_BOUNDS_MS : 0,
      linear: false
    });
  }

  function fitToRadius(center, radiusKm, animate = true) {
    if (!center || !radiusKm) return;

    const circle = makeCircleGeoJSON(center.lng, center.lat, radiusKm, 96);
    const coords = circle.features[0].geometry.coordinates[0];

    const bounds = new mapboxgl.LngLatBounds();
    coords.forEach(c => bounds.extend(c));

    map.fitBounds(bounds, {
      padding: isHorizontalLayout() ? PAD_DESKTOP : PAD_TABLET,
      duration: animate ? FIT_BOUNDS_MS : 0,
      linear: false
    });
  }

  // ------------------------------------------------------
  //   Zoom to Partner (by global cardIndex)
  // ------------------------------------------------------
  function zoomToCardIndex(cardIndex, customZoom, knownCoords) {
    const geo = allGeoData.find(p => p.cardIndex === cardIndex);
    if (!geo && !knownCoords) return;

    const lng  = knownCoords ? knownCoords.lng : geo.longitude;
    const lat  = knownCoords ? knownCoords.lat : geo.latitude;
    const zoom = customZoom || 11;

    lastOpen = { cardIndex, lng, lat, zoom };
    if (zoomResetBtn) zoomResetBtn.classList.add('is-active');

    if (map.getSource(sourceId)) {
      try {
        if (activeFeatureId !== null) {
          map.setFeatureState({ source: sourceId, id: activeFeatureId }, { active: false });
        }
        activeFeatureId = cardIndex;
        map.setFeatureState({ source: sourceId, id: activeFeatureId }, { active: true });
      } catch (err) {}
    }

    const el = partnerElByIndex.get(cardIndex);
    if (el) {
      setActivePartnerEl(el);

      // ✅ Wichtig: Scroll mehrfach/versetzt (Modal-Animationen + Finsweet Timing)
      scrollPartnerIntoView(el, { behavior: 'smooth', align: 'center', retries: 18 });
      setTimeout(() => scrollPartnerIntoView(el, { behavior: 'smooth', align: 'center', retries: 12 }), 120);
      setTimeout(() => scrollPartnerIntoView(el, { behavior: 'smooth', align: 'center', retries: 8  }), 280);
    }

    requestAnimationFrame(() => {
      flyToWithSidebar(lng, lat, zoom);
    });
  }

  // ------------------------------------------------------
  //   Ergebnis-Zähler
  // ------------------------------------------------------
  function updateResultInfo(query) {
    const infoEl = document.querySelector(SEL.resultInfo);
    if (!infoEl) return;

    const total   = allGeoData.length;
    const visible = geoData.length;

    if (!query) infoEl.textContent = `${total} Fachpartner gefunden`;
    else infoEl.textContent = `${visible} von ${total}`;
  }

  // ------------------------------------------------------
  //   Radius Select
  // ------------------------------------------------------
  function parseRadiusKmFromSelect() {
    if (!radiusSelect) return null;
    const raw   = radiusSelect.value || '';
    const match = raw.match(/(\d+)/);
    if (!match) return null;
    const km = parseFloat(match[1]);
    return isNaN(km) ? null : km;
  }

  function setupRadiusSelect() {
    if (!radiusSelect) return;
    currentRadiusKm = parseRadiusKmFromSelect();
    radiusSelect.addEventListener('change', () => {
      currentRadiusKm = parseRadiusKmFromSelect();
      setGeoFilterByQuery(currentQuery);
    });
  }

  // ------------------------------------------------------
  //   search-reset Sichtbarkeit
  // ------------------------------------------------------
  function updateSearchResetVisibility() {
    if (!searchResetBtn) return;
    if (currentQuery && currentQuery.length > 0) searchResetBtn.classList.add('is-visible');
    else searchResetBtn.classList.remove('is-visible');
  }

  // ------------------------------------------------------
  //   Filter Helpers
  // ------------------------------------------------------
  function textMatchesForQuery(qLower) {
    return allGeoData.filter(p => {
      const zip  = (p.zip  || '').toLowerCase();
      const city = (p.city || '').toLowerCase();
      return zip.startsWith(qLower) || city.includes(qLower);
    });
  }

  function centroidOf(points) {
    if (!points || !points.length) return null;
    let sumLat = 0, sumLng = 0;
    points.forEach(p => { sumLat += p.latitude; sumLng += p.longitude; });
    return { lat: sumLat / points.length, lng: sumLng / points.length };
  }

  // ------------------------------------------------------
  //   Gruppensichtbarkeit: Außendienst nur zeigen, wenn Partner sichtbar
  // ------------------------------------------------------
  function updateAussendienstVisibility() {
    const adItems = document.querySelectorAll(SEL.aussendienstItem);
    adItems.forEach(ad => {
      const partners = ad.querySelectorAll(SEL.partnerItem);
      if (!partners.length) {
        ad.style.display = '';
        return;
      }
      const anyVisible = Array.from(partners).some(p => p.style.display !== 'none');
      ad.style.display = anyVisible ? '' : 'none';
    });
  }

  // ------------------------------------------------------
  //   Hauptfilter (PLZ/Ort + optional Radius)
  // ------------------------------------------------------
  function setGeoFilterByQuery(queryRaw) {
    currentQuery = (queryRaw || '').trim();
    const q      = currentQuery.toLowerCase();
    const hasQ   = !!q;

    isFilteredByPlz = hasQ;
    updateSearchResetVisibility();

    const cards = Array.from(document.querySelectorAll(SEL.partnerItem));

    function applyCardsVisibility(allowedSetOrNull) {
      isApplyingDom = true;
      try {
        cards.forEach(card => {
          const idxStr = card.dataset.cardIndex;
          const idx    = typeof idxStr === 'string' ? parseInt(idxStr, 10) : NaN;

          const show = !allowedSetOrNull ? true : allowedSetOrNull.has(idx);
          card.style.display = show ? '' : 'none';
          if (!show) card.classList.remove('is--hover', 'is--active');
        });
      } finally {
        isApplyingDom = false;
      }
      updateAussendienstVisibility();
    }

    function resetCommonUi() {
      clearMarkerStates();
      lastOpen = null;
      if (zoomResetBtn) zoomResetBtn.classList.remove('is-active');
    }

    if (!hasQ) {
      geoData = allGeoData.slice();
      applyCardsVisibility(null);
      resetCommonUi();

      addClusterSourceAndLayers();
      updateResultInfo(null);

      searchCenter = null;
      setRadiusOverlay(null, null);

      updateNoResultsState();
      fitAllProjects(true);
      return;
    }

    if (!currentRadiusKm) {
      geoData = textMatchesForQuery(q);

      const allowed = new Set(geoData.map(p => p.cardIndex));
      applyCardsVisibility(allowed);

      resetCommonUi();
      addClusterSourceAndLayers();
      updateResultInfo(currentQuery);

      searchCenter = null;
      setRadiusOverlay(null, null);

      updateNoResultsState();

      if (geoData.length) fitAllProjects(true);
      return;
    }

    const isNumeric = /^[0-9]+$/.test(currentQuery);
    const shouldGeocode = !(isNumeric && currentQuery.length < 5);

    const immediateFallbackCenter =
      centroidOf(textMatchesForQuery(q)) ||
      searchCenter ||
      centroidOf(allGeoData);

    if (immediateFallbackCenter && currentRadiusKm) {
      searchCenter = immediateFallbackCenter;
      setRadiusOverlay(searchCenter, currentRadiusKm);
    }

    const finishRadiusFilter = (center) => {
      if (!center) {
        const tm = textMatchesForQuery(q);
        center = centroidOf(tm) || centroidOf(allGeoData);
      }

      if (!center) {
        geoData = [];
        applyCardsVisibility(new Set());
        resetCommonUi();
        addClusterSourceAndLayers();
        updateResultInfo(currentQuery);
        setRadiusOverlay(null, null);
        updateNoResultsState();
        return;
      }

      searchCenter = center;

      geoData = allGeoData.filter(p => {
        const d = distanceKm(p.latitude, p.longitude, center.lat, center.lng);
        return d <= currentRadiusKm;
      });

      const allowed = new Set(geoData.map(p => p.cardIndex));
      applyCardsVisibility(allowed);

      resetCommonUi();
      addClusterSourceAndLayers();
      updateResultInfo(currentQuery);

      setRadiusOverlay(center, currentRadiusKm);
      updateNoResultsState();

      fitToRadius(center, currentRadiusKm, true);
    };

    if (!shouldGeocode) {
      const tm = textMatchesForQuery(q);
      finishRadiusFilter(centroidOf(tm));
      return;
    }

    geocodeSearchQuery(currentQuery).then(center => finishRadiusFilter(center));
  }

  function resetSearchFieldAndFilter() {
    currentQuery = '';
    if (plzSearchInput) plzSearchInput.value = '';
    currentRadiusKm = parseRadiusKmFromSelect();
    setSearchNoneVisible(false);
    setGeoFilterByQuery(null);
  }

  // ------------------------------------------------------
  //   Input Setup
  // ------------------------------------------------------
  function setupPlzSearch() {
    if (!plzSearchInput) return;

    let debounceTO;

    plzSearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }
    }, true);

    plzSearchInput.addEventListener('input', (e) => {
      let value = (e.target.value || '');
      value = value.replace(/\s+/g, ' ').trimStart();

      currentQuery = value;
      updateSearchResetVisibility();

      clearTimeout(debounceTO);
      debounceTO = setTimeout(() => {
        setGeoFilterByQuery(value);
      }, 200);
    });
  }

  function setupZoomTargets() {
    const bind = () => {
      const targets = document.querySelectorAll(SEL.zoomTarget);
      targets.forEach(target => {
        if (target.dataset._rennergyBound === '1') return;
        target.dataset._rennergyBound = '1';

        target.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();

          const cardEl = target.closest(SEL.partnerItem);
          if (!cardEl) return;

          const idxStr = cardEl.dataset.cardIndex;
          const idx    = typeof idxStr === 'string' ? parseInt(idxStr, 10) : NaN;
          if (isNaN(idx)) return;

          zoomToCardIndex(idx, 11);
        });
      });
    };

    bind();
    return bind;
  }

  function setupCardHoverHighlight() {
    const bind = () => {
      const cards = document.querySelectorAll(SEL.partnerItem);
      cards.forEach(card => {
        if (card.dataset._rennergyHover === '1') return;
        card.dataset._rennergyHover = '1';

        card.addEventListener('mouseenter', () => {
          const idxStr = card.dataset.cardIndex;
          const idx    = typeof idxStr === 'string' ? parseInt(idxStr, 10) : NaN;
          if (isNaN(idx) || !map.getSource(sourceId)) return;

          try {
            if (hoveredFeatureId !== null) {
              map.setFeatureState({ source: sourceId, id: hoveredFeatureId }, { hover: false });
            }
            hoveredFeatureId = idx;
            map.setFeatureState({ source: sourceId, id: hoveredFeatureId }, { hover: true });
          } catch (err) {}

          highlightPartnerEl(card, true);

          if (hoverFlyTimeout) clearTimeout(hoverFlyTimeout);
          hoverFlyTimeout = setTimeout(() => {
            const geo = allGeoData.find(p => p.cardIndex === idx);
            if (!geo) return;
            lastOpen = { cardIndex: idx, lng: geo.longitude, lat: geo.latitude, zoom: 11 };
            flyToWithSidebar(geo.longitude, geo.latitude, 11);
          }, LIST_HOVER_DELAY_MS);
        });

        card.addEventListener('mouseleave', () => {
          if (hoveredFeatureId !== null && map.getSource(sourceId)) {
            try { map.setFeatureState({ source: sourceId, id: hoveredFeatureId }, { hover: false }); } catch (err) {}
            hoveredFeatureId = null;
          }
          highlightPartnerEl(card, false);
          if (hoverFlyTimeout) clearTimeout(hoverFlyTimeout);
          hoverFlyTimeout = null;
        });
      });
    };

    bind();
    return bind;
  }

  // ------------------------------------------------------
  //   Klick auf Card -> wenn danach is--active gesetzt ist -> zoom
  // ------------------------------------------------------
  function setupCardClickActiveZoom() {
    const isInteractiveTarget = (t) => {
      if (!t) return false;
      const el = t.closest('a, button, input, select, textarea, label, [role="button"]');
      return !!el;
    };

    const bind = () => {
      const cards = document.querySelectorAll(SEL.partnerItem);
      cards.forEach(card => {
        if (card.dataset._rennergyClickZoom === '1') return;
        card.dataset._rennergyClickZoom = '1';

        card.addEventListener('click', (e) => {
          if (isInteractiveTarget(e.target)) return;

          const idxStr = card.dataset.cardIndex;
          const idx    = typeof idxStr === 'string' ? parseInt(idxStr, 10) : NaN;
          if (isNaN(idx)) return;

          setTimeout(() => {
            if (!card.classList.contains('is--active')) return;
            zoomToCardIndex(idx, 11);
          }, 0);
        }, true);
      });
    };

    bind();
    return bind;
  }

  // ------------------------------------------------------
  //   Observer: wenn irgendwo .is--active auf einem Partner auftaucht -> zoom
  // ------------------------------------------------------
  function setupActiveClassObserver() {
    const wrapper = document.querySelector(SEL.aussendienstListWrapper);
    if (!wrapper) return;

    let to = null;
    let lastIdx = null;

    const obs = new MutationObserver((mutations) => {
      if (isApplyingDom) return;

      let activeEl = null;
      for (const m of mutations) {
        if (m.type !== 'attributes' || m.attributeName !== 'class') continue;
        const el = m.target;
        if (!(el instanceof HTMLElement)) continue;
        if (!el.matches(SEL.partnerItem)) continue;
        if (!el.classList.contains('is--active')) continue;
        activeEl = el;
      }
      if (!activeEl) return;

      const idxStr = activeEl.dataset.cardIndex;
      const idx    = typeof idxStr === 'string' ? parseInt(idxStr, 10) : NaN;
      if (isNaN(idx)) return;
      if (idx === lastIdx) return;

      lastIdx = idx;
      clearTimeout(to);
      to = setTimeout(() => {
        zoomToCardIndex(idx, 11);
      }, 20);
    });

    obs.observe(wrapper, {
      subtree: true,
      attributes: true,
      attributeFilter: ['class']
    });

    dbg.log('👀 Active-Class Observer aktiv');
  }

  // ------------------------------------------------------
  //   Warten bis Finsweet "stabil" ist
  // ------------------------------------------------------
  async function waitForStablePartners({ timeoutMs = 22000, stableMs = 800 } = {}) {
    const start = Date.now();
    let lastCount = -1;
    let lastChange = Date.now();

    while (Date.now() - start < timeoutMs) {
      const count = document.querySelectorAll(SEL.partnerItem).length;

      if (count !== lastCount) {
        lastCount = count;
        lastChange = Date.now();
        dbg.log('List count changed:', count);
      }

      const stableFor = Date.now() - lastChange;
      const isStable = (count > 0 && stableFor >= stableMs);

      if (isStable) {
        dbg.log('Stable wait done:', { count, stable: true, elapsed: Date.now() - start });
        return count;
      }

      await new Promise(r => setTimeout(r, 200));
    }

    dbg.log('Stable wait timeout:', { count: lastCount, stable: false, elapsed: Date.now() - start });
    return lastCount;
  }

  // ------------------------------------------------------
  //   DOM einsammeln -> allGeoData aufbauen
  // ------------------------------------------------------
  async function rebuildFromDOM(reason) {
    dbg.log('RebuildFromDOM ->', reason || 'manual');

    const partnerEls = Array.from(document.querySelectorAll(SEL.partnerItem));
    if (!partnerEls.length) {
      dbg.log('❌ Keine Fachpartner-Items gefunden:', SEL.partnerItem);
      allGeoData = [];
      geoData = [];
      cardCount = 0;
      partnerElByIndex = new Map();
      addClusterSourceAndLayers();
      updateResultInfo(currentQuery || null);
      updateNoResultsState();
      return;
    }

    aussendienstEls = Array.from(document.querySelectorAll(SEL.aussendienstItem));
    partnerElByIndex = new Map();

    const out = [];
    for (let i = 0; i < partnerEls.length; i++) {
      const item = partnerEls[i];

      const cardIndex = i;
      item.dataset.cardIndex = String(cardIndex);

      const streetEl = item.querySelector('.fachpartner_street');
      const numEl    = item.querySelector('.fachpartner_number');
      const zipEl    = item.querySelector('.fachpartner_zip');
      const cityEl   = item.querySelector('.fachpartner_city');

      const street = streetEl ? streetEl.textContent.trim() : '';
      const number = numEl    ? numEl.textContent.trim()    : '';
      const zip    = zipEl    ? zipEl.textContent.trim()    : '';
      const city   = cityEl   ? cityEl.textContent.trim()   : '';

      if (zip)  item.dataset.zip  = zip;
      if (city) item.dataset.city = city;

      partnerElByIndex.set(cardIndex, item);

      let lat = item.getAttribute('data-lat');
      let lng = item.getAttribute('data-lng');

      if (!lat || !lng) {
        const latEl = item.querySelector('.latitude');
        const lngEl = item.querySelector('.longtitude') || item.querySelector('.longitude');
        lat = latEl ? latEl.textContent.trim() : '';
        lng = lngEl ? lngEl.textContent.trim() : '';
      }

      let latitude  = parseFloat(lat);
      let longitude = parseFloat(lng);

      if (isNaN(latitude) || isNaN(longitude)) {
        const geo = await geocodeAddress(street, number, zip, city);
        if (!geo) continue;
        latitude  = geo.lat;
        longitude = geo.lng;
      }

      const blurred = obfuscateCoords(latitude, longitude, 5);
      latitude  = blurred.lat;
      longitude = blurred.lng;

      const titleEl = item.querySelector('h3, h4, .g_content_title');
      const linkEl  = item.querySelector('a');

      const title = titleEl ? titleEl.textContent.trim() : 'Fachpartner';
      const link  = linkEl  ? (linkEl.getAttribute('href') || '#') : '#';

      out.push({
        latitude,
        longitude,
        title,
        link,
        cardIndex,
        zip,
        city
      });
    }

    allGeoData = out;
    geoData    = out.slice();
    cardCount  = out.length;

    dbg.log('✅ Partner gesammelt:', { partnerDOM: partnerEls.length, geoItems: out.length });

    addClusterSourceAndLayers();
    setGeoFilterByQuery(currentQuery);

    updateResultInfo(currentQuery || null);
    updateNoResultsState();

    if (!currentQuery) fitAllProjects(false);
  }

  // ------------------------------------------------------
  //   Finsweet ReRender Watcher
  // ------------------------------------------------------
  function setupDomObserver(rebindFns) {
    const target = document.querySelector(SEL.aussendienstListWrapper) || document.body;
    const obs = new MutationObserver(() => {
      if (isApplyingDom) return;
      clearTimeout(rerenderTO);
      rerenderTO = setTimeout(async () => {
        dbg.log('🔁 Mutation -> resync');
        await rebuildFromDOM('mutation');

        if (rebindFns && rebindFns.length) {
          rebindFns.forEach(fn => { try { fn(); } catch(e) {} });
        }
      }, 250);
    });

    obs.observe(target, { childList: true, subtree: true });
    dbg.log('👀 MutationObserver aktiv auf:', target === document.body ? 'document.body' : SEL.aussendienstListWrapper);
  }

  // ------------------------------------------------------
  //   Controls + Events
  // ------------------------------------------------------
  function setupControls() {
    if (zoomInBtn)  zoomInBtn.addEventListener('click', () => zoomRelative(+1));
    if (zoomOutBtn) zoomOutBtn.addEventListener('click', () => zoomRelative(-1));

    if (zoomResetBtn) {
      zoomResetBtn.addEventListener('click', () => {
        if (!lastOpen) return;
        zoomToCardIndex(lastOpen.cardIndex, lastOpen.zoom, { lng: lastOpen.lng, lat: lastOpen.lat });
      });
    }

    if (zoomResetMainBtn) {
      zoomResetMainBtn.addEventListener('click', () => {
        clearMarkerStates();
        lastOpen = null;
        if (zoomResetBtn) zoomResetBtn.classList.remove('is-active');
        setSearchNoneVisible(false);
        setGeoFilterByQuery(null);
        setActivePartnerEl(null);
        clearPartnerHover();
        fitAllProjects(true);
      });
    }

    if (searchResetBtn) {
      searchResetBtn.addEventListener('click', (e) => {
        e.preventDefault();
        resetSearchFieldAndFilter();
      });
    }

    if (searchForm) {
      searchForm.addEventListener('submit', (e) => {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }, true);
    }

    let resizeTO;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTO);
      resizeTO = setTimeout(() => {
        if (!currentQuery) fitAllProjects(false);
      }, 250);
    });
  }

  // ------------------------------------------------------
  //   Dark/Light Switch (Hard + Rebuild)
  // ------------------------------------------------------
  function switchMapStyleHard(newStyle) {
    if (newStyle === currentStyle) {
      setTimeout(updateLayerThemeColors, 80);
      return;
    }

    currentStyle = newStyle;
    hoveredFeatureId = null;
    activeFeatureId  = null;

    dbg.log('🌓 Style switch ->', newStyle);

    try { map.setStyle(newStyle, { diff: false }); }
    catch (e) { map.setStyle(newStyle); }

    map.once('style.load', () => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          addClusterSourceAndLayers();
          setRadiusOverlay(searchCenter, currentRadiusKm);

          setTimeout(() => {
            updateLayerThemeColors();
            map.resize();
            try { map.triggerRepaint(); } catch(e) {}

            if (lastOpen == null) {
              if (searchCenter && currentRadiusKm) fitToRadius(searchCenter, currentRadiusKm, false);
              else fitAllProjects(false);
            } else {
              flyToWithSidebar(lastOpen.lng, lastOpen.lat, lastOpen.zoom);
            }

            updateNoResultsState();
          }, 120);
        });
      });
    });
  }

  const themeObserver = new MutationObserver(() => {
    const newStyle = isDarkMode() ? darkStyle : lightStyle;
    switchMapStyleHard(newStyle);
  });

  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  themeObserver.observe(document.body,            { attributes: true, attributeFilter: ['class'] });

  // ------------------------------------------------------
  //   INIT
  // ------------------------------------------------------
  map.on('load', async () => {
    dbg.log('Map init… style:', currentStyle);

    setupControls();
    setupPlzSearch();
    setupRadiusSelect();
    updateSearchResetVisibility();

    const rebindZoomTargets   = setupZoomTargets();
    const rebindHover         = setupCardHoverHighlight();
    const rebindCardClickZoom = setupCardClickActiveZoom();
    const rebindFns = [rebindZoomTargets, rebindHover, rebindCardClickZoom];

    await waitForStablePartners({ timeoutMs: 24000, stableMs: 900 });
    await rebuildFromDOM('initial');

    setupActiveClassObserver();
    setupDomObserver(rebindFns);

    dbg.log('✅ INIT DONE');
  });

})();
