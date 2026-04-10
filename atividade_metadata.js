/*
 * Metadata display script for ATIVIDADE FM
 *
 * Este script exibe a capa do álbum e informações da música apenas
 * depois que o usuário clica no botão de play do player Lunaradio.
 * Enquanto o usuário não interagir, a página mostra apenas o logotipo
 * padrão da rádio. O script continua a buscar metadados, mas só
 * mostra as informações quando a reprodução for iniciada pelo usuário.
 */

(function() {
  function init() {
    const DEFAULT_LOGO = 'https://i.imgur.com/v3cg03k.jpeg';

    // Elementos e estado da sobreposição
    let overlay, img, text;
    let lastTitle = '';
    let currentSong = '';
    let currentArtist = '';
    let userInitiatedPlay = false;

    /**
     * Determina se o player está atualmente reproduzindo observando
     * a visibilidade do botão de pausa criado pelo Lunaradio. O
     * plugin alterna entre #playerbuttonplay e #playerbuttonpause ao
     * iniciar ou pausar o áudio. Se o botão de pausa estiver
     * visível (display diferente de 'none' e opacidade maior que 0),
     * considera-se que o player está em reprodução.
     */
    function isPlaying() {
      const pauseBtn = document.getElementById('playerbuttonpause');
      if (!pauseBtn) return false;
      const style = window.getComputedStyle(pauseBtn);
      // Quando o Lunaradio oculta o botão, display é 'none'.
      return style.display !== 'none' && parseFloat(style.opacity || '0') > 0;
    }

    /**
     * Espera o wrapper da capa do Lunaradio ser criado e então monta a
     * sobreposição. Usa polling pois o player renderiza elementos
     * assíncronos.
     */
    function waitForWrapper() {
      const wrapper = document.getElementById('playercoverwrapper');
      if (wrapper) {
        if (getComputedStyle(wrapper).position === 'static') {
          wrapper.style.position = 'relative';
        }
        if (!overlay) {
          // Cria a camada de sobreposição
          overlay = document.createElement('div');
          overlay.id = 'atividade-metadata-overlay';
          overlay.style.position = 'absolute';
          overlay.style.top = '0';
          overlay.style.left = '0';
          overlay.style.width = '100%';
          overlay.style.height = '100%';
          overlay.style.display = 'none';
          overlay.style.zIndex = '10';
          overlay.style.background = 'rgba(0,0,0,0.6)';
          overlay.style.color = '#fff';
          overlay.style.pointerEvents = 'none';
          overlay.style.borderRadius = 'inherit';
          overlay.style.display = 'flex';
          overlay.style.flexDirection = 'column';
          overlay.style.justifyContent = 'center';
          overlay.style.alignItems = 'center';
          overlay.style.textAlign = 'center';

          // Imagem de capa
          img = document.createElement('img');
          img.id = 'atividade-cover';
          img.src = DEFAULT_LOGO;
          img.alt = 'Album Cover';
          img.style.width = '80%';
          img.style.height = '80%';
          img.style.objectFit = 'cover';
          img.style.borderRadius = 'inherit';

          // Texto da música/artista
          text = document.createElement('div');
          text.id = 'atividade-song-info';
          text.style.marginTop = '8px';
          text.style.padding = '0 10px';
          text.style.fontFamily = 'Orbitron, sans-serif';
          text.style.fontWeight = 'bold';
          text.style.wordBreak = 'break-word';

          overlay.appendChild(img);
          overlay.appendChild(text);
          wrapper.appendChild(overlay);

          // Escuta clique no player para saber se o usuário iniciou a reprodução
          attachPlayerClickListener();
          // Conecta aos metadados
          subscribeToMetadata();
        }
      } else {
        setTimeout(waitForWrapper, 300);
      }
    }

    /**
     * Anexa um listener de clique ao container do player. Quando o
     * usuário clicar em qualquer parte do player, consideramos que o
     * play foi iniciado manualmente. A partir de então, se a rádio
     * estiver tocando, as informações serão exibidas.
     */
    function attachPlayerClickListener() {
      const player = document.getElementById('player');
      if (!player) return;
      player.addEventListener('click', function(ev) {
        // Apenas reage a interações do usuário.
        if (!ev.isTrusted) return;
        // Após o clique, verifica o estado de reprodução para definir
        // se o usuário iniciou ou pausou a rádio. Usa pequeno atraso
        // para dar tempo ao Lunaradio de alternar os botões play/pause.
        setTimeout(function() {
          userInitiatedPlay = isPlaying();
          if ((currentSong || currentArtist) && userInitiatedPlay) {
            updateUI(currentSong, currentArtist);
          } else {
            resetUI();
          }
        }, 100);
      });
    }

    /**
     * Abre uma EventSource para receber metadados do Zeno FM.
     */
    function subscribeToMetadata() {
      try {
        const url = 'https://api.zeno.fm/mounts/metadata/subscribe/z2h3tpp2fchvv';
        const es = new EventSource(url);
        es.addEventListener('message', function(event) {
          processData(event.data);
        });
        es.addEventListener('error', function(evt) {
          console.error('Erro na conexão do EventSource:', evt);
        });
      } catch (e) {
        console.error('EventSource não é suportado neste navegador ou falhou ao iniciar:', e);
      }
    }

    /**
     * Processa o JSON recebido e decide se a UI deve ser atualizada ou
     * revertida. Só mostra informações se o usuário clicou no player e
     * a rádio estiver tocando.
     */
    function processData(data) {
      try {
        const parsed = JSON.parse(data);
        if (parsed && parsed.streamTitle) {
          let artist = '';
          let song = '';
          const title = parsed.streamTitle;
          if (title.includes(' - ')) {
            const parts = title.split(' - ');
            artist = parts[0].trim();
            song = parts.slice(1).join(' - ').trim();
          } else {
            song = title.trim();
          }
          const combined = song && artist ? `${song} - ${artist}` : song || artist;
          if (combined && combined !== lastTitle) {
            lastTitle = combined;
            currentSong = song;
            currentArtist = artist;
            if (userInitiatedPlay && isPlaying()) {
              updateUI(song, artist);
            } else {
              resetUI();
            }
            return;
          }
        }
      } catch (e) {
        console.error('Erro ao processar metadados:', e);
      }
      resetUI();
    }

    /**
     * Oculta a sobreposição e restaura o logo padrão.
     */
    function resetUI() {
      if (!overlay || !img || !text) return;
      overlay.style.display = 'none';
      img.src = DEFAULT_LOGO;
      text.textContent = 'ATIVIDADE FM';
      text.style.fontSize = '24px';
    }

    /**
     * Exibe a sobreposição com a música e artista atuais. Ajusta o tamanho
     * da fonte conforme os dados disponíveis.
     */
    function updateUI(song, artist) {
      if (!overlay || !img || !text) return;
      overlay.style.display = 'flex';
      if (song && artist) {
        text.textContent = `${song} - ${artist}`;
        text.style.fontSize = '18px';
      } else if (song) {
        text.textContent = song;
        text.style.fontSize = '18px';
      } else if (artist) {
        text.textContent = artist;
        text.style.fontSize = '18px';
      } else {
        text.textContent = 'ATIVIDADE FM';
        text.style.fontSize = '24px';
      }
      refreshCover(song, artist);
    }

    /**
     * Faz uma consulta na API do Deezer via JSONP para buscar a capa do
     * álbum. Se não encontrar, mantém o logo padrão.
     */
    function refreshCover(song, artist) {
      if (!overlay || !img) return;
      if (!song && !artist) {
        img.src = DEFAULT_LOGO;
        return;
      }
      const query = ((artist || '') + ' ' + (song || '')).trim();
      if (!query) {
        img.src = DEFAULT_LOGO;
        return;
      }
      const callbackName = 'atividadeCoverCallback_' + Math.random().toString(36).substring(2) + '_' + Date.now();
      window[callbackName] = function(data) {
        try {
          let cover = '';
          if (data && data.data && data.data.length > 0) {
            const album = data.data[0].album || {};
            cover = album.cover_xl || album.cover_big || album.cover_medium || album.cover;
          }
          if (cover) {
            img.src = cover;
          } else {
            img.src = DEFAULT_LOGO;
          }
        } finally {
          cleanup();
        }
      };
      function cleanup() {
        try {
          delete window[callbackName];
        } catch (e) {
          window[callbackName] = undefined;
        }
        if (script && script.parentNode) {
          script.parentNode.removeChild(script);
        }
      }
      const script = document.createElement('script');
      script.src = 'https://api.deezer.com/search?q=' + encodeURIComponent(query) + '&output=jsonp&callback=' + callbackName;
      script.onerror = function() {
        img.src = DEFAULT_LOGO;
        cleanup();
      };
      document.body.appendChild(script);
      setTimeout(function() {
        if (window[callbackName]) {
          img.src = DEFAULT_LOGO;
          cleanup();
        }
      }, 5000);
    }

    // Inicia o processo
    waitForWrapper();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();