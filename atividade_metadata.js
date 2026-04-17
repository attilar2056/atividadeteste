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
    lastZenoArtist: ''
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
    state.overlay.style.display = 'flex';
    applyOverlayLayoutMode();
    state.text.style.display = 'none';
    state.img.src = DEFAULT_LOGO;
    external.textContent = '';
    external.style.display = 'none';
  }

  function syncSongInfoLayout(info) {
    const external = ensureExternalText();
    if (!state.text || !external) return;

    applyOverlayLayoutMode();
    state.text.style.display = 'none';
    external.textContent = info || '';
    positionExternalText();
  }


  function resetUI() {
    if (!state.overlay || !state.img || !state.text) return;
    syncSongInfoLayout('');
    renderIdleLogoUI();
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
    if (!state.overlay || !state.img || !state.text) return;
    if (isVoiceBrasilMode()) {
      renderVoiceBrasilUI();
      return;
    }
    state.overlay.style.display = 'flex';
    const info = (song && artist) ? `${song} - ${artist}` : (song || artist || 'ATIVIDADE FM 103.1FM');
    syncSongInfoLayout(info);
    refreshCover(song, artist);
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

        if (state.userInitiatedPlay && (state.currentSong || state.currentArtist)) {
          updateUI(state.currentSong, state.currentArtist);
        } else if (state.userInitiatedPlay && isVoiceBrasilMode()) {
          renderVoiceBrasilUI();
        } else {
          renderIdleLogoUI();
        }
        
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

    function attachPlayerClickListener() {
      const player = document.getElementById('player');
      if (!player || state.playerClickBound) return;
      state.playerClickBound = true;
      player.addEventListener('click', function(ev) {
        if (!ev.isTrusted) return;
        setTimeout(function() {
          state.userInitiatedPlay = isPlaying();
          if (!state.userInitiatedPlay) {
            resetUI();
            return;
          }
          if (isVoiceBrasilMode()) {
            renderVoiceBrasilUI();
          } else if (state.currentSong || state.currentArtist) {
            updateUI(state.currentSong, state.currentArtist);
          } else if (state.lastZenoSong || state.lastZenoArtist) {
            updateUI(state.lastZenoSong, state.lastZenoArtist);
          } else {
            resetUI();
          }
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
              
              if (state.userInitiatedPlay) {
                updateUI_External(song, artist);
              }
            }
          }
        } catch (e) {}
      };
    } catch (e) {}
  }

  function updateUI_External(song, artist) {
    if (isVoiceBrasilMode()) {
      renderVoiceBrasilUI();
      return;
    }
    const overlay = document.getElementById('atividade-metadata-overlay');
    const img = document.getElementById('atividade-cover');
    const text = document.getElementById('atividade-song-info');
    if (overlay && img && text) {
      overlay.style.display = 'flex';
      const info = (song && artist) ? `${song} - ${artist}` : (song || artist || 'ATIVIDADE FM 103.1FM');
      syncSongInfoLayout(info);

      const cleanQuery = cleanTitleForSearch(artist, song);
      const searchDeezerLocal = function(q, cb) {
        const cbName = 'dz_ext_' + Math.random().toString(36).substring(2, 10);
        window[cbName] = function(d) {
          let c = null;
          if (d && d.data && d.data.length > 0) {
            const res = d.data[0];
            c = (res.album && res.album.cover_xl) ? res.album.cover_xl : (res.artist ? res.artist.picture_xl : null);
          }
          cb(c);
          const s = document.getElementById(cbName);
          if (s) s.remove();
          delete window[cbName];
        };
        const s = document.createElement('script');
        s.id = cbName;
        s.src = `https://api.deezer.com/search?q=${encodeURIComponent(q)}&output=jsonp&callback=${cbName}&_=${Date.now()}`;
        s.onerror = function() {
          cb(null);
          const sx = document.getElementById(cbName);
          if (sx) sx.remove();
          delete window[cbName];
        };
        document.body.appendChild(s);
        setTimeout(function() {
          if (window[cbName]) {
            cb(null);
            const sx = document.getElementById(cbName);
            if (sx) sx.remove();
            delete window[cbName];
          }
        }, 5000);
      };

      searchDeezerLocal(cleanQuery, function(c) {
        if (c) img.src = c;
        else {
          if (artist) {
            searchDeezerLocal(artist.trim(), function(c2) { img.src = c2 || DEFAULT_LOGO; });
          } else img.src = DEFAULT_LOGO;
        }
      });
    }
  }


  window.addEventListener('atividade-stream-mode-change', function(e) {
    const detail = e && e.detail ? e.detail : {};
    state.specialMode = detail.mode || 'zeno';

    if (state.specialMode === 'voz') {
      if (state.userInitiatedPlay) {
        renderVoiceBrasilUI();
      } else {
        renderIdleLogoUI();
      }
      return;
    }

    if (state.userInitiatedPlay) {
      if (state.currentSong || state.currentArtist) {
        updateUI(state.currentSong, state.currentArtist);
      } else if (state.lastZenoSong || state.lastZenoArtist) {
        updateUI(state.lastZenoSong, state.lastZenoArtist);
      } else {
        resetUI();
      }
    } else {
      resetUI();
    }
  });

  window.addEventListener('lunaradio-reinitialized', function(e) {
    state.userInitiatedPlay = (e && e.detail && typeof e.detail.wasPlaying === 'boolean') ? e.detail.wasPlaying : state.userInitiatedPlay;
    state.specialMode = (e && e.detail && e.detail.mode) ? e.detail.mode : (window.__atividadeCurrentStreamMode || state.specialMode);
    init();
    setTimeout(function() {
      if (isVoiceBrasilMode() && state.userInitiatedPlay) {
        renderVoiceBrasilUI();
      } else {
        positionExternalText();
      }
    }, 400);
  });

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
