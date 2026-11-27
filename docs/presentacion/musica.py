# Música de fondo para los videos: un tema instrumental tranquilo, de estilo institucional, armado
# nota por nota con numpy (sin samples ni derechos de terceros). Siempre sale igual.
# Uso:  python docs/presentacion/musica.py <salida.wav> [segundos]
import sys
import wave

import numpy as np

SR = 44100
BPM = 100
BEAT = 60 / BPM
BAR = 4 * BEAT
rng = np.random.default_rng(7)


def hz(midi):
    return 440.0 * 2 ** ((midi - 69) / 12)


def piano(f, dur, vel=1.0, brillo=1.0):
    """Piano suave: parciales levemente inarmónicos que se apagan más rápido cuanto más agudos."""
    t = np.arange(int((dur + 1.2) * SR)) / SR
    out = np.zeros_like(t)
    for k in range(1, 9):
        fk = k * f * np.sqrt(1 + 0.0004 * k * k)
        if fk > 12000:
            break
        amp = (1 / k ** 1.35) * (brillo if k > 2 else 1)
        out += amp * np.exp(-t * (1.2 + 0.9 * k)) * np.sin(2 * np.pi * fk * t + rng.uniform(0, 6.28))
    ataque = 1 - np.exp(-t / 0.004)
    suelta = np.where(t > dur, np.exp(-(t - dur) / 0.25), 1.0)
    return (vel * out * ataque * suelta).astype(np.float32)


def ep(f, dur, vel=1.0):
    """Piano eléctrico (FM): cálido, para los arpegios."""
    t = np.arange(int((dur + 0.8) * SR)) / SR
    indice = 1.6 * np.exp(-t * 6) + 0.25
    s = np.sin(2 * np.pi * f * t + indice * np.sin(2 * np.pi * f * t))
    env = (1 - np.exp(-t / 0.003)) * np.exp(-t * 3.2)
    return (vel * s * env).astype(np.float32)


def pad(fs, dur):
    """Colchón de cuerdas: varias voces apenas desafinadas, entrada y salida lentas."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    out = np.zeros(n)
    for f in fs:
        for desaf in (-0.12, 0.0, 0.13):
            ff = f * 2 ** (desaf / 12)
            for k in range(1, 9):
                if k * ff > 6000:
                    break
                out += (1 / k ** 1.8) * np.sin(2 * np.pi * k * ff * t + rng.uniform(0, 6.28))
    env = np.minimum(1, t / 0.9) * np.minimum(1, (dur - t) / 0.9)
    return (out * np.clip(env, 0, 1) / (len(fs) * 3)).astype(np.float32)


def bajo(f, dur):
    t = np.arange(int((dur + 0.2) * SR)) / SR
    s = np.sin(2 * np.pi * f * t) + 0.35 * np.sin(4 * np.pi * f * t) + 0.12 * np.sin(6 * np.pi * f * t)
    env = (1 - np.exp(-t / 0.006)) * np.exp(-t * 1.6) * np.where(t > dur, np.exp(-(t - dur) / 0.05), 1)
    return (s * env).astype(np.float32)


def bombo():
    t = np.arange(int(0.45 * SR)) / SR
    f = 45 + 75 * np.exp(-t * 28)
    fase = 2 * np.pi * np.cumsum(f) / SR
    return (np.sin(fase) * np.exp(-t * 9) * (1 - np.exp(-t / 0.001))).astype(np.float32)


def ruido(dur, caida, agudo=True):
    t = np.arange(int(dur * SR)) / SR
    r = rng.standard_normal(len(t))
    if agudo:
        r = np.diff(np.diff(r, prepend=0), prepend=0)  # se queda con el brillo
    return (r * np.exp(-t * caida) / (4 if agudo else 1)).astype(np.float32)


# Acordes (midi): Do, Sol, La menor, Fa. Una vuelta = 4 compases.
ACORDES = [(48, [60, 64, 67]), (43, [59, 62, 67]), (45, [60, 64, 69]), (41, [60, 65, 69])]
MELODIA = [  # (tiempo en negras dentro de la vuelta, nota, duración en negras)
    (0, 76, 1.5), (1.5, 74, 0.5), (2, 72, 1), (3, 67, 1),
    (4, 74, 1.5), (5.5, 71, 0.5), (6, 67, 1), (7, 74, 1),
    (8, 72, 1.5), (9.5, 76, 0.5), (10, 81, 1), (11, 79, 1),
    (12, 77, 1.5), (13.5, 76, 0.5), (14, 72, 2),
]
MELODIA_B = MELODIA[:12] + [(12, 77, 1), (13, 79, 1), (14, 76, 1), (15, 74, 1)]


def armar(segundos):
    n = int((segundos + 3) * SR)
    seco = {nombre: np.zeros((2, n), np.float32) for nombre in ('arpegio', 'pad', 'bajo', 'ritmo', 'melodia')}

    def poner(bus, x, t0, paneo=0.0, vol=1.0):
        i = int(t0 * SR)
        if i >= n:
            return
        if i < 0:
            x, i = x[-i:], 0
        x = x[: n - i]
        izq, der = np.cos((paneo + 1) * np.pi / 4), np.sin((paneo + 1) * np.pi / 4)
        seco[bus][0, i : i + len(x)] += vol * izq * x
        seco[bus][1, i : i + len(x)] += vol * der * x

    vueltas = int(np.ceil(segundos / (4 * BAR))) + 1
    for v in range(vueltas):
        # Forma: intro (2 vueltas), entra el ritmo, entra la melodía; cada 6 vueltas, un respiro sin batería.
        respiro = v >= 2 and v % 6 == 5
        con_ritmo = v >= 2 and not respiro
        con_melodia = v >= 4 and v % 6 in (0, 1, 3, 4) and not respiro
        for c, (raiz, notas) in enumerate(ACORDES):
            t0 = (v * 4 + c) * BAR
            poner('pad', pad([hz(x) for x in notas] + [hz(notas[0] - 12)], BAR + 0.9), t0 - 0.2, vol=0.9)
            # Arpegio en corcheas, subiendo y bajando por el acorde.
            figura = [notas[0], notas[1], notas[2], notas[0] + 12, notas[2], notas[1] + 12, notas[2], notas[1]]
            for j, m in enumerate(figura):
                acento = 1.0 if j % 2 == 0 else 0.72
                poner('arpegio', ep(hz(m), BEAT * 0.45), t0 + j * BEAT / 2, paneo=(-0.35 if j % 2 else 0.35), vol=0.5 * acento)
            if con_ritmo or respiro:
                for b in range(4):
                    poner('bajo', bajo(hz(raiz), BEAT * 0.9), t0 + b * BEAT, vol=0.75 if b % 2 == 0 else 0.5)
            if con_ritmo:
                for b in (0, 2):
                    poner('ritmo', bombo(), t0 + b * BEAT, vol=0.9)
                poner('ritmo', bombo(), t0 + 3.5 * BEAT, vol=0.45)
                for b in (1, 3):
                    poner('ritmo', ruido(0.25, 22), t0 + b * BEAT, paneo=0.1, vol=0.55)
                for s in range(16):
                    poner('ritmo', ruido(0.06, 70), t0 + s * BEAT / 4, paneo=0.4, vol=0.22 if s % 2 else 0.32)
        if con_melodia:
            for tb, m, d in MELODIA if v % 2 == 0 else MELODIA_B:
                poner('melodia', piano(hz(m), d * BEAT * 0.95, brillo=0.8), v * 4 * BAR + tb * BEAT, paneo=-0.1, vol=0.55)
        if respiro:
            for tb, m, d in MELODIA:
                poner('melodia', piano(hz(m - 12), d * BEAT, brillo=0.6), v * 4 * BAR + tb * BEAT, paneo=0.15, vol=0.4)

    # Sala: reverberación por convolución (ruido que se apaga), más en el colchón y la melodía.
    largo = int(2.2 * SR)
    t = np.arange(largo) / SR
    sala = np.stack([rng.standard_normal(largo) * np.exp(-t * 3.1) for _ in range(2)]).astype(np.float32)
    sala[:, : int(0.012 * SR)] = 0
    sala /= np.sqrt((sala ** 2).sum(axis=1, keepdims=True))

    def reverb(x):
        y = np.zeros_like(x)
        nfft = 1 << 19
        paso = nfft - largo
        for ch in range(2):
            H = np.fft.rfft(sala[ch], nfft)
            for i in range(0, x.shape[1], paso):
                bloque = x[ch, i : i + paso]
                r = np.fft.irfft(np.fft.rfft(bloque, nfft) * H, nfft)[: len(bloque) + largo - 1]
                fin = min(x.shape[1], i + len(r))
                y[ch, i:fin] += r[: fin - i].astype(np.float32)
        return y

    envio = 0.35 * seco['pad'] + 0.25 * seco['arpegio'] + 0.4 * seco['melodia'] + 0.05 * seco['ritmo']
    mezcla = 0.8 * seco['pad'] + 0.9 * seco['arpegio'] + seco['bajo'] + 0.7 * seco['ritmo'] + seco['melodia'] + 0.45 * reverb(envio)
    mezcla = mezcla[:, : int(segundos * SR)]
    mezcla = np.tanh(mezcla / np.abs(mezcla).max() * 1.2) / np.tanh(1.2) * 0.89
    return mezcla


def guardar(ruta, x):
    pcm = (np.clip(x, -1, 1) * 32767).astype('<i2').T.copy()
    with wave.open(ruta, 'wb') as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


if __name__ == '__main__':
    salida = sys.argv[1]
    segundos = float(sys.argv[2]) if len(sys.argv) > 2 else 420
    guardar(salida, armar(segundos))
    print(f'{salida}: {segundos:.0f} s')
