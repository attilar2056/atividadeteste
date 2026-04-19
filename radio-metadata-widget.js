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
        /**
         * Cache da programação carregada a partir de programas/programacao.json.
         * Se já estiver carregado, reaproveitamos para evitar múltiplos fetch.
         */
        programSchedule: null,
        /**
         * Promessa em andamento para carregar a programação. Evita
         * múltiplas requisições concorrentes quando vários updates
         * chamam _loadSchedule ao mesmo tempo.
         */
        scheduleFetchPromise: null,
        /**
         * Temporizador para atualizar o metadata. Quando um novo metadado chega,
         * o widget mostra um placeholder por alguns segundos antes de atualizar
         * para as informações da nova música. Este campo guarda o ID do
         * temporizador ativo para permitir cancelamento.
         */
        pendingTimer: null
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
      return this;
    }

    reset() {
      // Cancelar qualquer atualização pendente quando resetar.
      if (this.state.pendingTimer) {
        clearTimeout(this.state.pendingTimer);
        this.state.pendingTimer = null;
      }
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
      // Quando um novo metadado chega, cancelamos qualquer atualização agendada
      // anteriormente e mostramos um placeholder com o logotipo e o programa/locutor
      // por 12 segundos. Somente após esse período atualizamos para a nova música.
      if (this.state.pendingTimer) {
        clearTimeout(this.state.pendingTimer);
        this.state.pendingTimer = null;
      }
      // Exibir placeholder com logotipo e nome do programa. Aguarda
      // conclusão pois a leitura da programação pode envolver fetch.
      await this._showPlaceholder();
      const immediate = this.parseRawTitle(raw);
      // Iniciar a resolução do Deezer em paralelo.
      const resolvePromise = this.resolveTrackMetadata(raw).catch(() => immediate);
      return new Promise((resolve) => {
        this.state.pendingTimer = setTimeout(async () => {
          const resolved = await resolvePromise;
          this._render({
            song: resolved.song || immediate.song || raw,
            artist: resolved.artist || immediate.artist || '',
            cover: resolved.cover || this.options.defaultCover || '',
            rawTitle: raw
          });
          this.state.pendingTimer = null;
          resolve(resolved);
        }, 12000);
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

      const finalizeResolved = async (chosenBase, bestInfo, segmentArtistInfo) => {
        let resolvedArtist = cleanupMetadataChunk(chosenBase.artist);
        let resolvedSong = cleanupMetadataChunk(chosenBase.song);
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

        if (!resolvedCover) {
          const fallbackCoverQuery = cleanTitleForSearch(resolvedArtist, resolvedSong) || cleanTitleForSearch(chosenBase.artist, chosenBase.song);
          if (fallbackCoverQuery) {
            const fallbackResults = await searchDeezerDetailed(fallbackCoverQuery, this.options.deezer.limit, this.options.deezer.timeoutMs);
            if (fallbackResults && fallbackResults.length) {
              const coverOnlyBest = fallbackResults.reduce(function (acc, item) {
                const score = scoreResultForInterpretation(item, resolvedArtist, resolvedSong);
                return (!acc || score.total > acc.total) ? score : acc;
              }, null);
              if (coverOnlyBest && coverOnlyBest.cover) {
                resolvedCover = coverOnlyBest.cover;
              }
            }
          }
        }

        if (!resolvedCover && resolvedArtist) {
          const artistOnlyResults = await searchDeezerDetailed(resolvedArtist, 5, this.options.deezer.timeoutMs);
          if (artistOnlyResults && artistOnlyResults.length) {
            let bestArtistOnly = null;
            artistOnlyResults.forEach(function (item) {
              const artistName = item && item.artist ? item.artist.name : '';
              const artistScore = similarityScore(resolvedArtist, artistName);
              if (!bestArtistOnly || artistScore > bestArtistOnly.artistScore) {
                bestArtistOnly = { artistScore: artistScore, cover: getCoverFromResult(item) };
              }
            });
            if (bestArtistOnly && bestArtistOnly.artistScore >= 0.78 && bestArtistOnly.cover) {
              resolvedCover = bestArtistOnly.cover;
            }
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

      return finalizeResolved(chosen, best, chosenArtistInfo);
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

    /*
     * Este espaço era ocupado por uma documentação antiga do método de
     * placeholder. Foi mantido um comentário simples para preservar a
     * estrutura do arquivo. A documentação atualizada encontra-se
     * imediatamente acima do método _showPlaceholder().
     */
    /**
     * Exibe temporariamente o logotipo da rádio e o nome do programa atual.
     * Em vez de ler elementos de grade na página, determina o programa
     * atual com base na programação definida em programas/programacao.json.
     * Caso não seja possível determinar o programa, usa o nome da estação
     * ou o texto fallback configurado. Este método é assíncrono pois
     * pode realizar um fetch da programação.
     */
    async _showPlaceholder() {
      let title = '';
      try {
        const current = await this._getCurrentProgram();
        if (current && current.title) {
          title = String(current.title || '').trim();
        }
      } catch (_error) {
        // Se houver erro ao carregar a programação, cairemos para o nome padrão
      }
      if (!title) {
        // Se não conseguir determinar o programa atual, usa o nome da estação ou fallback.
        title = this.options.stationName || this.options.textFallback || 'Ao vivo';
      }
      // Renderizar placeholder com a capa padrão. O nome do programa vai na
      // posição de "song" e não exibimos artista neste modo.
      this._render({
        song: title,
        artist: '',
        cover: this.options.defaultCover || '',
        rawTitle: ''
      });
    }

    /**
     * Converte uma string HH:MM para o número de minutos desde 00:00. Se o
     * formato for inválido, retorna null.
     * @param {string} hhmm
     * @returns {number|null}
     */
    _timeToMinutes(hhmm) {
      const m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})$/);
      if (!m) return null;
      return Number(m[1]) * 60 + Number(m[2]);
    }

    /**
     * Carrega e retorna a programação a partir de um arquivo JSON. Por padrão
     * usa 'programas/programacao.json', mas pode ser sobrescrito via
     * options.programsSrc. Implementa cache simples para evitar múltiplos
     * downloads e suporta chamadas concorrentes.
     * @returns {Promise<Array<{title: string, host: string, start: string, end: string, dias: string[]}>>}
     */
    _loadSchedule() {
      // Se já carregado, retorna imediatamente.
      if (this.state.programSchedule) {
        return Promise.resolve(this.state.programSchedule);
      }
      // Se uma requisição já estiver em andamento, reutiliza a promessa.
      if (this.state.scheduleFetchPromise) {
        return this.state.scheduleFetchPromise;
      }
      const src = this.options.programsSrc || 'programas/programacao.json';
      const url = src;
      this.state.scheduleFetchPromise = fetch(url)
        .then((res) => {
          if (!res.ok) {
            throw new Error('Falha ao carregar programação');
          }
          return res.json();
        })
        .then((data) => {
          const programas = Array.isArray(data.programas) ? data.programas : [];
          const normalized = programas.map((item) => ({
            title: String(item.title || item.programa || '').trim(),
            host: String(item.host || item.locutor || '').trim(),
            start: String(item.start || item.inicio || '').trim(),
            end: String(item.end || item.fim || '').trim(),
            dias: Array.isArray(item.diaDaSemana) ? item.diaDaSemana.map((d) => String(d).toLowerCase()) : []
          }));
          this.state.programSchedule = normalized;
          return normalized;
        })
        .catch((err) => {
          // Em caso de erro, limpamos o cache para permitir novas tentativas futuramente.
          this.state.programSchedule = null;
          throw err;
        })
        .finally(() => {
          // Limpa a promessa em andamento, permitindo novas requisições.
          this.state.scheduleFetchPromise = null;
        });
      return this.state.scheduleFetchPromise;
    }

    /**
     * Determina o programa atual com base na programação e no horário local.
     * Se nenhum programa coincidir, retorna null. O horário é calculado com
     * base no relógio do navegador.
     * @returns {Promise<{title: string, host: string}|null>}
     */
    async _getCurrentProgram() {
      const schedule = await this._loadSchedule().catch(() => null);
      if (!schedule || !Array.isArray(schedule) || schedule.length === 0) return null;
      const weekdayMap = ['dom', 'seg', 'ter', 'quar', 'qui', 'sex', 'sab'];
      const now = new Date();
      const weekday = weekdayMap[now.getDay()];
      const minutes = now.getHours() * 60 + now.getMinutes();
      let current = null;
      schedule.forEach((item) => {
        if (!item || !item.start || !item.end) return;
        const dias = Array.isArray(item.dias) ? item.dias : [];
        if (dias.indexOf(weekday) === -1) return;
        const startMinutes = this._timeToMinutes(item.start);
        let endMinutes = this._timeToMinutes(item.end);
        if (startMinutes === null || endMinutes === null) return;
        // Programas que atravessam a meia-noite
        if (endMinutes <= startMinutes) {
          endMinutes += 24 * 60;
        }
        let currentMinutes = minutes;
        if (currentMinutes < startMinutes) {
          currentMinutes += 24 * 60;
        }
        if (currentMinutes >= startMinutes && currentMinutes < endMinutes) {
          current = { title: item.title || '', host: item.host || '' };
        }
      });
      return current;
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

  global.UniversalRadioMetadata = UniversalRadioMetadata;
})(window);
