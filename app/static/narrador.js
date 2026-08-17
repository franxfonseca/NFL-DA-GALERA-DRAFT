// narrador.js - compartilhado entre home/board/resultado/comentarios.
//
// Toca o audio "bonito" gerado pela ElevenLabs quando ele existe; se nao
// existir (ainda nao gerado, falhou, sem creditos) cai pro speechSynthesis
// local do navegador automaticamente. Regra do projeto: nunca fica em
// silencio esperando rede.

let _vozLocalEscolhida = null;

function _pegarVozLocal() {
    if (_vozLocalEscolhida) return _vozLocalEscolhida;
    _vozLocalEscolhida = speechSynthesis.getVoices().find((v) => v.lang.startsWith("pt")) || null;
    return _vozLocalEscolhida;
}

function falarLocal(texto, aoTerminar) {
    try {
        const utter = new SpeechSynthesisUtterance(texto);
        utter.lang = "pt-BR";
        const voz = _pegarVozLocal();
        if (voz) utter.voice = voz;
        if (aoTerminar) {
            utter.onend = aoTerminar;
            utter.onerror = aoTerminar;
        }
        speechSynthesis.speak(utter);
    } catch (erro) {
        console.error("falha no TTS local:", erro);
        if (aoTerminar) aoTerminar();
    }
}

/**
 * Toca urlAudio (audio ElevenLabs pre-gerado). Se a URL nao existir ainda,
 * ou falhar ao carregar/tocar, cai pro TTS local com textoFallback.
 * Retorna o elemento <audio> criado (util pra poder pausar/cancelar depois).
 */
function narrar(urlAudio, textoFallback, aoTerminar) {
    if (!urlAudio) {
        falarLocal(textoFallback, aoTerminar);
        return null;
    }
    const audio = new Audio(urlAudio);
    audio.onended = () => {
        if (aoTerminar) aoTerminar();
    };
    audio.onerror = () => falarLocal(textoFallback, aoTerminar);
    audio.play().catch(() => falarLocal(textoFallback, aoTerminar));
    return audio;
}
