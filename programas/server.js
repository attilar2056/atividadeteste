const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT || 30870);
const PROGRAMAS_DIR = __dirname;
const ROOT_DIR = path.resolve(__dirname, '..');
const JSON_PATH = path.join(PROGRAMAS_DIR, 'programacao.json');
const ADMIN_HTML_PATH = path.join(PROGRAMAS_DIR, 'admin-programacao.html');
const UPLOADS_DIR = path.join(ROOT_DIR, 'assets', 'uploads');

const DAY_ORDER = ['seg', 'ter', 'quar', 'qui', 'sex', 'sab', 'dom'];
const WEEKDAY_GROUP = ['seg', 'ter', 'quar', 'qui', 'sex'];
const WEEKEND_GROUP = ['sab', 'dom'];
const DAY_LABELS = {
  seg: 'Segunda-feira',
  ter: 'Terça-feira',
  quar: 'Quarta-feira',
  qui: 'Quinta-feira',
  sex: 'Sexta-feira',
  sab: 'Sábado',
  dom: 'Domingo'
};

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function sendText(res, statusCode, text, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(statusCode, {
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store'
  });
  res.end(text);
}

function safeJoin(baseDir, requestedPath) {
  const cleanPath = String(requestedPath || '/').replace(/\\/g, '/');
  const resolved = path.resolve(baseDir, '.' + cleanPath);
  if (!resolved.startsWith(baseDir)) return null;
  return resolved;
}

function readBody(req, maxBytes = 25 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;

    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error('Arquivo muito grande. Limite de 25 MB.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function slugifyFileName(name) {
  return String(name || 'imagem')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[_\.]+|[_\.]+$/g, '')
    .slice(0, 120) || 'imagem';
}

function getExtension(fileName, contentType) {
  const fromName = path.extname(fileName || '').toLowerCase();
  if (fromName) return fromName;
  if (contentType === 'image/png') return '.png';
  if (contentType === 'image/jpeg') return '.jpg';
  if (contentType === 'image/webp') return '.webp';
  if (contentType === 'image/gif') return '.gif';
  if (contentType === 'image/svg+xml') return '.svg';
  return '.bin';
}

function normalizeWeekday(day) {
  const safe = String(day || '').trim().toLowerCase();
  if (DAY_ORDER.includes(safe)) return safe;
  if (safe === 'qua') return 'quar';
  return '';
}

function normalizeWeekdays(input) {
  const source = Array.isArray(input) ? input : [input];
  const seen = new Set();
  const result = [];
  for (const value of source) {
    const day = normalizeWeekday(value);
    if (day && !seen.has(day)) {
      seen.add(day);
      result.push(day);
    }
  }
  return result;
}

function timeToMinutes(value) {
  const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return (hour * 60) + minute;
}

function minutesToTime(minutes) {
  const safe = Math.max(0, Math.min(1439, Number(minutes) || 0));
  const hour = Math.floor(safe / 60);
  const minute = safe % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function cloneSegment(segment) {
  return {
    day: segment.day,
    startMin: segment.startMin,
    endMin: segment.endMin,
    title: segment.title || '',
    host: segment.host || '',
    locutor: segment.locutor || '',
    image: segment.image || '',
    vinyl: segment.vinyl || '',
    photoX: Number.isFinite(Number(segment.photoX)) ? Number(segment.photoX) : 0,
    photoY: Number.isFinite(Number(segment.photoY)) ? Number(segment.photoY) : 0,
    photoZoom: Number.isFinite(Number(segment.photoZoom)) ? Number(segment.photoZoom) : 1,
    empty: !!segment.empty
  };
}

function makeEmptySegment(day, startMin, endMin) {
  return {
    day,
    startMin,
    endMin,
    title: '',
    host: '',
    locutor: '',
    image: '',
    vinyl: '',
    photoX: 0,
    photoY: 0,
    photoZoom: 1,
    empty: true
  };
}

function sameProgram(a, b) {
  if (!!a.empty !== !!b.empty) return false;
  if (a.day !== b.day) return false;
  if (a.empty && b.empty) return true;
  return String(a.title || '') === String(b.title || '')
    && String(a.locutor || '') === String(b.locutor || '')
    && String(a.host || '') === String(b.host || '')
    && String(a.image || '') === String(b.image || '')
    && String(a.vinyl || '') === String(b.vinyl || '')
    && Number(a.photoX || 0) === Number(b.photoX || 0)
    && Number(a.photoY || 0) === Number(b.photoY || 0)
    && Number(a.photoZoom || 1) === Number(b.photoZoom || 1);
}

function mergeSegments(segments) {
  const sorted = (Array.isArray(segments) ? segments : [])
    .map(cloneSegment)
    .filter((segment) => Number.isInteger(segment.startMin) && Number.isInteger(segment.endMin) && segment.endMin >= segment.startMin)
    .sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);

  const merged = [];
  for (const segment of sorted) {
    if (!merged.length) {
      merged.push(segment);
      continue;
    }
    const prev = merged[merged.length - 1];
    if (prev.endMin + 1 === segment.startMin && sameProgram(prev, segment)) {
      prev.endMin = segment.endMin;
      continue;
    }
    merged.push(segment);
  }
  return merged;
}

function applySegment(daySegments, newSegment) {
  const next = [];
  const safeNew = cloneSegment(newSegment);

  for (const existing of daySegments) {
    if (existing.endMin < safeNew.startMin || existing.startMin > safeNew.endMin) {
      next.push(cloneSegment(existing));
      continue;
    }

    if (existing.startMin < safeNew.startMin) {
      next.push({ ...cloneSegment(existing), endMin: safeNew.startMin - 1 });
    }
    if (existing.endMin > safeNew.endMin) {
      next.push({ ...cloneSegment(existing), startMin: safeNew.endMin + 1 });
    }
  }

  next.push(safeNew);
  return mergeSegments(next);
}

function sanitizeProgramFields(input) {
  const title = String(input && input.title || '').trim();
  const locutor = String(input && (input.locutor || input.host) || '').trim();
  const host = String(input && (input.host || input.locutor) || '').trim() || locutor;
  const image = String(input && input.image || '').trim();
  const vinyl = String(input && (input.vinyl || input.vinylImage) || '').trim();
  return {
    title,
    locutor,
    host,
    image,
    vinyl,
    photoX: Number.isFinite(Number(input && input.photoX)) ? Number(input.photoX) : 0,
    photoY: Number.isFinite(Number(input && input.photoY)) ? Number(input.photoY) : 0,
    photoZoom: Number.isFinite(Number(input && input.photoZoom)) ? Number(input.photoZoom) : 1,
    empty: !title && !locutor && !image && !vinyl
  };
}

function createSegmentId(segment) {
  return `${segment.day}_${segment.startMin}_${segment.endMin}`;
}

function readScheduleFile() {
  const raw = fs.readFileSync(JSON_PATH, 'utf8');
  const parsed = JSON.parse(raw);
  return {
    timezone: typeof parsed.timezone === 'string' && parsed.timezone.trim() ? parsed.timezone.trim() : 'America/Sao_Paulo',
    timeApiUrl: typeof parsed.timeApiUrl === 'string' ? parsed.timeApiUrl.trim() : '',
    programas: Array.isArray(parsed.programas) ? parsed.programas : []
  };
}

function buildDayMaps(schedule) {
  const maps = Object.fromEntries(DAY_ORDER.map((day) => [day, [makeEmptySegment(day, 0, 1439)]]));

  for (const item of schedule.programas) {
    const startMin = timeToMinutes(item.start);
    const endMin = timeToMinutes(item.end);
    const days = normalizeWeekdays(item.diaDaSemana || []);
    if (startMin === null || endMin === null || !days.length) continue;

    const data = sanitizeProgramFields(item);
    if (data.empty) continue;

    for (const day of days) {
      if (endMin >= startMin) {
        maps[day] = applySegment(maps[day], {
          day,
          startMin,
          endMin,
          ...data,
          empty: false
        });
      } else {
        maps[day] = applySegment(maps[day], {
          day,
          startMin,
          endMin: 1439,
          ...data,
          empty: false
        });

        const nextDay = DAY_ORDER[(DAY_ORDER.indexOf(day) + 1) % DAY_ORDER.length];
        maps[nextDay] = applySegment(maps[nextDay], {
          day: nextDay,
          startMin: 0,
          endMin,
          ...data,
          empty: false
        });
      }
    }
  }

  return maps;
}

function dayMapsToSchedule(dayMaps, originalMeta) {
  const programas = [];

  for (const day of DAY_ORDER) {
    for (const segment of dayMaps[day] || []) {
      if (segment.empty) continue;
      programas.push({
        id: `programa_${day}_${segment.startMin}_${segment.endMin}`,
        title: String(segment.title || '').trim(),
        host: String(segment.host || segment.locutor || '').trim(),
        locutor: String(segment.locutor || segment.host || '').trim(),
        start: minutesToTime(segment.startMin),
        end: minutesToTime(segment.endMin),
        image: String(segment.image || '').trim(),
        vinyl: String(segment.vinyl || '').trim(),
        diaDaSemana: [day],
        photoX: Number(segment.photoX || 0),
        photoY: Number(segment.photoY || 0),
        photoZoom: Number(segment.photoZoom || 1)
      });
    }
  }

  return {
    timezone: originalMeta.timezone || 'America/Sao_Paulo',
    timeApiUrl: originalMeta.timeApiUrl || '',
    programas
  };
}

function saveSchedule(schedule) {
  fs.writeFileSync(JSON_PATH, JSON.stringify(schedule, null, 2) + '\n', 'utf8');
  return schedule;
}

function buildAdminState(schedule) {
  const dayMaps = buildDayMaps(schedule);

  return {
    timezone: schedule.timezone,
    timeApiUrl: schedule.timeApiUrl,
    days: DAY_ORDER.map((day) => ({
      key: day,
      label: DAY_LABELS[day],
      items: (dayMaps[day] || []).map((segment) => ({
        id: createSegmentId(segment),
        day,
        start: minutesToTime(segment.startMin),
        end: minutesToTime(segment.endMin),
        startMin: segment.startMin,
        endMin: segment.endMin,
        title: segment.title || '',
        host: segment.host || '',
        locutor: segment.locutor || '',
        image: segment.image || '',
        vinyl: segment.vinyl || '',
        photoX: Number(segment.photoX || 0),
        photoY: Number(segment.photoY || 0),
        photoZoom: Number(segment.photoZoom || 1),
        empty: !!segment.empty
      }))
    }))
  };
}

function findBlockingEnd(daySegments, newStartMin, requestedEndMin, originalStartMin, originalEndMin) {
  const blocking = daySegments.find((segment) => {
    if (segment.empty) return false;
    const isOriginal = originalStartMin !== null
      && originalEndMin !== null
      && segment.startMin === originalStartMin
      && segment.endMin === originalEndMin;
    if (isOriginal) return false;
    return segment.startMin > newStartMin && segment.startMin <= requestedEndMin;
  });
  return blocking ? (blocking.startMin - 1) : requestedEndMin;
}

function findExistingUploadByName(fileName) {
  const safeInput = String(fileName || '').trim().replace(/\\/g, '/');
  const ext = path.extname(safeInput).toLowerCase();
  const baseName = path.basename(safeInput, ext);
  const safeBaseName = slugifyFileName(baseName);
  const safeFileName = `${safeBaseName}${ext}`;

  if (!safeBaseName || !ext) return '';
  if (!fs.existsSync(UPLOADS_DIR)) return '';

  const directPath = path.join(UPLOADS_DIR, safeFileName);
  if (fs.existsSync(directPath) && fs.statSync(directPath).isFile()) {
    return safeFileName;
  }

  const suffix = `_${safeBaseName}${ext}`.toLowerCase();
  const exactLower = safeFileName.toLowerCase();
  const entries = fs.readdirSync(UPLOADS_DIR).filter((entry) => {
    const entryLower = String(entry).toLowerCase();
    return entryLower === exactLower || entryLower.endsWith(suffix);
  });

  entries.sort((a, b) => b.localeCompare(a, undefined, { numeric: true, sensitivity: 'base' }));
  return entries[0] || '';
}

function detectExistingUploadReference(urlObj) {
  const candidates = [
    urlObj.searchParams.get('existingPath'),
    urlObj.searchParams.get('relativePath'),
    urlObj.searchParams.get('path'),
    urlObj.searchParams.get('image'),
    urlObj.searchParams.get('filename')
  ].filter(Boolean);

  for (const candidate of candidates) {
    const existing = findExistingUploadByName(candidate);
    if (existing) return existing;
  }
  return '';
}

function groupForDay(day) {
  if (WEEKDAY_GROUP.includes(day)) return WEEKDAY_GROUP;
  if (WEEKEND_GROUP.includes(day)) return WEEKEND_GROUP;
  return [day];
}

function segmentSignature(segment) {
  return JSON.stringify({
    startMin: Number(segment.startMin),
    endMin: Number(segment.endMin),
    title: String(segment.title || '').trim(),
    host: String(segment.host || '').trim(),
    locutor: String(segment.locutor || '').trim(),
    image: String(segment.image || '').trim(),
    vinyl: String(segment.vinyl || '').trim(),
    photoX: Number(segment.photoX || 0),
    photoY: Number(segment.photoY || 0),
    photoZoom: Number(segment.photoZoom || 1),
    empty: !!segment.empty
  });
}

function findDeleteSuggestionDays(payload) {
  const day = normalizeWeekday(payload.day);
  const startMin = timeToMinutes(payload.start);
  const endMin = timeToMinutes(payload.end);
  if (!day || startMin === null || endMin === null) return [];

  const schedule = readScheduleFile();
  const maps = buildDayMaps(schedule);
  const source = (maps[day] || []).find((segment) => !segment.empty && segment.startMin === startMin && segment.endMin === endMin);
  if (!source) return [];

  const signature = segmentSignature(source);
  return groupForDay(day)
    .filter((candidateDay) => candidateDay !== day)
    .filter((candidateDay) => (maps[candidateDay] || []).some((segment) => !segment.empty && segmentSignature(segment) === signature))
    .map((candidateDay) => ({ day: candidateDay, label: DAY_LABELS[candidateDay] }));
}

function findSaveSuggestionDays(payload) {
  const day = normalizeWeekday(payload.day);
  const startMin = timeToMinutes(payload.start);
  const endMin = timeToMinutes(payload.end);
  if (!day || startMin === null || endMin === null) return [];

  const fields = sanitizeProgramFields(payload);
  if (fields.empty || !fields.title) return [];

  const requestedDays = normalizeWeekdays(payload.days && payload.days.length ? payload.days : [day]);
  const alreadyTargeted = new Set(requestedDays.length ? requestedDays : [day]);
  const schedule = readScheduleFile();
  const maps = buildDayMaps(schedule);

  return groupForDay(day)
    .filter((candidateDay) => !alreadyTargeted.has(candidateDay))
    .filter((candidateDay) => {
      const coveringSegment = (maps[candidateDay] || []).find((segment) => (
        segment.startMin <= startMin
        && segment.endMin >= endMin
      ));

      if (!coveringSegment || !coveringSegment.empty) {
        return false;
      }

      return true;
    })
    .map((candidateDay) => ({ day: candidateDay, label: DAY_LABELS[candidateDay] }));
}

function validateSavePayload(payload) {
  const day = normalizeWeekday(payload.day);
  const originalStartMin = timeToMinutes(payload.originalStart);
  const originalEndMin = timeToMinutes(payload.originalEnd);
  const startMin = timeToMinutes(payload.start);
  const endMin = timeToMinutes(payload.end);
  const requestedDays = normalizeWeekdays(payload.days && payload.days.length ? payload.days : [day]);
  const targetDays = requestedDays.length ? requestedDays : (day ? [day] : []);

  if (!day) throw new Error('Dia da semana inválido.');
  if (!targetDays.length) throw new Error('Selecione pelo menos um dia da semana.');
  if (startMin === null || endMin === null) throw new Error('Horário inicial ou final inválido.');
  if (endMin < startMin) throw new Error('Neste painel, o horário final deve ser maior ou igual ao inicial no mesmo dia.');

  const fields = sanitizeProgramFields(payload);
  if (!fields.title) throw new Error('Informe o nome do programa.');

  return {
    day,
    days: targetDays,
    originalStartMin,
    originalEndMin,
    startMin,
    endMin,
    fields: { ...fields, empty: false }
  };
}

function handleSaveItemPayload(payload) {
  const parsed = validateSavePayload(payload);
  const current = readScheduleFile();
  const dayMaps = buildDayMaps(current);
  const targetDays = parsed.days && parsed.days.length ? parsed.days : [parsed.day];

  for (const targetDay of targetDays) {
    const currentDaySegments = dayMaps[targetDay].map(cloneSegment);
    const sameDayAsOriginal = targetDay === parsed.day;

    if (sameDayAsOriginal && parsed.originalStartMin !== null && parsed.originalEndMin !== null) {
      dayMaps[targetDay] = applySegment(dayMaps[targetDay], makeEmptySegment(targetDay, parsed.originalStartMin, parsed.originalEndMin));
    }

    const adjustedEndMin = findBlockingEnd(
      currentDaySegments,
      parsed.startMin,
      parsed.endMin,
      sameDayAsOriginal ? parsed.originalStartMin : null,
      sameDayAsOriginal ? parsed.originalEndMin : null
    );

    if (adjustedEndMin < parsed.startMin) {
      throw new Error(`Esse horário invade o próximo programa em ${DAY_LABELS[targetDay]}. Ajuste o horário final.`);
    }

    dayMaps[targetDay] = applySegment(dayMaps[targetDay], {
      day: targetDay,
      startMin: parsed.startMin,
      endMin: adjustedEndMin,
      ...parsed.fields,
      empty: false
    });
  }

  const saved = saveSchedule(dayMapsToSchedule(dayMaps, current));
  return buildAdminState(saved);
}

function handleDeleteItemPayload(payload) {
  const day = normalizeWeekday(payload.day);
  const startMin = timeToMinutes(payload.start);
  const endMin = timeToMinutes(payload.end);
  const requestedDays = normalizeWeekdays(payload.days && payload.days.length ? payload.days : [day]);
  const targetDays = requestedDays.length ? requestedDays : (day ? [day] : []);

  if (!day || startMin === null || endMin === null || !targetDays.length) {
    throw new Error('Dados inválidos para deletar o horário.');
  }

  const current = readScheduleFile();
  const dayMaps = buildDayMaps(current);
  for (const targetDay of targetDays) {
    dayMaps[targetDay] = applySegment(dayMaps[targetDay], makeEmptySegment(targetDay, startMin, endMin));
  }
  const saved = saveSchedule(dayMapsToSchedule(dayMaps, current));
  return buildAdminState(saved);
}

function serveFile(res, filePath) {
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      sendText(res, 404, 'Arquivo não encontrado.');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': stat.size,
      'Cache-Control': 'no-store'
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

async function handleUpload(req, res, urlObj) {
  try {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });

    const existingFileName = detectExistingUploadReference(urlObj);
    if (existingFileName) {
      sendJson(res, 200, {
        ok: true,
        reused: true,
        fileName: existingFileName,
        relativePath: `assets/uploads/${existingFileName}`
      });
      return;
    }

    const requestedName = urlObj.searchParams.get('filename') || 'imagem';
    const contentType = (req.headers['content-type'] || 'application/octet-stream').split(';')[0].trim();
    const ext = getExtension(requestedName, contentType);
    const baseName = slugifyFileName(path.basename(requestedName, path.extname(requestedName)));

    const sameNameExisting = findExistingUploadByName(`${baseName}${ext}`);
    if (sameNameExisting) {
      sendJson(res, 200, {
        ok: true,
        reused: true,
        fileName: sameNameExisting,
        relativePath: `assets/uploads/${sameNameExisting}`
      });
      return;
    }

    const body = await readBody(req);
    if (!body.length) {
      sendJson(res, 400, { ok: false, error: 'Nenhum arquivo foi enviado.' });
      return;
    }

    const finalName = `${Date.now()}_${baseName}${ext}`;
    const outputPath = path.join(UPLOADS_DIR, finalName);
    fs.writeFileSync(outputPath, body);

    sendJson(res, 200, {
      ok: true,
      reused: false,
      fileName: finalName,
      relativePath: `assets/uploads/${finalName}`
    });
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error.message || 'Falha ao enviar a imagem.' });
  }
}

async function handleJsonRoute(req, res, callback, maxBytes = 5 * 1024 * 1024) {
  try {
    const body = await readBody(req, maxBytes);
    const payload = body.length ? JSON.parse(body.toString('utf8')) : {};
    const result = callback(payload);
    sendJson(res, 200, { ok: true, data: result });
  } catch (error) {
    sendJson(res, 400, { ok: false, error: error.message || 'Requisição inválida.' });
  }
}

const server = http.createServer(async (req, res) => {
  const urlObj = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);
  const pathname = urlObj.pathname;

  if (req.method === 'GET' && (pathname === '/' || pathname === '/admin' || pathname === '/admin-programacao.html')) {
    serveFile(res, ADMIN_HTML_PATH);
    return;
  }

  if (req.method === 'GET' && pathname === '/api/admin/state') {
    try {
      sendJson(res, 200, { ok: true, data: buildAdminState(readScheduleFile()) });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: 'Não foi possível carregar a programação.' });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/admin/save-item') {
    await handleJsonRoute(req, res, handleSaveItemPayload);
    return;
  }

  if (req.method === 'POST' && pathname === '/api/admin/delete-item') {
    await handleJsonRoute(req, res, handleDeleteItemPayload);
    return;
  }

  if (req.method === 'POST' && pathname === '/api/admin/suggest-save-days') {
    await handleJsonRoute(req, res, findSaveSuggestionDays);
    return;
  }

  if (req.method === 'POST' && pathname === '/api/admin/suggest-delete-days') {
    await handleJsonRoute(req, res, findDeleteSuggestionDays);
    return;
  }

  if (req.method === 'POST' && pathname === '/api/upload') {
    await handleUpload(req, res, urlObj);
    return;
  }

  if (req.method === 'GET' && pathname === '/api/programacao') {
    try {
      sendJson(res, 200, readScheduleFile());
    } catch (error) {
      sendJson(res, 500, { ok: false, error: 'Não foi possível ler o programacao.json.' });
    }
    return;
  }

  if (req.method === 'GET' && pathname === '/programacao.json') {
    serveFile(res, JSON_PATH);
    return;
  }

  if (req.method === 'GET') {
    const mappedPath = safeJoin(ROOT_DIR, pathname);
    if (mappedPath) {
      serveFile(res, mappedPath);
      return;
    }
  }

  sendText(res, 404, 'Rota não encontrada.');
});

server.listen(PORT, HOST, () => {
  console.log(`Painel da programação disponível em http://${HOST}:${PORT}`);
  console.log(`JSON usado: ${JSON_PATH}`);
  console.log(`Uploads em: ${UPLOADS_DIR}`);
});
