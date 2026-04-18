/*
 * Metadata display script for ATIVIDADE FM
 *
 * Este script exibe a capa do álbum e informações da música apenas
 * depois que o usuário clica no botão de play do player Lunaradio.
 * Corrigido para manter o estado ao redimensionar, evitar som duplicado e busca inteligente de capas.
 */

(function() {
  const DEFAULT_LOGO = 'https://i.imgur.com/v3cg03k.jpeg';
  const VOZ_BRASIL_COVER = 'https://i.imgur.com/F0cxBQ9.png';
  const FALLBACK_METADATA_URL = 'https://atividadefm.dpdns.org/metadados';
  const RADIO_NAME = 'ATIVIDADE FM 103.1FM';
  const TIME_API_URL = 'https://time.now/developer/api/timezone/America/Sao_Paulo';
  const PROGRAM_PREVIEW_MS = 15000;
  const FALLBACK_METADATA_INTERVAL_MS = 12000;
  const FALLBACK_METADATA_TIMEOUT_MS = 5000;
  const PROGRAM_SCHEDULE = [
    { name: '1 Hora de Música', image: 'https://i.imgur.com/N9EyeHV.jpeg', days: [1, 2, 3, 4, 5], start: '03:00', end: '05:59' },
    { name: '1 Hora de Música', image: 'https://i.imgur.com/N9EyeHV.jpeg', days: [1, 2, 3, 4, 5], start: '11:00', end: '12:59' },
    { name: '1 Hora de Música', image: 'https://i.imgur.com/N9EyeHV.jpeg', days: [1, 2, 3, 4, 5], start: '20:00', end: '20:59' },
    { name: '1 Hora de Música', image: 'https://i.imgur.com/N9EyeHV.jpeg', days: [1, 2, 3, 4, 5], start: '22:00', end: '23:59' },
    { name: '1 Hora de Música', image: 'https://i.imgur.com/N9EyeHV.jpeg', days: [6], start: '03:00', end: '23:59' },
    { name: '1 Hora de Música', image: 'https://i.imgur.com/N9EyeHV.jpeg', days: [0], start: '00:00', end: '23:59' },
    { name: 'Insônia', image: 'https://i.imgur.com/lA7Sl3A.jpeg', days: [1, 2, 3, 4, 5, 6], start: '00:00', end: '02:59' },
    { name: 'Sucessos da Manhã', image: 'https://i.imgur.com/a94mDWH.jpeg', days: [1, 2, 3, 4, 5], start: '07:00', end: '08:59' },
    { name: 'Top Hits – 1ª edição', image: 'https://i.imgur.com/BUHqEHd.jpeg', days: [1, 2, 3, 4, 5], start: '09:00', end: '10:59' },
    { name: 'Top Hits', image: 'https://i.imgur.com/cZz1d6k.jpeg', days: [1, 2, 3, 4, 5], start: '13:00', end: '15:59' },
    { name: 'Top Hits – 2ª edição', image: 'https://i.imgur.com/lEoVkDJ.jpeg', days: [1, 2, 3, 4, 5], start: '16:00', end: '17:59' },
    { name: 'Clube do Charme', image: 'https://i.imgur.com/YO93jT4.jpeg', days: [1, 2, 3, 4, 5], start: '18:00', end: '18:59' },
    { name: 'Momento de Reflexão', image: 'https://i.imgur.com/cNxPEWx.jpeg', days: [1, 2, 3, 4, 5], start: '06:00', end: '06:59' },
    { name: 'Momento de Reflexão', image: 'https://i.imgur.com/cNxPEWx.jpeg', days: [1, 2, 3, 4, 5], start: '21:00', end: '21:59' }
  ];
  
  // Estado global persistente dentro do closure para sobreviver a reinicializações do player
  let state = {
    overlay: null,
    img: null,
    text: null,
    externalText: null,
    lastTitle: '',
    currentSong: '',
    currentArtist: '',
    userInitiatedPlay: false,
    userPlaybackIntent: false,
    layoutListenersBound: false,
    playerClickBound: false,
    boundPlayerEl: null,
    playbackWatchStarted: false,
    lastObservedPlaying: false,
    specialMode: (window.__atividadeCurrentStreamMode || 'zeno'),
    lastZenoSong: '',
    lastZenoArtist: '',
    displayMode: 'idle',
    programPreviewTimer: null,
    activeProgramPreviewReason: '',
    awaitingInitialSongAfterPlay: false,
    serverOffsetMs: 0,
    timeSyncRunning: false,
    timeSyncReady: false,
    mediaEventsBound: false,
    lastObservedPlaying: null,
    lastPlaybackGestureAt: 0,
    coverRequestId: 0,
    lastCoverQueryKey: '',
    metadataResolveId: 0,
    currentResolvedCover: '',
    metadataResolveCache: Object.create(null),
    fallbackMetadataUrl: (window.__atividadeFallbackMetadataUrl || FALLBACK_METADATA_URL),
    fallbackMetadataTimer: null,
    fallbackMetadataRunning: false,
    lastFallbackRawTitle: ''
  };

  /**
   * Limpa o título da música para melhorar a busca no Deezer.
   */
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
    const dp = Array.from({ length: rows }, function(_, i) {
      const row = new Array(cols).fill(0);
      row[0] = i;
      return row;
    });

    for (let j = 0; j < cols; j++) dp[0][j] = j;

    for (let i = 1; i < rows; i++) {
      for (let j = 1; j < cols; j++) {
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
    tokensA.forEach(function(token) {
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
      .map(function(part) { return cleanupMetadataChunk(part); })
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
    return /(cd|disc|disk|disco|vol|volume|faixa|track)/.test(normalized);
  }

  function chooseArtistSongFromParts(parts) {
    const cleanParts = (parts || []).map(function(part) {
      return cleanupMetadataChunk(part);
    }).filter(Boolean);

    if (cleanParts.length === 3) {
      const first = cleanParts[0];
      const middle = cleanParts[1];
      const last = cleanParts[2];

      if (isNumericMetadataSegment(middle)) {
        return {
          artist: first,
          song: last
        };
      }

      if (isNumericMetadataSegment(first)) {
        return {
          artist: middle,
          song: last
        };
      }

      if (isNumericMetadataSegment(last)) {
        return {
          artist: first,
          song: middle
        };
      }
    }

    if (cleanParts.length >= 4) {
      return {
        artist: cleanParts[cleanParts.length - 2],
        song: cleanParts[cleanParts.length - 1]
      };
    }

    if (cleanParts.length >= 3) {
      const prefix = cleanParts.slice(0, -2);
      const hasPrefixNoise = prefix.some(function(part) {
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

    if (aCount <= 2 && bCount >= 3) {
      return { artist: a, song: b };
    }

    if (bCount <= 3 && aCount >= 4) {
      return { artist: b, song: a };
    }

    if (aCount === 1 && bCount >= 3) {
      return { artist: a, song: b };
    }

    if (bCount === 1 && aCount >= 3) {
      return { artist: b, song: a };
    }

    return { artist: a, song: b };
  }

  function parseMetadataForDisplay(rawTitle) {
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

  function buildDisplayText(song, artist) {
    const cleanSong = cleanupMetadataChunk(song);
    const cleanArtist = cleanupMetadataChunk(artist);
    return cleanSong && cleanArtist ? `${cleanSong} - ${cleanArtist}` : (cleanSong || cleanArtist || RADIO_NAME);
  }

  function isMobileLandscapeView() {
    return window.matchMedia('(max-width: 900px) and (orientation: landscape)').matches;
  }

  function isMobilePortraitView() {
    return window.matchMedia('(max-width: 900px) and (orientation: portrait)').matches;
  }

  function clearProgramPreviewTimer() {
    if (state.programPreviewTimer) {
      clearTimeout(state.programPreviewTimer);
      state.programPreviewTimer = null;
    }
    state.activeProgramPreviewReason = '';
  }

  function parseMinutes(hhmm) {
    const parts = String(hhmm || '00:00').split(':');
    const hour = Number(parts[0] || '0');
    const minute = Number(parts[1] || '0');
    return (hour * 60) + minute;
  }

  function getSaoPauloParts(date) {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Sao_Paulo',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
    const pieces = formatter.formatToParts(date);
    const map = {};
    pieces.forEach(function(piece) {
      if (piece.type !== 'literal') map[piece.type] = piece.value;
    });

    const weekdayMap = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

    return {
      weekdayShort: String(map.weekday || '').toLowerCase(),
      weekdayIndex: weekdayMap[String(map.weekday || '').toLowerCase()] ?? 0,
      hour: Number(map.hour || '0'),
      minute: Number(map.minute || '0'),
      second: Number(map.second || '0')
    };
  }

  function getSyncedSaoPauloNow() {
    return new Date(Date.now() + state.serverOffsetMs);
  }

  async function syncProgramTime() {
    if (state.timeSyncRunning) return;
    state.timeSyncRunning = true;
    try {
      const response = await fetch(TIME_API_URL, { cache: 'no-store' });
      const data = await response.json();
      if (data && data.datetime) {
        state.serverOffsetMs = new Date(data.datetime).getTime() - Date.now();
        state.timeSyncReady = true;
      } else {
        state.serverOffsetMs = 0;
      }
    } catch (err) {
      state.serverOffsetMs = 0;
    } finally {
      state.timeSyncRunning = false;
    }
  }

  function getCurrentProgramInfo() {
    const parts = getSaoPauloParts(getSyncedSaoPauloNow());
    const totalMinutes = (parts.hour * 60) + parts.minute;

    for (let i = 0; i < PROGRAM_SCHEDULE.length; i++) {
      const entry = PROGRAM_SCHEDULE[i];
      if (!entry.days.includes(parts.weekdayIndex)) continue;
      const startMinutes = parseMinutes(entry.start);
      const endMinutes = parseMinutes(entry.end);
      if (totalMinutes >= startMinutes && totalMinutes <= endMinutes) {
        return entry;
      }
    }

    return null;
  }

  function fitTextToWidth(el, maxPx, minPx) {
    if (!el) return;
    let size = maxPx;
    el.style.fontSize = size + 'px';
    while (size > minPx && el.scrollWidth > el.clientWidth) {
      size -= 1;
      el.style.fontSize = size + 'px';
    }
  }

  function ensureExternalText() {
    const player = document.getElementById('player');
    if (!player) return null;

    let el = document.getElementById('atividade-song-info-external');
    if (!el) {
      el = document.createElement('div');
      el.id = 'atividade-song-info-external';
      player.appendChild(el);
    }

    state.externalText = el;
    return el;
  }

  function positionExternalText() {
    const el = ensureExternalText();
    const radio = document.getElementById('playertextradioname');
    const player = document.getElementById('player');
    const cover = document.getElementById('playercoverwrapper');
    if (!el || !radio || !player) return;

    if (!el.textContent) {
      el.style.display = 'none';
      return;
    }

    const radioRect = radio.getBoundingClientRect();
    const playerRect = player.getBoundingClientRect();
    const coverRect = cover ? cover.getBoundingClientRect() : null;
    let gapAfterRadio = 10;
    if (isMobileLandscapeView()) {
      gapAfterRadio = 12;
    } else if (isMobilePortraitView()) {
      gapAfterRadio = 8;
    } else {
      gapAfterRadio = 10;
    }
    const top = Math.max(0, radioRect.bottom - playerRect.top + gapAfterRadio);

    let left = 12;
    let width = Math.max(120, playerRect.width - 24);
    let textAlign = 'center';
    let maxPx = 30;
    let minPx = 12;

    if (isMobileLandscapeView()) {
      const coverRight = coverRect ? (coverRect.right - playerRect.left) : 0;
      left = Math.max(coverRight + 12, radioRect.left - playerRect.left);
      width = Math.max(120, playerRect.width - left - 14);
      textAlign = 'left';
      maxPx = 30;
      minPx = 11;
    } else if (isMobilePortraitView()) {
      left = 12;
      width = Math.max(120, playerRect.width - 24);
      textAlign = 'center';
      maxPx = 26;
      minPx = 11;
    } else {
      left = 20;
      width = Math.max(200, playerRect.width - 40);
      textAlign = 'center';
      maxPx = 30;
      minPx = 12;
    }

    el.style.left = left + 'px';
    el.style.top = top + 'px';
    el.style.width = width + 'px';
    el.style.textAlign = textAlign;
    el.style.display = 'block';
    fitTextToWidth(el, maxPx, minPx);
  }

  function isVoiceBrasilMode() {
    return state.specialMode === 'voz';
  }

  function isFallbackMode() {
    return state.specialMode === 'fallback';
  }

  function isZenoMode() {
    return state.specialMode === 'zeno';
  }

  function applyOverlayLayoutMode() {
    if (!state.img || !state.text || !state.overlay) return;

    state.img.style.width = '100%';
    state.img.style.height = '100%';
    state.overlay.style.justifyContent = 'center';
    state.text.style.display = 'none';
  }

  function renderVoiceBrasilUI() {
    const external = ensureExternalText();
    if (!state.overlay || !state.img || !state.text || !external) return;
    state.displayMode = 'voz';
    state.overlay.style.display = 'flex';
    applyOverlayLayoutMode();
    state.text.style.display = 'none';
    state.img.src = VOZ_BRASIL_COVER;
    external.textContent = 'A voz do Brasil';
    positionExternalText();
    external.style.display = 'block';
  }

  function renderIdleLogoUI() {
    const external = ensureExternalText();
    if (!state.overlay || !state.img || !state.text || !external) return;
    state.displayMode = 'idle';
    state.overlay.style.display = 'flex';
    applyOverlayLayoutMode();
    state.text.style.display = 'none';
    state.img.src = DEFAULT_LOGO;
    external.textContent = '';
    external.style.display = 'none';
  }

  function renderFallbackStationUI() {
    const external = ensureExternalText();
    if (!state.overlay || !state.img || !state.text || !external) return;
    state.displayMode = 'fallback-station';
    state.overlay.style.display = 'flex';
    applyOverlayLayoutMode();
    state.text.style.display = 'none';
    state.img.src = DEFAULT_LOGO;
    external.textContent = RADIO_NAME;
    positionExternalText();
    external.style.display = 'block';
  }

  function renderProgramUI(program) {
    const external = ensureExternalText();
    if (!state.overlay || !state.img || !state.text || !external) return;
    state.displayMode = 'program';
    state.overlay.style.display = 'flex';
    applyOverlayLayoutMode();
    state.text.style.display = 'none';
    state.img.src = (program && program.image) ? program.image : DEFAULT_LOGO;
    external.textContent = (program && program.name) ? program.name : 'ATIVIDADE FM 103.1FM';
    positionExternalText();
    external.style.display = 'block';
  }

  function syncSongInfoLayout(info) {
    const external = ensureExternalText();
    if (!state.text || !external) return;

    applyOverlayLayoutMode();
    state.text.style.display = 'none';
    external.textContent = info || '';
    positionExternalText();
  }


  function renderSongUI(song, artist, preferredCover) {
    if (!state.overlay || !state.img || !state.text) return;
    if (isVoiceBrasilMode()) {
      renderVoiceBrasilUI();
      return;
    }
    if (isFallbackMode() && !cleanupMetadataChunk(song) && !cleanupMetadataChunk(artist)) {
      renderFallbackStationUI();
      return;
    }
    state.displayMode = 'song';
    state.overlay.style.display = 'flex';
    syncSongInfoLayout(buildDisplayText(song, artist));
    refreshCover(song, artist, preferredCover || state.currentResolvedCover || '');
  }

  function restoreActiveVisualState() {
    if (!state.overlay || !state.img || !state.text) return;

    if (!state.userInitiatedPlay) {
      renderIdleLogoUI();
      return;
    }

    if (isVoiceBrasilMode()) {
      renderVoiceBrasilUI();
      return;
    }

    if (isFallbackMode() && !(state.currentSong || state.currentArtist)) {
      renderFallbackStationUI();
      return;
    }

    if (state.displayMode === 'program') {
      const currentProgram = getCurrentProgramInfo();
      if (currentProgram) {
        renderProgramUI(currentProgram);
        return;
      }
    }

    if (state.currentSong || state.currentArtist) {
      renderSongUI(state.currentSong, state.currentArtist);
    } else if (isZenoMode() && (state.lastZenoSong || state.lastZenoArtist)) {
      renderSongUI(state.lastZenoSong, state.lastZenoArtist);
    } else if (isFallbackMode()) {
      renderFallbackStationUI();
    } else {
      renderIdleLogoUI();
    }
  }

  function startProgramPreview(reason) {
    if (!state.userInitiatedPlay) {
      resetUI();
      return;
    }

    if (isVoiceBrasilMode()) {
      clearProgramPreviewTimer();
      renderVoiceBrasilUI();
      return;
    }

    const currentProgram = getCurrentProgramInfo();
    if (!currentProgram) {
      clearProgramPreviewTimer();
      if (state.currentSong || state.currentArtist) {
        renderSongUI(state.currentSong, state.currentArtist);
      } else if (isZenoMode() && (state.lastZenoSong || state.lastZenoArtist)) {
        renderSongUI(state.lastZenoSong, state.lastZenoArtist);
      } else if (isFallbackMode()) {
        renderFallbackStationUI();
      } else {
        renderIdleLogoUI();
      }
      return;
    }

    clearProgramPreviewTimer();
    state.activeProgramPreviewReason = reason || 'program';
    renderProgramUI(currentProgram);

    state.programPreviewTimer = setTimeout(function() {
      state.programPreviewTimer = null;
      state.activeProgramPreviewReason = '';
      state.awaitingInitialSongAfterPlay = false;

      if (!state.userInitiatedPlay) {
        resetUI();
        return;
      }

      if (isVoiceBrasilMode()) {
        renderVoiceBrasilUI();
        return;
      }

      if (state.currentSong || state.currentArtist) {
        renderSongUI(state.currentSong, state.currentArtist);
      } else if (isZenoMode() && (state.lastZenoSong || state.lastZenoArtist)) {
        renderSongUI(state.lastZenoSong, state.lastZenoArtist);
      } else if (isFallbackMode()) {
        renderFallbackStationUI();
      } else {
        renderIdleLogoUI();
      }
    }, PROGRAM_PREVIEW_MS);
  }

  function resetUI() {
    if (!state.overlay || !state.img || !state.text) return;
    clearProgramPreviewTimer();
    state.awaitingInitialSongAfterPlay = false;
    syncSongInfoLayout('');
    renderIdleLogoUI();
  }

  window.resetUI = resetUI;


  function fetchWithTimeout(url, timeoutMs) {
    return new Promise(function(resolve, reject) {
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = setTimeout(function() {
        if (controller) controller.abort();
        reject(new Error('timeout'));
      }, Math.max(1000, Number(timeoutMs || 4000)));

      fetch(url, {
        cache: 'no-store',
        signal: controller ? controller.signal : undefined
      }).then(function(response) {
        clearTimeout(timer);
        if (!response.ok) {
          reject(new Error('http-' + response.status));
          return;
        }
        resolve(response);
      }).catch(function(error) {
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  function normalizeFallbackMetadataPayload(payload) {
    if (!payload) return { title: '', song: '', artist: '', cover: '' };

    if (typeof payload === 'string') {
      const parsed = parseMetadataForDisplay(payload);
      return {
        title: cleanupMetadataChunk(payload),
        song: parsed.song || '',
        artist: parsed.artist || '',
        cover: ''
      };
    }

    const title = cleanupMetadataChunk(
      payload.streamTitle || payload.title || payload.songtitle || payload.nowplaying || payload.now_playing || payload.track || payload.music || payload.song || ''
    );
    const song = cleanupMetadataChunk(payload.song || payload.music || payload.track || payload.title || '');
    const artist = cleanupMetadataChunk(payload.artist || payload.singer || payload.author || '');
    const cover = payload.cover || payload.image || payload.artwork || payload.thumbnail || '';

    if (song || artist) {
      return { title: title || buildDisplayText(song, artist), song: song, artist: artist, cover: cover || '' };
    }

    if (title) {
      const parsed = parseMetadataForDisplay(title);
      return {
        title: title,
        song: parsed.song || '',
        artist: parsed.artist || '',
        cover: cover || ''
      };
    }

    return { title: '', song: '', artist: '', cover: cover || '' };
  }

  async function readFallbackMetadata() {
    const baseUrl = state.fallbackMetadataUrl || FALLBACK_METADATA_URL;
    const separator = baseUrl.indexOf('?') >= 0 ? '&' : '?';
    const url = `${baseUrl}${separator}_=${Date.now()}`;
    const response = await fetchWithTimeout(url, FALLBACK_METADATA_TIMEOUT_MS);
    const rawText = await response.text();
    const trimmed = String(rawText || '').trim();
    if (!trimmed) return { title: '', song: '', artist: '', cover: '' };

    try {
      const json = JSON.parse(trimmed);
      return normalizeFallbackMetadataPayload(json);
    } catch (err) {
      return normalizeFallbackMetadataPayload(trimmed);
    }
  }

  function applyFallbackMetadataResult(data) {
    const normalized = normalizeFallbackMetadataPayload(data);
    const title = normalized.title || buildDisplayText(normalized.song, normalized.artist);
    const resolveId = ++state.metadataResolveId;

    state.lastFallbackRawTitle = title || '';
    state.currentSong = normalized.song || '';
    state.currentArtist = normalized.artist || '';
    state.currentResolvedCover = normalized.cover || '';

    if (!state.userInitiatedPlay && !state.userPlaybackIntent) return;

    if (state.currentSong || state.currentArtist) {
      if (state.awaitingInitialSongAfterPlay && state.programPreviewTimer && (state.activeProgramPreviewReason === 'play' || state.activeProgramPreviewReason === 'play-observer')) {
        state.awaitingInitialSongAfterPlay = false;
      }

      if (normalized.cover) {
        if (state.displayMode === 'song' && !state.programPreviewTimer) {
          renderSongUI(state.currentSong, state.currentArtist, normalized.cover);
        }
        return;
      }

      resolveTrackMetadata(title, function(resolved) {
        if (resolveId !== state.metadataResolveId) return;
        state.currentSong = resolved.song || state.currentSong;
        state.currentArtist = resolved.artist || state.currentArtist;
        state.currentResolvedCover = resolved.cover || state.currentResolvedCover || '';
        if (state.displayMode === 'song' && !state.programPreviewTimer) {
          renderSongUI(state.currentSong, state.currentArtist, state.currentResolvedCover);
        }
      });

      if (!state.programPreviewTimer) {
        renderSongUI(state.currentSong, state.currentArtist, state.currentResolvedCover);
      }
      return;
    }

    state.currentResolvedCover = '';
    renderFallbackStationUI();
  }

  function applyFallbackMetadataFailure() {
    state.currentSong = '';
    state.currentArtist = '';
    state.currentResolvedCover = '';
    if (!state.userInitiatedPlay && !state.userPlaybackIntent) {
      resetUI();
      return;
    }
    if (!state.programPreviewTimer) {
      renderFallbackStationUI();
    }
  }

  async function pollFallbackMetadataOnce() {
    if (!isFallbackMode()) return;
    if (state.fallbackMetadataRunning) return;
    state.fallbackMetadataRunning = true;
    try {
      const data = await readFallbackMetadata();
      if (!isFallbackMode()) return;
      applyFallbackMetadataResult(data);
    } catch (error) {
      if (!isFallbackMode()) return;
      applyFallbackMetadataFailure();
    } finally {
      state.fallbackMetadataRunning = false;
    }
  }

  function stopFallbackMetadataPolling() {
    if (state.fallbackMetadataTimer) {
      clearInterval(state.fallbackMetadataTimer);
      state.fallbackMetadataTimer = null;
    }
    state.fallbackMetadataRunning = false;
  }

  function ensureFallbackMetadataPolling() {
    if (!isFallbackMode()) {
      stopFallbackMetadataPolling();
      return;
    }
    if (!state.fallbackMetadataTimer) {
      state.fallbackMetadataTimer = setInterval(function() {
        if (!isFallbackMode()) return;
        pollFallbackMetadataOnce();
      }, FALLBACK_METADATA_INTERVAL_MS);
    }
    pollFallbackMetadataOnce();
  }

  function searchDeezer(query, callback) {
    const callbackName = 'deezer_cb_' + Math.random().toString(36).substring(2, 10);
    window[callbackName] = function(data) {
      let cover = null;
      if (data && data.data && data.data.length > 0) {
        const firstResult = data.data[0];
        if (firstResult.album && firstResult.album.cover_xl) {
          cover = firstResult.album.cover_xl || firstResult.album.cover_big || firstResult.album.cover_medium;
        } else if (firstResult.artist && firstResult.artist.picture_xl) {
          cover = firstResult.artist.picture_xl || firstResult.artist.picture_big;
        }
      }
      callback(cover);
      cleanup();
    };

    const script = document.createElement('script');
    script.id = callbackName;
    script.src = `https://api.deezer.com/search?q=${encodeURIComponent(query)}&output=jsonp&callback=${callbackName}&_=${Date.now()}`;

    function cleanup() {
      if (script.parentNode) script.parentNode.removeChild(script);
      delete window[callbackName];
    }

    script.onerror = function() {
      callback(null);
      cleanup();
    };
    document.body.appendChild(script);

    setTimeout(function() {
      if (window[callbackName]) {
        callback(null);
        cleanup();
      }
    }, 5000);
  }


  function searchDeezerDetailed(query, callback, limit) {
    const callbackName = 'deezer_detail_cb_' + Math.random().toString(36).substring(2, 10);
    const maxResults = Math.max(1, Math.min(Number(limit || 6), 10));

    window[callbackName] = function(data) {
      callback((data && Array.isArray(data.data)) ? data.data : []);
      cleanup();
    };

    const script = document.createElement('script');
    script.id = callbackName;
    script.src = `https://api.deezer.com/search?q=${encodeURIComponent(query)}&limit=${maxResults}&output=jsonp&callback=${callbackName}&_=${Date.now()}`;

    function cleanup() {
      if (script.parentNode) script.parentNode.removeChild(script);
      delete window[callbackName];
    }

    script.onerror = function() {
      callback([]);
      cleanup();
    };

    document.body.appendChild(script);

    setTimeout(function() {
      if (window[callbackName]) {
        callback([]);
        cleanup();
      }
    }, 5000);
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

  function resolveArtistFromSingleSegment(segment, callback) {
    const cleaned = cleanupMetadataChunk(segment);
    if (!cleaned) {
      callback({ bestArtist: '', bestArtistScore: 0, artistBias: -1, bestTitleScore: 0, cover: '' });
      return;
    }

    searchDeezerDetailed(cleaned, function(results) {
      let bestArtist = '';
      let bestArtistScore = 0;
      let bestTitleScore = 0;
      let bestCover = '';

      results.forEach(function(item) {
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

      callback({
        bestArtist: bestArtist,
        bestArtistScore: bestArtistScore,
        bestTitleScore: bestTitleScore,
        artistBias: bestArtistScore - bestTitleScore,
        cover: bestCover
      });
    }, 5);
  }

  function resolveTrackMetadata(rawTitle, callback) {
    const cacheKey = String(rawTitle || '').trim();
    if (!cacheKey) {
      callback({ song: '', artist: '', cover: '' });
      return;
    }

    if (state.metadataResolveCache[cacheKey]) {
      callback(state.metadataResolveCache[cacheKey]);
      return;
    }

    const immediate = parseMetadataForDisplay(rawTitle);
    const first = immediate.first;
    const second = immediate.second;

    if (!second) {
      const simple = { song: immediate.song, artist: '', cover: '' };
      state.metadataResolveCache[cacheKey] = simple;
      callback(simple);
      return;
    }

    const direct = { artist: cleanupMetadataChunk(first), song: cleanupMetadataChunk(second) };
    const swapped = { artist: cleanupMetadataChunk(second), song: cleanupMetadataChunk(first) };
    const meaningfulParts = (immediate.parts || []).map(function(part) {
      return cleanupMetadataChunk(part);
    }).filter(function(part) {
      return part && !isNumericMetadataSegment(part) && !isCollectionMetadataSegment(part);
    });
    const fullQuery = meaningfulParts.length >= 2
      ? (cleanTitleForSearch(meaningfulParts[meaningfulParts.length - 2], meaningfulParts[meaningfulParts.length - 1]) || cleanupMetadataChunk(rawTitle))
      : (cleanTitleForSearch(first, second) || cleanupMetadataChunk(rawTitle));

    searchDeezerDetailed(fullQuery, function(results) {
      let best = null;

      results.forEach(function(item) {
        const directScore = scoreResultForInterpretation(item, direct.artist, direct.song);
        const swappedScore = scoreResultForInterpretation(item, swapped.artist, swapped.song);
        const better = directScore.total >= swappedScore.total
          ? { orientation: 'direct', scores: directScore, base: direct }
          : { orientation: 'swapped', scores: swappedScore, base: swapped };

        if (!best || better.scores.total > best.scores.total) {
          best = better;
        }
      });

      function finalizeResolved(chosenBase, bestInfo, segmentArtistInfo) {
        const safeArtist = cleanupMetadataChunk(chosenBase.artist);
        const safeSong = cleanupMetadataChunk(chosenBase.song);
        let resolvedArtist = safeArtist;
        let resolvedSong = safeSong;
        let resolvedCover = (bestInfo && bestInfo.scores && bestInfo.scores.cover) || '';

        if (bestInfo && bestInfo.scores && bestInfo.scores.artistScore >= 0.68 && bestInfo.scores.resultArtist) {
          resolvedArtist = cleanupMetadataChunk(bestInfo.scores.resultArtist);
        } else if (segmentArtistInfo && segmentArtistInfo.bestArtistScore >= 0.78 && segmentArtistInfo.bestArtist) {
          resolvedArtist = cleanupMetadataChunk(segmentArtistInfo.bestArtist);
          if (!resolvedCover && segmentArtistInfo.cover) resolvedCover = segmentArtistInfo.cover;
        }

        if (bestInfo && bestInfo.scores && bestInfo.scores.songScore >= 0.82 && bestInfo.scores.resultSong) {
          resolvedSong = cleanupMetadataChunk(bestInfo.scores.resultSong);
        }

        const rawParts = (immediate.parts || []).map(function(part) { return cleanupMetadataChunk(part); }).filter(Boolean);
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

        const resolved = { song: resolvedSong, artist: resolvedArtist, cover: resolvedCover || '' };
        state.metadataResolveCache[cacheKey] = resolved;
        callback(resolved);
      }

      if (best && best.scores.total >= 0.56) {
        finalizeResolved(best.base, best, null);
        return;
      }

      resolveArtistFromSingleSegment(first, function(infoFirst) {
        resolveArtistFromSingleSegment(second, function(infoSecond) {
          let chosen = best && best.base ? best.base : direct;
          let chosenArtistInfo = null;

          if (infoFirst.artistBias > infoSecond.artistBias + 0.08) {
            chosen = direct;
            chosenArtistInfo = infoFirst;
          } else if (infoSecond.artistBias > infoFirst.artistBias + 0.08) {
            chosen = swapped;
            chosenArtistInfo = infoSecond;
          } else if (best && best.orientation === 'swapped') {
            chosen = swapped;
            chosenArtistInfo = infoSecond.artistBias >= infoFirst.artistBias ? infoSecond : infoFirst;
          } else {
            chosen = direct;
            chosenArtistInfo = infoFirst.artistBias >= infoSecond.artistBias ? infoFirst : infoSecond;
          }

          finalizeResolved(chosen, best, chosenArtistInfo);
        });
      });
    }, 6);
  }

  function refreshCover(song, artist, preferredCover) {
    if (!state.img) return;
    if (isVoiceBrasilMode()) {
      state.img.src = VOZ_BRASIL_COVER;
      return;
    }

    const cleanQuery = cleanTitleForSearch(artist, song);
    const queryKey = `${artist || ''}__${song || ''}`.trim();
    const requestId = ++state.coverRequestId;
    state.lastCoverQueryKey = queryKey;

    state.img.src = preferredCover || DEFAULT_LOGO;

    if (preferredCover || !cleanQuery) {
      return;
    }

    searchDeezer(cleanQuery, function(cover) {
      if (requestId !== state.coverRequestId || state.lastCoverQueryKey !== queryKey) return;

      if (cover) {
        state.img.src = cover;
        return;
      }

      if (artist) {
        searchDeezer(artist.trim(), function(artistCover) {
          if (requestId !== state.coverRequestId || state.lastCoverQueryKey !== queryKey) return;
          state.img.src = artistCover || DEFAULT_LOGO;
        });
        return;
      }

      state.img.src = DEFAULT_LOGO;
    });
  }

  function updateUI(song, artist) {
    renderSongUI(song, artist);
  }

  function getGlobalPlayingState() {
    const pauseBtn = document.getElementById('playerbuttonpause');
    if (pauseBtn) {
      const style = window.getComputedStyle(pauseBtn);
      if (style.display !== 'none' && parseFloat(style.opacity || '0') > 0 && style.visibility !== 'hidden') {
        return true;
      }
    }

    const media = Array.from(document.querySelectorAll('#player audio, #player video, audio, video'));
    return media.some(function(el) {
      return !el.paused && !el.ended && !el.error;
    });
  }

  function handleObservedPlaybackChange(playingNow) {
    if (playingNow === state.lastObservedPlaying) return;
    state.lastObservedPlaying = playingNow;

    if (!playingNow) {
      state.userInitiatedPlay = false;
      setTimeout(function() {
        if (!getGlobalPlayingState()) {
          resetUI();
        }
      }, 700);
      return;
    }

    state.userInitiatedPlay = true;
    state.userPlaybackIntent = true;

    if (isVoiceBrasilMode()) {
      clearProgramPreviewTimer();
      renderVoiceBrasilUI();
      return;
    }

    state.awaitingInitialSongAfterPlay = true;
    startProgramPreview('play-observer');
  }

  function bindMediaStateListeners() {
    if (state.mediaEventsBound) return;
    state.mediaEventsBound = true;

    function isMediaNode(target) {
      return !!target && (target.tagName === 'AUDIO' || target.tagName === 'VIDEO');
    }

    document.addEventListener('play', function(ev) {
      if (!isMediaNode(ev.target)) return;
      handleObservedPlaybackChange(true);
    }, true);

    document.addEventListener('playing', function(ev) {
      if (!isMediaNode(ev.target)) return;
      handleObservedPlaybackChange(true);
    }, true);

    const syncPauseLike = function(ev) {
      if (!isMediaNode(ev.target)) return;
      setTimeout(function() {
        handleObservedPlaybackChange(getGlobalPlayingState());
      }, 180);
    };

    document.addEventListener('pause', syncPauseLike, true);
    document.addEventListener('ended', syncPauseLike, true);
  }

  function init() {
    function isPlaying() {
      return getGlobalPlayingState();
    }

    function waitForWrapper() {
      const wrapper = document.getElementById('playercoverwrapper');
      if (wrapper) {
        if (getComputedStyle(wrapper).position === 'static') {
          wrapper.style.position = 'relative';
        }
        
        createOverlay(wrapper);
        positionExternalText();
        restoreActiveVisualState();
        attachPlayerClickListener();
      } else {
        setTimeout(waitForWrapper, 300);
      }
    }

    function createOverlay(wrapper) {
      // Remove overlay antigo se existir (limpeza extra)
      const oldOverlay = document.getElementById('atividade-metadata-overlay');
      if (oldOverlay) oldOverlay.remove();

      state.overlay = document.createElement('div');
      state.overlay.id = 'atividade-metadata-overlay';
      state.overlay.style.position = 'absolute';
      state.overlay.style.top = '0';
      state.overlay.style.left = '0';
      state.overlay.style.width = '100%';
      state.overlay.style.height = '100%';
      state.overlay.style.zIndex = '10';
      state.overlay.style.background = 'transparent';
      state.overlay.style.color = '#fff';
      state.overlay.style.pointerEvents = 'none';
      state.overlay.style.borderRadius = 'inherit';
      state.overlay.style.display = 'none';
      state.overlay.style.flexDirection = 'column';
      state.overlay.style.justifyContent = 'center';
      state.overlay.style.alignItems = 'center';
      state.overlay.style.textAlign = 'center';

      ensureExternalText();

      state.img = document.createElement('img');
      state.img.id = 'atividade-cover';
      state.img.src = DEFAULT_LOGO;
      state.img.alt = 'Album Cover';
      state.img.style.width = '100%';
      state.img.style.height = '100%';
      state.img.style.objectFit = 'cover';
      state.img.style.borderRadius = 'inherit';

      state.text = document.createElement('div');
      state.text.id = 'atividade-song-info';
      state.text.style.marginTop = '8px';
      state.text.style.padding = '0 10px';
      state.text.style.fontFamily = 'Orbitron, sans-serif';
      state.text.style.fontWeight = 'bold';
      state.text.style.wordBreak = 'break-word';

      state.overlay.appendChild(state.img);
      state.overlay.appendChild(state.text);
      wrapper.appendChild(state.overlay);
    }

    function isPlaybackControlClick(ev) {
      const target = ev && ev.target ? ev.target : null;
      if (!target || typeof target.closest !== 'function') return false;

      return Boolean(
        target.closest('#playerbuttonplay') ||
        target.closest('#playerbuttonpause') ||
        target.closest('#playerpauseplaywrapper') ||
        target.closest('.lunaradioplay') ||
        target.closest('.lunaradiopause')
      );
    }

    function attachPlayerClickListener() {
      const player = document.getElementById('player');
      if (!player) return;
      if (state.boundPlayerEl === player) return;

      state.boundPlayerEl = player;
      state.playerClickBound = true;

      const handlePlaybackGesture = function(ev) {
        if (!ev.isTrusted) return;

        const wasPlayingBeforeClick = isPlaying();
        const playbackControlClick = isPlaybackControlClick(ev);

        if (playbackControlClick) {
          state.userPlaybackIntent = true;
        }

        setTimeout(function() {
          const playingNow = isPlaying();

          if (!playbackControlClick && wasPlayingBeforeClick === playingNow) {
            return;
          }

          if (wasPlayingBeforeClick === playingNow) {
            return;
          }

          state.userInitiatedPlay = playingNow;
          if (!playingNow) {
            setTimeout(function() {
              if (!isPlaying()) resetUI();
            }, 700);
            return;
          }

          if (isVoiceBrasilMode()) {
            clearProgramPreviewTimer();
            renderVoiceBrasilUI();
            return;
          }

          if (isFallbackMode()) {
            state.awaitingInitialSongAfterPlay = true;
            startProgramPreview('play');
            ensureFallbackMetadataPolling();
            return;
          }

          state.awaitingInitialSongAfterPlay = true;
          startProgramPreview('play');
        }, 220);
      };

      player.addEventListener('click', handlePlaybackGesture);
      player.addEventListener('touchend', handlePlaybackGesture, { passive: true });
      player.addEventListener('pointerup', handlePlaybackGesture);
    }


    if (!state.layoutListenersBound) {
      window.addEventListener('resize', function() {
        positionExternalText();
        setTimeout(positionExternalText, 120);
      });
      window.addEventListener('orientationchange', function() {
        setTimeout(positionExternalText, 300);
        setTimeout(positionExternalText, 650);
      });
      state.layoutListenersBound = true;
    }

    bindMediaStateListeners();
    state.lastObservedPlaying = getGlobalPlayingState();
    waitForWrapper();
  }

  function subscribeToMetadata() {
    try {
      const url = 'https://api.zeno.fm/mounts/metadata/subscribe/z2h3tpp2fchvv';
      const es = new EventSource(url);
      es.onmessage = function(event) {
        try {
          const parsed = JSON.parse(event.data);
          if (parsed && parsed.streamTitle) {
            if (!isZenoMode()) return;
            const title = parsed.streamTitle;
            if (title !== state.lastTitle) {
              state.lastTitle = title;
              const immediate = parseMetadataForDisplay(title);
              const resolveId = ++state.metadataResolveId;
              state.currentResolvedCover = '';
              state.currentSong = immediate.song;
              state.currentArtist = immediate.artist;
              state.lastZenoSong = immediate.song;
              state.lastZenoArtist = immediate.artist;

              const metadataSessionActive = state.userInitiatedPlay || state.userPlaybackIntent || state.displayMode === 'song' || state.displayMode === 'program' || !!state.currentSong || !!state.lastZenoSong;
              if (!metadataSessionActive) return;

              if (state.awaitingInitialSongAfterPlay) {
                state.awaitingInitialSongAfterPlay = false;
                if (state.programPreviewTimer && (state.activeProgramPreviewReason === 'play' || state.activeProgramPreviewReason === 'play-observer')) {
                  resolveTrackMetadata(title, function(resolved) {
                    if (resolveId !== state.metadataResolveId || state.lastTitle !== title) return;
                    state.currentSong = resolved.song || immediate.song;
                    state.currentArtist = resolved.artist || immediate.artist;
                    state.lastZenoSong = state.currentSong;
                    state.lastZenoArtist = state.currentArtist;
                    state.currentResolvedCover = resolved.cover || '';
                  });
                  return;
                }
                renderSongUI(immediate.song, immediate.artist);
                resolveTrackMetadata(title, function(resolved) {
                  if (resolveId !== state.metadataResolveId || state.lastTitle !== title) return;
                  state.currentSong = resolved.song || immediate.song;
                  state.currentArtist = resolved.artist || immediate.artist;
                  state.lastZenoSong = state.currentSong;
                  state.lastZenoArtist = state.currentArtist;
                  state.currentResolvedCover = resolved.cover || '';
                  if (state.displayMode === 'song') {
                    renderSongUI(state.currentSong, state.currentArtist, state.currentResolvedCover);
                  }
                });
                return;
              }

              startProgramPreview('track-change');
              resolveTrackMetadata(title, function(resolved) {
                if (resolveId !== state.metadataResolveId || state.lastTitle !== title) return;
                state.currentSong = resolved.song || immediate.song;
                state.currentArtist = resolved.artist || immediate.artist;
                state.lastZenoSong = state.currentSong;
                state.lastZenoArtist = state.currentArtist;
                state.currentResolvedCover = resolved.cover || '';
                if (state.displayMode === 'song' && !state.programPreviewTimer) {
                  renderSongUI(state.currentSong, state.currentArtist, state.currentResolvedCover);
                }
              });
            }
          }
        } catch (e) {}
      };
    } catch (e) {}
  }

  window.addEventListener('atividade-stream-mode-change', function(e) {
    const detail = e && e.detail ? e.detail : {};
    state.specialMode = detail.mode || 'zeno';
    state.fallbackMetadataUrl = detail.metadataurl || state.fallbackMetadataUrl || FALLBACK_METADATA_URL;

    if (state.specialMode === 'voz') {
      stopFallbackMetadataPolling();
      clearProgramPreviewTimer();
      if (state.userInitiatedPlay || state.userPlaybackIntent) {
        renderVoiceBrasilUI();
      } else {
        renderIdleLogoUI();
      }
      return;
    }

    if (state.specialMode === 'fallback') {
      ensureFallbackMetadataPolling();
    } else {
      stopFallbackMetadataPolling();
    }

    if (state.userInitiatedPlay || state.userPlaybackIntent) {
      state.awaitingInitialSongAfterPlay = true;
      startProgramPreview('mode-change');
      if (state.specialMode === 'fallback') {
        pollFallbackMetadataOnce();
      }
    } else {
      resetUI();
    }
  });

  window.addEventListener('lunaradio-reinitialized', function(e) {
    state.userInitiatedPlay = (e && e.detail && typeof e.detail.wasPlaying === 'boolean') ? e.detail.wasPlaying : state.userInitiatedPlay;
    if (state.userInitiatedPlay) state.userPlaybackIntent = true;
    state.specialMode = (e && e.detail && e.detail.mode) ? e.detail.mode : (window.__atividadeCurrentStreamMode || state.specialMode);
    state.fallbackMetadataUrl = (e && e.detail && e.detail.metadataurl) ? e.detail.metadataurl : (window.__atividadeFallbackMetadataUrl || state.fallbackMetadataUrl || FALLBACK_METADATA_URL);
    if (state.specialMode === 'fallback') {
      ensureFallbackMetadataPolling();
    } else {
      stopFallbackMetadataPolling();
    }
    init();
    setTimeout(function() {
      restoreActiveVisualState();
      if (state.specialMode === 'fallback') {
        pollFallbackMetadataOnce();
      }
      positionExternalText();
    }, 400);
  });

  syncProgramTime();
  setInterval(syncProgramTime, 300000);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      init();
      subscribeToMetadata();
    });
  } else {
    init();
    subscribeToMetadata();
  }
})();
