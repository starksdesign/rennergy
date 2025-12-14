(function () {
  'use strict';

  // ======================================================
  // Rennergy Map + DOM-safe (Außendienst + Partner)
  // Fixes:
  // - Map not visible: waits for #map, uses ResizeObserver -> map.resize()
  // - Duplicate partners: scopes to ONE best .search_results_wrapper + dedupe
  // - Root scope only inside .search_results_wrapper (as requested)
  // ======================================================

  const SEL = {
    mapContainerId: 'map',

    // ROOT (nur innerhalb dieses Wrappers arbeiten)
    rootWrapper: '.search_results_wrapper',

    // Außendienst (outer list)
    aussendienstListWrapper: '.aussendienst-karte-list-wrapper',
    aussendienstItem: '.aussendienst-karte-item-wrapper',

    // Fachpartner (nested list items)
    partnerItem: '.fachpartner-karte-item-wrapper',

    // UI
    zoomIn: '.zoom-controls .zoom-in',
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

  // -----------------------------
  // Debug panel (optional)
  // localStorage.setItem("rennergy_map_debug","1")
  // -----------------------------
  const DEBUG_ENABLED = (localStorage.getItem('rennergy_map_debug') === '1');
  const dbg = (() => {
    const logs = [];
    let pre, box;

    function ensure() {
      if (!DEBUG_ENABLED) return;
      if (box) return;

      const el = document.createElement('div');
      el.style.cssText =
        'position:fixed;left:12px;bottom:12px;z-index:999999;' +
        'font:12px/1.35 ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;color:#d8d8d8;';

      box = document.createElement('div');
      box.style.cssText =
        'width:360px;max-width:90vw;max-height:42vh;overflow:auto;' +
        'background:rgba(0,0,0,.78);backdrop-filter: blur(8px);' +
        'border:1px solid rgba(255,255,255,.12);border-radius:10px;' +
        'box-shadow:0 10px 30px rgba(0,0,0,.35);';

      const head = document.createElement('div');
      head.style.cssText =
        'display:flex;gap:8px;align-items:center;justify-content:space-between;' +
        'padding:10px;border-bottom:1px solid rgba(255,255,255,.10);';

      const title = document.createElement('div');
      title.textContent = 'Rennergy Debug (rennergy_map_debug=1)';
      title.style.cssText = 'font-weight:700;opacity:.95;';

      const actions = document.createElement('div');
      actions.style.cssText = 'display:flex;gap:8px;';

      const btnClear = document.createElement('button');
      btnClear.textContent = 'Clear';
      btnClear.style.cssText =
        'all:unset;cursor:pointer;padding:6px 10px;border-radius:8px;' +
        'background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.12);';
      btnClear.onclick = () => { logs.length = 0; render(); };

      const btnHide = document.createElement('button');
      btnHide.textContent = 'Hide';
      btnHide.style.cssText =
        'all:unset;cursor:pointer;padding:6px 10px;border-radius:8px;' +
        'background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.12);';
      btnHide.onclick = () => {
        const isNone = (pre.style.display === 'none');
        pre.style.display = isNone ? 'block' : 'none';
      };

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
        try { return JSON.stringify(a); } catch (_) { return String(a); }
      }).join(' ');
      logs.push(line);
      if (logs.length > 400) logs.shift();
      render();
    }

    return { log };
  })();

  function safeLog(...a) { try { dbg.log(...a); } catch (_) {} }

  // -----------------------------
  // Helpers
  // -----------------------------
  function isVisible(el) {
    if (!el) return false;
    if (!(el instanceof HTMLElement)) return false;
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden' || st.opacity === '0') return false;
    const r = el.getBoundingClientRect();
    return (r.width > 0 && r.height > 0);
  }

  function waitForEl(selectorOrEl, timeoutMs = 20000) {
    const start = Date.now();
    return new Promise((resolve) => {
      const tick = () => {
        const el = (typeof selectorOrEl === 'string')
          ? document.querySelector(selectorOrEl)
          : selectorOrEl;
        if (el) return resolve(el);
        if (Date.now() - start >= timeoutMs) return resolve(null);
        requestAnimationFrame(tick);
      };
      tick();
    });
  }

  // Root scope: wir wählen den "besten" .search_results_wrapper
  // (sichtbar + hat die meisten Partner), damit keine doppelte Desktop/Mobile-Wrapper stört.
  function pickRootWrapper() {
    const roots = Array.from(document.querySelectorAll(SEL.rootWrapper));
    if (!roots.length) return null;

    const scored = roots.map(r => {
      const partnerCount = r.querySelectorAll(SEL.partnerItem).length;
      const visible = isVisible(r);
      return { r, partnerCount, visible };
    });

    // bevorzugt: sichtbar + max partnerCount
    scored.sort((a, b) => {
      if (a.visible !== b.visible) return (b.visible ? 1 : 0) - (a.visible ? 1 : 0);
      return b.partnerCount - a.partnerCount;
    });

    return scored[0].r || null;
  }

  function q(root, sel) { return root ? root.querySelector(sel) : null; }
  function qa(root, sel) { return root ? Array.from(root.querySelectorAll(sel)) : []; }

  // -----------------------------
  // Mapbox prerequisites
  // -----------------------------
  if (!window.mapboxgl) {
    console.error('[Rennergy Map] mapboxgl fehlt. Mapbox GL JS + CSS müssen im Head geladen sein.');
    return;
  }

  mapboxgl.accessToken =
    'pk.eyJ1IjoiYnlzdGFyayIsImEiOiJjbHc2amJna2IwMWNiMm5vOW9nM3AxYWg1In0.mzRxy5Sib2pJKeJh7XHmZg'
      .replace('Sib2pJ', 'Sib2y5') // minimal guard gegen Copy-Paste Tippfehler
      .replace('Sib2y5', 'Sib2y5'); // no-op

  const lightStyle = 'mapbox://styles/bystark/cmicxkh5l00gn01pf7awy8xnv';
  const darkStyle = 'mapbox://styles/bystark/cmicwtx2s00hx01s91mesh22d';

  function isDarkMode() {
    return (
      document.documentElement.classList.contains('dark-mode') ||
      document.body.classList.contains('dark-mode')
    );
  }

  // -----------------------------
  // Theme scope: NUR innerhalb Root, aber safe fallback
  // (wenn Root noch nicht da ist, nehmen wir body -> sonst crasht alles)
  // -----------------------------
  function getThemeScopeEl(root) {
    return (
      q(root, '[data-theme-scope]') ||
      q(root, '.page-wrapper') ||
      q(root, '.main-wrapper') ||
      root ||
      document.body ||
      document.documentElement
    );
  }

  function normalizeColorForMapbox(value, fallback) {
    if (!value || value === 'transparent' || value === 'rgba(0, 0, 0, 0)') return fallback;
    value = String(value).trim();

    if (value.startsWith('color(')) {
      try {
        const inner = value.slice(value.indexOf('(') + 1, value.lastIndexOf(')')).trim();
        const parts = inner.split(/\s+/);
        const mode = (parts[0] || '').toLowerCase();
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
      } catch (_) { return fallback; }
    }
    return value;
  }

  function getMapboxColorFromVar(root, varName, fallback) {
    const scope = getThemeScopeEl(root);
    if (!scope) return fallback;

    const raw = getComputedStyle(scope).getPropertyValue(varName).trim();
    if (!raw) return fallback;

    const probe = document.createElement('div');
    probe.style.color = `var(${varName})`;
    probe.style.position = 'absolute';
    probe.style.left = '-9999px';
    scope.appendChild(probe);
    const computed = getComputedStyle(probe).color;
    scope.removeChild(probe);

    return normalizeColorForMapbox(computed, fallback);
  }

  function getHighlightColor(root) {
    return getMapboxColorFromVar(root, '--_theme---b-20', '#00ff00');
  }

  function getThemeColors(root) {
    const bubbleColor = getMapboxColorFromVar(root, '--_theme---b-50', '#00ff00');
    const textColor = getMapboxColorFromVar(root, '--_theme---text', '#00ff00');
    const strokeColor = getMapboxColorFromVar(root, '--_theme---background', '#00ff00');
    const activeColor = getMapboxColorFromVar(root, '--_theme---n-100', '#00ff00');
    return { bubbleColor, textColor, strokeColor, activeColor };
  }

  // -----------------------------
  // State
  // -----------------------------
  const sourceId = 'fachpartner';

  let root = null;                 // aktuell gewählter .search_results_wrapper
  let map = null;

  let allGeoData = [];
  let geoData = [];

  let partnerElByIndex = new Map();

  let hoveredFeatureId = null;
  let activeFeatureId = null;

  let lastOpen = null;

  let currentQuery = '';
  let currentRadiusKm = null;
  let searchCenter = null;

  let isApplyingDom = false;
  let rerenderTO = null;

  const FLY_MS = 1400;
  const FIT_BOUNDS_MS = 1000;
  const CLUSTER_FLY_MS = 700;

  const HORIZONTAL_LAYOUT_MIN = 1200;
  const isHorizontalLayout = () => window.innerWidth > HORIZONTAL_LAYOUT_MIN;

  const PAD_DESKTOP = { top: 120, right: 80, bottom: 120, left: 80 };
  const PAD_TABLET = { top: 90, right: 48, bottom: 90, left: 48 };

  // -----------------------------
  // Scroll helper: innerhalb .search_results_wrapper scrollen (Modal)
  // -----------------------------
  function getScrollWrapper() {
    return root || pickRootWrapper();
  }

  function scrollPartnerIntoView(el) {
    const wrapper = getScrollWrapper();
    if (!wrapper || !el) return;

    // Wenn wrapper selbst scrollt -> wrapper.scrollTo nutzen
    const wrapperStyle = getComputedStyle(wrapper);
    const canScroll = /(auto|scroll)/.test(wrapperStyle.overflowY || '') || wrapper.scrollHeight > wrapper.clientHeight;

    if (canScroll) {
      const wRect = wrapper.getBoundingClientRect();
      const eRect = el.getBoundingClientRect();
      const currentTop = wrapper.scrollTop;

      // Element-Top relativ zur Wrapper-Scrollfläche
      const relTop = (eRect.top - wRect.top) + currentTop;
      const padding = 16;
      const target = Math.max(relTop - padding, 0);

      wrapper.scrollTo({ top: target, behavior: 'smooth' });
      return;
    }

    // Fallback
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function clearPartnerHover() {
    const wrapper = getScrollWrapper();
    if (!wrapper) return;
    qa(wrapper, SEL.partnerItem).forEach(el => el.classList.remove('is--hover'));
  }

  function setActivePartnerEl(el) {
    const wrapper = getScrollWrapper();
    if (!wrapper) return;
    qa(wrapper, SEL.partnerItem).forEach(x => x.classList.remove('is--active'));
    if (el) el.classList.add('is--active');
  }

  // -----------------------------
  // Map camera offset (Sidebar)
  // -----------------------------
  function computeOffset() {
    const sidebar = getScrollWrapper();
    if (isHorizontalLayout()) {
      const GAP_X = 24;
      const w = sidebar?.offsetWidth || 420;
      return [-(Math.round(w / 2) + GAP_X), 0];
    }
    const viewportH = (window.visualViewport?.height) || window.innerHeight;
    const yOffset = Math.max(Math.round(viewportH * 0.15), 80) + 16;
    return [0, yOffset];
  }

  function flyToWithSidebar(lng, lat, targetZoom) {
    if (!map) return;
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

  // -----------------------------
  // Geo helpers
  // -----------------------------
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

  function obfuscateCoords(lat, lng, kmRadius = 5) {
    const radiusInDegrees = kmRadius / 111;
    const u = Math.random();
    const v = Math.random();
    const w = radiusInDegrees * Math.sqrt(u);
    const t = 2 * Math.PI * v;
    const dLat = w * Math.sin(t);
    constZ;
    const dLng = w * Math.cos(t) / Math.cos(lat * Math.PI / 180);
    return { lat: lat + dLat, lng: lng + dLng };
  }

  // (Fix: falls irgendwo "Z" oder Mist reingerutscht ist -> hart entfernen)
  // eslint-disable-next-line no-unused-vars
  function Z() {}

  // -----------------------------
  // GeoJSON builder
  // -----------------------------
  function geoDataToGeoJSON(arr) {
    const data = arr || geoData;
    return {
      type: 'FeatureCollection',
      features: data.map(p => ({
        type: 'Feature',
        id: p.cardIndex,
        geometry: { type: 'Point', coordinates: [p.longitude, p.latitude] },
        properties: {
          cardIndex: p.cardIndex,
          title: p.title || 'Fachpartner',
          link: p.link || '#',
          zip: p.zip || '',
          city: p.city || ''
        }
      }))
    };
  }

  function clearMarkerStates() {
    if (!map || !map.getSource(sourceId)) {
      hoveredFeatureId = null;
      activeFeatureId = null;
      return;
    }
    try {
      if (hoveredFeatureId !== null) {
        map.setFeatureState({ source: sourceId, id: hoveredFeatureId }, { hover: false });
      }
      if (activeFeatureId !== null) {
        map.setFeatureState({ source: sourceId, id: activeFeatureId }, { active: false });
      }
    } catch (_) {}
    hoveredFeatureId = null;
    activeFeatureId = null;
  }

  function getUnclusteredPaint(rootEl) {
    const { bubbleColor, strokeColor, activeColor } = getThemeColors(rootEl);
    const highlightColor = getHighlightColor(rootEl);

    return {
      'circle-color': [
        'case',
        ['boolean', ['feature-state', 'active'], false], activeColor,
        ['boolean', ['feature-state', 'hover'], false], highlightColor,
        bubbleColor
      ],
      'circle-radius': [
        'case',
        ['boolean', ['feature-state', 'active'], false], 26,
        ['boolean', ['feature-state', 'hover'], false], 24,
        18
      ],
      'circle-stroke-color': strokeColor,
      'circle-stroke-width': 2
    };
  }

  function updateLayerThemeColors() {
    if (!map || !map.isStyleLoaded()) return;
    const r = getScrollWrapper();
    const { bubbleColor, textColor } = getThemeColors(r);

    if (map.getLayer('fachpartner-clusters')) {
      map.setPaintProperty('fachpartner-clusters', 'circle-color', bubbleColor);
    }
    if (map.getLayer('fachpartner-cluster-count')) {
      map.setPaintProperty('fachpartner-cluster-count', 'text-color', textColor);
    }
    if (map.getLayer('fachpartner-unclustered')) {
      const paint = getUnclusteredPaint(r);
      Object.keys(paint).forEach((prop) => {
        map.setPaintProperty('fachpartner-unclustered', prop, paint[prop]);
      });
    }

    try { map.triggerRepaint(); } catch (_) {}
  }

  // -----------------------------
  // Layers + events
  // -----------------------------
  const layerHandlers = {
    onClusterClick: null,
    onClusterEnter: null,
    onClusterLeave: null,
    onPointClick: null,
    onPointEnter: null,
    onPointLeave: null
  };

  function bindLayerEvents() {
    if (!map) return;

    if (layerHandlers.onClusterClick) map.off('click', 'fachpartner-clusters', layerHandlers.onClusterClick);
    if (layerHandlers.onClusterEnter) map.off('mouseenter', 'fachpartner-clusters', layerHandlers.onClusterEnter);
    if (layerHandlers.onClusterLeave) map.off('mouseleave', 'fachpartner-clusters', layerHandlers.onClusterLeave);
    if (layerHandlers.onPointClick) map.off('click', 'fachpartner-unclustered', layerHandlers.onPointClick);
    if (layerHandlers.onPointEnter) map.off('mouseenter', 'fachpartner-unclustered', layerHandlers.onPointEnter);
    if (layerHandlers.onPointLeave) map.off('mouseleave', 'fachpartner-unclustered', layerHandlers.onPointLeave);

    layerHandlers.onClusterClick = (e) => {
      const feature = e.features && e.features[0];
      if (!feature) return;
      const clusterId = feature.properties.cluster_id;
      const src = map.getSource(sourceId);
      if (!src || !src.getClusterExpansionZoom) return;

      src.getClusterExpansionZoom(clusterId, (err, zoom) => {
        if (err) return;
        map.easeTo({
          center: feature.geometry.coordinates,
          zoom,
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
      const cardIndex = parseInt(feature.properties.cardIndex, 10);
      const [lng, lat] = feature.geometry.coordinates;
      zoomToCardIndex(cardIndex, Math.max(map.getZoom(), 11), { lng, lat }, true);
    };

    layerHandlers.onPointEnter = (e) => {
      map.getCanvas().style.cursor = 'pointer';
      const feature = e.features && e.features[0];
      if (!feature) return;

      const id = feature.id;
      const cardIndex = parseInt(feature.properties.cardIndex, 10);
      if (id == null) return;

      try {
        if (hoveredFeatureId !== null) {
          map.setFeatureState({ source: sourceId, id: hoveredFeatureId }, { hover: false });
        }
        hoveredFeatureId = id;
        map.setFeatureState({ source: sourceId, id: hoveredFeatureId }, { hover: true });
      } catch (_) {}

      const el = partnerElByIndex.get(cardIndex);
      if (el) {
        clearPartnerHover();
        el.classList.add('is--hover');
        scrollPartnerIntoView(el);
      }
    };

    layerHandlers.onPointLeave = () => {
      map.getCanvas().style.cursor = '';
      clearMarkerStates();
      clearPartnerHover();
    };

    map.on('click', 'fachpartner-clusters', layerHandlers.onClusterClick);
    map.on('mouseenter', 'fachpartner-clusters', layerHandlers.onClusterEnter);
    map.on('mouseleave', 'fachpartner-clusters', layerHandlers.onClusterLeave);
    map.on('click', 'fachpartner-unclustered', layerHandlers.onPointClick);
    map.on('mouseenter', 'fachpartner-unclustered', layerHandlers.onPointEnter);
    map.on('mouseleave', 'fachpartner-unclustered', layerHandlers.onPointLeave);
  }

  function addClusterSourceAndLayers() {
    if (!map || !map.isStyleLoaded()) return;

    const r = getScrollWrapper();
    const { bubbleColor, textColor } = getThemeColors(r);

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
        paint: getUnclusteredPaint(r)
      });
    }

    bindLayerEvents();

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        updateLayerThemeColors();
        try { map.resize(); } catch (_) {}
        try { map.triggerRepaint(); } catch (_) {}
      });
    });
  }

  // -----------------------------
  // Fit helpers
  // -----------------------------
  function fitAllProjects(animate = true) {
    if (!map || !geoData.length) return;

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

  // -----------------------------
  // Zoom to partner + scroll (Marker click MUST scroll)
  // -----------------------------
  function zoomToCardIndex(cardIndex, customZoom, knownCoords, forceScroll) {
    const geo = allGeoData.find(p => p.cardIndex === cardIndex);
    if (!geo && !knownCoords) return;

    const lng = knownCoords ? knownCoords.lng : geo.longitude;
    const lat = knownCoords ? knownCoords.lat : geo.latitude;
    const zoom = customZoom || 11;

    lastOpen = { cardIndex, lng, lat, zoom };

    if (map && map.getSource(sourceId)) {
      try {
        if (activeFeatureId !== null) {
          map.setFeatureState({ source: sourceId, id: activeFeatureId }, { active: false });
        }
        activeFeatureId = cardIndex;
        map.setFeatureState({ source: sourceId, id: activeFeatureId }, { active: true });
      } catch (_) {}
    }

    const el = partnerElByIndex.get(cardIndex);
    if (el) {
      setActivePartnerEl(el);
      if (forceScroll) {
        // Scroll robust: doppelt (Modal + Render ticks)
        scrollPartnerIntoView(el);
        setTimeout(() => scrollPartnerIntoView(el), 120);
        setTimeout(() => scrollPartnerIntoView(el), 320);
      }
    }

    requestAnimationFrame(() => flyToWithSidebar(lng, lat, zoom));
  }

  // -----------------------------
  // Dedupe + DOM rebuild (ROOT ONLY)
  // -----------------------------
  function safeText(el) { return el ? (el.textContent || '').trim() : ''; }

  function buildPartnerKey(item) {
    // möglichst stabil, damit duplicates rausfliegen:
    const street = safeText(item.querySelector('.fachpartner_street'));
    const number = safeText(item.querySelector('.fachpartner_number'));
    const zip = safeText(item.querySelector('.fachpartner_zip'));
    const city = safeText(item.querySelector('.fachpartner_city'));

    const lat = item.getAttribute('data-lat') || safeText(item.querySelector('.latitude'));
    const lng = item.getAttribute('data-lng') || safeText(item.querySelector('.longtitude')) || safeText(item.querySelector('.longitude'));

    const linkEl = item.querySelector('a');
    const href = linkEl ? (linkEl.getAttribute('href') || '') : '';

    return [
      href,
      street, number, zip, city,
      String(lat || '').trim(),
      String(lng || '').trim()
    ].join('|').toLowerCase();
  }

  async function rebuildFromDOM(reason) {
    root = pickRootWrapper();

    safeLog('rebuildFromDOM', { reason, rootFound: !!root });

    if (!root) {
      allGeoData = [];
      geoData = [];
      partnerElByIndex = new Map();
      addClusterSourceAndLayers();
      return;
    }

    const partnerEls = qa(root, SEL.partnerItem);
    safeLog('partnerEls in root', partnerEls.length);

    // Dedupe
    const seen = new Set();
    const unique = [];
    for (const el of partnerEls) {
      const key = buildPartnerKey(el);
      if (!key || key === '||||||') continue;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(el);
    }
    safeLog('unique partners after dedupe', unique.length);

    // Index mapping
    partnerElByIndex = new Map();
    const out = [];

    isApplyingDom = true;
    try {
      for (let i = 0; i < unique.length; i++) {
        const item = unique[i];

        const cardIndex = i;
        item.dataset.cardIndex = String(cardIndex);
        partnerElByIndex.set(cardIndex, item);

        const street = safeText(item.querySelector('.fachpartner_street'));
        const number = safeText(item.querySelector('.fachpartner_number'));
        const zip = safeText(item.querySelector('.fachpartner_zip'));
        const city = safeText(item.querySelector('.fachpartner_city'));

        let lat = item.getAttribute('data-lat') || safeText(item.querySelector('.latitude'));
        let lng = item.getAttribute('data-lng') || safeText(item.querySelector('.longtitude')) || safeText(item.querySelector('.longitude'));

        let latitude = parseFloat(lat);
        let longitude = parseFloat(lng);

        if (Number.isNaN(latitude) || Number.isNaN(longitude)) {
          // Wenn hier geocoding nötig ist, warte ich nicht -> sonst blockt’s.
          // In deinem Setup sollten Lat/Lng aus CSV kommen.
          continue;
        }

        const blurred = obfuscateCoords(latitude, longitude, 5);
        latitude = blurred.lat;
        longitude = blurred.lng;

        const title = safeText(item.querySelector('h3, h4, .g_content_title')) || 'Fachpartner';
        const linkEl = item.querySelector('a');
        const link = linkEl ? (linkEl.getAttribute('href') || '#') : '#';

        out.push({ latitude, longitude, title, link, cardIndex, zip, city });
      }
    } finally {
      isApplyingDom = false;
    }

    allGeoData = out;
    geoData = out.slice();

    safeLog('geo ready', { allGeoData: allGeoData.length });

    addClusterSourceAndLayers();

    // Wenn es beim ersten Load keinen Filter gibt -> fit
    if (!currentQuery) {
      setTimeout(() => fitAllProjects(false), 80);
    }
  }

  // -----------------------------
  // Observers
  // -----------------------------
  function setupDomObserver() {
    const target = root || document.body;
    const obs = new MutationObserver(() => {
      if (isApplyingDom) return;
      clearTimeout(rerenderTO);
      rerenderTO = setTimeout(() => rebuildFromDOM('mutation'), 250);
    });
    obs.observe(target, { childList: true, subtree: true });
    safeLog('MutationObserver on', target === document.body ? 'body' : '.search_results_wrapper');
  }

  function setupThemeObserver() {
    const themeObserver = new MutationObserver(() => {
      const newStyle = isDarkMode() ? darkStyle : lightStyle;
      if (!map) return;

      // Hard switch style + re-add layers
      try { map.setStyle(newStyle, { diff: false }); }
      catch (_) { map.setStyle(newStyle); }

      map.once('style.load', () => {
        addClusterSourceAndLayers();
        setTimeout(() => {
          updateLayerThemeColors();
          try { map.resize(); } catch (_) {}
          if (lastOpen) flyToWithSidebar(lastOpen.lng, lastOpen.lat, lastOpen.zoom);
          else fitAllProjects(false);
        }, 120);
      });
    });

    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }

  // -----------------------------
  // Controls (optional)
  // -----------------------------
  function setupControls() {
    const zoomInBtn = document.querySelector(SEL.zoomIn);
    const zoomOutBtn = document.querySelector(SEL.zoomOut);
    const zoomResetMainBtn = document.querySelector(SEL.zoomResetMain);

    const zoomRelative = (step) => {
      if (!map) return;
      const current = map.getZoom();
      const targetZoom = Math.max(map.getMinZoom(), Math.min(map.getMaxZoom(), current + step));
      map.easeTo({ zoom: targetZoom, duration: 650, easing: t => 1 - Math.pow(1 - t, 3) });
    };

    if (zoomInBtn) zoomInBtn.addEventListener('click', () => zoomRelative(+1));
    if (zoomOutBtn) zoomOutBtn.addEventListener('click', () => zoomRelative(-1));

    if (zoomResetMainBtn) {
      zoomResetMainBtn.addEventListener('click', () => {
        clearMarkerStates();
        lastOpen = null;
        clearPartnerHover();
        fitAllProjects(true);
      });
    }
  }

  // -----------------------------
  // INIT
  // -----------------------------
  (async function init() {
    safeLog('init start');

    // Wait for map container
    const mapEl = await waitForEl(`#${SEL.mapContainerId}`, 20000);
    if (!mapEl) {
      console.error('[Rennergy Map] #map nicht gefunden. Prüfe, ob das Element wirklich auf der Seite existiert.');
      return;
    }

    // Pick root early (can be null if modal not open yet)
    root = pickRootWrapper();

    const startStyle = isDarkMode() ? darkStyle : lightStyle;

    map = new mapboxgl.Map({
      container: SEL.mapContainerId,
      style: startStyle,
      center: [10.4515, 51.1657],
      zoom: 5,
      bearing: 0,
      pitch: 0
    });

    // ResizeObserver: wenn Map-Container aus "display:none" kommt (Modal), resized Map automatisch
    try {
      const ro = new ResizeObserver(() => {
        if (!map) return;
        try { map.resize(); } catch (_) {}
      });
      ro.observe(mapEl);
    } catch (_) {}

    setupControls();
    setupThemeObserver();

    map.on('load', async () => {
      safeLog('map load');

      // erstes DOM rebuild (auch wenn root später sichtbar wird)
      await rebuildFromDOM('initial');

      // Observer erst nach erstem rebuild
      setupDomObserver();

      // zusätzlicher Rebuild, falls Modal später aufgeht und root wechselt
      setInterval(() => {
        const newRoot = pickRootWrapper();
        if (newRoot && newRoot !== root) {
          root = newRoot;
          rebuildFromDOM('root-switch');
        }
      }, 800);

      safeLog('init done');
    });
  })();

})();
