(function () {
  var hlsReadyPromise = null;
  function ensureHlsLoaded() {
    if (window.Hls) return Promise.resolve(window.Hls);
    if (hlsReadyPromise) return hlsReadyPromise;
    hlsReadyPromise = new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/hls.js@1';
      script.async = true;
      script.onload = function () { resolve(window.Hls || null); };
      script.onerror = function () { reject(new Error('Falha ao carregar hls.js')); };
      document.head.appendChild(script);
    });
    return hlsReadyPromise;
  }

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

  function cloneScheduleItem(item) {
    item = item || {};
    return {
      id: item.id || '',
      title: item.title || item.programa || '',
      host: item.host || item.locutor || '',
      locutor: item.locutor || item.host || '',
      start: item.start || item.inicio || '',
      end: item.end || item.fim || '',
      image: item.image || item.imagem || '',
      vinyl: item.vinyl || item.vinylImage || item.disco || '',
      diaDaSemana: normalizeWeekdays(item.diaDaSemana || item.dayOfWeek || item.days || item.weekdays || item.dias || []),
      photoX: Number(item.photoX || 0),
      photoY: Number(item.photoY || 0),
      photoZoom: Math.max(0.1, Number(item.photoZoom || 1) || 1)
    };
  }

  function parseSchedule(text) {
    return String(text || '').split(/\n+/).map(function (line) {
      var trimmed = line.trim();
      if (!trimmed) return null;
      var parts = trimmed.split('|').map(function (p) { return p.trim(); });
      var range = String(parts[0] || '').split('-').map(function (p) { return p.trim(); });
      if (range.length !== 2) return null;
      return cloneScheduleItem({ start: range[0], end: range[1], title: parts[1] || '', image: parts[2] || '' });
    }).filter(Boolean);
  }

  function timeToMinutes(hhmm) {
    var m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    return Number(m[1]) * 60 + Number(m[2]);
  }

  var WEEKDAY_ORDER = ['dom', 'seg', 'ter', 'quar', 'qui', 'sex', 'sab'];
  var DEFAULT_VINYL_PATH = 'assets/base/vinyl.png';
  var PROGRAMS_SOURCE_CACHE = Object.create(null);
  var TIME_SOURCE_CACHE = Object.create(null);
  var PAGE_BOOT_CACHE_BUSTER = String(Date.now());
  var THEME_STORAGE_KEY = 'radioatividade-theme';
  var VOLUME_STORAGE_KEY = 'radioatividade-volume';

  function readStoredVolume(defaultValue) {
    try {
      var raw = localStorage.getItem(VOLUME_STORAGE_KEY);
      if (raw === null || raw === '') return Number(defaultValue || 1);
      var parsed = Number(raw);
      if (!Number.isFinite(parsed)) return Number(defaultValue || 1);
      return Math.max(0, Math.min(1, parsed));
    } catch (_error) {
      return Number(defaultValue || 1);
    }
  }

  function persistVolume(value) {
    try {
      var normalized = Math.max(0, Math.min(1, Number(value || 0)));
      localStorage.setItem(VOLUME_STORAGE_KEY, String(normalized));
    } catch (_error) {}
  }
  var DEFAULT_RADIO_STREAM_URL = 'https://stream.zeno.fm/z2h3tpp2fchvv';
  var VOZ_DO_BRASIL_STREAM_URL = 'http://radioaovivo.senado.gov.br/canal2.mp3';
  var AUTO_DJ_RETRY_INTERVAL_MS = 15 * 1000;
  var AUTO_DJ_STREAM_TIMEOUT_MS = 12 * 1000;
  var RADIO_SILENCE_TIMEOUT_MS = 15 * 1000;
  var AUTO_DJ_PLAYLIST = [

            // 12 originais do Romantic
            { id: "1", title: "Ao vivo", artist: "Roxette", url: "https://atividadefm.dpdns.org/all" }
  ];

  function pad2(value) {
    return String(Math.max(0, Number(value) || 0)).padStart(2, '0');
  }

  function parseLocalIsoParts(isoText) {
    var match = String(isoText || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
    if (!match) return null;
    return {
      year: Number(match[1]),
      month: Number(match[2]),
      day: Number(match[3]),
      hour: Number(match[4]),
      minute: Number(match[5])
    };
  }

  function buildClockContextFromIso(isoText, elapsedMs) {
    var parts = parseLocalIsoParts(isoText);
    if (!parts) return null;
    var basePseudoUtcMs = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0, 0);
    var elapsed = Number(elapsedMs);
    var date = new Date(basePseudoUtcMs + (Number.isFinite(elapsed) ? elapsed : 0));
    return {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
      weekday: WEEKDAY_ORDER[date.getUTCDay()],
      minutes: (date.getUTCHours() * 60) + date.getUTCMinutes(),
      isoLocal: date.getUTCFullYear() + '-' + pad2(date.getUTCMonth() + 1) + '-' + pad2(date.getUTCDate()) + 'T' + pad2(date.getUTCHours()) + ':' + pad2(date.getUTCMinutes()),
      pseudoUtcMs: basePseudoUtcMs + (Number.isFinite(elapsed) ? elapsed : 0)
    };
  }

  function fallbackClockContext(timeZone, offsetMs) {
    var formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timeZone || 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
    var shiftedNow = new Date(Date.now() + (Number(offsetMs) || 0));
    var parts = formatter.formatToParts(shiftedNow);
    var map = {};
    parts.forEach(function (part) {
      if (part && part.type) map[part.type] = part.value;
    });
    var weekdayMap = { sun: 'dom', mon: 'seg', tue: 'ter', wed: 'quar', thu: 'qui', fri: 'sex', sat: 'sab' };
    var weekday = weekdayMap[String(map.weekday || '').toLowerCase()] || 'seg';
    var year = Number(map.year || 0);
    var month = Number(map.month || 0);
    var day = Number(map.day || 0);
    var hour = Number(map.hour || 0);
    var minute = Number(map.minute || 0);
    return {
      year: year,
      month: month,
      day: day,
      weekday: weekday,
      minutes: (hour * 60) + minute,
      isoLocal: String(map.year || '0000') + '-' + String(map.month || '00') + '-' + String(map.day || '00') + 'T' + String(map.hour || '00') + ':' + String(map.minute || '00'),
      pseudoUtcMs: Date.UTC(year, Math.max(0, month - 1), day, hour, minute, 0, 0)
    };
  }

  function findScheduleConfigHost(widget) {
    if (widget && widget.getAttribute('data-programs-src')) return widget;
    var owner = document.querySelector('[data-programs-src][data-type="schedule"], [data-programs-src][data-type="schedule-photo-current"], [data-programs-src].re-type-schedule, [data-programs-src].re-type-schedule-photo-current');
    if (owner) return owner;
    var anyProgramsSource = document.querySelector('[data-programs-src]');
    if (anyProgramsSource) return anyProgramsSource;
    return widget || null;
  }

  function getProgramsSourceUrl(widget) {
    var sourceHost = findScheduleConfigHost(widget);
    return (sourceHost && sourceHost.getAttribute('data-programs-src')) || 'programas/programacao.json';
  }

  function getTimeApiUrl(widget) {
    var sourceHost = findScheduleConfigHost(widget);
    return (sourceHost && sourceHost.getAttribute('data-time-api-url')) || 'https://api.open-meteo.com/v1/forecast?latitude=-23.5505&longitude=-46.6333&current=is_day&timezone=America/Sao_Paulo&forecast_days=1';
  }

  function getTimezoneForWidget(widget) {
    var sourceHost = findScheduleConfigHost(widget);
    return (sourceHost && sourceHost.getAttribute('data-timezone')) || 'America/Sao_Paulo';
  }

  function buildNoCacheUrl(url, token) {
    var safeUrl = String(url || '').trim();
    if (!safeUrl) return '';
    var separator = safeUrl.indexOf('?') === -1 ? '?' : '&';
    return safeUrl + separator + '_rt=' + encodeURIComponent(String(token || PAGE_BOOT_CACHE_BUSTER));
  }

  function setFreshImageSource(imageEl, src, token) {
    if (!imageEl) return;
    var baseSrc = String(src || '').trim();
    if (!baseSrc) {
      imageEl.removeAttribute('src');
      return;
    }
    imageEl.setAttribute('data-base-src', baseSrc);
    imageEl.setAttribute('src', buildNoCacheUrl(baseSrc, token || Date.now()));
  }
  function normalizeRadioUrl(url) {
    return String(url || '').trim().replace(/\/+$/, '').toLowerCase();
  }

  function getConfiguredDefaultRadioStreamUrl(host) {
    var normalizedFallback = normalizeRadioUrl(DEFAULT_RADIO_STREAM_URL);
    var nodes = [];
    if (host) nodes.push(host);
    nodes.push(document.querySelector('.re-type-player[data-radio-url]'));
    nodes.push(document.querySelector('[data-radio-url]'));
    for (var i = 0; i < nodes.length; i += 1) {
      var node = nodes[i];
      if (!node || !node.getAttribute) continue;
      var explicitUrl = normalizeRadioUrl(node.getAttribute('data-radio-url') || '');
      if (!explicitUrl || explicitUrl === normalizeRadioUrl(VOZ_DO_BRASIL_STREAM_URL)) continue;
      return explicitUrl;
    }
    return normalizedFallback;
  }

  function isManagedRadioUrl(url, host) {
    var safeUrl = normalizeRadioUrl(url);
    if (!safeUrl) return false;
    return safeUrl === getConfiguredDefaultRadioStreamUrl(host) || safeUrl === normalizeRadioUrl(VOZ_DO_BRASIL_STREAM_URL);
  }

  function radioUrlsMatch(a, b) {
    var urlA = normalizeRadioUrl(a);
    var urlB = normalizeRadioUrl(b);
    if (!urlA || !urlB) return false;
    if (urlA === urlB) return true;
    return isManagedRadioUrl(urlA) && isManagedRadioUrl(urlB);
  }

  function getClockWidgetForRuntime() {
    return document.querySelector('[data-time-api-url], [data-timezone], [data-programs-src]') || document.body;
  }

  function currentRuntimeClockContext() {
    var widget = getClockWidgetForRuntime();
    primeClockForWidget(widget);
    return currentClockContext(widget);
  }

  function isVoiceOfBrazilWeekday(clock) {
    var ctx = clock || currentRuntimeClockContext();
    if (!ctx) return false;
    return ctx.weekday === 'seg' || ctx.weekday === 'ter' || ctx.weekday === 'quar' || ctx.weekday === 'qui' || ctx.weekday === 'sex';
  }

  function isVoiceOfBrazilWindow(clock) {
    var ctx = clock || currentRuntimeClockContext();
    if (!ctx || typeof ctx.minutes !== 'number') return false;
    if (!isVoiceOfBrazilWeekday(ctx)) return false;
    return ctx.minutes >= (19 * 60) && ctx.minutes <= ((19 * 60) + 59);
  }

  function resolveManagedRadioUrl(clock, host) {
    return isVoiceOfBrazilWindow(clock) ? VOZ_DO_BRASIL_STREAM_URL : getConfiguredDefaultRadioStreamUrl(host);
  }

  function resolvePreferredRadioUrl(host) {
    var explicitUrl = host && host.getAttribute ? String(host.getAttribute('data-radio-url') || '').trim() : '';
    if (!explicitUrl) explicitUrl = getConfiguredDefaultRadioStreamUrl(host);
    if (!isManagedRadioUrl(explicitUrl, host)) return explicitUrl;
    return resolveManagedRadioUrl(null, host);
  }


  function parseScheduleItemsFromWidgetFallback(widget) {
    var raw = widget.getAttribute('data-schedule-items') || '';
    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length) return parsed.map(cloneScheduleItem).filter(Boolean);
      } catch (_error) {}
    }
    return parseSchedule(widget.getAttribute('data-schedule') || '');
  }

  function parseProgramsPayload(data) {
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.programas)) return data.programas;
    if (data && Array.isArray(data.programs)) return data.programs;
    if (data && Array.isArray(data.items)) return data.items;
    return [];
  }

  function loadProgramsForWidget(widget, options) {
    var url = getProgramsSourceUrl(widget);
    if (!url) return Promise.resolve(parseScheduleItemsFromWidgetFallback(widget));
    if (typeof window !== 'undefined' && window.location && window.location.protocol === 'file:') {
      return Promise.resolve(parseScheduleItemsFromWidgetFallback(widget));
    }
    if (!PROGRAMS_SOURCE_CACHE[url]) PROGRAMS_SOURCE_CACHE[url] = { items: null, promise: null };
    var cache = PROGRAMS_SOURCE_CACHE[url];
    var forceFresh = !!(options && options.forceFresh);
    if (!forceFresh && cache.items && cache.items.length) return Promise.resolve(cache.items);
    if (cache.promise) return cache.promise;
    cache.promise = fetch(buildNoCacheUrl(url, Date.now()), {
      cache: 'no-store'
    }).then(function (res) {
      if (!res.ok) throw new Error('Falha ao carregar programação');
      return res.json();
    }).then(function (data) {
      var items = parseProgramsPayload(data).map(cloneScheduleItem).filter(Boolean);
      if (!items.length) throw new Error('Programação vazia');
      cache.items = items;
      cache.promise = null;
      return items;
    }, function () {
      cache.promise = null;
      cache.items = parseScheduleItemsFromWidgetFallback(widget);
      return cache.items;
    });
    return cache.promise;
  }

  function readClockContextFromApiPayload(data) {
    var current = data && data.current ? data.current : (data && data.current_weather ? data.current_weather : null);
    var isoText = current && current.time ? current.time : '';
    return buildClockContextFromIso(isoText, 0);
  }

  function primeClockForWidget(widget) {
    var url = getTimeApiUrl(widget);
    if (!url) return;
    if (typeof window !== 'undefined' && window.location && window.location.protocol === 'file:') return;
    if (!TIME_SOURCE_CACHE[url]) TIME_SOURCE_CACHE[url] = { offsetMs: 0, syncedAt: 0, promise: null, lastApiIso: '' };
    var cache = TIME_SOURCE_CACHE[url];
    var timeZone = getTimezoneForWidget(widget);
    var refreshMs = 5 * 60 * 1000;
    var isFresh = cache.syncedAt && (Date.now() - cache.syncedAt) < refreshMs;
    if (isFresh || cache.promise) return;
    cache.promise = fetch(buildNoCacheUrl(url, Date.now()), {
      cache: 'no-store'
    }).then(function (res) {
      if (!res.ok) throw new Error('Falha ao sincronizar hora');
      return res.json();
    }).then(function (data) {
      var apiCtx = readClockContextFromApiPayload(data);
      var browserCtx = fallbackClockContext(timeZone, 0);
      if (apiCtx && apiCtx.isoLocal && browserCtx && Number.isFinite(apiCtx.pseudoUtcMs) && Number.isFinite(browserCtx.pseudoUtcMs)) {
        cache.lastApiIso = apiCtx.isoLocal;
        cache.offsetMs = apiCtx.pseudoUtcMs - browserCtx.pseudoUtcMs;
        cache.syncedAt = Date.now();
      }
      cache.promise = null;
      return apiCtx;
    }, function () {
      cache.promise = null;
      return null;
    });
  }

  function currentClockContext(widget) {
    var url = getTimeApiUrl(widget);
    var timeZone = getTimezoneForWidget(widget);
    var cache = TIME_SOURCE_CACHE[url];
    var offsetMs = cache && Number.isFinite(cache.offsetMs) ? cache.offsetMs : 0;
    return fallbackClockContext(timeZone, offsetMs);
  }

  function currentMinutesForTimezone(timeZone) {
    return fallbackClockContext(timeZone).minutes;
  }

  function previousWeekday(weekday) {
    var index = WEEKDAY_ORDER.indexOf(weekday);
    if (index === -1) return 'dom';
    return WEEKDAY_ORDER[(index + 6) % 7];
  }

  function matchesProgram(item, clock) {
    var start = timeToMinutes(item.start);
    var end = timeToMinutes(item.end);
    if (start === null || end === null || !clock) return false;
    var days = normalizeWeekdays(item.diaDaSemana || []);
    var hasDayFilter = days.length > 0;
    if (end >= start) {
      if (hasDayFilter && days.indexOf(clock.weekday) === -1) return false;
      return clock.minutes >= start && clock.minutes <= end;
    }
    if (clock.minutes >= start) {
      return !hasDayFilter || days.indexOf(clock.weekday) !== -1;
    }
    if (clock.minutes <= end) {
      return !hasDayFilter || days.indexOf(previousWeekday(clock.weekday)) !== -1;
    }
    return false;
  }

  function findProgram(items, clock) {
    for (var i = 0; i < items.length; i += 1) {
      if (matchesProgram(items[i], clock)) return items[i];
    }
    return null;
  }

  function isHlsUrl(url) {
    return /\.m3u8($|\?)/i.test(String(url || ''));
  }

  function createEngine(id, audio, hostNode) {
    audio.preload = 'none';
    try { audio.setAttribute('playsinline', ''); } catch (_error) {}
    try { audio.crossOrigin = 'anonymous'; } catch (_error) {}
    return {
      id: id,
      hostNode: hostNode || null,
      audio: audio,
      hls: null,
      lastUrl: '',
      defaultVolume: Number(hostNode && hostNode.getAttribute('data-volume') || 1) || 1,
      wantPlay: false,
      waitingForAudio: false,
      audioDetected: false,
      audioContext: null,
      sourceNode: null,
      analyserNode: null,
      frequencyData: null,
      timeData: null,
      detectInterval: null,
      detectStartedAt: 0,
      silenceStartedAt: 0,
      lastAudibleAt: 0,
      analyserUnavailable: false,
      isAutoDjActive: false,
      autoDjTrackIndex: -1,
      autoDjRetryTimer: null,
      autoDjProbeAudio: null,
      autoDjProbeTimeout: null,
      autoDjRetryInFlight: false,
      autoDjFallbackReason: '',
      currentTrackMeta: null,
      onStreamTimeout: null
    };
  }

  function clearAudioDetection(engine) {
    if (!engine) return;
    if (engine.detectInterval) {
      clearInterval(engine.detectInterval);
      engine.detectInterval = null;
    }
  }


  function notifyEngineState(engine) {
    if (engine && typeof engine.onStateChange === 'function') engine.onStateChange();
  }

  function ensureAudioAnalyser(engine) {
    if (!engine || engine.analyserNode) return true;
    if (engine.analyserUnavailable) return false;
    try {
      var AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) throw new Error('AudioContext indisponível');
      if (!window.__reSharedAudioContext) window.__reSharedAudioContext = new AudioContextClass();
      engine.audioContext = window.__reSharedAudioContext;
      if (!engine.sourceNode) engine.sourceNode = engine.audioContext.createMediaElementSource(engine.audio);
      engine.analyserNode = engine.audioContext.createAnalyser();
      engine.analyserNode.fftSize = 256;
      engine.analyserNode.smoothingTimeConstant = 0.78;
      engine.frequencyData = new Uint8Array(engine.analyserNode.frequencyBinCount);
      engine.timeData = new Uint8Array(engine.analyserNode.fftSize);
      engine.sourceNode.connect(engine.analyserNode);
      engine.analyserNode.connect(engine.audioContext.destination);
      return true;
    } catch (_error) {
      engine.analyserUnavailable = true;
      return false;
    }
  }

  function resumeAudioContext(engine) {
    if (!engine || !engine.audioContext || typeof engine.audioContext.resume !== 'function') return Promise.resolve();
    if (engine.audioContext.state === 'running') return Promise.resolve();
    try {
      var resumed = engine.audioContext.resume();
      if (resumed && typeof resumed.then === 'function') return resumed.catch(function () {});
    } catch (_error) {}
    return Promise.resolve();
  }

  function measureAudioPresence(engine) {
    if (!engine || !engine.analyserNode || !engine.frequencyData || !engine.timeData) return false;
    try {
      engine.analyserNode.getByteFrequencyData(engine.frequencyData);
      engine.analyserNode.getByteTimeDomainData(engine.timeData);
    } catch (_error) {
      return false;
    }

    var peakFrequency = 0;
    for (var i = 0; i < engine.frequencyData.length; i += 1) {
      if (engine.frequencyData[i] > peakFrequency) peakFrequency = engine.frequencyData[i];
    }

    var avgDeviation = 0;
    for (var j = 0; j < engine.timeData.length; j += 1) {
      avgDeviation += Math.abs(engine.timeData[j] - 128);
    }
    avgDeviation = avgDeviation / Math.max(1, engine.timeData.length);

    return peakFrequency >= 12 || avgDeviation >= 1.4;
  }

  function startAudioDetection(engine) {
    if (!engine) return;
    clearAudioDetection(engine);
    engine.detectStartedAt = Date.now();
    engine.silenceStartedAt = 0;
    engine.waitingForAudio = !engine.audioDetected;
    engine.detectInterval = setInterval(function () {
      if (!engine.wantPlay) {
        clearAudioDetection(engine);
        return;
      }
      if (!engine.audio || engine.audio.ended) return;
      if (engine.audio.muted || Number(engine.audio.volume || 0) <= 0) {
        engine.waitingForAudio = false;
        engine.silenceStartedAt = 0;
        notifyEngineState(engine);
        return;
      }

      var detected = false;
      if (!engine.audio.paused) detected = measureAudioPresence(engine);

      if (detected) {
        engine.audioDetected = true;
        engine.lastAudibleAt = Date.now();
        engine.silenceStartedAt = 0;
        engine.waitingForAudio = false;
        notifyEngineState(engine);
        return;
      }

      if (!engine.audioDetected) {
        if (!engine.isAutoDjActive && engine.wantPlay && engine.detectStartedAt && (Date.now() - engine.detectStartedAt) >= AUTO_DJ_STREAM_TIMEOUT_MS) {
          clearAudioDetection(engine);
          if (typeof engine.onStreamTimeout === 'function') {
            engine.onStreamTimeout('timeout');
            return;
          }
        }

        engine.waitingForAudio = true;
        notifyEngineState(engine);
        return;
      }

      if (!engine.isAutoDjActive && isManagedRadioUrl(engine.lastUrl, engine.hostNode || document.body)) {
        if (!engine.silenceStartedAt) engine.silenceStartedAt = Date.now();
        engine.waitingForAudio = true;
        notifyEngineState(engine);
        if ((Date.now() - engine.silenceStartedAt) >= RADIO_SILENCE_TIMEOUT_MS) {
          clearAudioDetection(engine);
          engine.audioDetected = false;
          engine.silenceStartedAt = 0;
          if (typeof engine.onStreamTimeout === 'function') {
            engine.onStreamTimeout('silent-timeout');
            return;
          }
        }
        return;
      }

      engine.waitingForAudio = false;
      engine.silenceStartedAt = 0;
      notifyEngineState(engine);
    }, 500);
  }

  function destroyHls(engine) {
    if (engine && engine.hls) {
      try { engine.hls.destroy(); } catch (_error) {}
      engine.hls = null;
    }
  }

  function detachSource(engine) {
    if (!engine || !engine.audio) return;
    destroyHls(engine);
    try { engine.audio.pause(); } catch (_error) {}
    try { engine.audio.removeAttribute('src'); } catch (_error) {}
    try { engine.audio.src = ''; } catch (_error) {}
    try { engine.audio.load(); } catch (_error) {}
    engine.lastUrl = '';
  }

  function attachSource(engine, url) {
    var safeUrl = String(url || '').trim();
    if (!engine || !safeUrl) return Promise.resolve(engine);
    if (engine.lastUrl === safeUrl) return Promise.resolve(engine);
    detachSource(engine);
    engine.lastUrl = safeUrl;

    if (isHlsUrl(safeUrl)) {
      return ensureHlsLoaded().then(function (Hls) {
        if (Hls && Hls.isSupported && Hls.isSupported()) {
          engine.hls = new Hls();
          engine.hls.loadSource(safeUrl);
          engine.hls.attachMedia(engine.audio);
        } else {
          engine.audio.src = safeUrl;
          try { engine.audio.load(); } catch (_error) {}
        }
        return engine;
      }).catch(function () {
        engine.audio.src = safeUrl;
        try { engine.audio.load(); } catch (_error) {}
        return engine;
      });
    }

    engine.audio.src = safeUrl;
    try { engine.audio.load(); } catch (_error) {}
    return Promise.resolve(engine);
  }

  function bindVUMeter(engine) {
    var vuElement = document.querySelector('.re-type-vu-meter');
    if (!vuElement || vuElement.__vuBound) return;
    vuElement.__vuBound = true;

    var BAR_COUNT = 8;
    var ACTIVE_INTERVAL = 140;
    var IDLE_INTERVAL = 260;
    var HIDDEN_INTERVAL = 520;

    function buildChannelMarkup(name) {
      var html = '<div class="re-vu-channel" data-channel="' + name + '">';
      for (var i = 0; i < BAR_COUNT; i += 1) {
        html += '<div class="re-vu-bar" data-index="' + i + '"></div>';
      }
      html += '</div>';
      return html;
    }

    vuElement.innerHTML = '<div class="re-vu-stereo">' + buildChannelMarkup('left') + buildChannelMarkup('right') + '</div>';
    vuElement.classList.add('re-vu-meter-stereo');

    var leftBars = Array.prototype.slice.call(vuElement.querySelectorAll('.re-vu-channel[data-channel="left"] .re-vu-bar'));
    var rightBars = Array.prototype.slice.call(vuElement.querySelectorAll('.re-vu-channel[data-channel="right"] .re-vu-bar'));
    var state = {
      left: 0,
      right: 0,
      lastLeft: -1,
      lastRight: -1,
      timerId: null
    };

    function paintBars(bars, litCount, cacheKey) {
      if (state[cacheKey] === litCount) return;
      state[cacheKey] = litCount;
      bars.forEach(function (bar, index) {
        var active = index < litCount;
        bar.classList.toggle('is-active', active);
        bar.classList.toggle('is-warn', active && index >= BAR_COUNT - 2 && index < BAR_COUNT - 1);
        bar.classList.toggle('is-hot', active && index >= BAR_COUNT - 1);
      });
    }

    function paintLevels(leftLevel, rightLevel) {
      var leftCount = Math.max(0, Math.min(BAR_COUNT, Math.round(leftLevel * BAR_COUNT)));
      var rightCount = Math.max(0, Math.min(BAR_COUNT, Math.round(rightLevel * BAR_COUNT)));
      paintBars(leftBars, leftCount, 'lastLeft');
      paintBars(rightBars, rightCount, 'lastRight');
    }

    function decayLevels() {
      state.left *= 0.72;
      state.right *= 0.72;
      if (state.left < 0.01) state.left = 0;
      if (state.right < 0.01) state.right = 0;
      paintLevels(state.left, state.right);
    }

    function sampleStereoLite() {
      if (!(ensureAudioAnalyser(engine) && engine.analyserNode && engine.frequencyData)) {
        return { left: 0, right: 0 };
      }

      try {
        engine.analyserNode.getByteFrequencyData(engine.frequencyData);
      } catch (_error) {
        return { left: 0, right: 0 };
      }

      var length = Math.min(engine.frequencyData.length, 42);
      if (!length) return { left: 0, right: 0 };

      var low = 0;
      var mid = 0;
      var high = 0;
      var lowCount = 0;
      var midCount = 0;
      var highCount = 0;

      for (var i = 0; i < length; i += 1) {
        var value = engine.frequencyData[i] / 255;
        if (i < 12) {
          low += value;
          lowCount += 1;
        } else if (i < 26) {
          mid += value;
          midCount += 1;
        } else {
          high += value;
          highCount += 1;
        }
      }

      var lowAvg = low / Math.max(1, lowCount);
      var midAvg = mid / Math.max(1, midCount);
      var highAvg = high / Math.max(1, highCount);

      var leftRaw = Math.max(0, (lowAvg * 0.76) + (midAvg * 0.24) - 0.08);
      var rightRaw = Math.max(0, (midAvg * 0.46) + (highAvg * 0.54) - 0.08);

      var leftTarget = Math.min(1, Math.pow(leftRaw / 0.82, 1.08));
      var rightTarget = Math.min(1, Math.pow(rightRaw / 0.82, 1.08));

      state.left += (leftTarget - state.left) * (leftTarget > state.left ? 0.34 : 0.16);
      state.right += (rightTarget - state.right) * (rightTarget > state.right ? 0.34 : 0.16);

      return {
        left: Math.max(0, Math.min(1, state.left)),
        right: Math.max(0, Math.min(1, state.right))
      };
    }

    function scheduleNext(delay) {
      clearTimeout(state.timerId);
      state.timerId = setTimeout(updateVU, delay);
    }

    function updateVU() {
      if (!engine.wantPlay || engine.audio.paused || engine.audio.ended) {
        decayLevels();
        scheduleNext(IDLE_INTERVAL);
        return;
      }

      if (document.hidden) {
        decayLevels();
        scheduleNext(HIDDEN_INTERVAL);
        return;
      }

      var levels = sampleStereoLite();
      paintLevels(levels.left, levels.right);
      scheduleNext(ACTIVE_INTERVAL);
    }

    updateVU();
  }

  function bindPlayers() {
    var engines = new Map();

    function updateSliderAppearance(slider) {
      if (!slider) return;
      var min = Number(slider.min || 0);
      var max = Number(slider.max || 100);
      var value = Number(slider.value || 0);
      var range = max - min || 1;
      var percent = Math.max(0, Math.min(100, ((value - min) / range) * 100));
      slider.style.setProperty('--volume-percent', percent.toFixed(2) + '%');
    }

    function ensureAudioControlMarkup() {
      Array.prototype.slice.call(document.querySelectorAll('.re-type-volume-control')).forEach(function (host) {
        var muteBtn = host.querySelector('.re-mute-btn');
        if (muteBtn) {
          muteBtn.textContent = '';
          muteBtn.setAttribute('title', 'Mutar ou desmutar');
        }
        if (!host.querySelector('.re-live-badge')) {
          var live = document.createElement('div');
          live.className = 're-live-badge';
          live.hidden = true;
          var dot = document.createElement('span');
          dot.className = 're-live-dot';
          var text = document.createElement('span');
          text.textContent = 'AO VIVO';
          live.appendChild(dot);
          live.appendChild(text);
          host.appendChild(live);
        }
        var slider = host.querySelector('.re-volume-slider');
        if (slider) updateSliderAppearance(slider);
      });

      Array.prototype.slice.call(document.querySelectorAll('.re-type-player .re-mute-btn')).forEach(function (btn) {
        btn.textContent = '';
      });
    }

    var controls = Array.prototype.slice.call(document.querySelectorAll('.re-type-player, .re-type-play-toggle, .re-type-volume-control, .re-type-vinyl'));
    ensureAudioControlMarkup();
    var actualPlayers = Array.prototype.slice.call(document.querySelectorAll('.re-type-player'));

    actualPlayers.forEach(function (player) {
      var audio = player.querySelector('.re-audio');
      if (!audio) return;
      var id = player.getAttribute('data-id');
      var engine = createEngine(id, audio, player);
      engine.onStateChange = function () { syncAll(); };
      engine.onStreamTimeout = function () { handleManagedStreamFailure(engine, 'timeout'); };
      var initialVolume = readStoredVolume(Number(player.getAttribute('data-volume') || 1));
      engine.audio.volume = Math.max(0, Math.min(1, initialVolume));
      engines.set(id, engine);
      var url = resolvePreferredRadioUrl(player);
      attachSource(engine, url);
      if (id === 'el_xvas15jl') bindVUMeter(engine);
      ['play', 'pause', 'ended', 'volumechange', 'playing', 'canplay', 'canplaythrough', 'loadstart', 'loadedmetadata', 'waiting', 'stalled'].forEach(function (eventName) {
        audio.addEventListener(eventName, function () {
          if (eventName === 'volumechange') {
            persistVolume(audio.volume);
          }
          if (eventName === 'pause' || eventName === 'ended') {
            if (!engine.wantPlay) {
              engine.waitingForAudio = false;
              engine.audioDetected = false;
              engine.silenceStartedAt = 0;
            }
          }
          if (eventName === 'ended' && engine.isAutoDjActive && engine.wantPlay) {
            playAutoDjTrack(engine, engine.autoDjTrackIndex + 1);
            return;
          }
          if (eventName === 'waiting' && engine.wantPlay && !engine.audioDetected && !audio.muted && Number(audio.volume || 0) > 0) {
            engine.waitingForAudio = true;
          }
          if (eventName === 'playing' && engine.wantPlay && !engine.audioDetected && !audio.muted && Number(audio.volume || 0) > 0) {
            engine.waitingForAudio = true;
            engine.silenceStartedAt = 0;
            startAudioDetection(engine);
          }
          if (eventName === 'volumechange' && (audio.muted || Number(audio.volume || 0) <= 0) && !engine.audioDetected) {
            engine.waitingForAudio = false;
          }
          if (eventName === 'volumechange' && !audio.muted && Number(audio.volume || 0) > 0 && engine.wantPlay && !engine.audioDetected) {
            engine.waitingForAudio = true;
            engine.silenceStartedAt = 0;
            startAudioDetection(engine);
          }
          notifyEngineState(engine);
        });
      });
      audio.addEventListener('error', function () {
        if (engine.isAutoDjActive && engine.wantPlay) {
          playAutoDjTrack(engine, engine.autoDjTrackIndex + 1);
          return;
        }
        handleManagedStreamFailure(engine, 'error');
      });
    });


    function shouldAllowAutoDjForEngine(engine) {
      if (!engine || !engine.wantPlay) return false;
      var host = engine.hostNode || null;
      var explicitUrl = host && host.getAttribute ? String(host.getAttribute('data-radio-url') || '').trim() : '';
      if (explicitUrl && !isManagedRadioUrl(explicitUrl, host || document.body)) return false;
      var desiredUrl = resolvePreferredRadioUrl(host || document.body);
      return normalizeRadioUrl(desiredUrl) === getConfiguredDefaultRadioStreamUrl(host || document.body);
    }

    function cleanupAutoDjProbe(engine) {
      if (!engine || !engine.autoDjProbeAudio) return;
      var probe = engine.autoDjProbeAudio;
      engine.autoDjProbeAudio = null;
      try { probe.pause(); } catch (_error) {}
      try { probe.removeAttribute('src'); } catch (_error) {}
      try { probe.src = ''; } catch (_error) {}
      try { probe.load(); } catch (_error) {}
    }

    function clearAutoDjRetry(engine) {
      if (!engine) return;
      if (engine.autoDjRetryTimer) {
        clearTimeout(engine.autoDjRetryTimer);
        engine.autoDjRetryTimer = null;
      }
      if (engine.autoDjProbeTimeout) {
        clearTimeout(engine.autoDjProbeTimeout);
        engine.autoDjProbeTimeout = null;
      }
      engine.autoDjRetryInFlight = false;
      cleanupAutoDjProbe(engine);
    }

    function stopAutoDjMode(engine) {
      if (!engine) return;
      clearAutoDjRetry(engine);
      engine.isAutoDjActive = false;
      engine.autoDjFallbackReason = '';
      engine.currentTrackMeta = null;
    }

    function scheduleAutoDjRetry(engine) {
      if (!engine || !engine.isAutoDjActive || !engine.wantPlay) return;
      if (engine.autoDjRetryTimer) return;
      engine.autoDjRetryTimer = setTimeout(function () {
        engine.autoDjRetryTimer = null;
        probeManagedStreamRecovery(engine);
      }, AUTO_DJ_RETRY_INTERVAL_MS);
    }

    function probeManagedStreamRecovery(engine) {
      if (!engine || !engine.isAutoDjActive || !engine.wantPlay) return;
      if (!shouldAllowAutoDjForEngine(engine)) {
        stopAutoDjMode(engine);
        switchEngineStream(engine, resolvePreferredRadioUrl(engine.hostNode || document.body));
        return;
      }
      if (engine.autoDjRetryInFlight) return;

      var desiredUrl = resolvePreferredRadioUrl(engine.hostNode || document.body);
      if (!desiredUrl) {
        scheduleAutoDjRetry(engine);
        return;
      }

      engine.autoDjRetryInFlight = true;
      cleanupAutoDjProbe(engine);

      var probe = new Audio();
      engine.autoDjProbeAudio = probe;
      try { probe.setAttribute('playsinline', ''); } catch (_error) {}
      try { probe.crossOrigin = 'anonymous'; } catch (_error) {}
      probe.muted = true;
      probe.volume = 0;
      probe.preload = 'none';
      probe.src = desiredUrl;

      var settled = false;
      function finish(success) {
        if (settled) return;
        settled = true;
        if (engine.autoDjProbeTimeout) {
          clearTimeout(engine.autoDjProbeTimeout);
          engine.autoDjProbeTimeout = null;
        }
        engine.autoDjRetryInFlight = false;
        cleanupAutoDjProbe(engine);
        if (!engine.wantPlay) return;
        if (!success) {
          scheduleAutoDjRetry(engine);
          return;
        }
        stopAutoDjMode(engine);
        switchEngineStream(engine, desiredUrl);
      }

      probe.addEventListener('canplay', function () { finish(true); }, { once: true });
      probe.addEventListener('playing', function () { finish(true); }, { once: true });
      probe.addEventListener('error', function () { finish(false); }, { once: true });

      engine.autoDjProbeTimeout = setTimeout(function () {
        finish(false);
      }, AUTO_DJ_STREAM_TIMEOUT_MS);

      try { probe.load(); } catch (_error) {}
      try {
        var playAttempt = probe.play();
        if (playAttempt && typeof playAttempt.catch === 'function') {
          playAttempt.catch(function () {});
        }
      } catch (_error) {}
    }

    function playAutoDjTrack(engine, nextIndex) {
      if (!engine || !engine.wantPlay || !AUTO_DJ_PLAYLIST.length) return;
      if (!engine.isAutoDjActive) engine.isAutoDjActive = true;

      var listLength = AUTO_DJ_PLAYLIST.length;
      var numericIndex = Number(nextIndex);
      if (!Number.isFinite(numericIndex)) {
        numericIndex = engine.autoDjTrackIndex >= 0 ? (engine.autoDjTrackIndex + 1) : Math.floor(Math.random() * listLength);
      }
      numericIndex = ((numericIndex % listLength) + listLength) % listLength;

      var track = AUTO_DJ_PLAYLIST[numericIndex];
      if (!track || !track.url) return;

      var volume = Number(engine.audio.volume || engine.defaultVolume || 1);
      var muted = !!engine.audio.muted;
      engine.autoDjTrackIndex = numericIndex;
      engine.currentTrackMeta = track;
      engine.waitingForAudio = true;
      engine.audioDetected = false;
      engine.silenceStartedAt = 0;
      clearAudioDetection(engine);

      attachSource(engine, track.url).then(function () {
        engine.audio.volume = Math.max(0, Math.min(1, volume));
        engine.audio.muted = muted;
        ensureAudioAnalyser(engine);
        notifyEngineState(engine);
        return resumeAudioContext(engine);
      }).then(function () {
        var playPromise = engine.audio.play();
        if (playPromise && typeof playPromise.catch === 'function') {
          playPromise.catch(function () {
            setTimeout(function () {
              if (engine.isAutoDjActive && engine.wantPlay) playAutoDjTrack(engine, engine.autoDjTrackIndex + 1);
            }, 250);
          });
        }
        startAudioDetection(engine);
        scheduleAutoDjRetry(engine);
        setTimeout(syncAll, 20);
        setTimeout(syncAll, 180);
        setTimeout(syncAll, 600);
      });
    }

    function startAutoDjFallback(engine, reason) {
      if (!engine || !engine.wantPlay || !AUTO_DJ_PLAYLIST.length) return;
      if (!shouldAllowAutoDjForEngine(engine)) return;
      if (engine.isAutoDjActive) {
        engine.autoDjFallbackReason = String(reason || engine.autoDjFallbackReason || 'stream-error');
        scheduleAutoDjRetry(engine);
        notifyEngineState(engine);
        return;
      }
      engine.autoDjFallbackReason = String(reason || 'stream-error');
      engine.isAutoDjActive = true;
      playAutoDjTrack(engine, engine.autoDjTrackIndex >= 0 ? engine.autoDjTrackIndex : Math.floor(Math.random() * AUTO_DJ_PLAYLIST.length));
      scheduleAutoDjRetry(engine);
      notifyEngineState(engine);
    }

    function handleManagedStreamFailure(engine, reason) {
      if (!engine || !engine.wantPlay) return;
      if (shouldAllowAutoDjForEngine(engine) && AUTO_DJ_PLAYLIST.length) {
        startAutoDjFallback(engine, reason);
        return;
      }
      stopAutoDjMode(engine);
      engine.waitingForAudio = true;
      engine.audioDetected = false;
      engine.silenceStartedAt = 0;
      clearAudioDetection(engine);
      detachSource(engine);
      engine.wantPlay = true;
      notifyEngineState(engine);
    }

    function engineFromControl(control) {
      if (!control) return actualPlayers[0] ? engines.get(actualPlayers[0].getAttribute('data-id')) : null;
      var host = control.classList.contains('re-element') ? control : control.closest('.re-element');
      if (!host) return actualPlayers[0] ? engines.get(actualPlayers[0].getAttribute('data-id')) : null;
      if (host.classList.contains('re-type-player')) return engines.get(host.getAttribute('data-id')) || null;
      var linkedId = host.getAttribute('data-linked-player-id');
      if (linkedId && engines.has(linkedId)) return engines.get(linkedId);
      var ownUrl = String(host.getAttribute('data-radio-url') || '').trim();

      if (ownUrl) {
        for (var i = 0; i < actualPlayers.length; i += 1) {
          var playerHost = actualPlayers[i];
          var playerUrl = String(playerHost.getAttribute('data-radio-url') || '').trim();
          if (playerUrl && (playerUrl === ownUrl || radioUrlsMatch(playerUrl, ownUrl))) {
            return engines.get(playerHost.getAttribute('data-id')) || null;
          }
        }
      }

      if (!linkedId && actualPlayers.length === 1) {
        var onlyPlayer = actualPlayers[0];
        var onlyPlayerUrl = String(onlyPlayer.getAttribute('data-radio-url') || '').trim();
        if (!ownUrl || !onlyPlayerUrl || ownUrl === onlyPlayerUrl) {
          return engines.get(onlyPlayer.getAttribute('data-id')) || null;
        }
      }

      if (ownUrl) {
        var runtimeId = host.getAttribute('data-runtime-player-id');
        if (!runtimeId) {
          runtimeId = 'virtual-' + btoa(unescape(encodeURIComponent(ownUrl))).replace(/[^a-z0-9]/gi, '').slice(0, 24);
          host.setAttribute('data-runtime-player-id', runtimeId);
        }
        if (!engines.has(runtimeId)) {
          var audio = new Audio();
          var engine = createEngine(runtimeId, audio, null);
          engine.onStateChange = function () { syncAll(); };
          engines.set(runtimeId, engine);
          attachSource(engine, ownUrl);
          ['play', 'pause', 'ended', 'volumechange', 'playing', 'canplay', 'canplaythrough', 'loadstart', 'loadedmetadata', 'waiting', 'stalled'].forEach(function (eventName) {
            audio.addEventListener(eventName, function () { syncAll(); });
          });
          audio.addEventListener('error', function () { if (!engine.isAutoDjActive && isManagedRadioUrl(engine.lastUrl)) { handleManagedStreamFailure(engine, 'error'); return; } syncAll(); });
        }
        return engines.get(runtimeId);
      }
      return actualPlayers[0] ? engines.get(actualPlayers[0].getAttribute('data-id')) : null;
    }

    function matchesEngine(host, engine) {
      if (!host || !engine) return false;
      if (host.classList.contains('re-type-player')) return host.getAttribute('data-id') === engine.id;
      if (host.getAttribute('data-linked-player-id')) return host.getAttribute('data-linked-player-id') === engine.id;
      if (host.classList.contains('re-type-vinyl') && !host.getAttribute('data-linked-player-id') && actualPlayers.length === 1) return engine.id === actualPlayers[0].getAttribute('data-id');
      if (host.getAttribute('data-runtime-player-id')) return host.getAttribute('data-runtime-player-id') === engine.id;
      if (host.getAttribute('data-radio-url') && radioUrlsMatch(engine.lastUrl, host.getAttribute('data-radio-url'))) return true;
      var firstPlayer = actualPlayers[0];
      return !!firstPlayer && engine.id === firstPlayer.getAttribute('data-id');
    }

    function syncHost(host, engine) {
      if (!host || !engine) return;
      var audio = engine.audio;
      var started = !!engine.wantPlay;
      var muted = !!audio && (!!audio.muted || Number(audio.volume || 0) === 0);
      var liveActive = started && !!engine.audioDetected && !!audio && !audio.paused && !audio.ended;
      var autoDjActive = started && !!engine.isAutoDjActive;
      var loading = started && !liveActive && !autoDjActive && !!engine.waitingForAudio && !muted;
      var volumeValue = Math.round(Math.max(0, Math.min(1, Number(audio.volume || 0))) * 100);
      host.classList.toggle('is-playing', started);
      host.classList.toggle('is-live-active', liveActive || autoDjActive);
      host.classList.toggle('is-loading', loading);
      host.classList.toggle('is-muted', muted);
      host.classList.toggle('is-autodj', autoDjActive);
      var live = host.querySelector('.re-live-badge');
      if (live) {
        var liveText = live.querySelector('span:last-child');
        live.hidden = !(liveActive || loading || autoDjActive);
        live.classList.toggle('is-loading', loading);
        live.classList.toggle('is-live', liveActive || autoDjActive);
        if (liveText) liveText.textContent = autoDjActive ? 'AUTO DJ' : (loading ? 'CARREGANDO AGUARDE' : 'AO VIVO');
      }
      var muteBtn = host.querySelector('.re-mute-btn');
      if (muteBtn) {
        muteBtn.setAttribute('aria-label', muted ? 'Desmutar' : 'Mutar');
        muteBtn.setAttribute('title', muted ? 'Desmutar' : 'Mutar');
      }
      var slider = host.querySelector('.re-volume-slider');
      if (slider && String(slider.value) !== String(volumeValue)) slider.value = String(volumeValue);
      if (slider) updateSliderAppearance(slider);
    }

    function switchEngineStream(engine, desiredUrl) {
      var safeUrl = String(desiredUrl || '').trim();
      if (!engine || !safeUrl) return;
      if (engine.isAutoDjActive && normalizeRadioUrl(safeUrl) === getConfiguredDefaultRadioStreamUrl(engine.hostNode || document.body)) stopAutoDjMode(engine);
      if (normalizeRadioUrl(engine.lastUrl) === normalizeRadioUrl(safeUrl)) return;
      var shouldResume = !!engine.wantPlay;
      var volume = Number(engine.audio.volume || engine.defaultVolume || 1);
      var muted = !!engine.audio.muted;
      engine.waitingForAudio = shouldResume;
      engine.audioDetected = false;
      engine.silenceStartedAt = 0;
      clearAudioDetection(engine);
      attachSource(engine, safeUrl).then(function () {
        engine.audio.volume = Math.max(0, Math.min(1, volume));
        engine.audio.muted = muted;
        if (!shouldResume) {
          notifyEngineState(engine);
          return;
        }
        ensureAudioAnalyser(engine);
        notifyEngineState(engine);
        resumeAudioContext(engine).then(function () {
          var playPromise = engine.audio.play();
          if (playPromise && typeof playPromise.catch === 'function') {
            playPromise.catch(function () {
              handleManagedStreamFailure(engine, 'play-catch');
            });
          }
          startAudioDetection(engine);
          setTimeout(syncAll, 20);
          setTimeout(syncAll, 180);
          setTimeout(syncAll, 600);
        });
      });
    }

    function syncManagedStreams() {
      engines.forEach(function (engine) {
        var host = engine.hostNode || null;
        var baseUrl = host && host.getAttribute ? String(host.getAttribute('data-radio-url') || '').trim() : '';
        if (!isManagedRadioUrl(baseUrl, host || document.body) && !isManagedRadioUrl(engine.lastUrl, host || document.body)) return;
        var desiredUrl = resolvePreferredRadioUrl(host || document.body);
        if (!desiredUrl) return;

        if (engine.isAutoDjActive) {
          if (!shouldAllowAutoDjForEngine(engine)) {
            stopAutoDjMode(engine);
            switchEngineStream(engine, desiredUrl);
            return;
          }
          scheduleAutoDjRetry(engine);
          return;
        }

        if (!radioUrlsMatch(engine.lastUrl, desiredUrl) || normalizeRadioUrl(engine.lastUrl) !== normalizeRadioUrl(desiredUrl)) {
          switchEngineStream(engine, desiredUrl);
        }
      });
    }

    function syncAll() {
      engines.forEach(function (engine) {
        controls.forEach(function (host) {
          if (matchesEngine(host, engine)) syncHost(host, engine);
        });
      });
    }

    function stopEngine(engine) {
      if (!engine) return;
      engine.wantPlay = false;
      engine.waitingForAudio = false;
      engine.audioDetected = false;
      engine.silenceStartedAt = 0;
      clearAudioDetection(engine);
      stopAutoDjMode(engine);
      detachSource(engine);
      try { if (Number.isFinite(engine.audio.currentTime)) engine.audio.currentTime = 0; } catch (_error) {}
      notifyEngineState(engine);
    }

    function setPlayState(control, shouldPlay) {
      var engine = engineFromControl(control);
      if (!engine) return;
      var url = '';
      var controlHost = control && (control.classList.contains('re-element') ? control : control.closest('.re-element'));
      if (engine.hostNode) url = resolvePreferredRadioUrl(engine.hostNode);
      if (!url && controlHost) url = resolvePreferredRadioUrl(controlHost);
      if (!url) url = resolveManagedRadioUrl(null, controlHost || engine.hostNode || document.body);
      if (shouldPlay) {
        stopAutoDjMode(engine);
        engine.wantPlay = true;
        engine.waitingForAudio = true;
        engine.audioDetected = false;
        engine.silenceStartedAt = 0;
        ensureAudioAnalyser(engine);
        notifyEngineState(engine);
        attachSource(engine, url).then(function () {
          try {
            if (engine.audio.readyState < 2) engine.audio.load();
          } catch (_error) {}
          resumeAudioContext(engine).then(function () {
            var p = engine.audio.play();
            if (p && typeof p.catch === 'function') {
              p.catch(function () {
                handleManagedStreamFailure(engine, 'play-catch');
              });
            }
            startAudioDetection(engine);
            setTimeout(syncAll, 20);
            setTimeout(syncAll, 180);
            setTimeout(syncAll, 600);
          });
        });
      } else {
        stopEngine(engine);
        setTimeout(syncAll, 20);
        setTimeout(syncAll, 180);
      }
    }

    function toggleMute(control) {
      var engine = engineFromControl(control);
      if (!engine) return;
      engine.audio.muted = !engine.audio.muted;
      notifyEngineState(engine);
    }

    function setVolume(control, value) {
      var engine = engineFromControl(control);
      if (!engine) return;
      engine.audio.volume = Math.max(0, Math.min(1, Number(value || 0) / 100));
      persistVolume(engine.audio.volume);
      if (engine.audio.volume > 0 && engine.audio.muted) engine.audio.muted = false;
      var host = control && (control.classList.contains('re-element') ? control : control.closest('.re-element'));
      var slider = host ? host.querySelector('.re-volume-slider') : null;
      if (slider) updateSliderAppearance(slider);
      notifyEngineState(engine);
    }

    Array.prototype.slice.call(document.querySelectorAll('.re-play-btn')).forEach(function (btn) {
      btn.addEventListener('click', function () {
        var host = btn.closest('.re-element') || btn.parentElement;
        var engine = engineFromControl(host);
        if (!engine) return;
        setPlayState(host, !engine.wantPlay);
      });
    });
    Array.prototype.slice.call(document.querySelectorAll('.re-mute-btn')).forEach(function (btn) {
      btn.addEventListener('click', function () { toggleMute(btn.closest('.re-element') || btn.parentElement); });
    });
    Array.prototype.slice.call(document.querySelectorAll('.re-volume-slider')).forEach(function (slider) {
      updateSliderAppearance(slider);
      slider.addEventListener('input', function () {
        updateSliderAppearance(slider);
        setVolume(slider.closest('.re-element') || slider.parentElement, slider.value);
      });
    });

    syncManagedStreams();
    setInterval(syncManagedStreams, 1000);
    syncAll();
  }



  function bindResponsiveStage() {
    var stage = document.getElementById('page-stage');
    var wrapper = document.getElementById('page-stage-wrapper');
    if (!stage || !wrapper) return;

    function getViewportBox() {
      var vv = window.visualViewport;
      return {
        width: Math.max(1, Math.round((vv && vv.width) || document.documentElement.clientWidth || window.innerWidth || 0)),
        height: Math.max(1, Math.round((vv && vv.height) || document.documentElement.clientHeight || window.innerHeight || 0))
      };
    }

    function isTouchDevice() {
      return !!(
        (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) ||
        navigator.maxTouchPoints > 0 ||
        /Android|iPhone|iPad|iPod|Mobile|Tablet/i.test(navigator.userAgent || '')
      );
    }

    var scheduled = false;
    function getDesktopContentHeight() {
      var maxBottom = 0;
      Array.prototype.slice.call(stage.querySelectorAll('.re-element')).forEach(function (el) {
        var rectBottom = el.offsetTop + el.offsetHeight;
        if (rectBottom > maxBottom) maxBottom = rectBottom;
      });
      return Math.max(1, Math.ceil(maxBottom + 8));
    }

    function updateStageScale() {
      scheduled = false;
      var rootStyle = getComputedStyle(document.documentElement);
      var baseWidth = parseFloat(rootStyle.getPropertyValue('--re-stage-width')) || 1380;
      var baseHeight = parseFloat(rootStyle.getPropertyValue('--re-stage-height')) || 1008;
      var viewport = getViewportBox();
      var touch = isTouchDevice();
      var portrait = viewport.height >= viewport.width;
      var narrowScreen = viewport.width <= 900;
      var useTouchLandscape = touch && !portrait;
      var gutter = useTouchLandscape ? 0 : (narrowScreen ? 0 : 24);
      var availableWidth = Math.max(1, viewport.width - gutter);
      var availableHeight = Math.max(1, viewport.height - (touch ? 0 : 12));
      var widthScale = availableWidth / baseWidth;
      var heightScale = availableHeight / baseHeight;
      var scale = useTouchLandscape ? widthScale : Math.min(1, widthScale);
      if (!useTouchLandscape && touch && portrait) {
        scale = Math.min(1, widthScale);
      }
      var scaledWidth = Math.max(1, Math.round(baseWidth * scale));
      var effectiveContentHeight = useTouchLandscape ? Math.min(baseHeight, getDesktopContentHeight()) : baseHeight;
      var scaledHeight = Math.max(1, Math.round(effectiveContentHeight * scale));

      document.body.classList.toggle('re-touch-device', touch);
      document.body.classList.toggle('re-touch-portrait', touch && portrait);
      document.body.classList.toggle('re-touch-landscape', touch && !portrait);
      document.body.classList.toggle('re-desktop-device', !touch);

      wrapper.style.width = scaledWidth + 'px';
      wrapper.style.height = scaledHeight + 'px';
      wrapper.style.maxWidth = '100%';
      stage.style.transformOrigin = 'top left';
      stage.style.transform = 'translateZ(0) scale(' + scale + ')';
      document.body.style.minHeight = Math.max(scaledHeight, viewport.height) + 'px';
      document.body.style.width = '100%';
    }

    function requestUpdate() {
      if (scheduled) return;
      scheduled = true;
      window.requestAnimationFrame(updateStageScale);
    }

    updateStageScale();
    window.addEventListener('resize', requestUpdate, { passive: true });
    window.addEventListener('orientationchange', requestUpdate, { passive: true });
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', requestUpdate, { passive: true });
      window.visualViewport.addEventListener('scroll', requestUpdate, { passive: true });
    }
  }


  function bindFooterCopyrightTheme() {
    var footer = document.querySelector('.re-footer-copyright');
    if (!footer) return;

    function parsePx(value) {
      var n = parseFloat(String(value || '').replace('px', '').trim());
      return isFinite(n) ? n : 0;
    }

    function readInlineMetric(el, prop) {
      if (!el) return 0;
      return parsePx(el.style && el.style[prop] ? el.style[prop] : '');
    }

    function findStripBehindFooter() {
      var footerTop = readInlineMetric(footer, 'top');
      var footerLeft = readInlineMetric(footer, 'left');
      var footerWidth = readInlineMetric(footer, 'width');
      var candidates = Array.prototype.slice.call(document.querySelectorAll('.re-type-shape'));
      var best = null;
      var bestScore = Infinity;

      candidates.forEach(function (shape) {
        var top = readInlineMetric(shape, 'top');
        var left = readInlineMetric(shape, 'left');
        var width = readInlineMetric(shape, 'width');
        var height = readInlineMetric(shape, 'height');
        if (!width || !height) return;
        if (height > 50) return;
        if (Math.abs(top - footerTop) > 18) return;
        if (width < Math.max(footerWidth, 400)) return;
        var score = Math.abs(top - footerTop) + Math.abs(left - footerLeft);
        if (score < bestScore) {
          bestScore = score;
          best = shape;
        }
      });

      return best;
    }

    function applyFooterTheme() {
      var root = document.documentElement;
      var body = document.body;
      var isDark = root.classList.contains('re-dark-theme') || body.classList.contains('re-dark-theme');
      var strip = findStripBehindFooter();
      if (strip) {
        strip.style.display = 'none';
        strip.setAttribute('aria-hidden', 'true');
      }

      var left = strip ? readInlineMetric(strip, 'left') : readInlineMetric(footer, 'left');
      var top = strip ? readInlineMetric(strip, 'top') : readInlineMetric(footer, 'top');
      var width = strip ? readInlineMetric(strip, 'width') : readInlineMetric(footer, 'width');
      var height = strip ? readInlineMetric(strip, 'height') : Math.max(32, readInlineMetric(footer, 'height'));
      if (width > 0) footer.style.width = width + 'px';
      if (height > 0) footer.style.height = height + 'px';
      if (left > 0) footer.style.left = left + 'px';
      footer.style.top = top + 'px';
      footer.style.background = isDark ? '#000000' : '#ffffff';
      footer.style.color = isDark ? '#ffffff' : '#000000';
      footer.style.opacity = '1';
      footer.style.borderRadius = '9px';
      footer.style.display = 'flex';
      footer.style.alignItems = 'center';
      footer.style.justifyContent = 'center';
      footer.style.textAlign = 'center';
      footer.style.padding = '0 16px';
      footer.style.boxSizing = 'border-box';
      footer.style.zIndex = '29';
      footer.style.lineHeight = '1.1';
      footer.style.fontSize = '22px';
      footer.style.fontWeight = '500';

      var inner = footer.querySelector('.re-text-inner');
      if (inner) {
        inner.style.width = '100%';
        inner.style.margin = '0';
        inner.style.color = isDark ? '#ffffff' : '#000000';
        inner.style.background = 'transparent';
        inner.style.textAlign = 'center';
        inner.style.lineHeight = '1.1';
      }
    }

    applyFooterTheme();
    window.addEventListener('resize', applyFooterTheme, { passive: true });
  }

  function bindThemeToggles() {
    var root = document.documentElement;
    var body = document.body;
    var stage = document.getElementById('page-stage');

    function readStoredTheme() {
      try { return localStorage.getItem(THEME_STORAGE_KEY) || ''; } catch (_error) { return ''; }
    }

    function persistTheme(isDark) {
      try { localStorage.setItem(THEME_STORAGE_KEY, isDark ? 'dark' : 'light'); } catch (_error) {}
    }

    function applyTheme(isDark) {
      root.classList.toggle('re-dark-theme', !!isDark);
      body.classList.toggle('re-dark-theme', !!isDark);
    }

    function sync() {
      var isDark = root.classList.contains('re-dark-theme') || body.classList.contains('re-dark-theme');
      Array.prototype.slice.call(document.querySelectorAll('.re-theme-toggle-btn')).forEach(function (btn) {
        btn.classList.toggle('is-dark', isDark);
      });
      Array.prototype.slice.call(document.querySelectorAll('.re-theme-icon-box')).forEach(function (box) {
        box.classList.toggle('is-dark', isDark);
      });
      if (stage) stage.setAttribute('data-theme', isDark ? 'dark' : 'light');
      bindFooterCopyrightTheme();
    }

    applyTheme(readStoredTheme() === 'dark');

    Array.prototype.slice.call(document.querySelectorAll('.re-theme-toggle-btn')).forEach(function (btn) {
      btn.addEventListener('click', function () {
        var nextIsDark = !(root.classList.contains('re-dark-theme') || body.classList.contains('re-dark-theme'));
        applyTheme(nextIsDark);
        persistTheme(nextIsDark);
        sync();
      });
    });

    sync();
  }

  function parseScheduleItemsFromWidget(widget) {
    return parseScheduleItemsFromWidgetFallback(widget);
  }

  function parseScheduleLayout(widget) {
    var raw = widget.getAttribute('data-schedule-layout') || '';
    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        return {
          photoFrameX: Number(parsed.photoFrameX || 0),
          photoFrameY: Number(parsed.photoFrameY || 0),
          photoFrameW: Math.max(20, Number(parsed.photoFrameW || 132)),
          photoFrameH: Math.max(20, Number(parsed.photoFrameH || 106)),
          titleX: Number(parsed.titleX || 146),
          titleY: Number(parsed.titleY || 14),
          hostX: Number(parsed.hostX || 146),
          hostY: Number(parsed.hostY || 48),
          timeX: Number(parsed.timeX || 146),
          timeY: Number(parsed.timeY || 80)
        };
      } catch (_error) {}
    }
    return { photoFrameX: 0, photoFrameY: 0, photoFrameW: 132, photoFrameH: 106, titleX: 146, titleY: 14, hostX: 146, hostY: 48, timeX: 146, timeY: 80 };
  }


  function bindNewsWidgets() {
    var widgets = Array.prototype.slice.call(document.querySelectorAll('.re-type-news'));
    widgets.forEach(function (widget) {
      var list = widget.querySelector('.re-news-list');
      if (!list) return;
      var apiUrl = widget.getAttribute('data-news-api-url') || 'https://api.rss2json.com/v1/api.json?rss_url=https://g1.globo.com/rss/g1/';
      var maxItems = Math.max(1, Math.min(20, Number(widget.getAttribute('data-news-count') || 8) || 8));
      var itemsPerView = Math.max(1, Math.min(3, Number(widget.getAttribute('data-news-items-per-view') || 2) || 2));
      var rotateSeconds = Math.max(15, Math.min(60, Number(widget.getAttribute('data-news-rotate-seconds') || 15) || 15));
      var errorText = widget.getAttribute('data-news-error-text') || 'Erro ao carregar';
      var rotationTimer = null;
      list.textContent = 'Carregando...';
      fetch(apiUrl).then(function (res) {
        return res.json();
      }).then(function (data) {
        var items = Array.isArray(data && data.items) ? data.items.slice(0, maxItems) : [];
        if (!items.length) throw new Error('Sem notícias');
        var groupStart = 0;
        function renderGroup() {
          list.innerHTML = '';
          var group = items.slice(groupStart, groupStart + itemsPerView);
          if (!group.length) {
            groupStart = 0;
            group = items.slice(0, itemsPerView);
          }
          group.forEach(function (item) {
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
            list.appendChild(row);
          });
        }
        renderGroup();
        if (rotationTimer) clearInterval(rotationTimer);
        if (items.length > itemsPerView) {
          rotationTimer = setInterval(function () {
            if (document.hidden) return;
            groupStart += itemsPerView;
            if (groupStart >= items.length) groupStart = 0;
            renderGroup();
          }, rotateSeconds * 1000);
        }
      }).catch(function () {
        list.textContent = errorText;
      });
    });
  }

  function defaultWeatherLayout(raw) {
    raw = raw || {};
    return {
      cityX: Number.isFinite(Number(raw.cityX)) ? Number(raw.cityX) : 32,
      cityY: Number.isFinite(Number(raw.cityY)) ? Number(raw.cityY) : 34,
      tempX: Number.isFinite(Number(raw.tempX)) ? Number(raw.tempX) : 32,
      tempY: Number.isFinite(Number(raw.tempY)) ? Number(raw.tempY) : 106,
      cityFontSize: Math.max(8, Number.isFinite(Number(raw.cityFontSize)) ? Number(raw.cityFontSize) : 24),
      tempFontSize: Math.max(8, Number.isFinite(Number(raw.tempFontSize)) ? Number(raw.tempFontSize) : 58),
      cityManual: raw.cityManual === true,
      tempManual: raw.tempManual === true,
      cityAutoYRatio: Number.isFinite(Number(raw.cityAutoYRatio)) ? Number(raw.cityAutoYRatio) : 0.15,
      tempAutoYRatio: Number.isFinite(Number(raw.tempAutoYRatio)) ? Number(raw.tempAutoYRatio) : 0.45
    };
  }

  function parseWeatherLayout(widget) {
    var raw = widget.getAttribute('data-weather-layout') || '';
    if (raw) {
      try {
        return defaultWeatherLayout(JSON.parse(raw));
      } catch (_error) {}
    }
    return defaultWeatherLayout({});
  }

  function applyWeatherTextLayout(widget, node, layout, key) {
    if (!widget || !node) return;
    var isCity = key === 'city';
    var manual = !!(isCity ? layout.cityManual : layout.tempManual);
    var ratio = Number(isCity ? layout.cityAutoYRatio : layout.tempAutoYRatio);
    var top = manual
      ? Number(isCity ? layout.cityY : layout.tempY)
      : Math.round(widget.clientHeight * (Number.isFinite(ratio) ? ratio : (isCity ? 0.15 : 0.45)));
    node.style.top = top + 'px';
    node.style.fontSize = Math.max(8, Number(isCity ? layout.cityFontSize : layout.tempFontSize) || (isCity ? 24 : 58)) + 'px';
    if (manual) {
      node.style.left = Number(isCity ? layout.cityX : layout.tempX) + 'px';
      node.style.transform = 'none';
    } else {
      node.style.left = '50%';
      node.style.transform = 'translateX(-50%)';
    }
  }

  function bindWeatherWidgets() {
    var widgets = Array.prototype.slice.call(document.querySelectorAll('.re-type-weather-rio'));
    widgets.forEach(function (widget) {
      var cityEl = widget.querySelector('.re-weather-city');
      var tempEl = widget.querySelector('.re-weather-temp');
      var layout = parseWeatherLayout(widget);
      applyWeatherTextLayout(widget, cityEl, layout, 'city');
      applyWeatherTextLayout(widget, tempEl, layout, 'temp');
      var apiUrl = widget.getAttribute('data-weather-api-url') || 'https://api.open-meteo.com/v1/forecast?latitude=-22.9068&longitude=-43.1729&current_weather=true&timezone=America/Sao_Paulo';
      fetch(apiUrl).then(function (res) { return res.json(); }).then(function (data) {
        var weather = data && data.current_weather ? data.current_weather : null;
        var temp = Number(weather && weather.temperature);
        if (tempEl) tempEl.textContent = Number.isFinite(temp) ? temp.toFixed(1) + '°C' : '--.-°C';
      }).catch(function (error) {
        console.error('Erro ao buscar clima:', error);
        if (tempEl) tempEl.textContent = '--.-°C';
      });
    });
  }

  function bindImageLoops() {
    var widgets = Array.prototype.slice.call(document.querySelectorAll('.re-type-image-loop'));
    widgets.forEach(function (widget) {
      var img = widget.querySelector('.re-image-loop-img');
      if (!img) return;

      var items = [];
      var links = [];
      try { items = JSON.parse(widget.getAttribute('data-image-loop-images') || '[]'); } catch (_error) {}
      try { links = JSON.parse(widget.getAttribute('data-image-loop-links') || '[]'); } catch (_error2) {}
      items = Array.isArray(items) ? items.filter(Boolean) : [];
      links = Array.isArray(links) ? links : [];
      if (!items.length) return;

      var index = 0;
      var seconds = Math.max(15, Number(widget.getAttribute('data-image-loop-seconds') || 15) || 15);
      var linkEl = widget.querySelector('.re-image-loop-link');
      var existingFillLink = widget.querySelector('.re-link-fill');
      if (!linkEl) {
        if (existingFillLink && existingFillLink.querySelector('.re-image-loop-box')) {
          linkEl = existingFillLink;
          linkEl.classList.add('re-image-loop-link');
        } else {
          linkEl = document.createElement('a');
          linkEl.className = 're-link-fill re-image-loop-link';
          linkEl.target = '_blank';
          linkEl.rel = 'noopener';
          linkEl.setAttribute('aria-label', 'Abrir link do banner');
          widget.appendChild(linkEl);
        }
      }

      function applyLink(idx) {
        var href = String(links[idx] || '').trim();
        var clickable = !!href;
        widget.classList.toggle('is-clickable', clickable);
        if (clickable) {
          linkEl.href = href;
          linkEl.hidden = false;
          linkEl.style.pointerEvents = 'auto';
          linkEl.setAttribute('aria-hidden', 'false');
        } else {
          linkEl.removeAttribute('href');
          linkEl.hidden = true;
          linkEl.style.pointerEvents = 'none';
          linkEl.setAttribute('aria-hidden', 'true');
        }
      }

      function applySlide(idx) {
        img.src = items[idx];
        img.style.opacity = '1';
        applyLink(idx);
      }

      img.style.opacity = '1';
      img.style.transition = 'opacity .45s ease';
      applySlide(index);

      if (items.length > 1) {
        setInterval(function () {
          if (document.hidden) return;
          index = (index + 1) % items.length;
          img.style.opacity = '0';
          setTimeout(function () {
            applySlide(index);
          }, 220);
        }, seconds * 1000);
      }
    });
  }

  function bindRadioMetadataWidgets() {
    if (typeof window.UniversalRadioMetadata !== 'function') return;
    var widgets = Array.prototype.slice.call(document.querySelectorAll('.re-type-radio-metadata'));
    widgets.forEach(function (widget) {
      if (widget.__radioMetadataBound) return;
      widget.__radioMetadataBound = true;
      try {
        var metadataUrl = widget.getAttribute('data-metadata-url') || '';
        var stationName = widget.getAttribute('data-station-name') || 'Minha Rádio';
        var defaultCover = widget.getAttribute('data-default-cover') || 'assets/base/logo.png';
        widget.innerHTML = '<div class="re-radio-metadata-shell"></div>';
        widget.__radioMetadataInstance = new window.UniversalRadioMetadata({
          mount: widget.querySelector('.re-radio-metadata-shell'),
          stationName: stationName,
          defaultCover: defaultCover,
          metadata: {
            type: 'sse',
            url: metadataUrl,
            jsonField: 'streamTitle'
          },
          deezer: {
            enabled: true,
            limit: 6,
            timeoutMs: 5000
          },
          theme: {
            injectCss: true,
            borderRadius: '18px',
            gap: '16px'
          }
        }).start();
      } catch (error) {
        console.error('Erro ao iniciar metadata da rádio:', error);
      }
    });
  }

  function bindSchedules() {
    var fullWidgets = Array.prototype.slice.call(document.querySelectorAll('.re-type-schedule'));
    var photoWidgets = Array.prototype.slice.call(document.querySelectorAll('.re-type-schedule-photo-current'));
    var vinylWidgets = Array.prototype.slice.call(document.querySelectorAll('.re-type-vinyl'));
    var allWidgets = fullWidgets.concat(photoWidgets, vinylWidgets);

    function ensureWidgetPrograms(widget, forceFresh) {
      if (!forceFresh && widget.__reScheduleItems && widget.__reScheduleItems.length) return Promise.resolve(widget.__reScheduleItems);
      if (!forceFresh && widget.__reScheduleItemsPromise) return widget.__reScheduleItemsPromise;
      widget.__reScheduleItemsPromise = loadProgramsForWidget(widget, { forceFresh: !!forceFresh }).then(function (items) {
        widget.__reScheduleItems = items;
        widget.__reScheduleItemsPromise = null;
        return items;
      }, function () {
        widget.__reScheduleItems = parseScheduleItemsFromWidgetFallback(widget);
        widget.__reScheduleItemsPromise = null;
        return widget.__reScheduleItems;
      });
      return widget.__reScheduleItemsPromise;
    }

    function renderFullWidget(widget, items) {
      var now = currentClockContext(widget);
      var current = findProgram(items, now);
      var layout = parseScheduleLayout(widget);
      var titleEl = widget.querySelector('.re-schedule-title');
      var hostEl = widget.querySelector('.re-schedule-host');
      var timeEl = widget.querySelector('.re-schedule-time');
      var photoFrame = widget.querySelector('.re-schedule-photo-frame');
      var imageEl = widget.querySelector('.re-schedule-image');
      if (photoFrame) {
        photoFrame.style.left = layout.photoFrameX + 'px';
        photoFrame.style.top = layout.photoFrameY + 'px';
        photoFrame.style.width = layout.photoFrameW + 'px';
        photoFrame.style.height = layout.photoFrameH + 'px';
      }
      if (titleEl) { titleEl.style.left = layout.titleX + 'px'; titleEl.style.top = layout.titleY + 'px'; }
      if (hostEl) { hostEl.style.left = layout.hostX + 'px'; hostEl.style.top = layout.hostY + 'px'; }
      if (timeEl) { timeEl.style.left = layout.timeX + 'px'; timeEl.style.top = layout.timeY + 'px'; }
      if (!current) {
        if (titleEl) titleEl.textContent = 'Sem programação';
        if (hostEl) hostEl.textContent = '';
        if (timeEl) timeEl.textContent = '';
        if (imageEl) imageEl.style.display = 'none';
        return;
      }
      if (titleEl) titleEl.textContent = current.title || 'Programa';
      if (hostEl) hostEl.textContent = current.host || current.locutor || '';
      if (timeEl) timeEl.textContent = (current.start || '') + ' às ' + (current.end || '');
      if (imageEl) {
        if (current.image) {
          setFreshImageSource(imageEl, current.image, now && now.isoLocal ? now.isoLocal : Date.now());
          imageEl.style.display = '';
          imageEl.style.transform = 'translate(' + Number(current.photoX || 0) + 'px, ' + Number(current.photoY || 0) + 'px) scale(' + Math.max(0.1, Number(current.photoZoom || 1)) + ')';
        } else {
          imageEl.style.display = 'none';
        }
      }
    }

    function renderPhotoWidget(widget, items) {
      var now = currentClockContext(widget);
      var current = findProgram(items, now);
      var imageEl = widget.querySelector('.re-current-program-photo');
      if (!imageEl) return;
      if (!current || !current.image) {
        imageEl.style.display = 'none';
        return;
      }
      setFreshImageSource(imageEl, current.image, now && now.isoLocal ? now.isoLocal : Date.now());
      imageEl.style.display = '';
    }

    function renderVinylWidget(widget, items) {
      var now = currentClockContext(widget);
      var current = findProgram(items, now);
      var imageEl = widget.querySelector('.re-vinyl-image');
      if (!imageEl) return;
      var src = current && current.vinyl ? current.vinyl : DEFAULT_VINYL_PATH;
      setFreshImageSource(imageEl, src, now && now.isoLocal ? now.isoLocal : Date.now());
      imageEl.style.display = '';
    }

    function renderWidget(widget, items) {
      if (fullWidgets.indexOf(widget) !== -1) renderFullWidget(widget, items || []);
      if (photoWidgets.indexOf(widget) !== -1) renderPhotoWidget(widget, items || []);
      if (vinylWidgets.indexOf(widget) !== -1) renderVinylWidget(widget, items || []);
    }

    function renderFromCache() {
      allWidgets.forEach(function (widget) {
        primeClockForWidget(widget);
        var items = widget.__reScheduleItems;
        if (!items || !items.length) items = parseScheduleItemsFromWidgetFallback(widget);
        renderWidget(widget, items || []);
      });
    }

    function refreshFromSource() {
      allWidgets.forEach(function (widget) {
        primeClockForWidget(widget);
        ensureWidgetPrograms(widget, true).then(function (items) {
          renderWidget(widget, items || []);
        }, function () {
          renderWidget(widget, parseScheduleItemsFromWidgetFallback(widget));
        });
      });
    }

    if (!allWidgets.length) return;

    allWidgets.forEach(function (widget) { primeClockForWidget(widget); });
    refreshFromSource();
    renderFromCache();

    var lastRenderKey = '';
    var lastSourceRefreshAt = 0;

    var isPageVisible = true;
    var lastHiddenRefreshAt = 0;
    document.addEventListener('visibilitychange', function() {
      isPageVisible = !document.hidden;
      tick(true);
    });

    function tick(force) {
      var nowTs = Date.now();
      if (!isPageVisible && !force) {
        if (!lastHiddenRefreshAt || (nowTs - lastHiddenRefreshAt) >= 30000) {
          lastHiddenRefreshAt = nowTs;
          renderFromCache();
          if (!lastSourceRefreshAt || (nowTs - lastSourceRefreshAt) >= 240000) {
            lastSourceRefreshAt = nowTs;
            refreshFromSource();
          }
        }
        return;
      }

      var clock = currentRuntimeClockContext();
      var renderKey = clock && clock.isoLocal ? clock.isoLocal : String(nowTs);
      if (force || renderKey !== lastRenderKey) {
        lastRenderKey = renderKey;
        renderFromCache();
      }
      if (!lastSourceRefreshAt || (nowTs - lastSourceRefreshAt) >= 240000) {
        lastSourceRefreshAt = nowTs;
        refreshFromSource();
      }
    }

    setInterval(tick, 1000);
  }


  function bindMapPollWidget() {
    var slot = document.querySelector('.re-map-poll-slot');
    if (!slot) return;
    var image = slot.querySelector('.re-map-poll-image');
    var frame = slot.querySelector('.re-map-poll-frame');
    if (!image || !frame) return;

    var STATE_URL = 'https://jovial-chaja-1bae9e.netlify.app/.netlify/functions/state-public';
    var WIDGET_URL = 'https://jovial-chaja-1bae9e.netlify.app/widget.html';
    var CHECK_INTERVAL = 15 * 60 * 1000;
    var lastMode = '';

    function applyMode(mode) {
      var safeMode = String(mode || 'map').toLowerCase();
      var showWidget = safeMode === 'poll' || safeMode === 'result';
      if (showWidget) {
        slot.classList.add('is-poll-active');
        if (!frame.getAttribute('src') || frame.getAttribute('src') === 'about:blank') {
          frame.setAttribute('src', WIDGET_URL);
        }
      } else {
        slot.classList.remove('is-poll-active');
        if (frame.getAttribute('src') && frame.getAttribute('src') !== 'about:blank') {
          frame.setAttribute('src', 'about:blank');
        }
      }
      lastMode = safeMode;
    }

    function checkState() {
      fetch(STATE_URL, {
        cache: 'no-store',
        headers: { 'Accept': 'application/json' }
      }).then(function (res) {
        if (!res.ok) throw new Error('Falha ao consultar enquete');
        return res.json();
      }).then(function (data) {
        var mode = data && data.mode ? data.mode : (data && data.state && data.state.mode ? data.state.mode : 'map');
        applyMode(mode);
      }).catch(function () {
        if (!lastMode) applyMode('map');
      });
    }

    applyMode('map');
    checkState();
    setInterval(checkState, CHECK_INTERVAL);
  }

  document.addEventListener('DOMContentLoaded', function () {
    bindPlayers();
    bindResponsiveStage();
    bindThemeToggles();
    bindNewsWidgets();
    bindWeatherWidgets();
    bindImageLoops();
    bindRadioMetadataWidgets();
    bindSchedules();
    bindMapPollWidget();
  });
})();