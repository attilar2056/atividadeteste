VERSÃO REFATORADA LEVE

Objetivo:
- manter a aparência geral do site
- reduzir travamentos de áudio em primeiro e segundo plano
- centralizar a lógica principal em um único arquivo: app_refatorado.js

Principais mudanças:
- removida a lógica antiga espalhada entre script.js + radio-metadata-widget.js + vu-meter.js
- versão nova usa apenas index.html + style.css + style_refatorado.css + app_refatorado.js
- metadados com SSE sem reconexão agressiva em focus/blur
- VU muito mais leve e independente do caminho real do áudio
- sem AudioContext/analyser rodando em paralelo ao player principal
- rotação de notícias e banners compartilhada por um único relógio simples
- clima e relógio com atualização reduzida
- troca de disco GIF/JPG centralizada
- troca Zeno / Voz do Brasil centralizada

Arquivo principal da versão nova:
- app_refatorado.js

Observação importante:
- nesta versão o VU foi priorizado para leveza e estabilidade do áudio
