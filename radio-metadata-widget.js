(function (global) {
  'use strict';

  const DEFAULTS = {
    mount: '#radio-metadata',
    metadata: {
      type: 'sse', // 'sse' | 'manual'
      url: '',
      jsonField: 'streamTitle'
    },
    stationName: 'Minha Rádio',
    defaultCover: '',
    textFallback: 'Ao vivo',
    showOfflineOnReset: true,
    deezer: {
      enabled: true,
      limit: 6,
      timeoutMs: 5000
    },
    theme: {
      injectCss: true,
      borderRadius: '18px',
      gap: '14px'
    },
    debug: false,
    transitionOnTrackChange: true,
    transitionDelayMs: 12000,
    schedule: {
      enabled: true,
      url: 'programas/programacao.json',
      programField: 'programas'
    },
    onUpdate: null
  };

  class UniversalRadioMetadata {
    constructor(options) {
      this.options = deepMerge(DEFAULTS, options || {});
      this.state = {
        root: null,
        coverEl: null,
        textEl: null,
        artistEl: null,
        lastRawTitle: '',
        currentCoverRequestId: 0,
        resolveCache: Object.create(null),
        eventSource: null,
        styleInjected: false,
        hasDisplayedTrack: false,
        pendingTransitionTimer: null,
        pendingTransitionToken: 0,
        scheduleCache: null,
        schedulePromise: null
      };

      this._boundOnMessage = this._onSseMessage.bind(this);
      this._boundOnError = this._onSseError.bind(this);
    }

    start() {
      this._ensureMounted();
      this.reset();

      if (this.options.metadata.type === 'sse') {
        if (!this.options.metadata.url) {
          throw new Error('metadata.url é obrigatório quando metadata.type = "sse".');
        }
        this._connectEventSource();
      }

      return this;
    }

    stop() {
      if (this.state.eventSource) {
        this.state.eventSource.close();
        this.state.eventSource = null;
      }
      this._clearPendingTransition();
      return this;
    }

    reset() {
      this._clearPendingTransition();
      this.state.lastRawTitle = '';
      this.state.hasDisplayedTrack = false;
      this._render({
        song: this.options.stationName || this.options.textFallback || 'Ao vivo',
        artist: '',
        cover: this.options.defaultCover || '',
        rawTitle: ''
      });
      return this;
    }

    async pushRawTitle(rawTitle) {
      const raw = String(rawTitle || '').trim();
      if (!raw || raw === this.state.lastRawTitle) return null;

      this.state.lastRawTitle = raw;

      const immediate = this.parseRawTitle(raw);
      const resolvedPromise = this.resolveTrackMetadata(raw).catch(() => immediate);
      const shouldTransition = !!(this.options.transitionOnTrackChange && this.state.hasDisplayedTrack);

      if (!shouldTransition) {
        this._render({
          song: immediate.song || raw,
          artist: immediate.artist || '',
          cover: this.options.defaultCover || '',
          rawTitle: raw
        });

        const firstResolved = await resolvedPromise;
        this._render({
          song: firstResolved.song || immediate.song || raw,
          artist: firstResolved.artist || immediate.artist || '',
          cover: firstResolved.cover || this.options.defaultCover || '',
          rawTitle: raw
        });
        this.state.hasDisplayedTrack = true;
        return firstResolved;
      }

      const token = ++this.state.pendingTransitionToken;
      this._clearPendingTransition();

      const currentProgram = await this._getCurrentProgramDisplay();
      if (token !== this.state.pendingTransitionToken) return null;

      this._render({
        song: currentProgram.title || this.options.stationName || this.options.textFallback || 'Ao vivo',
        artist: '',
        cover: this.options.defaultCover || '',
        rawTitle: ''
      });

      const delayMs = Math.max(0, Number(this.options.transitionDelayMs || 12000));
      return new Promise((resolve) => {
        this.state.pendingTransitionTimer = setTimeout(async () => {
          this.state.pendingTransitionTimer = null;
          if (token !== this.state.pendingTransitionToken) {
            resolve(null);
            return;
          }

          const resolved = await resolvedPromise;
          if (token !== this.state.pendingTransitionToken) {
            resolve(null);
            return;
          }

          this._render({
            song: resolved.song || immediate.song || raw,
            artist: resolved.artist || immediate.artist || '',
            cover: resolved.cover || this.options.defaultCover || '',
            rawTitle: raw
          });
          this.state.hasDisplayedTrack = true;
          resolve(resolved);
        }, delayMs);
      });
    }

    parseRawTitle(rawTitle) {
      const pieces = splitRawMetadataTitle(rawTitle);
      if (!pieces.hasSeparator) {
        return {
          song: cleanupMetadataChunk(pieces.raw),
          artist: '',
          raw: pieces.raw,
          first: pieces.first,
          second: pieces.second,
          parts: pieces.parts || []
        };
      }

      const chosenFromParts = chooseArtistSongFromParts(pieces.parts || []);
      const guess = chosenFromParts || guessArtistSong(pieces.first, pieces.second);
      return {
        song: cleanupMetadataChunk(guess.song),
        artist: cleanupMetadataChunk(guess.artist),
        raw: pieces.raw,
        first: cleanupMetadataChunk(guess.artist),
        second: cleanupMetadataChunk(guess.song),
        parts: pieces.parts || []
      };
    }

    async resolveTrackMetadata(rawTitle) {
      const cacheKey = String(rawTitle || '').trim();
      if (!cacheKey) return { song: '', artist: '', cover: '' };
      if (this.state.resolveCache[cacheKey]) return this.state.resolveCache[cacheKey];

      const immediate = this.parseRawTitle(rawTitle);
      const first = immediate.first;
      const second = immediate.second;

      if (!this.options.deezer.enabled || !second) {
        const simple = { song: immediate.song, artist: immediate.artist || '', cover: '' };
        this.state.resolveCache[cacheKey] = simple;
        return simple;
      }

      const direct = { artist: cleanupMetadataChunk(first), song: cleanupMetadataChunk(second) };
      const swapped = { artist: cleanupMetadataChunk(second), song: cleanupMetadataChunk(first) };
      const meaningfulParts = (immediate.parts || []).map(cleanupMetadataChunk).filter(function (part) {
        return part && !isNumericMetadataSegment(part) && !isCollectionMetadataSegment(part);
      });

      const fullQuery = meaningfulParts.length >= 2
        ? (cleanTitleForSearch(meaningfulParts[meaningfulParts.length - 2], meaningfulParts[meaningfulParts.length - 1]) || cleanupMetadataChunk(rawTitle))
        : (cleanTitleForSearch(first, second) || cleanupMetadataChunk(rawTitle));

      const results = await searchDeezerDetailed(fullQuery, this.options.deezer.limit, this.options.deezer.timeoutMs);
      let best = null;

      results.forEach(function (item) {
        const directScore = scoreResultForInterpretation(item, direct.artist, direct.song);
        const swappedScore = scoreResultForInterpretation(item, swapped.artist, swapped.song);
        const better = directScore.total >= swappedScore.total
          ? { orientation: 'direct', scores: directScore, base: direct }
          : { orientation: 'swapped', scores: swappedScore, base: swapped };

        if (!best || better.scores.total > best.scores.total) {
          best = better;
        }
      });

      const finalizeResolved = async (chosenBase, bestInfo) => {
        let resolvedArtist = cleanupMetadataChunk(chosenBase.artist);
        let resolvedSong = cleanupMetadataChunk(chosenBase.song);
        let resolvedCover = (bestInfo && bestInfo.scores && bestInfo.scores.cover) || '';

        if (bestInfo && bestInfo.scores && bestInfo.scores.artistScore >= 0.68 && bestInfo.scores.resultArtist) {
          resolvedArtist = cleanupMetadataChunk(bestInfo.scores.resultArtist);
        }

        if (bestInfo && bestInfo.scores && bestInfo.scores.songScore >= 0.82 && bestInfo.scores.resultSong) {
          resolvedSong = cleanupMetadataChunk(bestInfo.scores.resultSong);
        }

        const rawParts = (immediate.parts || []).map(cleanupMetadataChunk).filter(Boolean);
        if (rawParts.length === 3 && isNumericMetadataSegment(rawParts[1])) {
          const forcedArtist = rawParts[0];
          const forcedSong = rawParts[2];
          if (isNumericMetadataSegment(resolvedArtist) || compactComparable(resolvedArtist) === compactComparable(resolvedSong)) {
            resolvedArtist = forcedArtist;
          }
          if (!resolvedSong || similarityScore(resolvedSong, forcedSong) < 0.75) {
            resolvedSong = forcedSong;
          }
        }

        const resolved = {
          song: resolvedSong,
          artist: resolvedArtist,
          cover: resolvedCover || ''
        };
        this.state.resolveCache[cacheKey] = resolved;
        return resolved;
      };

      if (best && best.scores.total >= 0.56) {
        return finalizeResolved(best.base, best);
      }

      const infoFirst = await resolveArtistFromSingleSegment(first, this.options.deezer.timeoutMs);
      const infoSecond = await resolveArtistFromSingleSegment(second, this.options.deezer.timeoutMs);
      let chosen = best && best.base ? best.base : direct;

      if (infoFirst.artistBias > infoSecond.artistBias + 0.08) {
        chosen = direct;
      } else if (infoSecond.artistBias > infoFirst.artistBias + 0.08) {
        chosen = swapped;
      } else if (best && best.orientation === 'swapped') {
        chosen = swapped;
      } else {
        chosen = direct;
      }

      return finalizeResolved(chosen, best);
    }

    _connectEventSource() {
      this.stop();
      const es = new EventSource(this.options.metadata.url);
      es.onmessage = this._boundOnMessage;
      es.onerror = this._boundOnError;
      this.state.eventSource = es;
    }

    async _onSseMessage(event) {
      try {
        const payload = JSON.parse(event.data);
        const field = this.options.metadata.jsonField || 'streamTitle';
        const rawTitle = payload && payload[field] ? String(payload[field]) : '';
        if (!rawTitle) return;
        await this.pushRawTitle(rawTitle);
      } catch (err) {
        this._log('Falha ao interpretar evento SSE:', err);
      }
    }

    _onSseError(err) {
      this._log('EventSource error:', err);
    }

    _clearPendingTransition() {
      if (this.state.pendingTransitionTimer) {
        clearTimeout(this.state.pendingTransitionTimer);
        this.state.pendingTransitionTimer = null;
      }
    }

    async _getCurrentProgramDisplay() {
      const fallbackTitle = this.options.stationName || this.options.textFallback || 'Ao vivo';
      if (!this.options.schedule || !this.options.schedule.enabled) {
        return { title: fallbackTitle };
      }

      try {
        const items = await this._loadScheduleItems();
        const active = findCurrentProgramFromSchedule(items);
        return { title: (active && cleanupMetadataChunk(active.title)) || fallbackTitle };
      } catch (err) {
        this._log('Falha ao obter programa atual:', err);
        return { title: fallbackTitle };
      }
    }

    async _loadScheduleItems() {
      if (Array.isArray(this.state.scheduleCache)) return this.state.scheduleCache;
      if (this.state.schedulePromise) return this.state.schedulePromise;

      const scheduleUrl = this.options.schedule && this.options.schedule.url
        ? String(this.options.schedule.url)
        : 'programas/programacao.json';
      const programField = this.options.schedule && this.options.schedule.programField
        ? String(this.options.schedule.programField)
        : 'programas';

      this.state.schedulePromise = fetch(scheduleUrl, { cache: 'no-store' })
        .then(function (response) {
          if (!response.ok) {
            throw new Error('HTTP ' + response.status + ' ao carregar programação');
          }
          return response.json();
        })
        .then((payload) => {
          const items = payload && Array.isArray(payload[programField]) ? payload[programField] : [];
          this.state.scheduleCache = items;
          this.state.schedulePromise = null;
          return items;
        })
        .catch((err) => {
          this.state.schedulePromise = null;
          throw err;
        });

      return this.state.schedulePromise;
    }

    _ensureMounted() {
      if (this.state.root) return;

      const mount = resolveElement(this.options.mount);
      if (!mount) {
        throw new Error('Elemento mount não encontrado: ' + this.options.mount);
      }

      if (this.options.theme.injectCss && !document.getElementById('urm-styles')) {
        injectStyles(this.options.theme);
      }

      mount.innerHTML = [
        '<div class="urm-widget">',
        '  <div class="urm-cover-wrap">',
        '    <img class="urm-cover" alt="Capa atual">',
        '  </div>',
        '  <div class="urm-meta">',
        '    <div class="urm-song"></div>',
        '    <div class="urm-artist"></div>',
        '  </div>',
        '</div>'
      ].join('');

      this.state.root = mount.querySelector('.urm-widget');
      this.state.coverEl = mount.querySelector('.urm-cover');
      this.state.textEl = mount.querySelector('.urm-song');
      this.state.artistEl = mount.querySelector('.urm-artist');
    }

    _render(data) {
      this._ensureMounted();

      const song = cleanupMetadataChunk(data.song || '') || this.options.stationName || this.options.textFallback;
      const artist = cleanupMetadataChunk(data.artist || '');
      const cover = String(data.cover || this.options.defaultCover || '').trim();

      this.state.textEl.textContent = song;
      this.state.artistEl.textContent = artist ? ('- ' + artist) : '';
      this.state.coverEl.src = cover || transparentFallbackSvg(song);

      if (typeof this.options.onUpdate === 'function') {
        try {
          this.options.onUpdate({
            rawTitle: data.rawTitle || '',
            song: song,
            artist: artist,
            cover: cover
          });
        } catch (err) {
          this._log('onUpdate falhou:', err);
        }
      }
    }

    _log() {
      if (!this.options.debug) return;
      console.log.apply(console, ['[UniversalRadioMetadata]'].concat([].slice.call(arguments)));
    }
  }

  function resolveElement(target) {
    if (!target) return null;
    if (target instanceof Element) return target;
    return document.querySelector(target);
  }

  function injectStyles(theme) {
    const style = document.createElement('style');
    style.id = 'urm-styles';
    style.textContent = `
      .urm-widget {
        display: flex;
        align-items: center;
        gap: ${theme.gap || '14px'};
        width: 100%;
        min-height: 96px;
        box-sizing: border-box;
        padding: 14px;
        border-radius: ${theme.borderRadius || '18px'};
        background: rgba(12, 12, 12, 0.92);
        color: #fff;
        font-family: Arial, Helvetica, sans-serif;
      }
      .urm-cover-wrap {
        flex: 0 0 82px;
        width: 82px;
        height: 82px;
        border-radius: 14px;
        overflow: hidden;
        background: rgba(255,255,255,0.06);
      }
      .urm-cover {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
      }
      .urm-meta {
        min-width: 0;
        flex: 1 1 auto;
      }
      .urm-song,
      .urm-artist {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .urm-song {
        font-size: 1.08rem;
        font-weight: 700;
        line-height: 1.15;
      }
      .urm-artist {
        margin-top: 6px;
        font-size: 0.96rem;
        opacity: 0.92;
      }
    `;
    document.head.appendChild(style);
  }

  function transparentFallbackSvg(label) {
    const safe = escapeHtml(String(label || 'Ao vivo').slice(0, 36));
    return 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400">
         <rect width="100%" height="100%" fill="#1c1c1c"/>
         <text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle"
               font-family="Arial, Helvetica, sans-serif" font-size="28" fill="#ffffff">${safe}</text>
       </svg>`
    );
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function deepMerge(base, extra) {
    const output = Array.isArray(base) ? base.slice() : Object.assign({}, base);
    Object.keys(extra || {}).forEach(function (key) {
      const baseValue = output[key];
      const extraValue = extra[key];
      if (isObject(baseValue) && isObject(extraValue)) {
        output[key] = deepMerge(baseValue, extraValue);
      } else {
        output[key] = extraValue;
      }
    });
    return output;
  }

  function isObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value);
  }

  function cleanTitleForSearch(artist, song) {
    let q = ((artist || '') + ' ' + (song || '')).trim();
    if (!q) return '';

    q = q.replace(/^[0-9]{1,3}[\s.\-_]+/, '');
    q = q.replace(/\s*-\s*[0-9]{2,3}\s*bpm/gi, '');
    q = q.replace(/\s*[\(\[][^^\)\]]*[\)\]]/g, '');
    q = q.replace(/[_]+/g, ' ');
    q = q.replace(/[^\w\sÀ-ÿ]/gi, ' ').replace(/\s+/g, ' ').trim();

    return q;
  }

  function stripDiacritics(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  function normalizeComparable(value) {
    return stripDiacritics(value)
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
    const aa = String(a || '');
    const bb = String(b || '');
    const rows = aa.length + 1;
    const cols = bb.length + 1;
    const dp = Array.from({ length: rows }, function (_, i) {
      const row = new Array(cols).fill(0);
      row[0] = i;
      return row;
    });

    for (let j = 0; j < cols; j += 1) dp[0][j] = j;

    for (let i = 1; i < rows; i += 1) {
      for (let j = 1; j < cols; j += 1) {
        const cost = aa[i - 1] === bb[j - 1] ? 0 : 1;
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
    const na = normalizeComparable(a);
    const nb = normalizeComparable(b);
    if (!na || !nb) return 0;
    if (na === nb) return 1;

    const ca = compactComparable(a);
    const cb = compactComparable(b);
    if (ca && cb && ca === cb) return 0.99;
    if (ca && cb && (ca.includes(cb) || cb.includes(ca))) return 0.93;

    const dist = levenshtein(ca || na, cb || nb);
    const maxLen = Math.max((ca || na).length, (cb || nb).length, 1);
    const editScore = Math.max(0, 1 - (dist / maxLen));

    const tokensA = na.split(' ').filter(Boolean);
    const tokensB = nb.split(' ').filter(Boolean);
    const setB = new Set(tokensB);
    let common = 0;
    tokensA.forEach(function (token) {
      if (setB.has(token)) common += 1;
    });
    const tokenScore = common / Math.max(tokensA.length, tokensB.length, 1);

    return Math.max(editScore, tokenScore * 0.95);
  }

  function cleanupMetadataChunk(value) {
    let s = String(value || '');
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
    const cleaned = cleanupMetadataChunk(rawTitle);
    if (!cleaned) return { raw: '', first: '', second: '', hasSeparator: false, parts: [] };

    const parts = cleaned
      .split(/\s-\s/)
      .map(function (part) { return cleanupMetadataChunk(part); })
      .filter(Boolean);

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
    const compact = cleanupMetadataChunk(value).replace(/\s+/g, '');
    return /^[0-9]{1,3}$/.test(compact);
  }

  function isCollectionMetadataSegment(value) {
    const normalized = normalizeComparable(value);
    if (!normalized) return false;
    return /\b(cd|disc|disk|disco|vol|volume|faixa|track)\b/.test(normalized);
  }

  function chooseArtistSongFromParts(parts) {
    const cleanParts = (parts || []).map(function (part) {
      return cleanupMetadataChunk(part);
    }).filter(Boolean);

    if (cleanParts.length === 3) {
      const first = cleanParts[0];
      const middle = cleanParts[1];
      const last = cleanParts[2];

      if (isNumericMetadataSegment(middle)) return { artist: first, song: last };
      if (isNumericMetadataSegment(first)) return { artist: middle, song: last };
      if (isNumericMetadataSegment(last)) return { artist: first, song: middle };
    }

    if (cleanParts.length >= 4) {
      return {
        artist: cleanParts[cleanParts.length - 2],
        song: cleanParts[cleanParts.length - 1]
      };
    }

    if (cleanParts.length >= 3) {
      const prefix = cleanParts.slice(0, -2);
      const hasPrefixNoise = prefix.some(function (part) {
        return isNumericMetadataSegment(part) || isCollectionMetadataSegment(part);
      }) || isNumericMetadataSegment(cleanParts[cleanParts.length - 2]);

      if (hasPrefixNoise) {
        return {
          artist: cleanParts[cleanParts.length - 2],
          song: cleanParts[cleanParts.length - 1]
        };
      }
    }

    return null;
  }

  function countWords(value) {
    return cleanupMetadataChunk(value).split(' ').filter(Boolean).length;
  }

  function guessArtistSong(first, second) {
    const a = cleanupMetadataChunk(first);
    const b = cleanupMetadataChunk(second);
    if (!b) return { artist: '', song: a };

    const aCount = countWords(a);
    const bCount = countWords(b);

    if (aCount <= 2 && bCount >= 3) return { artist: a, song: b };
    if (bCount <= 3 && aCount >= 4) return { artist: b, song: a };
    if (aCount === 1 && bCount >= 3) return { artist: a, song: b };
    if (bCount === 1 && aCount >= 3) return { artist: b, song: a };

    return { artist: a, song: b };
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
    const resultArtist = result && result.artist ? result.artist.name : '';
    const resultSong = result ? (result.title || '') : '';
    const artistScore = similarityScore(artist, resultArtist);
    const songScore = similarityScore(song, resultSong);
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
    return new Promise(function (resolve) {
      const callbackName = 'urm_deezer_detail_' + Math.random().toString(36).slice(2, 10);
      const maxResults = Math.max(1, Math.min(Number(limit || 6), 10));
      const timeout = Math.max(1000, Number(timeoutMs || 5000));
      const script = document.createElement('script');

      function cleanup() {
        if (script.parentNode) script.parentNode.removeChild(script);
        delete window[callbackName];
      }

      window[callbackName] = function (data) {
        cleanup();
        resolve((data && Array.isArray(data.data)) ? data.data : []);
      };

      script.onerror = function () {
        cleanup();
        resolve([]);
      };

      script.src = 'https://api.deezer.com/search?q=' + encodeURIComponent(query) + '&limit=' + maxResults + '&output=jsonp&callback=' + callbackName + '&_=' + Date.now();
      document.body.appendChild(script);

      setTimeout(function () {
        if (window[callbackName]) {
          cleanup();
          resolve([]);
        }
      }, timeout);
    });
  }

  async function resolveArtistFromSingleSegment(segment, timeoutMs) {
    const cleaned = cleanupMetadataChunk(segment);
    if (!cleaned) {
      return { bestArtist: '', bestArtistScore: 0, artistBias: -1, bestTitleScore: 0, cover: '' };
    }

    const results = await searchDeezerDetailed(cleaned, 5, timeoutMs);
    let bestArtist = '';
    let bestArtistScore = 0;
    let bestTitleScore = 0;
    let bestCover = '';

    results.forEach(function (item) {
      const artistName = item && item.artist ? item.artist.name : '';
      const titleName = item ? (item.title || '') : '';
      const artistScore = similarityScore(cleaned, artistName);
      const titleScore = similarityScore(cleaned, titleName);

      if (artistScore > bestArtistScore) {
        bestArtistScore = artistScore;
        bestArtist = artistName;
        bestCover = getCoverFromResult(item);
      }
      if (titleScore > bestTitleScore) {
        bestTitleScore = titleScore;
      }
    });

    return {
      bestArtist: bestArtist,
      bestArtistScore: bestArtistScore,
      bestTitleScore: bestTitleScore,
      artistBias: bestArtistScore - bestTitleScore,
      cover: bestCover
    };
  }

  function findCurrentProgramFromSchedule(items, now) {
    if (!Array.isArray(items) || !items.length) return null;

    const reference = now instanceof Date ? now : new Date();
    const parts = getBrazilNowParts(reference);
    const todayCode = mapWeekdayToScheduleCode(parts.weekday);
    const yesterdayCode = mapWeekdayToScheduleCode((parts.weekday + 6) % 7);
    const minutesNow = (parts.hours * 60) + parts.minutes;

    let best = null;

    items.forEach(function (item) {
      const days = normalizeScheduleDays(item && item.diaDaSemana);
      const startMinutes = parseTimeToMinutes(item && item.start);
      const endMinutes = parseTimeToMinutes(item && item.end);
      if (!days.length || startMinutes < 0 || endMinutes < 0) return;

      const crossesMidnight = endMinutes < startMinutes;
      let matches = false;
      let distance = Number.POSITIVE_INFINITY;

      if (!crossesMidnight) {
        matches = days.indexOf(todayCode) >= 0 && minutesNow >= startMinutes && minutesNow <= endMinutes;
        if (matches) distance = minutesNow - startMinutes;
      } else {
        const matchesTodaySegment = days.indexOf(todayCode) >= 0 && minutesNow >= startMinutes;
        const matchesYesterdaySegment = days.indexOf(yesterdayCode) >= 0 && minutesNow <= endMinutes;
        matches = matchesTodaySegment || matchesYesterdaySegment;
        if (matchesTodaySegment) {
          distance = minutesNow - startMinutes;
        } else if (matchesYesterdaySegment) {
          distance = (minutesNow + 1440) - startMinutes;
        }
      }

      if (!matches) return;
      if (!best || distance < best.distance) {
        best = { item: item, distance: distance };
      }
    });

    return best ? best.item : null;
  }

  function getBrazilNowParts(date) {
    const formatter = new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
    const mapped = { weekday: 0, hours: 0, minutes: 0 };
    formatter.formatToParts(date).forEach(function (part) {
      if (part.type === 'weekday') mapped.weekday = mapIntlWeekday(part.value);
      if (part.type === 'hour') mapped.hours = Number(part.value || 0);
      if (part.type === 'minute') mapped.minutes = Number(part.value || 0);
    });
    return mapped;
  }

  function mapIntlWeekday(value) {
    const key = compactComparable(value || '');
    if (key.indexOf('seg') === 0) return 1;
    if (key.indexOf('ter') === 0) return 2;
    if (key.indexOf('qua') === 0) return 3;
    if (key.indexOf('qui') === 0) return 4;
    if (key.indexOf('sex') === 0) return 5;
    if (key.indexOf('sab') === 0) return 6;
    return 0;
  }

  function mapWeekdayToScheduleCode(weekday) {
    return ['dom', 'seg', 'ter', 'quar', 'qui', 'sex', 'sab'][Number(weekday) || 0] || 'dom';
  }

  function normalizeScheduleDays(days) {
    if (!Array.isArray(days)) return [];
    return days.map(function (day) {
      const key = compactComparable(day || '');
      if (key.indexOf('seg') === 0) return 'seg';
      if (key.indexOf('ter') === 0) return 'ter';
      if (key.indexOf('qua') === 0) return 'quar';
      if (key.indexOf('qui') === 0) return 'qui';
      if (key.indexOf('sex') === 0) return 'sex';
      if (key.indexOf('sab') === 0) return 'sab';
      if (key.indexOf('dom') === 0) return 'dom';
      return '';
    }).filter(Boolean);
  }

  function parseTimeToMinutes(value) {
    const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return -1;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return -1;
    return (hours * 60) + minutes;
  }


  global.UniversalRadioMetadata = UniversalRadioMetadata;
})(window);
