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
  const TIME_API_URL = 'https://time.now/developer/api/timezone/America/Sao_Paulo';
  const PROGRAM_PREVIEW_MS = 15000;
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
    layoutListenersBound: false,
    playerClickBound: false,
    specialMode: (window.__atividadeCurrentStreamMode || 'zeno'),
    lastZenoSong: '',
    lastZenoArtist: '',
    displayMode: 'idle',
    programPreviewTimer: null,
    activeProgramPreviewReason: '',
    awaitingInitialSongAfterPlay: false,
    serverOffsetMs: 0,
    timeSyncRunning: false,
    timeSyncReady: false
  };

  /**
   * Limpa o título da música para melhorar a busca no Deezer.
   */
  function cleanTitleForSearch(artist, song) {
    let q = ((artist || '') + ' ' + (song || '')).trim();
    if (!q) return '';

    // 1. Remove prefixos de ranking como "71. ", "01 - ", etc no início da string
    q = q.replace(/^[0-9]{1,3}[\s.\-_]+/, '');

    // 2. Remove informações de BPM (ex: " - 110 bpm")
    q = q.replace(/\s*-\s*[0-9]{2,3}\s*bpm/gi, '');

    // 3. Remove textos entre parênteses ou colchetes (ex: "(Ultimix)", "[Radio Edit]")
    q = q.replace(/\s*[\(\[][^\)\]]*[\)\]]/g, '');

    // 4. Remove caracteres especiais e mantém apenas letras, números e espaços básicos
    // Nota: Mantemos números aqui pois alguns artistas/músicas precisam deles (ex: "U2", "Mambo No. 5")
    q = q.replace(/[^\w\sÀ-ÿ]/gi, ' ').replace(/\s+/g, ' ').trim();

    return q;
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


  function renderSongUI(song, artist) {
    if (!state.overlay || !state.img || !state.text) return;
    if (isVoiceBrasilMode()) {
      renderVoiceBrasilUI();
      return;
    }
    state.displayMode = 'song';
    state.overlay.style.display = 'flex';
    const info = (song && artist) ? `${song} - ${artist}` : (song || artist || 'ATIVIDADE FM 103.1FM');
    syncSongInfoLayout(info);
    refreshCover(song, artist);
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

    if (state.displayMode === 'program') {
      const currentProgram = getCurrentProgramInfo();
      if (currentProgram) {
        renderProgramUI(currentProgram);
        return;
      }
    }

    if (state.currentSong || state.currentArtist) {
      renderSongUI(state.currentSong, state.currentArtist);
    } else if (state.lastZenoSong || state.lastZenoArtist) {
      renderSongUI(state.lastZenoSong, state.lastZenoArtist);
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
      renderSongUI(state.currentSong || state.lastZenoSong, state.currentArtist || state.lastZenoArtist);
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
      } else if (state.lastZenoSong || state.lastZenoArtist) {
        renderSongUI(state.lastZenoSong, state.lastZenoArtist);
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

  function refreshCover(song, artist) {
    if (!state.img) return;
    if (isVoiceBrasilMode()) {
      state.img.src = VOZ_BRASIL_COVER;
      return;
    }

    const cleanQuery = cleanTitleForSearch(artist, song);
    if (!cleanQuery) {
      state.img.src = DEFAULT_LOGO;
      return;
    }

    searchDeezer(cleanQuery, function(cover) {
      if (cover) {
        state.img.src = cover;
      } else if (artist) {
        searchDeezer(artist.trim(), function(artistCover) {
          state.img.src = artistCover || DEFAULT_LOGO;
        });
      } else {
        state.img.src = DEFAULT_LOGO;
      }
    });
  }

  function updateUI(song, artist) {
    renderSongUI(song, artist);
  }

  function init() {
    function isPlaying() {
      const pauseBtn = document.getElementById('playerbuttonpause');
      if (!pauseBtn) return false;
      const style = window.getComputedStyle(pauseBtn);
      return style.display !== 'none' && parseFloat(style.opacity || '0') > 0;
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
      if (!player || state.playerClickBound) return;
      state.playerClickBound = true;
      player.addEventListener('click', function(ev) {
        if (!ev.isTrusted) return;

        const wasPlayingBeforeClick = isPlaying();
        const playbackControlClick = isPlaybackControlClick(ev);

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
            resetUI();
            return;
          }

          if (isVoiceBrasilMode()) {
            clearProgramPreviewTimer();
            renderVoiceBrasilUI();
            return;
          }

          state.awaitingInitialSongAfterPlay = true;
          startProgramPreview('play');
        }, 200);
      });
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
            if (isVoiceBrasilMode()) return;
            const title = parsed.streamTitle;
            if (title !== state.lastTitle) {
              state.lastTitle = title;
              let artist = '', song = '';
              if (title.includes(' - ')) {
                const parts = title.split(' - ');
                artist = parts[0].trim();
                song = parts.slice(1).join(' - ').trim();
              } else {
                song = title.trim();
              }
              state.currentSong = song;
              state.currentArtist = artist;
              state.lastZenoSong = song;
              state.lastZenoArtist = artist;

              if (!state.userInitiatedPlay) return;

              if (state.awaitingInitialSongAfterPlay) {
                state.awaitingInitialSongAfterPlay = false;
                if (state.programPreviewTimer && state.activeProgramPreviewReason === 'play') {
                  return;
                }
                renderSongUI(song, artist);
                return;
              }

              startProgramPreview('track-change');
            }
          }
        } catch (e) {}
      };
    } catch (e) {}
  }

  window.addEventListener('atividade-stream-mode-change', function(e) {
    const detail = e && e.detail ? e.detail : {};
    state.specialMode = detail.mode || 'zeno';

    if (state.specialMode === 'voz') {
      clearProgramPreviewTimer();
      if (state.userInitiatedPlay) {
        renderVoiceBrasilUI();
      } else {
        renderIdleLogoUI();
      }
      return;
    }

    if (state.userInitiatedPlay) {
      state.awaitingInitialSongAfterPlay = true;
      startProgramPreview('mode-change');
    } else {
      resetUI();
    }
  });

  window.addEventListener('lunaradio-reinitialized', function(e) {
    state.userInitiatedPlay = (e && e.detail && typeof e.detail.wasPlaying === 'boolean') ? e.detail.wasPlaying : state.userInitiatedPlay;
    state.specialMode = (e && e.detail && e.detail.mode) ? e.detail.mode : (window.__atividadeCurrentStreamMode || state.specialMode);
    init();
    setTimeout(function() {
      restoreActiveVisualState();
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
