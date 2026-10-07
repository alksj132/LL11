// LilacAnime Hybrid & Standalone Web Bridge for iOS
// Automatically detects whether a local backend server is running.
// If computer is off or hosting statically (GitHub Pages / Vercel), switches to 100% Client-Side Standalone Mode!

(function() {
  if (window.lilac && !window.lilac.__isWebBridge) {
    console.log('[Lilac] Running in native Electron environment');
    return;
  }

  console.log('[Lilac] Initializing iOS Hybrid/Standalone bridge');

  const API_BASE = window.location.origin;
  let serverAvailable = true;

  // Public CORS Proxies for Standalone Mode (when PC server is turned off)
  const CORS_PROXIES = [
    url => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    url => `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
    url => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`
  ];

  async function fetchWithCorsProxy(url, headers = {}) {
    // Try direct first
    try {
      const resp = await fetch(url, { headers });
      if (resp.ok) return resp;
    } catch {}

    // Fall back to CORS proxies
    for (const proxy of CORS_PROXIES) {
      try {
        const proxyUrl = proxy(url);
        const resp = await fetch(proxyUrl);
        if (resp.ok) return resp;
      } catch {}
    }
    throw new Error(`CORS 프록시를 통한 연결 실패: ${url}`);
  }

  async function fetchJsonWithFallback(url) {
    const resp = await fetchWithCorsProxy(url);
    return await resp.json();
  }

  async function request(path, options = {}) {
    if (serverAvailable) {
      try {
        const res = await fetch(path, options);
        if (res.ok) return await res.json();
        if (res.status === 404 || res.status >= 500) {
          // Fall through to standalone
        }
      } catch (e) {
        // Server unreachable -> switch to standalone mode
        serverAvailable = false;
        console.warn('[Lilac] Backend server unreachable. Switching to iPhone Standalone Mode!');
      }
    }
    return handleStandaloneRequest(path, options);
  }

  function get(endpoint, params = {}) {
    const url = new URL(endpoint, API_BASE);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }
    return request(url.pathname + url.search, {
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    });
  }

  function post(endpoint, body = {}) {
    return request(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(body)
    });
  }

  // --- Standalone Client-side API Handlers (PC OFF) ---
  const LINKKF_API = 'https://linkkf1.5imgdarr.top/api';
  const LINKKF_EPISODE_API = 'https://linkkfep1.5imgdarr.top';
  const LINKKF_WEB = 'https://linkkf.app';
  const REANIME_WEB = 'https://reanime.to';

  function formatLinkkfItem(item) {
    const pid = String(item.postid || item.id || '');
    let thumb = item.postthum || item.thumb || '';
    if (thumb && !thumb.startsWith('http')) thumb = `https://rez1.ims1.top/350x/${thumb}`;
    return {
      provider: 'linkkf',
      id: pid,
      mal_id: `linkkf:${pid}`,
      title: item.postname || item.name || '',
      title_english: item.english || '',
      title_japanese: item.native || '',
      images: { webp: { large_image_url: thumb } },
      year: String(item.postyear || ''),
      type: item.postseasontype || 'Anime',
      synopsis: item.postcontent || item.description || '',
      url: `${LINKKF_WEB}/up/${pid}/`,
      anilistId: Number(item.anilistid || item.anilist_id) || null
    };
  }

  async function handleStandaloneRequest(path, options) {
    const urlObj = new URL(path, API_BASE);
    const pathname = urlObj.pathname;
    const params = urlObj.searchParams;

    // 1. Jikan Anime APIs (Directly allowed by CORS!)
    if (pathname === '/api/anime/season') {
      const res = await fetch('https://api.jikan.moe/v4/seasons/now?limit=20&sfw=true');
      return await res.json();
    }
    if (pathname === '/api/anime/top') {
      const res = await fetch('https://api.jikan.moe/v4/top/anime?filter=bypopularity&limit=20&sfw=true');
      return await res.json();
    }
    if (pathname === '/api/anime/search') {
      const q = params.get('query') || '';
      const res = await fetch(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(q)}&limit=24&sfw=true&order_by=popularity`);
      return await res.json();
    }
    if (pathname === '/api/anime/detail') {
      const id = params.get('id') || '';
      const res = await fetch(`https://api.jikan.moe/v4/anime/${id}/full`);
      return await res.json();
    }

    // 2. Linkkf APIs via CORS proxy
    if (pathname === '/api/linkkf/home') {
      const page = params.get('page') || '1';
      const limit = params.get('limit') || '20';
      const data = await fetchJsonWithFallback(`${LINKKF_API}/filter.php?page=${page}&limit=${limit}`);
      return { data: (data.data || []).map(formatLinkkfItem) };
    }
    if (pathname === '/api/linkkf/detail') {
      const id = params.get('id') || '';
      const data = await fetchJsonWithFallback(`${LINKKF_API}/single.php?postid=${encodeURIComponent(id)}`);
      return { data: formatLinkkfItem(data.data || {}) };
    }
    if (pathname === '/api/linkkf/episodes') {
      const id = params.get('id') || '';
      const data = await fetchJsonWithFallback(`${LINKKF_EPISODE_API}/api2.php?epid=${encodeURIComponent(id)}`);
      const servers = [];
      for (const srv of (Array.isArray(data) ? data : [])) {
        const eps = [];
        for (const item of (srv.server_data || [])) {
          const slug = String(item.slug || '');
          const name = String(item.name || slug);
          const m = name.match(/\d+/);
          eps.append?.({
            name, slug, number: m ? Number(m[0]) : null,
            token: String(item.link || `${id}v${srv.id}_${slug}`),
            postId: id
          }) || eps.push({
            name, slug, number: m ? Number(m[0]) : null,
            token: String(item.link || `${id}v${srv.id}_${slug}`),
            postId: id
          });
        }
        if (eps.length) {
          servers.push({ id: srv.id, name: srv.server_name || `Server ${srv.id}`, episodes: eps });
        }
      }
      return servers;
    }
    if (pathname === '/api/linkkf/resolve') {
      const body = JSON.parse(options.body || '{}');
      const ep = body.episode || {};
      let playerUrl = '';
      try {
        const root = await fetchJsonWithFallback(`https://emdlinkkf.5imgdarr.top/apilink2.php?data=${encodeURIComponent(ep.token)}`);
        const links = Array.isArray(root.data) ? root.data : [];
        playerUrl = (links.find(x => String(x.server).toUpperCase() === 'NR-HD') || links[0] || {}).link || '';
      } catch {}
      if (!playerUrl) playerUrl = `${LINKKF_WEB}/up/${ep.postId}/watch/?slug=${ep.slug}`;

      // Resolve player html
      const resp = await fetchWithCorsProxy(playerUrl);
      const html = await resp.text();
      const m3u8Match = html.match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/i);
      const mp4Match = html.match(/https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*/i);
      if (m3u8Match) return { url: m3u8Match[0], hls: true };
      if (mp4Match) return { url: mp4Match[0], hls: false };
      return { url: playerUrl, hls: false };
    }
    if (pathname === '/api/linkkf/search') {
      const q = params.get('query') || '';
      const data = await fetchJsonWithFallback(`${LINKKF_API}/filter.php?page=1&limit=50`);
      const key = q.toLowerCase().replace(/[\s\-_:.,!?~]+/g, '');
      const found = (data.data || []).map(formatLinkkfItem).filter(it => {
        const combined = `${it.title} ${it.title_english} ${it.title_japanese}`.toLowerCase();
        return combined.replace(/[\s\-_:.,!?~]+/g, '').includes(key);
      });
      return { data: found, total: found.length };
    }

    // 3. AniSkip (Direct CORS enabled)
    if (pathname === '/api/oped/get') {
      const body = JSON.parse(options.body || '{}');
      const malId = body.malId;
      const ep = body.episode || 1;
      const dur = Math.round(Number(body.duration) || 0);
      if (malId && ep) {
        try {
          const skipUrl = `https://api.aniskip.com/v2/skip-times/${malId}/${ep}?types[]=op&types[]=ed&episodeLength=${dur}`;
          const skipRes = await fetch(skipUrl, { headers: { 'Accept': 'application/json' } });
          if (skipRes.ok) {
            const data = await skipRes.json();
            return (data.results || []).map(item => ({
              type: item.skipType,
              startTime: Number(item.interval?.startTime || 0),
              endTime: Number(item.interval?.endTime || 0)
            }));
          }
        } catch {}
      }
      return [];
    }

    // 4. Titles Resolve
    if (pathname === '/api/titles/resolve') {
      const body = JSON.parse(options.body || '{}');
      return (body.list || []).slice(0, 60).map(it => ({
        key: `${it.provider || 'jikan'}:${it.id ?? it.mal_id}`,
        ko: it.title || '',
        en: it.title_english || ''
      }));
    // 5. Provider APIs (Standalone Mode Fallbacks via Jikan Anime APIs)
    if (pathname === '/api/provider/season') {
      try {
        const res = await fetch('https://api.jikan.moe/v4/seasons/now?limit=25&sfw=true');
        const root = await res.json();
        return { data: root.data || [], label: '이번 시즌 추천' };
      } catch { return { data: [], label: '이번 시즌 추천' }; }
    }
    if (pathname === '/api/provider/airing') {
      try {
        const res = await fetch('https://api.jikan.moe/v4/top/anime?filter=airing&limit=25&sfw=true');
        const root = await res.json();
        return { data: root.data || [], label: '방영 중' };
      } catch { return { data: [], label: '방영 중' }; }
    }
    if (pathname === '/api/provider/catalog') {
      try {
        const res = await fetch('https://api.jikan.moe/v4/top/anime?filter=bypopularity&limit=30&sfw=true');
        const root = await res.json();
        return { data: root.data || [], total: (root.pagination || {}).items?.total || 100, done: true };
      } catch { return { data: [], total: 0, done: true }; }
    }
    if (pathname === '/api/provider/detail') {
      const body = JSON.parse(options.body || '{}');
      const a = body.anime || {};
      const id = a.id || a.mal_id;
      let detail = a;
      if (id && String(id).match(/^\d+$/)) {
        try {
          const res = await fetch(`https://api.jikan.moe/v4/anime/${id}/full`);
          const json = await res.json();
          if (json.data) detail = json.data;
        } catch {}
      }
      const epCount = Number(detail.episodes) || 12;
      const episodes = [];
      for (let i = 1; i <= epCount; i++) {
        episodes.push({
          name: String(i),
          number: i,
          title: `${detail.title || '애니'} ${i}화`,
          provider: 'linkkf'
        });
      }
      return { data: detail, episodes, unavailable: false };
    }
    if (pathname === '/api/provider/resolve') {
      const body = JSON.parse(options.body || '{}');
      const ep = body.episode || {};
      return { url: ep.url || '', hls: false };
    }

    return { error: '미지원 또는 데이터 없음' };
  }

  // --- window.lilac API Binding ---
  window.lilac = {
    __isWebBridge: true,

    // Metadata
    season: () => get('/api/anime/season'),
    top: () => get('/api/anime/top'),
    search: query => get('/api/anime/search', { query }),
    detail: id => get('/api/anime/detail', { id }),

    // Linkkf
    linkkfHome: (page = 1, limit = 20) => get('/api/linkkf/home', { page, limit }),
    linkkfDetail: id => get('/api/linkkf/detail', { id }),
    linkkfEpisodes: id => get('/api/linkkf/episodes', { id }),
    linkkfPlay: episode => post('/api/linkkf/play', { episode }),
    linkkfResolve: episode => post('/api/linkkf/resolve', { episode }),
    linkkfSchedule: () => get('/api/linkkf/schedule'),
    linkkfSections: () => get('/api/linkkf/sections'),
    linkkfFilterTags: () => get('/api/linkkf/filter-tags'),
    linkkfFilter: req => post('/api/linkkf/filter', req),
    linkkfSearch: query => get('/api/linkkf/search', { query }),
    linkkfExtras: anime => post('/api/linkkf/extras', { anime }),
    linkkfRecordView: postId => post('/api/linkkf/record-view', { postId }),

    // Providers
    providerCatalog: (provider, query = '', offset = 0) => get('/api/provider/catalog', { provider, query, offset }),
    providerSeason: provider => get('/api/provider/season', { provider }),
    providerAiring: provider => get('/api/provider/airing', { provider }),
    providerDetail: anime => post('/api/provider/detail', { anime }),
    providerPlay: (episode, title) => post('/api/provider/play', { episode, title }),
    providerResolve: episode => post('/api/provider/resolve', { episode }),
    providerSubtitleTracks: episode => post('/api/provider/subtitle-tracks', { episode }),

    // Covers & Titles
    coverData: url => Promise.resolve(String(url || '')),
    resolveTitles: list => post('/api/titles/resolve', { list }),
    animeOverview: anime => post('/api/anime/overview', { anime }),
    titleVariants: query => get('/api/titles/variants', { query }),
    catalogKoreanSearch: (provider, query) => get('/api/catalog/search-korean', { provider, query }),
    catalogIndexState: () => Promise.resolve({ state: 'idle' }),
    activateCatalog: () => Promise.resolve({ state: 'idle' }),
    onCatalogIndexState: () => {},

    // AniSkip
    opEdSkip: req => post('/api/oped/get', req),
    clearOpEd: () => Promise.resolve(true),
    onOpEdStatus: () => {},

    // Subtitles
    findSubtitle: (source, title, episode, anime, options) =>
      post('/api/subtitle/find', { source, title, episode, anime, options }),
    anissiaMakers: (title, anime) =>
      get('/api/anissia/makers', { title, anime: JSON.stringify(anime || {}) }),
    remoteSubtitle: (url, referer) =>
      post('/api/subtitle/remote', { url, referer }),
    savedSubtitles: key => {
      try { return JSON.parse(localStorage.getItem(`sub_${key}`) || '[]'); } catch { return []; }
    },
    saveSubtitle: (key, entry) => {
      try {
        const list = JSON.parse(localStorage.getItem(`sub_${key}`) || '[]');
        list.push(entry);
        localStorage.setItem(`sub_${key}`, JSON.stringify(list));
      } catch {}
      return Promise.resolve(true);
    },
    removeSavedSubtitle: (key, id) => {
      try {
        let list = JSON.parse(localStorage.getItem(`sub_${key}`) || '[]');
        list = list.filter(item => item.id !== id);
        localStorage.setItem(`sub_${key}`, JSON.stringify(list));
      } catch {}
      return Promise.resolve(true);
    },
    subtitleCacheUsage: () => Promise.resolve({ count: 0, size: 0 }),
    cleanSubtitleCache: () => Promise.resolve({ count: 0, size: 0 }),
    clearSubtitleCache: () => Promise.resolve({ count: 0, size: 0 }),
    defaultSubtitleFont: () => Promise.resolve({
      name: 'AppleSDGothicNeo',
      family: 'Apple SD Gothic Neo, -apple-system, sans-serif'
    }),
    chooseFont: () => Promise.resolve(null),

    // Controls & Downloads
    setPlayerFullscreen: enabled => {
      const v = document.getElementById('video');
      if (enabled) {
        if (v && v.webkitEnterFullscreen) v.webkitEnterFullscreen();
        else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
      } else {
        if (document.exitFullscreen) document.exitFullscreen().catch(() => {});
      }
      return Promise.resolve(Boolean(enabled));
    },
    setWindowTheme: () => Promise.resolve(true),
    setWindowButtons: () => Promise.resolve(true),
    openExternal: url => { window.open(url, '_blank', 'noopener,noreferrer'); return Promise.resolve(true); },
    downloadMedia: (url, name) => {
      const a = document.createElement('a'); a.href = url; a.download = name || 'video.mp4';
      a.target = '_blank'; document.body.appendChild(a); a.click(); a.remove();
      return Promise.resolve(true);
    },
    onDownloadProgress: () => {},
    downloads: () => Promise.resolve([]),
    addDownload: () => Promise.resolve(false),
    cancelDownload: () => Promise.resolve(true),
    resumeDownload: () => Promise.resolve(true),
    removeDownload: () => Promise.resolve(true),
    playDownload: () => Promise.resolve(null),
    openDownloadsFolder: () => Promise.resolve(false),
    downloadRoot: () => Promise.resolve(''),
    chooseDownloadRoot: () => Promise.resolve(null),
    clearDownloads: () => Promise.resolve(true),
    onDownloadsChanged: () => {},

    // System Fallbacks
    mpvStatus: () => Promise.resolve({ available: false }),
    mpvPlay: () => Promise.reject(new Error('iOS에서는 웹 플레이어가 사용됩니다.')),
    chooseVideo: () => Promise.resolve(null),
    chooseSubtitle: () => Promise.resolve(null),
    chooseSubtitleDetails: () => Promise.resolve(null),
    updateState: () => Promise.resolve({ status: 'up-to-date' }),
    checkUpdate: () => Promise.resolve({ status: 'up-to-date' }),
    downloadUpdate: () => Promise.resolve(false),
    installUpdate: () => Promise.resolve(false),
    onUpdateState: () => {},
    updateNotes: () => Promise.resolve('아이폰 독립 실행 모드로 동작 중입니다.'),
    tmdbKey: () => Promise.resolve({ key: localStorage.getItem('tmdb_key') || '' }),
    setTmdbKey: key => { localStorage.setItem('tmdb_key', key || ''); return Promise.resolve({ key }); },
    geminiSettings: () => Promise.resolve({}),
    setGeminiSettings: () => Promise.resolve({}),
    translateSubtitle: () => Promise.reject(new Error('모바일에서는 자막 번역 준비 중입니다.')),
    jimakuList: () => Promise.resolve([]),
    jimakuDownload: () => Promise.reject(new Error('미지원')),
    installLocalModel: () => Promise.reject(new Error('미지원')),
    cancelLocalModelInstall: () => Promise.resolve(true),
    addLocalModelFile: () => Promise.resolve(null),
    removeLocalModel: () => Promise.resolve({}),
    onLocalModelProgress: () => {},
    cancelTranslation: () => Promise.resolve(true),
    jumpTranslation: () => Promise.resolve(true),
    prepareEpisodeSubtitle: () => Promise.resolve(false),
    onTranslateProgress: () => {}
  };

})();
