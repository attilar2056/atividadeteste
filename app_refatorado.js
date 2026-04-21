
(function () {
  'use strict';

  var DEFAULT_STREAM_URL = 'https://stream.zeno.fm/zh7jkchfce4uv';
  var VOZ_STREAM_URL = 'http://radioaovivo.senado.gov.br/canal2.mp3';
  var TIMEZONE = 'America/Sao_Paulo';
  var TIME_API = 'https://time.now/developer/api/timezone/' + TIMEZONE;
  var WEATHER_API = 'https://api.open-meteo.com/v1/forecast?latitude=-22.9068&longitude=-43.1729&current_weather=true&timezone=America/Sao_Paulo';
  var VOZ_STATE_URL = 'voz.json';
  var PROGRAMS_URL = 'programas/programacao.json';
  var VOLUME_STORAGE_KEY = 'radioatividade-volume';
  var THEME_STORAGE_KEY = 'radioatividade-theme';
  var WEEKDAY_ORDER = ['dom', 'seg', 'ter', 'quar', 'qui', 'sex', 'sab'];
  var VINYL_GIF_HTTPS_MAP = {
    '1.png': 'https://i.imgur.com/OCzg7r5.gif',
    '1.jpg': 'https://i.imgur.com/OCzg7r5.gif',
    'vinyl.png': 'https://i.imgur.com/OCzg7r5.gif',
    'vinyl.jpg': 'https://i.imgur.com/OCzg7r5.gif',
    '2.png': 'https://i.imgur.com/eapFIOl.gif',
    '2.jpg': 'https://i.imgur.com/eapFIOl.gif',
    '3.png': 'https://i.imgur.com/9sUzszo.gif',
    '3.jpg': 'https://i.imgur.com/9sUzszo.gif',
    '4.png': 'https://i.imgur.com/GDq5Heq.gif',
    '4.jpg': 'https://i.imgur.com/GDq5Heq.gif',
    '5.png': 'https://i.imgur.com/wZ8V4ol.gif',
    '5.jpg': 'https://i.imgur.com/wZ8V4ol.gif',
    '6.png': 'https://i.imgur.com/XsQceoL.gif',
    '6.jpg': 'https://i.imgur.com/XsQceoL.gif',
    '7.png': 'https://i.imgur.com/cPsyhan.gif',
    '7.jpg': 'https://i.imgur.com/cPsyhan.gif',
    '8.png': 'https://i.imgur.com/ZHL15sA.gif',
    '8.jpg': 'https://i.imgur.com/ZHL15sA.gif',
    '9.png': 'https://i.imgur.com/9E4GdKH.gif',
    '9.jpg': 'https://i.imgur.com/9E4GdKH.gif',
    '10.png': 'https://i.imgur.com/ZRKGta4.gif',
    '10.jpg': 'https://i.imgur.com/ZRKGta4.gif'
  };

  var app = {
    audio: null,
    playerHost: null,
    volumeHosts: [],
    vinylHosts: [],
    metadataHost: null,
    metadataState: null,
    photoHosts: [],
    weatherHosts: [],
    newsHosts: [],
    bannerHosts: [],
    programs: [],
    currentClock: null,
    currentProgram: null,
    currentTrack: null,
    voiceActive: false,
    visible: !document.hidden,
    focused: typeof document.hasFocus === 'function' ? !!document.hasFocus() : true,
    uiTickTimer: null,
    streamTickTimer: null,
    weatherTimer: null,
    timeFetchedAt: 0,
    clockBase: null,
    pendingTrackTimer: null,
    pendingTrackRevealAt: 0,
    eventSource: null,
    coverCache: Object.create(null),
    metadataRequestId: 0,
    lastMetadataRaw: '',
    audioAnalysis: {
      ctx: null,
      analyser: null,
      source: null,
      timeData: null,
      failed: false
    },
    vu: {
      host: null,
      canvas: null,
      ctx: null,
      raf: 0,
      running: false,
      lastFrameAt: 0,
      currentLevel: 0,
      targetLevel: 0,
      backgroundCanvas: null,
      backgroundImage: null
    },
    audioRecognition: {
      mode: 'js-wasm',
      triggerRaw: 'PODCAST DA RETRO #16',
      intervalMs: 10000,
      captureMs: 7000,
      acoustidClient: '',
      running: false,
      loopTimer: null,
      inFlight: false,
      lastRecognizedKey: '',
      lastRecognizedAt: 0,
      lastFingerprint: '',
      lastFingerprintAt: 0,
      lastError: '',
      chromaprintLoader: null,
      chromaprintApi: null,
      supported: false
    }
  };

  function qs(sel, root) { return (root || document).querySelector(sel); }
  function qsa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
  function safeText(v) { return String(v == null ? '' : v); }

  function stripAccents(value) {
    var text = String(value || '');
    if (typeof text.normalize === 'function') {
      return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    }
    return text;
  }

  function normalizeWeekdayToken(value) {
    var text = stripAccents(String(value || '')).toLowerCase().replace(/[^a-z]/g, '');
    var map = {
      dom: 'dom', domingo: 'dom', sun: 'dom', sunday: 'dom',
      seg: 'seg', segunda: 'seg', segundafeira: 'seg', mon: 'seg', monday: 'seg',
      ter: 'ter', terca: 'ter', tercafeira: 'ter', tue: 'ter', tuesday: 'ter',
      quar: 'quar', quarta: 'quar', quartafeira: 'quar', wed: 'quar', wednesday: 'quar',
      qui: 'qui', quinta: 'qui', quintafeira: 'qui', thu: 'qui', thursday: 'qui',
      sex: 'sex', sexta: 'sex', sextafeira: 'sex', fri: 'sex', friday: 'sex',
      sab: 'sab', sabado: 'sab', sat: 'sab', saturday: 'sab'
    };
    return map[text] || '';
  }

  function normalizeWeekdays(value) {
    var source = Array.isArray(value) ? value : String(value || '').split(/[\s,;|]+/);
    var normalized = [];
    source.forEach(function (part) {
      var token = normalizeWeekdayToken(part);
      if (token && normalized.indexOf(token) === -1) normalized.push(token);
    });
    return normalized;
  }

  function timeToMinutes(hhmm) {
    var m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    return Number(m[1]) * 60 + Number(m[2]);
  }

  function parseProgramsPayload(data) {
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.programas)) return data.programas;
    if (data && Array.isArray(data.programs)) return data.programs;
    return [];
  }

  function cloneScheduleItem(item) {
    item = item || {};
    var startMinutes = timeToMinutes(item.start || item.inicio || '');
    var endMinutes = timeToMinutes(item.end || item.fim || '');
    return {
      id: item.id || '',
      title: item.title || item.programa || '',
      host: item.host || item.locutor || '',
      start: item.start || item.inicio || '',
      end: item.end || item.fim || '',
      image: item.image || item.imagem || '',
      vinyl: item.vinyl || item.vinylImage || item.disco || '',
      diaDaSemana: normalizeWeekdays(item.diaDaSemana || item.dayOfWeek || item.days || item.weekdays || item.dias || []),
      startMinutes: startMinutes,
      endMinutes: endMinutes,
      photoX: Number(item.photoX || 0),
      photoY: Number(item.photoY || 0),
      photoZoom: Math.max(0.1, Number(item.photoZoom || 1) || 1)
    };
  }

  function readBooleanLike(value) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    var text = String(value || '').trim().toLowerCase();
    if (text === 'true' || text === '1' || text === 'on' || text === 'yes' || text === 'sim') return true;
    if (text === 'false' || text === '0' || text === 'off' || text === 'no' || text === 'nao' || text === 'não') return false;
    return null;
  }

  function readVoiceStateFromPayload(payload) {
    var direct = readBooleanLike(payload);
    if (direct !== null) return direct;
    if (!payload || typeof payload !== 'object') return false;
    var keys = ['active', 'ativo', 'enabled', 'voice', 'voz', 'state', 'status', 'value'];
    for (var i = 0; i < keys.length; i += 1) {
      if (!Object.prototype.hasOwnProperty.call(payload, keys[i])) continue;
      var candidate = readBooleanLike(payload[keys[i]]);
      if (candidate !== null) return candidate;
      if (payload[keys[i]] && typeof payload[keys[i]] === 'object') {
        var nested = readVoiceStateFromPayload(payload[keys[i]]);
        if (nested !== null) return nested;
      }
    }
    return false;
  }

  function isUiActive() {
    return !document.hidden && app.focused !== false;
  }

  function isRemoteUrl(url) {
    return /^(?:https?:)?\/\//i.test(String(url || '').trim());
  }

  function buildNoCacheUrl(url, options) {
    var safe = String(url || '').trim();
    if (!safe) return safe;
    var opts = options || {};
    var shouldBust = opts.cacheBust;
    if (typeof shouldBust !== 'boolean') shouldBust = !isRemoteUrl(safe);
    if (!shouldBust) return safe;
    return safe + (safe.indexOf('?') === -1 ? '?' : '&') + '_=' + Date.now();
  }

  function getVinylGifSource(staticSrc) {
    var safeStaticSrc = String(staticSrc || '').trim();
    if (!safeStaticSrc) return '';
    var fileName = safeStaticSrc.split('?')[0].split('/').pop().toLowerCase();
    if (VINYL_GIF_HTTPS_MAP[fileName]) return VINYL_GIF_HTTPS_MAP[fileName];
    if (/\.gif(?:$|\?)/i.test(safeStaticSrc)) return safeStaticSrc;
    if (/\.jpg(?:$|\?)/i.test(safeStaticSrc)) return safeStaticSrc.replace(/\.jpg(?=$|\?)/i, '.gif');
    if (/\.png(?:$|\?)/i.test(safeStaticSrc)) return safeStaticSrc.replace(/\.png(?=$|\?)/i, '.gif');
    return safeStaticSrc;
  }

  function setFreshImageSource(img, src, options) {
    if (!img || !src) return;
    var opts = options || {};
    var safeSrc = String(src).trim();
    if (!safeSrc) return;

    var cacheKey = safeSrc + '|' + (opts.cacheBust === false ? '0' : '1');
    var currentBase = img.getAttribute('data-base-src') || '';
    if (!opts.force && currentBase === cacheKey) return;
    img.setAttribute('data-base-src', cacheKey);

    var fallback = String(opts.fallback || '').trim();
    var finalSrc = buildNoCacheUrl(safeSrc, opts);
    var remote = isRemoteUrl(safeSrc);

    if (remote) {
      var probe = new Image();
      probe.decoding = 'async';
      try { probe.referrerPolicy = 'no-referrer'; } catch (_error) {}
      probe.onload = function () {
        try { img.referrerPolicy = 'no-referrer'; } catch (_error2) {}
        img.src = finalSrc;
      };
      probe.onerror = function () {
        if (fallback && fallback !== safeSrc) {
          setFreshImageSource(img, fallback, { force: true });
        }
      };
      probe.src = finalSrc;
      return;
    }

    img.src = finalSrc;
  }

  function readStoredVolume(defaultValue) {
    try {
      var raw = localStorage.getItem(VOLUME_STORAGE_KEY);
      if (raw === null || raw === '') return Number(defaultValue || 1);
      var parsed = Number(raw);
      if (!Number.isFinite(parsed)) return Number(defaultValue || 1);
      return clamp(parsed, 0, 1);
    } catch (_error) {
      return Number(defaultValue || 1);
    }
  }

  function persistVolume(value) {
    try { localStorage.setItem(VOLUME_STORAGE_KEY, String(clamp(Number(value || 0), 0, 1))); } catch (_error) {}
  }

  function fetchJson(url) {
    return fetch(buildNoCacheUrl(url), { cache: 'no-store' }).then(function (res) {
      if (!res.ok) throw new Error('Falha ao buscar ' + url);
      return res.json();
    });
  }

  function parseClockPayload(data) {
    if (!data) return null;
    var iso = data.datetime || data.dateTime || data.local_datetime || data.localDateTime || data.iso || data.currentDateTime || '';
    var weekdayNum = Number(data.day_of_week || data.dayOfWeek || NaN);
    var m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
    if (!m) return null;
    var year = Number(m[1]);
    var month = Number(m[2]);
    var day = Number(m[3]);
    var hour = Number(m[4]);
    var minute = Number(m[5]);
    var second = Number(m[6] || 0);
    var baseUtc = Date.UTC(year, month - 1, day, hour, minute, second, 0);
    var weekday = Number.isFinite(weekdayNum) && weekdayNum >= 0 && weekdayNum <= 6
      ? WEEKDAY_ORDER[weekdayNum]
      : WEEKDAY_ORDER[new Date(baseUtc).getUTCDay()];
    return {
      isoLocal: year + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0') + 'T' + String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0') + ':' + String(second).padStart(2, '0'),
      pseudoUtcMs: baseUtc,
      weekday: weekday,
      minutes: (hour * 60) + minute,
      year: year,
      month: month,
      day: day,
      hour: hour,
      minute: minute,
      second: second,
      timezone: data.timezone || TIMEZONE
    };
  }

  function fallbackClockContext() {
    var formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: TIMEZONE,
      year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    });
    var parts = formatter.formatToParts(new Date());
    var map = {};
    parts.forEach(function (part) { if (part && part.type) map[part.type] = part.value; });
    var weekdayMap = { sun: 'dom', mon: 'seg', tue: 'ter', wed: 'quar', thu: 'qui', fri: 'sex', sat: 'sab' };
    var weekday = weekdayMap[String(map.weekday || '').toLowerCase()] || 'seg';
    var year = Number(map.year || 0);
    var month = Number(map.month || 0);
    var day = Number(map.day || 0);
    var hour = Number(map.hour || 0);
    var minute = Number(map.minute || 0);
    var second = Number(map.second || 0);
    return {
      isoLocal: year + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0') + 'T' + String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0') + ':' + String(second).padStart(2, '0'),
      pseudoUtcMs: Date.UTC(year, month - 1, day, hour, minute, second, 0),
      weekday: weekday,
      minutes: (hour * 60) + minute,
      year: year, month: month, day: day, hour: hour, minute: minute, second: second,
      timezone: TIMEZONE
    };
  }

  function getClockContext() {
    if (!app.clockBase || !app.timeFetchedAt) return fallbackClockContext();
    var elapsedMs = Date.now() - app.timeFetchedAt;
    var date = new Date(app.clockBase.pseudoUtcMs + Math.max(0, elapsedMs));
    return {
      isoLocal: date.getUTCFullYear() + '-' + String(date.getUTCMonth() + 1).padStart(2, '0') + '-' + String(date.getUTCDate()).padStart(2, '0') + 'T' + String(date.getUTCHours()).padStart(2, '0') + ':' + String(date.getUTCMinutes()).padStart(2, '0') + ':' + String(date.getUTCSeconds()).padStart(2, '0'),
      pseudoUtcMs: date.getTime(),
      weekday: WEEKDAY_ORDER[date.getUTCDay()],
      minutes: (date.getUTCHours() * 60) + date.getUTCMinutes(),
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
      hour: date.getUTCHours(),
      minute: date.getUTCMinutes(),
      second: date.getUTCSeconds(),
      timezone: TIMEZONE
    };
  }

  function fetchClock() {
    return fetchJson(TIME_API).then(function (data) {
      var parsed = parseClockPayload(data);
      if (parsed) {
        app.clockBase = parsed;
        app.timeFetchedAt = Date.now();
        app.currentClock = getClockContext();
      }
      return app.currentClock || fallbackClockContext();
    }).catch(function () {
      app.currentClock = fallbackClockContext();
      return app.currentClock;
    });
  }

  function loadPrograms() {
    return fetchJson(PROGRAMS_URL).then(function (data) {
      app.programs = parseProgramsPayload(data).map(cloneScheduleItem).filter(Boolean);
      return app.programs;
    }).catch(function () {
      app.programs = [];
      return app.programs;
    });
  }

  function findProgram(clock) {
    var ctx = clock || getClockContext();
    var weekday = ctx.weekday;
    var minutes = ctx.minutes;
    var current = null;
    app.programs.forEach(function (item) {
      if (!item || !item.start || !item.end) return;
      var days = Array.isArray(item.diaDaSemana) ? item.diaDaSemana : [];
      if (days.length && days.indexOf(weekday) === -1) return;
      var startMinutes = Number(item.startMinutes);
      var endMinutes = Number(item.endMinutes);
      if (!Number.isFinite(startMinutes) || !Number.isFinite(endMinutes)) return;
      var currentMinutes = minutes;
      var endAdjusted = endMinutes;
      if (endAdjusted <= startMinutes) {
        endAdjusted += 24 * 60;
        if (currentMinutes < startMinutes) currentMinutes += 24 * 60;
      }
      if (currentMinutes >= startMinutes && currentMinutes < endAdjusted) current = item;
    });
    return current;
  }

  function isVoiceWeekday(clock) {
    var wd = (clock || getClockContext()).weekday;
    return wd === 'seg' || wd === 'ter' || wd === 'quar' || wd === 'qui' || wd === 'sex';
  }

  function isVoiceWindow(clock) {
    var ctx = clock || getClockContext();
    return isVoiceWeekday(ctx) && ctx.minutes >= (19 * 60) && ctx.minutes <= ((19 * 60) + 59);
  }

  function fetchVoiceState() {
    if (!isVoiceWindow(getClockContext())) {
      app.voiceActive = false;
      return Promise.resolve(false);
    }
    return fetch(buildNoCacheUrl(VOZ_STATE_URL), { cache: 'no-store' }).then(function (res) {
      if (!res.ok) throw new Error('voz.json');
      return res.text();
    }).then(function (text) {
      var parsed = text;
      try { parsed = JSON.parse(text); } catch (_error) {}
      app.voiceActive = !!readVoiceStateFromPayload(parsed);
      return app.voiceActive;
    }).catch(function () {
      return app.voiceActive;
    });
  }

  function getDesiredStreamUrl(clock) {
    return (isVoiceWindow(clock) && app.voiceActive) ? VOZ_STREAM_URL : DEFAULT_STREAM_URL;
  }

  function updateSliderAppearance(slider) {
    if (!slider) return;
    var min = Number(slider.min || 0);
    var max = Number(slider.max || 100);
    var value = Number(slider.value || 0);
    var range = max - min || 1;
    var percent = clamp(((value - min) / range) * 100, 0, 100);
    slider.style.setProperty('--volume-percent', percent.toFixed(2) + '%');
  }

  function syncPlayerUi() {
    if (!app.audio || !app.playerHost) return;
    var audio = app.audio;
    var wantPlay = !audio.paused && !audio.ended;
    var loading = wantPlay && (audio.readyState < 3 || audio.networkState === HTMLMediaElement.NETWORK_LOADING || audio.getAttribute('data-loading') === '1');
    var muted = audio.muted || Number(audio.volume || 0) === 0;
    var liveActive = wantPlay && !loading;
    var volumeValue = Math.round(clamp(Number(audio.volume || 0), 0, 1) * 100);
    var hosts = [app.playerHost].concat(app.volumeHosts).concat(app.vinylHosts);
    hosts.forEach(function (host) {
      if (!host) return;
      host.classList.toggle('is-playing', wantPlay);
      host.classList.toggle('is-loading', loading);
      host.classList.toggle('is-muted', muted);
      host.classList.toggle('is-live-active', liveActive);
      var slider = host.querySelector('.re-volume-slider');
      if (slider) {
        slider.value = String(volumeValue);
        updateSliderAppearance(slider);
      }
      var muteBtn = host.querySelector('.re-mute-btn');
      if (muteBtn) muteBtn.textContent = muted ? '🔇' : '🔊';
      var live = host.querySelector('.re-live-badge');
      if (live) {
        var text = live.querySelector('span:last-child');
        live.hidden = !(loading || liveActive);
        if (text) text.textContent = loading ? 'CARREGANDO AGUARDE' : 'AO VIVO';
      }
    });
    renderVinylState();
    syncVuState();
  }

  function switchStreamIfNeeded() {
    if (!app.audio) return;
    var desired = getDesiredStreamUrl(getClockContext());
    var current = String(app.audio.getAttribute('data-current-stream') || app.audio.src || '').trim();
    if (current && current.indexOf(desired) !== -1) return;
    var wasPlaying = !app.audio.paused && !app.audio.ended;
    app.audio.setAttribute('data-loading', '1');
    app.audio.setAttribute('data-current-stream', desired);
    app.audio.src = desired;
    try { app.audio.load(); } catch (_error) {}
    if (wasPlaying) {
      var p = app.audio.play();
      if (p && typeof p.catch === 'function') p.catch(function () {});
    }
    syncPlayerUi();
  }

  function resolveProgramVinyl(program) {
    var src = program && program.vinyl ? String(program.vinyl) : 'assets/base/vinyl.jpg';
    if (/\.png$/i.test(src)) src = src.replace(/\.png$/i, '.jpg');
    return {
      staticSrc: src,
      gifSrc: getVinylGifSource(src)
    };
  }

  function renderVinylState() {
    var isPlaying = app.audio && !app.audio.paused && !app.audio.ended && !app.audio.muted && Number(app.audio.volume || 0) > 0;
    var activeVisual = isUiActive();
    var program = app.currentProgram || findProgram(getClockContext());
    var vinyl = resolveProgramVinyl(program);
    app.vinylHosts.forEach(function (host) {
      var img = host.querySelector('.re-vinyl-image');
      if (!img) return;
      var desired = isPlaying && activeVisual ? (vinyl.gifSrc || vinyl.staticSrc) : vinyl.staticSrc;
      setFreshImageSource(img, desired);
      img.setAttribute('data-static-src', vinyl.staticSrc);
      img.setAttribute('data-gif-src', vinyl.gifSrc);
      host.classList.remove('is-vinyl-spin-active');
    });
  }

  function cleanTitleForSearch(artist, song) {
    var q = ((artist || '') + ' ' + (song || '')).trim();
    if (!q) return '';
    q = q.replace(/^[0-9]{1,3}[\s.\-_]+/, '');
    q = q.replace(/\s*-\s*[0-9]{2,3}\s*bpm/gi, '');
    q = q.replace(/\s*[\(\[][^^\)\]]*[\)\]]/g, '');
    q = q.replace(/[_]+/g, ' ');
    q = q.replace(/[^\w\sÀ-ÿ]/gi, ' ').replace(/\s+/g, ' ').trim();
    return q;
  }

  function normalizeComparable(value) {
    return stripAccents(value)
      .toLowerCase()
      .replace(/[_]+/g, ' ')
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function compactComparable(value) {
    return normalizeComparable(value).replace(/\s+/g, '');
  }

  function levenshtein(a, b) {
    var aa = String(a || '');
    var bb = String(b || '');
    var rows = aa.length + 1;
    var cols = bb.length + 1;
    var dp = [];
    var i;
    var j;
    for (i = 0; i < rows; i += 1) {
      dp[i] = new Array(cols).fill(0);
      dp[i][0] = i;
    }
    for (j = 0; j < cols; j += 1) dp[0][j] = j;
    for (i = 1; i < rows; i += 1) {
      for (j = 1; j < cols; j += 1) {
        var cost = aa[i - 1] === bb[j - 1] ? 0 : 1;
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,
          dp[i][j - 1] + 1,
          dp[i - 1][j - 1] + cost
        );
      }
    }
    return dp[rows - 1][cols - 1];
  }

  function similarityScore(a, b) {
    var na = normalizeComparable(a);
    var nb = normalizeComparable(b);
    if (!na || !nb) return 0;
    if (na === nb) return 1;

    var ca = compactComparable(a);
    var cb = compactComparable(b);
    if (ca && cb && ca === cb) return 0.99;
    if (ca && cb && (ca.indexOf(cb) !== -1 || cb.indexOf(ca) !== -1)) return 0.93;

    var dist = levenshtein(ca || na, cb || nb);
    var maxLen = Math.max((ca || na).length, (cb || nb).length, 1);
    var editScore = Math.max(0, 1 - (dist / maxLen));

    var tokensA = na.split(' ').filter(Boolean);
    var tokensB = nb.split(' ').filter(Boolean);
    var setB = Object.create(null);
    var common = 0;
    tokensB.forEach(function (token) { setB[token] = true; });
    tokensA.forEach(function (token) {
      if (setB[token]) common += 1;
    });
    var tokenScore = common / Math.max(tokensA.length, tokensB.length, 1);
    return Math.max(editScore, tokenScore * 0.95);
  }

  function cleanupMetadataChunk(value) {
    var s = String(value || '');
    s = s.replace(/\.[a-z0-9]{2,4}$/i, '');
    s = s.replace(/[_]+/g, ' ');
    s = s.replace(/[–—]+/g, '-');
    s = s.replace(/\s*-\s*/g, ' - ');
    s = s.replace(/^[0-9]{1,3}[\s.\-_]+/, '');
    s = s.replace(/\s*-\s*[0-9]{2,3}\s*bpm/gi, '');
    s = s.replace(/\s*[\(\[][^^\)\]]*[\)\]]/g, '');
    s = s.replace(/\s+/g, ' ').trim();
    s = s.replace(/^[-\s]+|[-\s]+$/g, '').trim();
    return s;
  }

  function splitRawMetadataTitle(rawTitle) {
    var cleaned = cleanupMetadataChunk(rawTitle);
    if (!cleaned) return { raw: '', first: '', second: '', hasSeparator: false, parts: [] };

    var parts = cleaned.split(/\s-\s/).map(function (part) {
      return cleanupMetadataChunk(part);
    }).filter(Boolean);

    if (parts.length >= 2) {
      return {
        raw: cleaned,
        first: parts[0],
        second: parts.slice(1).join(' - '),
        hasSeparator: true,
        parts: parts
      };
    }

    return {
      raw: cleaned,
      first: cleaned,
      second: '',
      hasSeparator: false,
      parts: parts
    };
  }

  function isNumericMetadataSegment(value) {
    var compact = cleanupMetadataChunk(value).replace(/\s+/g, '');
    return /^[0-9]{1,3}$/.test(compact);
  }

  function isCollectionMetadataSegment(value) {
    var normalized = normalizeComparable(value);
    if (!normalized) return false;
    return /(cd|disc|disk|disco|vol|volume|faixa|track)/.test(normalized);
  }

  function chooseArtistSongFromParts(parts) {
    var cleanParts = (parts || []).map(function (part) {
      return cleanupMetadataChunk(part);
    }).filter(Boolean);

    if (cleanParts.length === 3) {
      var first = cleanParts[0];
      var middle = cleanParts[1];
      var last = cleanParts[2];
      if (isNumericMetadataSegment(middle)) return { artist: first, song: last };
      if (isNumericMetadataSegment(first)) return { artist: middle, song: last };
      if (isNumericMetadataSegment(last)) return { artist: first, song: middle };
    }

    if (cleanParts.length >= 4) {
      return { artist: cleanParts[cleanParts.length - 2], song: cleanParts[cleanParts.length - 1] };
    }

    if (cleanParts.length >= 3) {
      var prefix = cleanParts.slice(0, -2);
      var hasPrefixNoise = prefix.some(function (part) {
        return isNumericMetadataSegment(part) || isCollectionMetadataSegment(part);
      }) || isNumericMetadataSegment(cleanParts[cleanParts.length - 2]);
      if (hasPrefixNoise) {
        return { artist: cleanParts[cleanParts.length - 2], song: cleanParts[cleanParts.length - 1] };
      }
    }

    return null;
  }

  function countWords(value) {
    return cleanupMetadataChunk(value).split(' ').filter(Boolean).length;
  }

  function guessArtistSong(first, second) {
    var a = cleanupMetadataChunk(first);
    var b = cleanupMetadataChunk(second);
    if (!b) return { artist: '', song: a };

    var aCount = countWords(a);
    var bCount = countWords(b);

    if (aCount <= 2 && bCount >= 3) return { artist: a, song: b };
    if (bCount <= 3 && aCount >= 4) return { artist: b, song: a };
    if (aCount === 1 && bCount >= 3) return { artist: a, song: b };
    if (bCount === 1 && aCount >= 3) return { artist: b, song: a };
    return { artist: a, song: b };
  }

  function parseRawTitle(rawTitle) {
    var pieces = splitRawMetadataTitle(rawTitle);
    if (!pieces.hasSeparator) {
      return {
        rawTitle: cleanupMetadataChunk(pieces.raw),
        raw: pieces.raw,
        song: cleanupMetadataChunk(pieces.raw),
        artist: '',
        first: pieces.first,
        second: pieces.second,
        parts: pieces.parts || []
      };
    }

    var chosenFromParts = chooseArtistSongFromParts(pieces.parts || []);
    var guess = chosenFromParts || guessArtistSong(pieces.first, pieces.second);
    return {
      rawTitle: pieces.raw,
      raw: pieces.raw,
      song: cleanupMetadataChunk(guess.song),
      artist: cleanupMetadataChunk(guess.artist),
      first: cleanupMetadataChunk(guess.artist),
      second: cleanupMetadataChunk(guess.song),
      parts: pieces.parts || []
    };
  }

  function getAudioRecognitionConfig() {
    var rec = app.audioRecognition || {};
    var host = app.metadataHost;
    rec.mode = safeText(host && host.getAttribute('data-audio-recognition-mode') || rec.mode || 'js').trim().toLowerCase() || 'js';
    rec.triggerRaw = safeText(host && host.getAttribute('data-audio-recognition-trigger') || rec.triggerRaw || 'PODCAST DA RETRO #16').trim() || 'PODCAST DA RETRO #16';
    rec.intervalMs = Math.max(5000, Number(host && host.getAttribute('data-audio-recognition-interval') || rec.intervalMs || 10000) || 10000);
    rec.captureMs = Math.max(5000, Math.min(12000, Number(host && host.getAttribute('data-audio-recognition-capture-ms') || rec.captureMs || 7000) || 7000));
    rec.acoustidClient = safeText(host && (host.getAttribute('data-audio-recognition-acoustid-client') || host.getAttribute('data-audio-recognition-client')) || rec.acoustidClient || '').trim();
    rec.wasmUrl = safeText(host && host.getAttribute('data-audio-recognition-wasm-url') || rec.wasmUrl || 'assets/vendor/chromaprint/chromaprint_wasm.js').trim();
    rec.jsUrl = safeText(host && host.getAttribute('data-audio-recognition-js-url') || rec.jsUrl || '').trim();
    rec.supported = !!(app.audio && (app.audio.captureStream || app.audio.mozCaptureStream) && typeof MediaRecorder !== 'undefined');
    app.audioRecognition = rec;
    return rec;
  }

  function normalizeRecognitionKey(song, artist) {
    return compactComparable(cleanupMetadataChunk(song || '')) + '|' + compactComparable(cleanupMetadataChunk(artist || ''));
  }

  function shouldUseAudioRecognition(rawTitle) {
    var rec = getAudioRecognitionConfig();
    var raw = safeText(rawTitle).trim();
    return !!(rec && raw && raw.toUpperCase() === safeText(rec.triggerRaw).trim().toUpperCase());
  }

  function clearAudioRecognitionLoop() {
    var rec = getAudioRecognitionConfig();
    if (rec.loopTimer) {
      clearInterval(rec.loopTimer);
      rec.loopTimer = null;
    }
  }

  function stopAudioRecognitionLoop() {
    var rec = getAudioRecognitionConfig();
    rec.running = false;
    rec.inFlight = false;
    clearAudioRecognitionLoop();
  }

  function ensureRemoteScript(url) {
    var safeUrl = safeText(url).trim();
    if (!safeUrl) return Promise.reject(new Error('script url ausente'));
    return new Promise(function (resolve, reject) {
      var existing = document.querySelector('script[data-re-ext-src="' + safeUrl.replace(/"/g, '&quot;') + '"]');
      if (existing && existing.getAttribute('data-loaded') === '1') {
        resolve(existing);
        return;
      }
      if (existing) {
        existing.addEventListener('load', function () { resolve(existing); }, { once: true });
        existing.addEventListener('error', function () { reject(new Error('falha ao carregar script')); }, { once: true });
        return;
      }
      var script = document.createElement('script');
      script.async = true;
      script.src = safeUrl;
      script.setAttribute('data-re-ext-src', safeUrl);
      script.onload = function () {
        script.setAttribute('data-loaded', '1');
        resolve(script);
      };
      script.onerror = function () { reject(new Error('falha ao carregar script')); };
      document.head.appendChild(script);
    });
  }

  function loadChromaprintApi() {
    var rec = getAudioRecognitionConfig();
    if (rec.chromaprintApi) return Promise.resolve(rec.chromaprintApi);
    if (rec.chromaprintLoader) return rec.chromaprintLoader;

    function finalize(api) {
      if (!api) throw new Error('Chromaprint indisponível');
      rec.chromaprintApi = api;
      return api;
    }

    function tryWasmModule() {
      if (!rec.wasmUrl || rec.mode === 'js') return Promise.reject(new Error('wasm desativado'));
      return import(rec.wasmUrl).then(function (mod) {
        var api = mod && (mod.default || mod.chromaprint || mod);
        if (typeof api === 'function') {
          return Promise.resolve(api()).then(function (resolved) {
            return resolved || api;
          }).catch(function () {
            return api;
          });
        }
        return api;
      }).then(finalize);
    }

    function tryJsFallback() {
      return ensureRemoteScript(rec.jsUrl).then(function () {
        return finalize(window.chromaprint || window.Chromaprint || null);
      });
    }

    rec.chromaprintLoader = tryWasmModule().catch(function () {
      return tryJsFallback();
    }).finally(function () {
      rec.chromaprintLoader = null;
    });

    return rec.chromaprintLoader;
  }

  function capturePlayerAudioBlob(durationMs) {
    return new Promise(function (resolve, reject) {
      var audio = app.audio;
      if (!audio) {
        reject(new Error('player ausente'));
        return;
      }
      var captureFn = audio.captureStream || audio.mozCaptureStream;
      if (typeof captureFn !== 'function') {
        reject(new Error('captureStream indisponível'));
        return;
      }
      if (audio.paused || audio.ended) {
        reject(new Error('áudio parado'));
        return;
      }

      var sourceStream;
      try {
        sourceStream = captureFn.call(audio);
      } catch (error) {
        reject(error || new Error('falha ao capturar stream'));
        return;
      }
      if (!sourceStream) {
        reject(new Error('stream de captura vazio'));
        return;
      }

      var tracks = sourceStream.getAudioTracks ? sourceStream.getAudioTracks() : [];
      if (!tracks.length) {
        reject(new Error('nenhuma trilha de áudio na captura'));
        return;
      }

      var mimeTypes = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/ogg;codecs=opus',
        'audio/ogg'
      ];
      var options = {};
      for (var i = 0; i < mimeTypes.length; i += 1) {
        if (typeof MediaRecorder.isTypeSupported === 'function' && MediaRecorder.isTypeSupported(mimeTypes[i])) {
          options.mimeType = mimeTypes[i];
          break;
        }
      }

      var chunks = [];
      var stream = new MediaStream(tracks);
      var recorder;
      try {
        recorder = new MediaRecorder(stream, options);
      } catch (error2) {
        reject(error2 || new Error('MediaRecorder indisponível'));
        return;
      }

      var finished = false;
      function cleanup() {
        if (finished) return;
        finished = true;
        try {
          stream.getTracks().forEach(function (track) {
            try { track.stop(); } catch (_error) {}
          });
        } catch (_error2) {}
      }

      recorder.ondataavailable = function (event) {
        if (event && event.data && event.data.size > 0) chunks.push(event.data);
      };
      recorder.onerror = function (event) {
        cleanup();
        reject(event && event.error ? event.error : new Error('erro ao gravar áudio'));
      };
      recorder.onstop = function () {
        var blob = new Blob(chunks, { type: recorder.mimeType || options.mimeType || 'audio/webm' });
        cleanup();
        if (!blob.size) {
          reject(new Error('blob de áudio vazio'));
          return;
        }
        resolve(blob);
      };

      try {
        recorder.start();
      } catch (error3) {
        cleanup();
        reject(error3 || new Error('falha ao iniciar gravação'));
        return;
      }

      setTimeout(function () {
        try {
          if (recorder.state !== 'inactive') recorder.stop();
        } catch (_error4) {
          cleanup();
          reject(new Error('falha ao encerrar gravação'));
        }
      }, Math.max(3000, Number(durationMs || 7000) || 7000));
    });
  }

  function decodeRecognitionBlob(blob) {
    var AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return Promise.reject(new Error('AudioContext indisponível'));
    if (!app.audioRecognition.decodeCtx) {
      try {
        app.audioRecognition.decodeCtx = new AudioCtx();
      } catch (error) {
        return Promise.reject(error || new Error('falha ao criar contexto de decode'));
      }
    }
    var ctx = app.audioRecognition.decodeCtx;
    if (ctx && ctx.state === 'suspended' && typeof ctx.resume === 'function') {
      try { ctx.resume(); } catch (_error) {}
    }
    return blob.arrayBuffer().then(function (buffer) {
      return new Promise(function (resolve, reject) {
        var copy = buffer.slice(0);
        var result;
        try {
          result = ctx.decodeAudioData(copy, function (audioBuffer) { resolve(audioBuffer); }, function (error) { reject(error || new Error('falha ao decodificar áudio')); });
        } catch (error) {
          reject(error || new Error('falha ao decodificar áudio'));
          return;
        }
        if (result && typeof result.then === 'function') {
          result.then(resolve).catch(reject);
        }
      });
    });
  }

  function buildFingerprintInput(audioBuffer) {
    if (!audioBuffer) return null;
    var channels = [];
    var numberOfChannels = Math.max(1, Number(audioBuffer.numberOfChannels || 1) || 1);
    for (var i = 0; i < numberOfChannels; i += 1) {
      channels.push(audioBuffer.getChannelData(i));
    }
    return {
      audioBuffer: audioBuffer,
      sampleRate: Number(audioBuffer.sampleRate || 44100) || 44100,
      numberOfChannels: numberOfChannels,
      duration: Number(audioBuffer.duration || 0) || 0,
      length: Number(audioBuffer.length || (channels[0] ? channels[0].length : 0)) || 0,
      channelData: channels,
      getChannelData: function (index) { return audioBuffer.getChannelData(index); }
    };
  }

  function normalizeFingerprintResult(result, fallbackDuration) {
    if (!result) return null;
    if (typeof result === 'string') {
      return { fingerprint: result, duration: Math.max(1, Math.round(Number(fallbackDuration || 0) || 0)) };
    }
    if (typeof result === 'object') {
      var fp = safeText(result.fingerprint || result.code || result.value || '').trim();
      var duration = Math.max(1, Math.round(Number(result.duration || fallbackDuration || 0) || 0));
      if (fp) return { fingerprint: fp, duration: duration };
    }
    return null;
  }

  function callChromaprintApi(api, audioBuffer) {
    var input = buildFingerprintInput(audioBuffer);
    var fallbackDuration = input ? input.duration : 0;
    if (!api || !input) return Promise.reject(new Error('entrada de fingerprint inválida'));

    function wrapCallbackCall(fn, args) {
      return new Promise(function (resolve, reject) {
        var done = false;
        function finish(value) {
          if (done) return;
          done = true;
          var normalized = normalizeFingerprintResult(value, fallbackDuration);
          if (normalized) {
            resolve(normalized);
          } else {
            reject(new Error('fingerprint vazio'));
          }
        }
        function fail(error) {
          if (done) return;
          done = true;
          reject(error || new Error('falha ao calcular fingerprint'));
        }
        var withCb = args.slice();
        withCb.push(function (value) { finish(value); });
        try {
          var response = fn.apply(api, withCb);
          if (response && typeof response.then === 'function') {
            response.then(finish).catch(fail);
          } else {
            var normalized = normalizeFingerprintResult(response, fallbackDuration);
            if (normalized) finish(normalized);
          }
        } catch (error) {
          fail(error);
        }
        setTimeout(function () {
          if (!done) fail(new Error('timeout ao calcular fingerprint'));
        }, 20000);
      });
    }

    var candidates = [];
    if (api && typeof api.calculateFingerprint === 'function') {
      candidates.push(function () { return wrapCallbackCall(api.calculateFingerprint, [audioBuffer]); });
      candidates.push(function () { return wrapCallbackCall(api.calculateFingerprint, [input]); });
      candidates.push(function () { return wrapCallbackCall(api.calculateFingerprint, [audioBuffer, {}]); });
      candidates.push(function () { return wrapCallbackCall(api.calculateFingerprint, [input, {}]); });
    }
    if (api && typeof api.fingerprint === 'function') {
      candidates.push(function () { return wrapCallbackCall(api.fingerprint, [audioBuffer]); });
      candidates.push(function () { return wrapCallbackCall(api.fingerprint, [input]); });
      candidates.push(function () { return wrapCallbackCall(api.fingerprint, [input.channelData[0], input.sampleRate]); });
    }

    var index = 0;
    function next() {
      if (index >= candidates.length) return Promise.reject(new Error('API de fingerprint sem método compatível'));
      var candidate = candidates[index++];
      return Promise.resolve().then(candidate).catch(function () {
        return next();
      });
    }
    return next();
  }

  function createAudioRecognitionStatusCard(message) {
    var card = currentProgramCard();
    card.displayTitle = safeText(card.displayTitle || 'ATIVIDADE FM');
    card.subtitle = safeText(message || '').trim();
    return card;
  }

  function lookupAcoustidFingerprint(fingerprint, durationSeconds) {
    var rec = getAudioRecognitionConfig();
    if (!rec.acoustidClient) return Promise.reject(new Error('client do AcoustID ausente'));
    var params = new URLSearchParams();
    params.set('client', rec.acoustidClient);
    params.set('format', 'json');
    params.set('meta', 'recordings+releasegroups+compress');
    params.set('duration', String(Math.max(1, Math.round(Number(durationSeconds || 0) || 0))));
    params.set('fingerprint', fingerprint);
    return fetch('https://api.acoustid.org/v2/lookup?' + params.toString(), {
      method: 'GET',
      mode: 'cors',
      cache: 'no-store'
    }).then(function (response) {
      if (!response || !response.ok) throw new Error('falha ao consultar AcoustID');
      return response.json();
    });
  }

  function parseAcoustidBestMatch(payload) {
    var results = payload && Array.isArray(payload.results) ? payload.results.slice() : [];
    if (!results.length) return null;
    results.sort(function (a, b) {
      return Number(b && b.score || 0) - Number(a && a.score || 0);
    });
    for (var i = 0; i < results.length; i += 1) {
      var result = results[i] || {};
      var recordings = Array.isArray(result.recordings) ? result.recordings : [];
      if (!recordings.length) continue;
      var recording = recordings[0] || {};
      var title = safeText(recording.title || '').trim();
      var artists = Array.isArray(recording.artists) ? recording.artists.map(function (artist) {
        return safeText(artist && artist.name || '').trim();
      }).filter(Boolean) : [];
      if (!title) continue;
      return {
        song: title,
        artist: artists.join(', '),
        score: Number(result.score || 0) || 0,
        acoustid: safeText(result.id || recording.id || '').trim()
      };
    }
    return null;
  }

  function buildTrackCardFromRecognition(match) {
    var artist = cleanupMetadataChunk(match && match.artist || '');
    var song = cleanupMetadataChunk(match && match.song || '');
    var syntheticRaw = artist ? (artist + ' - ' + song) : song;
    return resolveTrackMetadata(syntheticRaw).then(function (resolved) {
      return buildTrackCardFromRaw(syntheticRaw, resolved.cover || currentProgramCard().cover, {
        rawTitle: syntheticRaw,
        song: resolved.song || song,
        artist: resolved.artist || artist
      });
    }).catch(function () {
      return buildTrackCardFromRaw(syntheticRaw, currentProgramCard().cover, {
        rawTitle: syntheticRaw,
        song: song,
        artist: artist
      });
    });
  }

  function runAudioRecognitionPass(options) {
    options = options || {};
    var rec = getAudioRecognitionConfig();
    if (rec.inFlight) return Promise.resolve(null);
    if (!shouldUseAudioRecognition(app.lastMetadataRaw)) {
      stopAudioRecognitionLoop();
      return Promise.resolve(null);
    }
    if (!rec.supported) {
      rec.lastError = 'Browser sem suporte a captureStream/MediaRecorder';
      if (isUiActive() || options.forceRender) {
        renderMetadataCard(createAudioRecognitionStatusCard('Reconhecimento indisponível neste navegador'));
      }
      return Promise.resolve(null);
    }
    if (!rec.acoustidClient) {
      rec.lastError = 'Client do AcoustID não configurado';
      if (isUiActive() || options.forceRender) {
        renderMetadataCard(createAudioRecognitionStatusCard('Configure o client do AcoustID'));
      }
      return Promise.resolve(null);
    }
    if (!app.audio || app.audio.paused || app.audio.ended) return Promise.resolve(null);
    if (!isUiActive() && !options.forceBackground) return Promise.resolve(null);

    rec.inFlight = true;
    return capturePlayerAudioBlob(rec.captureMs).then(function (blob) {
      return decodeRecognitionBlob(blob);
    }).then(function (audioBuffer) {
      return loadChromaprintApi().then(function (api) {
        return callChromaprintApi(api, audioBuffer);
      });
    }).then(function (fingerprintInfo) {
      if (!fingerprintInfo || !fingerprintInfo.fingerprint) throw new Error('fingerprint ausente');
      if (rec.lastFingerprint && rec.lastFingerprint === fingerprintInfo.fingerprint && rec.lastRecognizedKey) {
        rec.lastFingerprintAt = Date.now();
        return null;
      }
      rec.lastFingerprint = fingerprintInfo.fingerprint;
      rec.lastFingerprintAt = Date.now();
      return lookupAcoustidFingerprint(fingerprintInfo.fingerprint, fingerprintInfo.duration || Math.round(rec.captureMs / 1000));
    }).then(function (lookupPayload) {
      if (!lookupPayload) return null;
      var match = parseAcoustidBestMatch(lookupPayload);
      if (!match || !match.song) return null;
      var recognizedKey = normalizeRecognitionKey(match.song, match.artist);
      if (recognizedKey && recognizedKey === rec.lastRecognizedKey) {
        rec.lastRecognizedAt = Date.now();
        return null;
      }
      return buildTrackCardFromRecognition(match).then(function (card) {
        rec.lastRecognizedKey = recognizedKey;
        rec.lastRecognizedAt = Date.now();
        card.pendingRefresh = false;
        card.recognizedFromAudio = true;
        app.currentTrack = card;
        if (isUiActive() || options.forceRender) renderMetadataCard(card);
        return card;
      });
    }).catch(function (error) {
      rec.lastError = error && error.message ? error.message : 'falha no reconhecimento por áudio';
      return null;
    }).finally(function () {
      rec.inFlight = false;
    });
  }

  function startAudioRecognitionLoop(options) {
    options = options || {};
    var rec = getAudioRecognitionConfig();
    if (!shouldUseAudioRecognition(app.lastMetadataRaw)) {
      stopAudioRecognitionLoop();
      return;
    }
    rec.running = true;
    if (!rec.loopTimer) {
      rec.loopTimer = setInterval(function () {
        runAudioRecognitionPass();
      }, rec.intervalMs);
    }
    if (options.forceNow) {
      runAudioRecognitionPass({ forceRender: true });
    }
  }

  function renderMetadataCard(card) {
    if (!app.metadataHost) return;
    var root = app.metadataHost.querySelector('.re-radio-metadata-shell');
    if (!root) {
      app.metadataHost.innerHTML = '<div class="re-radio-metadata-shell"></div>';
      root = app.metadataHost.querySelector('.re-radio-metadata-shell');
    }
    if (!root) return;
    root.innerHTML = '' +
      '<div class="urm-widget">' +
        '<div class="urm-cover-wrap"><img class="urm-cover" alt="Capa" /></div>' +
        '<div class="urm-meta">' +
          '<div class="urm-song"></div>' +
          '<div class="urm-artist"></div>' +
        '</div>' +
      '</div>';
    var cover = root.querySelector('.urm-cover');
    var song = root.querySelector('.urm-song');
    var artist = root.querySelector('.urm-artist');
    var mainLine = safeText(card && (card.displayTitle || card.song || card.title || '')).trim();
    var subLine = safeText(card && (card.subtitle || card.artist || '')).trim();
    if (!mainLine) mainLine = 'ATIVIDADE FM';
    if (cover) setFreshImageSource(cover, card.cover || app.metadataHost.getAttribute('data-default-cover') || 'assets/base/logo.png', {
      fallback: app.metadataHost.getAttribute('data-default-cover') || 'assets/base/logo.png',
      force: true
    });
    if (song) song.textContent = mainLine;
    if (artist) {
      artist.textContent = subLine;
      artist.style.display = subLine ? '' : 'none';
    }
  }

  function currentProgramCard() {
    var program = app.currentProgram || findProgram(getClockContext());
    return {
      displayTitle: safeText(program && program.title || 'ATIVIDADE FM'),
      subtitle: '',
      cover: safeText(program && program.image || app.metadataHost.getAttribute('data-default-cover') || 'assets/base/logo.png')
    };
  }

  function voiceProgramCard() {
    return {
      displayTitle: 'A Voz do Brasil',
      subtitle: '',
      cover: 'assets/uploads/1775813163928_1775234080144_A_Voz_do_Brasil_103_1_FM_1.jpg'
    };
  }

  function getCoverFromResult(result) {
    if (!result) return '';
    if (result.album) {
      return result.album.cover_xl || result.album.cover_big || result.album.cover_medium || result.album.cover || '';
    }
    if (result.artist) {
      return result.artist.picture_xl || result.artist.picture_big || result.artist.picture_medium || result.artist.picture || '';
    }
    return '';
  }

  function scoreResultForInterpretation(result, artist, song) {
    var resultArtist = result && result.artist ? result.artist.name : '';
    var resultSong = result ? (result.title || '') : '';
    var artistScore = similarityScore(artist, resultArtist);
    var songScore = similarityScore(song, resultSong);
    return {
      total: (artistScore * 0.45) + (songScore * 0.55),
      artistScore: artistScore,
      songScore: songScore,
      resultArtist: resultArtist,
      resultSong: resultSong,
      cover: getCoverFromResult(result)
    };
  }

  function searchDeezerDetailed(query, limit, timeoutMs) {
    var q = safeText(query).trim();
    if (!q) return Promise.resolve([]);
    return new Promise(function (resolve) {
      var callbackName = 'deezer_meta_cb_' + Math.random().toString(36).slice(2, 10);
      var maxResults = Math.max(1, Math.min(Number(limit || 6), 10));
      var timer = null;
      var script = document.createElement('script');

      function cleanup() {
        if (timer) clearTimeout(timer);
        try { delete window[callbackName]; } catch (_error) { window[callbackName] = undefined; }
        if (script && script.parentNode) script.parentNode.removeChild(script);
      }

      window[callbackName] = function (data) {
        cleanup();
        resolve(data && Array.isArray(data.data) ? data.data : []);
      };

      script.async = true;
      script.src = 'https://api.deezer.com/search?q=' + encodeURIComponent(q) + '&limit=' + maxResults + '&output=jsonp&callback=' + callbackName + '&_=' + Date.now();
      script.onerror = function () { cleanup(); resolve([]); };
      timer = setTimeout(function () { cleanup(); resolve([]); }, Math.max(1000, Number(timeoutMs || 5000)));
      document.head.appendChild(script);
    });
  }

  function normalizeCoverUrl(url) {
    var safe = safeText(url).trim();
    if (!safe) return '';
    if (/\/\d+x\d+bb\.(jpg|png)$/i.test(safe)) {
      return safe.replace(/\/\d+x\d+bb\.(jpg|png)$/i, '/512x512bb.$1');
    }
    if (/100x100bb/i.test(safe)) return safe.replace(/100x100bb/ig, '512x512bb');
    return safe;
  }

  function searchItunesDetailed(query) {
    var q = safeText(query).trim();
    if (!q) return Promise.resolve([]);
    return fetch('https://itunes.apple.com/search?term=' + encodeURIComponent(q) + '&entity=song&limit=8', {
      method: 'GET',
      mode: 'cors',
      cache: 'no-store'
    }).then(function (response) {
      if (!response || !response.ok) throw new Error('itunes search failed');
      return response.json();
    }).then(function (data) {
      return data && Array.isArray(data.results) ? data.results : [];
    }).catch(function () {
      return [];
    });
  }

  function scoreItunesResult(item, artist, song) {
    var resultArtist = item ? (item.artistName || '') : '';
    var resultSong = item ? (item.trackName || item.collectionName || '') : '';
    var artistScore = similarityScore(artist, resultArtist);
    var songScore = similarityScore(song, resultSong);
    return {
      total: (artistScore * 0.45) + (songScore * 0.55),
      artistScore: artistScore,
      songScore: songScore,
      resultArtist: resultArtist,
      resultSong: resultSong,
      cover: normalizeCoverUrl(item && (item.artworkUrl100 || item.artworkUrl60 || item.artworkUrl30 || ''))
    };
  }

  function resolveArtistFromSingleSegment(segment) {
    var cleaned = cleanupMetadataChunk(segment);
    if (!cleaned) {
      return Promise.resolve({ bestArtist: '', bestArtistScore: 0, bestTitleScore: 0, artistBias: -1, cover: '' });
    }
    return searchDeezerDetailed(cleaned, 5, 5000).then(function (results) {
      var bestArtist = '';
      var bestArtistScore = 0;
      var bestTitleScore = 0;
      var bestCover = '';
      results.forEach(function (item) {
        var artistName = item && item.artist ? item.artist.name : '';
        var titleName = item ? (item.title || '') : '';
        var artistScore = similarityScore(cleaned, artistName);
        var titleScore = similarityScore(cleaned, titleName);
        if (artistScore > bestArtistScore) {
          bestArtistScore = artistScore;
          bestArtist = artistName;
          bestCover = getCoverFromResult(item);
        }
        if (titleScore > bestTitleScore) bestTitleScore = titleScore;
      });
      return {
        bestArtist: bestArtist,
        bestArtistScore: bestArtistScore,
        bestTitleScore: bestTitleScore,
        artistBias: bestArtistScore - bestTitleScore,
        cover: bestCover
      };
    });
  }

  function resolveTrackMetadata(rawTitle) {
    var cacheKey = 'trackmeta::' + safeText(rawTitle).trim();
    if (!safeText(rawTitle).trim()) return Promise.resolve({ song: '', artist: '', cover: '' });
    if (Object.prototype.hasOwnProperty.call(app.coverCache, cacheKey)) {
      return Promise.resolve(app.coverCache[cacheKey]);
    }

    var immediate = parseRawTitle(rawTitle);
    var first = immediate.first;
    var second = immediate.second;
    if (!second) {
      var simple = { song: immediate.song, artist: immediate.artist || '', cover: '' };
      app.coverCache[cacheKey] = simple;
      return Promise.resolve(simple);
    }

    var direct = { artist: cleanupMetadataChunk(first), song: cleanupMetadataChunk(second) };
    var swapped = { artist: cleanupMetadataChunk(second), song: cleanupMetadataChunk(first) };
    var meaningfulParts = (immediate.parts || []).map(cleanupMetadataChunk).filter(function (part) {
      return part && !isNumericMetadataSegment(part) && !isCollectionMetadataSegment(part);
    });
    var fullQuery = meaningfulParts.length >= 2
      ? (cleanTitleForSearch(meaningfulParts[meaningfulParts.length - 2], meaningfulParts[meaningfulParts.length - 1]) || cleanupMetadataChunk(rawTitle))
      : (cleanTitleForSearch(first, second) || cleanupMetadataChunk(rawTitle));

    function finalizeResolved(chosenBase, bestInfo, fallbackItunes) {
      var resolvedArtist = cleanupMetadataChunk(chosenBase.artist);
      var resolvedSong = cleanupMetadataChunk(chosenBase.song);
      var resolvedCover = (bestInfo && bestInfo.cover) || (fallbackItunes && fallbackItunes.cover) || '';

      if (bestInfo && bestInfo.artistScore >= 0.68 && bestInfo.resultArtist) {
        resolvedArtist = cleanupMetadataChunk(bestInfo.resultArtist);
      } else if (fallbackItunes && fallbackItunes.artistScore >= 0.68 && fallbackItunes.resultArtist) {
        resolvedArtist = cleanupMetadataChunk(fallbackItunes.resultArtist);
      }

      if (bestInfo && bestInfo.songScore >= 0.82 && bestInfo.resultSong) {
        resolvedSong = cleanupMetadataChunk(bestInfo.resultSong);
      } else if (fallbackItunes && fallbackItunes.songScore >= 0.82 && fallbackItunes.resultSong) {
        resolvedSong = cleanupMetadataChunk(fallbackItunes.resultSong);
      }

      var rawParts = (immediate.parts || []).map(cleanupMetadataChunk).filter(Boolean);
      if (rawParts.length === 3 && isNumericMetadataSegment(rawParts[1])) {
        var forcedArtist = rawParts[0];
        var forcedSong = rawParts[2];
        if (isNumericMetadataSegment(resolvedArtist) || compactComparable(resolvedArtist) === compactComparable(resolvedSong)) {
          resolvedArtist = forcedArtist;
        }
        if (!resolvedSong || similarityScore(resolvedSong, forcedSong) < 0.75) {
          resolvedSong = forcedSong;
        }
      }

      var resolved = {
        song: resolvedSong,
        artist: resolvedArtist,
        cover: resolvedCover || ''
      };
      app.coverCache[cacheKey] = resolved;
      return resolved;
    }

    return searchDeezerDetailed(fullQuery, 6, 5000).then(function (results) {
      var best = null;
      results.forEach(function (item) {
        var directScore = scoreResultForInterpretation(item, direct.artist, direct.song);
        var swappedScore = scoreResultForInterpretation(item, swapped.artist, swapped.song);
        var better = directScore.total >= swappedScore.total
          ? { orientation: 'direct', scores: directScore, base: direct }
          : { orientation: 'swapped', scores: swappedScore, base: swapped };
        if (!best || better.scores.total > best.scores.total) best = better;
      });

      if (best && best.scores.total >= 0.56) {
        return finalizeResolved(best.base, best.scores, null);
      }

      return Promise.all([
        resolveArtistFromSingleSegment(first),
        resolveArtistFromSingleSegment(second),
        searchItunesDetailed(fullQuery)
      ]).then(function (parts) {
        var infoFirst = parts[0];
        var infoSecond = parts[1];
        var itunesItems = parts[2] || [];
        var chosen = best && best.base ? best.base : direct;
        if (infoFirst.artistBias > infoSecond.artistBias + 0.08) {
          chosen = direct;
        } else if (infoSecond.artistBias > infoFirst.artistBias + 0.08) {
          chosen = swapped;
        } else if (best && best.orientation === 'swapped') {
          chosen = swapped;
        }

        var bestItunes = null;
        itunesItems.forEach(function (item) {
          var directScore = scoreItunesResult(item, direct.artist, direct.song);
          var swappedScore = scoreItunesResult(item, swapped.artist, swapped.song);
          var better = directScore.total >= swappedScore.total
            ? { orientation: 'direct', scores: directScore, base: direct }
            : { orientation: 'swapped', scores: swappedScore, base: swapped };
          if (!bestItunes || better.scores.total > bestItunes.scores.total) bestItunes = better;
        });
        if (bestItunes && bestItunes.scores.total >= 0.56) {
          chosen = bestItunes.base;
          return finalizeResolved(chosen, null, bestItunes.scores);
        }
        return finalizeResolved(chosen, best ? best.scores : null, null);
      });
    }).catch(function () {
      var fallback = { song: immediate.song, artist: immediate.artist || '', cover: '' };
      app.coverCache[cacheKey] = fallback;
      return fallback;
    });
  }



  function buildTrackCardFromRaw(rawTitle, cover, metadataOverride) {
    var parsed = metadataOverride || parseRawTitle(rawTitle);
    var programCard = currentProgramCard();
    var songTitle = cleanupMetadataChunk(parsed.song || parsed.rawTitle || rawTitle) || 'ATIVIDADE FM';
    var artistName = cleanupMetadataChunk(parsed.artist || '');
    return {
      rawTitle: safeText(rawTitle).trim(),
      song: songTitle,
      artist: artistName,
      displayTitle: songTitle,
      subtitle: artistName,
      cover: cover || programCard.cover || app.metadataHost.getAttribute('data-default-cover') || 'assets/base/logo.png',
      pendingRefresh: false
    };
  }

  function clearPendingTrackTimer() {
    if (app.pendingTrackTimer) {
      clearTimeout(app.pendingTrackTimer);
      app.pendingTrackTimer = null;
    }
  }

  function revealTrackNow(raw, options) {
    options = options || {};
    var targetRaw = safeText(raw || (app.currentTrack && app.currentTrack.rawTitle) || app.lastMetadataRaw).trim();
    app.pendingTrackRevealAt = 0;
    clearPendingTrackTimer();
    if (!targetRaw) {
      if (!syncMetadataOverride()) renderMetadataCard(currentProgramCard());
      return;
    }
    if (syncMetadataOverride()) return;
    if (app.currentTrack && safeText(app.currentTrack.rawTitle).trim() === targetRaw) {
      app.currentTrack.pendingRefresh = false;
      if (!app.currentTrack.cover) {
        app.currentTrack.cover = currentProgramCard().cover || app.metadataHost.getAttribute('data-default-cover') || 'assets/base/logo.png';
      }
      if (isUiActive() || options.forceRender) renderMetadataCard(app.currentTrack);
      return;
    }
    var fallbackCard = buildTrackCardFromRaw(targetRaw, currentProgramCard().cover);
    fallbackCard.pendingRefresh = false;
    app.currentTrack = fallbackCard;
    if (isUiActive() || options.forceRender) renderMetadataCard(fallbackCard);
  }

  function scheduleTrackReveal(raw, options) {
    options = options || {};
    var targetRaw = safeText(raw || (app.currentTrack && app.currentTrack.rawTitle) || app.lastMetadataRaw).trim();
    if (!targetRaw) {
      app.pendingTrackRevealAt = 0;
      clearPendingTrackTimer();
      if (!syncMetadataOverride()) renderMetadataCard(currentProgramCard());
      return;
    }
    if (syncMetadataOverride()) return;
    clearPendingTrackTimer();
    var delay = Math.max(0, Number(options.delayMs || 0) || 0);
    app.pendingTrackRevealAt = delay > 0 ? (Date.now() + delay) : 0;
    if (isUiActive() || options.forceRender) renderMetadataCard(currentProgramCard());
    if (!delay) {
      revealTrackNow(targetRaw, options);
      return;
    }
    app.pendingTrackTimer = setTimeout(function () {
      app.pendingTrackTimer = null;
      revealTrackNow(targetRaw, { forceRender: true });
    }, delay);
  }

  function renderTrackMetadata(rawTitle, options) {
    options = options || {};
    var raw = safeText(rawTitle).trim();
    if (!raw) return;

    var isNewTrack = app.lastMetadataRaw !== raw;
    app.lastMetadataRaw = raw;

    if (shouldUseAudioRecognition(raw)) {
      clearPendingTrackTimer();
      app.pendingTrackRevealAt = 0;
      if (!app.currentTrack || !app.currentTrack.recognizedFromAudio) {
        app.currentTrack = createAudioRecognitionStatusCard('Reconhecendo faixa pelo áudio');
      }
      if (isUiActive() || options.forceRender) {
        renderMetadataCard(app.currentTrack);
      }
      startAudioRecognitionLoop({ forceNow: isNewTrack || !!options.forceSearch || !!options.forceRender });
      return;
    }

    stopAudioRecognitionLoop();

    var immediateCard = buildTrackCardFromRaw(raw, currentProgramCard().cover);
    immediateCard.pendingRefresh = true;
    app.currentTrack = immediateCard;

    if (isNewTrack) {
      scheduleTrackReveal(raw, {
        delayMs: Number.isFinite(options.holdMs) ? options.holdMs : 15000,
        forceRender: !!options.forceRender
      });
    } else if (app.pendingTrackRevealAt && Date.now() < app.pendingTrackRevealAt) {
      if (isUiActive() || options.forceRender) renderMetadataCard(currentProgramCard());
    } else if (isUiActive() || options.forceRender) {
      renderMetadataCard(immediateCard);
    }

    if (!isUiActive() && !options.forceSearch) return;

    var requestId = ++app.metadataRequestId;
    resolveTrackMetadata(raw).then(function (resolved) {
      if (requestId !== app.metadataRequestId) return;
      var finalCard = buildTrackCardFromRaw(raw, resolved.cover || currentProgramCard().cover, {
        rawTitle: raw,
        song: resolved.song,
        artist: resolved.artist
      });
      finalCard.pendingRefresh = false;
      app.currentTrack = finalCard;
      if (!app.pendingTrackRevealAt || Date.now() >= app.pendingTrackRevealAt) {
        if (isUiActive() || options.forceRender) renderMetadataCard(finalCard);
      }
    }).catch(function () {
      if (requestId !== app.metadataRequestId) return;
      var fallbackCard = buildTrackCardFromRaw(raw, currentProgramCard().cover);
      fallbackCard.pendingRefresh = false;
      app.currentTrack = fallbackCard;
      if (!app.pendingTrackRevealAt || Date.now() >= app.pendingTrackRevealAt) {
        if (isUiActive() || options.forceRender) renderMetadataCard(fallbackCard);
      }
    });
  }

  function syncMetadataOverride() {
    if (!app.metadataHost) return;
    if (isVoiceWindow(getClockContext()) && app.voiceActive) {
      stopAudioRecognitionLoop();
      clearPendingTrackTimer();
      app.pendingTrackRevealAt = 0;
      renderMetadataCard(voiceProgramCard());
      return true;
    }
    return false;
  }

  function connectMetadata() {
    if (!app.metadataHost) return;
    var url = app.metadataHost.getAttribute('data-metadata-url') || '';
    if (!url || typeof EventSource === 'undefined') return;
    if (app.eventSource) {
      try { app.eventSource.close(); } catch (_error) {}
      app.eventSource = null;
    }
    var es = new EventSource(url);
    es.onmessage = function (event) {
      if (syncMetadataOverride()) return;
      try {
        var payload = JSON.parse(event.data);
        var raw = payload && payload.streamTitle ? String(payload.streamTitle) : '';
        raw = safeText(raw).trim();
        if (!raw) return;
        if (app.lastMetadataRaw === raw && app.currentTrack && !app.currentTrack.pendingRefresh && !shouldUseAudioRecognition(raw)) return;
        if (isUiActive()) {
          renderTrackMetadata(raw, { forceRender: true, forceSearch: true, holdMs: 15000 });
        } else {
          app.lastMetadataRaw = raw;
          if (shouldUseAudioRecognition(raw)) {
            app.currentTrack = createAudioRecognitionStatusCard('Reconhecendo faixa pelo áudio');
            startAudioRecognitionLoop();
          } else {
            stopAudioRecognitionLoop();
            app.currentTrack = buildTrackCardFromRaw(raw, currentProgramCard().cover);
            app.currentTrack.pendingRefresh = true;
            app.pendingTrackRevealAt = Date.now() + 15000;
          }
        }
      } catch (_error) {}
    };
    es.onerror = function () {};
    app.eventSource = es;
  }

  function refreshMetadataForeground() {
    if (syncMetadataOverride()) return;
    if (shouldUseAudioRecognition(app.lastMetadataRaw)) {
      startAudioRecognitionLoop({ forceNow: true });
      if (app.currentTrack) renderMetadataCard(app.currentTrack);
    } else if (app.currentTrack && app.currentTrack.rawTitle) {
      renderTrackMetadata(app.currentTrack.rawTitle, { forceRender: true, forceSearch: true });
    } else {
      renderMetadataCard(currentProgramCard());
    }
    connectMetadata();
  }

  function renderProgramPhoto() {

    var program = app.currentProgram;
    app.photoHosts.forEach(function (host) {
      var image = host.querySelector('.re-current-program-photo');
      if (!image) return;
      if (!program || !program.image) {
        image.style.display = 'none';
        return;
      }
      image.style.display = '';
      image.style.transform = 'translate(' + Number(program.photoX || 0) + 'px, ' + Number(program.photoY || 0) + 'px) scale(' + Math.max(0.1, Number(program.photoZoom || 1)) + ')';
      setFreshImageSource(image, program.image);
    });
  }

  function renderScheduleDependentUi() {
    app.currentClock = getClockContext();
    app.currentProgram = findProgram(app.currentClock);
    renderProgramPhoto();
    renderVinylState();
    if (!syncMetadataOverride() && !app.currentTrack) renderMetadataCard(currentProgramCard());
  }

  function fetchWeather() {
    app.weatherHosts.forEach(function (host) {
      var tempEl = host.querySelector('.re-weather-temp');
      fetchJson(host.getAttribute('data-weather-api-url') || WEATHER_API).then(function (data) {
        var temp = Number(data && data.current_weather && data.current_weather.temperature);
        if (tempEl) tempEl.textContent = Number.isFinite(temp) ? temp.toFixed(1) + '°C' : '--.-°C';
      }).catch(function () {
        if (tempEl) tempEl.textContent = '--.-°C';
      });
    });
  }

  function initNews() {
    app.newsHosts.forEach(function (host) {
      var list = host.querySelector('.re-news-list');
      if (!list) return;
      var url = host.getAttribute('data-news-api-url') || '';
      var perView = Math.max(1, Math.min(3, Number(host.getAttribute('data-news-items-per-view') || 2) || 2));
      var state = { items: [], index: 0, perView: perView, nextRotateAt: 0, list: list, url: url };
      host.__newsState = state;
      list.textContent = 'Carregando...';
      fetch(url).then(function (res) { return res.json(); }).then(function (data) {
        state.items = Array.isArray(data && data.items) ? data.items.slice(0, 8) : [];
        if (!state.items.length) throw new Error('sem notícias');
        state.nextRotateAt = Date.now() + 15000;
        renderNewsState(state);
      }).catch(function () {
        list.textContent = 'Erro ao carregar';
      });
    });
  }

  function renderNewsState(state) {
    if (!state || !state.list) return;
    state.list.innerHTML = '';
    var items = state.items.slice(state.index, state.index + state.perView);
    if (!items.length) items = state.items.slice(0, state.perView);
    items.forEach(function (item) {
      var row = document.createElement('div');
      row.className = 're-news-item';
      var link = document.createElement('a');
      link.href = item.link || '#';
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = item.title || 'Sem título';
      var date = document.createElement('div');
      date.className = 're-news-date';
      var rawDate = item.pubDate ? new Date(item.pubDate) : null;
      date.textContent = rawDate && !isNaN(rawDate.getTime()) ? rawDate.toLocaleString('pt-BR') : '';
      row.appendChild(link);
      row.appendChild(date);
      state.list.appendChild(row);
    });
  }

  function initBanners() {
    app.bannerHosts.forEach(function (host) {
      var img = host.querySelector('.re-image-loop-img');
      if (!img) return;
      var items = [];
      var links = [];
      try { items = JSON.parse(host.getAttribute('data-image-loop-images') || '[]'); } catch (_error) {}
      try { links = JSON.parse(host.getAttribute('data-image-loop-links') || '[]'); } catch (_error2) {}
      if (!Array.isArray(items) || !items.length) return;
      var overlay = host.querySelector('.re-image-loop-link');
      if (!overlay) {
        overlay = document.createElement('a');
        overlay.className = 're-link-fill re-image-loop-link';
        overlay.target = '_blank';
        overlay.rel = 'noopener';
        overlay.setAttribute('aria-label', 'Abrir banner');
        host.appendChild(overlay);
      }
      var state = { items: items, links: Array.isArray(links) ? links : [], index: 0, nextRotateAt: Date.now() + 15000, img: img, overlay: overlay, host: host };
      host.__bannerState = state;
      renderBannerState(state);
    });
  }

  function renderBannerState(state) {
    if (!state || !state.img) return;
    var src = state.items[state.index] || state.items[0] || '';
    if (src) setFreshImageSource(state.img, src);
    var href = String(state.links[state.index] || '').trim();
    var clickable = !!href;
    state.host.classList.toggle('is-clickable', clickable);
    if (clickable) {
      state.overlay.href = href;
      state.overlay.hidden = false;
      state.overlay.style.pointerEvents = 'auto';
    } else {
      state.overlay.hidden = true;
      state.overlay.removeAttribute('href');
      state.overlay.style.pointerEvents = 'none';
    }
  }

  function runSharedRotations() {
    if (!isUiActive()) return;
    var now = Date.now();
    app.newsHosts.forEach(function (host) {
      var state = host.__newsState;
      if (!state || !state.items.length || state.items.length <= state.perView) return;
      if (now < state.nextRotateAt) return;
      state.index += state.perView;
      if (state.index >= state.items.length) state.index = 0;
      state.nextRotateAt = now + 15000;
      renderNewsState(state);
    });
    app.bannerHosts.forEach(function (host) {
      var state = host.__bannerState;
      if (!state || state.items.length <= 1) return;
      if (now < state.nextRotateAt) return;
      state.index = (state.index + 1) % state.items.length;
      state.nextRotateAt = now + 15000;
      renderBannerState(state);
    });
  }

  function bindTheme() {
    var root = document.documentElement;
    var body = document.body;
    function apply(isDark) {
      root.classList.toggle('re-dark-theme', !!isDark);
      body.classList.toggle('re-dark-theme', !!isDark);
      qsa('.re-theme-toggle-btn').forEach(function (btn) { btn.classList.toggle('is-dark', !!isDark); });
    }
    try { apply(localStorage.getItem(THEME_STORAGE_KEY) === 'dark'); } catch (_error) { apply(false); }
    qsa('.re-theme-toggle-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var next = !(root.classList.contains('re-dark-theme') || body.classList.contains('re-dark-theme'));
        apply(next);
        try { localStorage.setItem(THEME_STORAGE_KEY, next ? 'dark' : 'light'); } catch (_error) {}
      });
    });
  }

  function bindResponsiveStage() {
    var stage = document.getElementById('page-stage');
    var wrapper = document.getElementById('page-stage-wrapper');
    if (!stage || !wrapper) return;
    var scheduled = false;
    function getViewportBox() {
      var vv = window.visualViewport;
      return {
        width: Math.max(1, Math.round((vv && vv.width) || document.documentElement.clientWidth || window.innerWidth || 0)),
        height: Math.max(1, Math.round((vv && vv.height) || document.documentElement.clientHeight || window.innerHeight || 0))
      };
    }
    function isTouchDevice() {
      return !!((window.matchMedia && window.matchMedia('(pointer: coarse)').matches) || navigator.maxTouchPoints > 0 || /Android|iPhone|iPad|iPod|Mobile|Tablet/i.test(navigator.userAgent || ''));
    }
    function getDesktopContentHeight() {
      var maxBottom = 0;
      qsa('.re-element', stage).forEach(function (el) {
        var rectBottom = el.offsetTop + el.offsetHeight;
        if (rectBottom > maxBottom) maxBottom = rectBottom;
      });
      return Math.max(1, Math.ceil(maxBottom + 8));
    }
    function update() {
      scheduled = false;
      var rootStyle = getComputedStyle(document.documentElement);
      var baseWidth = parseFloat(rootStyle.getPropertyValue('--re-stage-width')) || 1380;
      var baseHeight = parseFloat(rootStyle.getPropertyValue('--re-stage-height')) || 1008;
      var viewport = getViewportBox();
      var touch = isTouchDevice();
      var portrait = viewport.height >= viewport.width;
      var useTouchLandscape = touch && !portrait;
      var widthScale = viewport.width / baseWidth;
      var scale = useTouchLandscape ? widthScale : Math.min(1, widthScale);
      var effectiveContentHeight = useTouchLandscape ? Math.min(baseHeight, getDesktopContentHeight()) : baseHeight;
      var scaledWidth = Math.max(1, Math.round(baseWidth * scale));
      var scaledHeight = Math.max(1, Math.round(effectiveContentHeight * scale));
      wrapper.style.width = scaledWidth + 'px';
      wrapper.style.height = scaledHeight + 'px';
      stage.style.transformOrigin = 'top left';
      stage.style.transform = 'translateZ(0) scale(' + scale + ')';
      document.body.style.minHeight = Math.max(scaledHeight, viewport.height) + 'px';
      document.body.classList.toggle('re-touch-device', touch);
      document.body.classList.toggle('re-touch-portrait', touch && portrait);
      document.body.classList.toggle('re-touch-landscape', touch && !portrait);
      document.body.classList.toggle('re-desktop-device', !touch);
    }
    function requestUpdate() {
      if (scheduled) return;
      scheduled = true;
      window.requestAnimationFrame(update);
    }
    update();
    window.addEventListener('resize', requestUpdate, { passive: true });
    window.addEventListener('orientationchange', requestUpdate, { passive: true });
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', requestUpdate, { passive: true });
      window.visualViewport.addEventListener('scroll', requestUpdate, { passive: true });
    }
  }

  function bindPlayer() {
    app.playerHost = qs('.re-type-player');
    app.volumeHosts = qsa('.re-type-volume-control');
    app.vinylHosts = qsa('.re-type-vinyl');
    if (!app.playerHost) return;
    var audio = app.playerHost.querySelector('.re-audio');
    if (!audio) return;
    app.audio = audio;
    audio.preload = 'none';
    audio.crossOrigin = 'anonymous';
    audio.volume = readStoredVolume(Number(app.playerHost.getAttribute('data-volume') || 1));
    audio.setAttribute('data-current-stream', String(app.playerHost.getAttribute('data-radio-url') || DEFAULT_STREAM_URL).trim());
    audio.src = audio.getAttribute('data-current-stream') || DEFAULT_STREAM_URL;

    function markLoading(on) {
      if (on) audio.setAttribute('data-loading', '1');
      else audio.setAttribute('data-loading', '0');
      syncPlayerUi();
    }

    ['loadstart', 'waiting', 'stalled'].forEach(function (ev) {
      audio.addEventListener(ev, function () { markLoading(true); });
    });
    ['playing', 'canplay', 'canplaythrough'].forEach(function (ev) {
      audio.addEventListener(ev, function () {
        markLoading(false);
        resumeVuAudioAnalysis();
      });
    });
    ['pause', 'ended', 'error', 'volumechange'].forEach(function (ev) {
      audio.addEventListener(ev, function () {
        if (ev === 'volumechange') persistVolume(audio.volume);
        syncPlayerUi();
      });
    });

    qsa('.re-play-btn', document).forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (audio.paused || audio.ended) {
          markLoading(true);
          resumeVuAudioAnalysis();
          var p = audio.play();
          if (p && typeof p.catch === 'function') p.catch(function () { markLoading(false); });
        } else {
          audio.pause();
          markLoading(false);
        }
      });
    });

    qsa('.re-mute-btn', document).forEach(function (btn) {
      btn.addEventListener('click', function () {
        audio.muted = !audio.muted;
        syncPlayerUi();
      });
    });

    qsa('.re-volume-slider', document).forEach(function (slider) {
      slider.addEventListener('input', function () {
        audio.muted = false;
        audio.volume = clamp(Number(slider.value || 0) / 100, 0, 1);
        persistVolume(audio.volume);
        syncPlayerUi();
      }, { passive: true });
      updateSliderAppearance(slider);
    });

    syncPlayerUi();
  }

  function buildVuBackground(width, height) {
    var canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    var ctx = canvas.getContext('2d');
    var W = width;
    var H = height;

    function roundedRectPath(x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + r);
      ctx.lineTo(x + w, y + h - r);
      ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      ctx.lineTo(x + r, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - r);
      ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.closePath();
    }

    roundedRectPath(3, 3, W - 6, H - 6, 18);
    var outerGrad = ctx.createLinearGradient(0, 0, 0, H);
    outerGrad.addColorStop(0, '#1a3768');
    outerGrad.addColorStop(1, '#0a1f47');
    ctx.fillStyle = outerGrad;
    ctx.fill();
    ctx.strokeStyle = 'rgba(92,136,214,0.55)';
    ctx.lineWidth = 2;
    ctx.stroke();

    roundedRectPath(10, 10, W - 20, H - 20, 12);
    var panelGrad = ctx.createLinearGradient(0, 10, 0, H - 10);
    panelGrad.addColorStop(0, '#ece4cb');
    panelGrad.addColorStop(1, '#e4dac0');
    ctx.fillStyle = panelGrad;
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.globalAlpha = 0.18;
    for (var x = 14; x < W - 14; x += 8) {
      ctx.fillStyle = ((x / 8) % 2 === 0) ? '#c9be9e' : '#f4ecda';
      ctx.fillRect(x, 10, 3, H - 20);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
    ctx.strokeStyle = 'rgba(112,96,68,0.18)';
    ctx.lineWidth = 1;
    roundedRectPath(10, 10, W - 20, H - 20, 12);
    ctx.stroke();

    var centerX = W / 2;
    var centerY = H - 30;
    var radius = 88;
    var arcStart = -Math.PI * 0.84;
    var arcEnd = -Math.PI * 0.17;
    var arcTotal = arcEnd - arcStart;

    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, arcStart, arcEnd);
    ctx.strokeStyle = '#4c544d';
    ctx.lineWidth = 2.2;
    ctx.stroke();

    var marks = [
      { pos: 0.00, text: '-20', color: '#2b7e3c', len: 9 },
      { pos: 0.16, text: '-10', color: '#386d37', len: 9 },
      { pos: 0.33, text: '-7', color: '#4d7a3a', len: 10 },
      { pos: 0.53, text: '-5', color: '#6f7732', len: 10 },
      { pos: 0.71, text: '-3', color: '#9a7a1d', len: 11 },
      { pos: 0.88, text: '0', color: '#c3661c', len: 12 },
      { pos: 1.00, text: '+3', color: '#b94334', len: 13 }
    ];

    marks.forEach(function (mark) {
      var angle = arcStart + mark.pos * arcTotal;
      var x1 = centerX + Math.cos(angle) * radius;
      var y1 = centerY + Math.sin(angle) * radius;
      var x2 = centerX + Math.cos(angle) * (radius - mark.len);
      var y2 = centerY + Math.sin(angle) * (radius - mark.len);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.strokeStyle = mark.color;
      ctx.lineWidth = mark.pos >= 0.88 ? 2.2 : 1.8;
      ctx.stroke();
      ctx.save();
      ctx.translate(centerX + Math.cos(angle) * (radius - 20), centerY + Math.sin(angle) * (radius - 20));
      ctx.rotate(angle + Math.PI / 2);
      ctx.fillStyle = mark.color;
      ctx.font = 'bold 10px "Segoe UI", Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(mark.text, 0, 0);
      ctx.restore();
    });

    ctx.beginPath();
    ctx.arc(centerX, centerY, radius - 2, arcStart + 0.86 * arcTotal, arcEnd);
    ctx.strokeStyle = '#c84a3b';
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.fillStyle = 'rgba(92,84,68,0.55)';
    ctx.font = '700 22px "Segoe UI", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('VU', centerX, 98);
    ctx.fillStyle = 'rgba(92,84,68,0.72)';
    ctx.font = '700 9px "Segoe UI", Arial, sans-serif';
    ctx.fillText('METER', centerX, 116);

    ctx.fillStyle = '#4a4a4a';
    ctx.font = 'bold 9px "Segoe UI", Arial, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('PEAK', W - 43, H - 18);
    ctx.beginPath();
    ctx.arc(W - 31, H - 31, 4.7, 0, Math.PI * 2);
    ctx.fillStyle = '#5d1f1a';
    ctx.fill();

    return canvas;
  }

  function ensureVuAudioAnalysis() {
    if (app.audioAnalysis.failed) return false;
    if (app.audioAnalysis.analyser && app.audioAnalysis.ctx) return true;
    var AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx || !app.audio) return false;
    try {
      app.audio.crossOrigin = 'anonymous';
      var ctx = new AudioCtx();
      var analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.78;
      var source = ctx.createMediaElementSource(app.audio);
      source.connect(analyser);
      analyser.connect(ctx.destination);
      app.audioAnalysis.ctx = ctx;
      app.audioAnalysis.analyser = analyser;
      app.audioAnalysis.source = source;
      app.audioAnalysis.timeData = new Uint8Array(analyser.fftSize);
      return true;
    } catch (_error) {
      app.audioAnalysis.failed = true;
      return false;
    }
  }

  function resumeVuAudioAnalysis() {
    if (!ensureVuAudioAnalysis()) return;
    var ctx = app.audioAnalysis.ctx;
    if (ctx && ctx.state === 'suspended' && typeof ctx.resume === 'function') {
      try { ctx.resume(); } catch (_error) {}
    }
  }

  function readVuAudioLevel() {
    if (!ensureVuAudioAnalysis()) return 0;
    var analyser = app.audioAnalysis.analyser;
    var data = app.audioAnalysis.timeData;
    if (!analyser || !data) return 0;
    try {
      analyser.getByteTimeDomainData(data);
      var sum = 0;
      for (var i = 0; i < data.length; i += 1) {
        var centered = (data[i] - 128) / 128;
        sum += centered * centered;
      }
      var rms = Math.sqrt(sum / data.length);
      return clamp(Math.pow(rms * 4.6, 0.8), 0, 1);
    } catch (_error) {
      return 0;
    }
  }

  function initVu() {
    var host = qs('[data-id="el_239xlkuf"]');
    if (!host) return;
    app.vu.host = host;
    host.innerHTML = '';
    host.style.overflow = 'hidden';
    host.style.display = 'flex';
    host.style.alignItems = 'center';
    host.style.justifyContent = 'center';
    host.style.position = 'relative';
    var canvas = document.createElement('canvas');
    canvas.width = 362;
    canvas.height = 162;
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';
    host.appendChild(canvas);
    app.vu.canvas = canvas;
    app.vu.ctx = canvas.getContext('2d');
    app.vu.backgroundCanvas = buildVuBackground(canvas.width, canvas.height);
    app.vu.currentLevel = getIdleVuLevel();
    drawVuScene(app.vu.currentLevel);
    syncVuState();
  }

  function getIdleVuLevel() {
    return 0.025;
  }

  function drawVuScene(level) {
    if (!app.vu.ctx || !app.vu.backgroundCanvas || !app.vu.canvas) return;
    var ctx = app.vu.ctx;
    var w = app.vu.canvas.width;
    var h = app.vu.canvas.height;
    var needleLevel = clamp(level, 0, 1);
    var angle = (-Math.PI / 2 + (10 * Math.PI / 180)) + (needleLevel * ((140 * Math.PI / 180)));
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(app.vu.backgroundCanvas, 0, 0);
    var cx = w / 2;
    var cy = h - 31;
    var len = Math.min(w, h) * 0.43;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(0, 6);
    ctx.lineTo(0, -len);
    ctx.strokeStyle = '#1d1c1a';
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -len + 16);
    ctx.lineTo(0, -len);
    ctx.strokeStyle = '#8d2a23';
    ctx.lineWidth = 2.4;
    ctx.stroke();
    ctx.restore();

    ctx.beginPath();
    ctx.arc(cx, cy, 11.5, 0, Math.PI * 2);
    var hub = ctx.createRadialGradient(cx - 3, cy - 3, 1, cx, cy, 11.5);
    hub.addColorStop(0, '#f6f1e5');
    hub.addColorStop(0.30, '#d3ccb8');
    hub.addColorStop(0.60, '#7a7466');
    hub.addColorStop(1, '#26231e');
    ctx.fillStyle = hub;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy, 4.2, 0, Math.PI * 2);
    ctx.fillStyle = '#111';
    ctx.fill();

    if (needleLevel > 0.86) {
      ctx.beginPath();
      ctx.arc(w - 31, h - 30, 5.1, 0, Math.PI * 2);
      ctx.fillStyle = '#8e1f18';
      ctx.shadowColor = 'rgba(190, 40, 32, 0.55)';
      ctx.shadowBlur = 10;
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }

  function drawVuFrame() {
    if (!app.vu.running || !app.vu.ctx || !app.vu.backgroundCanvas) return;
    var now = performance.now ? performance.now() : Date.now();
    if (app.vu.lastFrameAt && (now - app.vu.lastFrameAt) < (1000 / 20)) {
      app.vu.raf = requestAnimationFrame(drawVuFrame);
      return;
    }
    app.vu.lastFrameAt = now;
    var isPlaying = app.audio && !app.audio.paused && !app.audio.ended && !app.audio.muted && Number(app.audio.volume || 0) > 0;
    app.vu.targetLevel = isPlaying ? readVuAudioLevel() : getIdleVuLevel();
    app.vu.currentLevel += (app.vu.targetLevel - app.vu.currentLevel) * (isPlaying ? 0.22 : 0.12);
    drawVuScene(app.vu.currentLevel);
    app.vu.raf = requestAnimationFrame(drawVuFrame);
  }

  function startVu() {
    if (!app.vu.canvas || app.vu.running || !isUiActive()) return;
    resumeVuAudioAnalysis();
    app.vu.running = true;
    app.vu.lastFrameAt = 0;
    app.vu.raf = requestAnimationFrame(drawVuFrame);
  }

  function stopVu() {
    app.vu.running = false;
    if (app.vu.raf) cancelAnimationFrame(app.vu.raf);
    app.vu.raf = 0;
    app.vu.currentLevel = getIdleVuLevel();
    drawVuScene(app.vu.currentLevel);
  }

  function syncVuState() {
    var shouldRun = !!(app.audio && !app.audio.paused && !app.audio.ended && isUiActive());
    if (shouldRun) startVu(); else stopVu();
  }

  function onVisibilityChange() {
    app.visible = !document.hidden;
    renderVinylState();
    syncVuState();
    if (app.visible) {
      renderScheduleDependentUi();
      refreshMetadataForeground();
      runSharedRotations();
    }
  }

  function onFocusChange(focused) {
    app.focused = focused;
    renderVinylState();
    syncVuState();
    if (focused) {
      renderScheduleDependentUi();
      refreshMetadataForeground();
    }
  }

  function runUiTick() {
    app.currentClock = getClockContext();
    renderScheduleDependentUi();
    runSharedRotations();
    syncPlayerUi();
  }

  function runStreamTick() {
    fetchVoiceState().then(function () {
      switchStreamIfNeeded();
      if (syncMetadataOverride()) return;
      if (!app.currentTrack) renderMetadataCard(currentProgramCard());
    });
  }

  function boot() {
    app.metadataHost = qs('.re-type-radio-metadata');
    app.photoHosts = qsa('.re-type-schedule-photo-current');
    app.weatherHosts = qsa('.re-type-weather-rio');
    app.newsHosts = qsa('.re-type-news');
    app.bannerHosts = qsa('.re-type-image-loop');
    bindTheme();
    bindResponsiveStage();
    bindPlayer();
    initVu();
    initNews();
    initBanners();
    fetchClock().then(function () {
      return loadPrograms();
    }).then(function () {
      renderScheduleDependentUi();
      fetchWeather();
      fetchVoiceState().then(function () {
        switchStreamIfNeeded();
        connectMetadata();
        if (!syncMetadataOverride()) renderMetadataCard(currentProgramCard());
      });
    });

    app.uiTickTimer = setInterval(runUiTick, 1000);
    app.streamTickTimer = setInterval(runStreamTick, 5000);
    app.weatherTimer = setInterval(fetchWeather, 15 * 60 * 1000);
    setInterval(function () {
      fetchClock();
    }, 30 * 1000);

    document.addEventListener('visibilitychange', onVisibilityChange, { passive: true });
    window.addEventListener('focus', function () { onFocusChange(true); }, { passive: true });
    window.addEventListener('blur', function () { onFocusChange(false); }, { passive: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
