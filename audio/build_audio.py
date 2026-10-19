#!/usr/bin/env python3
"""Builds the soundtrack: narration (neural TTS) + synthesized ambient score and sound design.

Outputs (in --out):
  audio.wav / audio.m4a   480 s stereo mix
  timings.json            real narration durations per line (used for subtitle timing)

Narration engine: edge-tts (neural voices, needs internet - available on GitHub runners),
falling back to espeak-ng, or 'silent' (music only) for testing.
"""
import argparse, asyncio, json, os, shutil, subprocess, sys, wave
import numpy as np
from scipy import signal

SR = 48000


def run(cmd):
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def probe_duration(path):
    out = subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path])
    return float(out.decode().strip())


def load_wav_mono(path):
    run(['ffmpeg', '-y', '-i', path, '-ac', '1', '-ar', str(SR), '-f', 'wav', path + '.mono.wav'])
    with wave.open(path + '.mono.wav') as w:
        data = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0
    os.remove(path + '.mono.wav')
    return data


# ------------------------------------------------------------------ narration
async def edge_tts_all(lines, voice, rate, outdir):
    import edge_tts
    for ln in lines:
        path = os.path.join(outdir, ln['id'] + '.mp3')
        for attempt in range(4):
            try:
                await edge_tts.Communicate(ln['text'], voice, rate=rate).save(path)
                break
            except Exception as e:  # network hiccup: retry
                print('edge-tts retry', ln['id'], e, file=sys.stderr)
                await asyncio.sleep(2 + attempt * 2)
        else:
            raise RuntimeError('edge-tts failed for ' + ln['id'])


def espeak_all(lines, outdir):
    exe = shutil.which('espeak-ng') or shutil.which('espeak')
    if not exe:
        raise RuntimeError('espeak-ng not installed')
    for ln in lines:
        path = os.path.join(outdir, ln['id'] + '.wav')
        subprocess.run([exe, '-v', 'en-gb', '-s', '148', '-p', '38', '-w', path, ln['text']], check=True)


def build_narration(script, engine, voice, rate, workdir):
    lines = script['narration']
    os.makedirs(workdir, exist_ok=True)
    if engine == 'auto':
        try:
            asyncio.run(edge_tts_all(lines, voice, rate, workdir)); engine = 'edge'
        except Exception as e:
            print('edge-tts unavailable (%s) -> falling back to espeak-ng' % e, file=sys.stderr)
            espeak_all(lines, workdir); engine = 'espeak'
    elif engine == 'edge':
        asyncio.run(edge_tts_all(lines, voice, rate, workdir))
    elif engine == 'espeak':
        espeak_all(lines, workdir)
    clips, timings = {}, {}
    if engine == 'silent':
        return clips, timings, engine
    ext = 'mp3' if engine == 'edge' else 'wav'
    for i, ln in enumerate(lines):
        path = os.path.join(workdir, ln['id'] + '.' + ext)
        dur = probe_duration(path)
        nxt = lines[i + 1]['t'] if i + 1 < len(lines) else script['duration'] - 1
        slot = nxt - ln['t'] - 0.25
        if dur > slot:  # speed up to fit the slot (max 1.3x)
            f = min(1.3, dur / slot)
            fast = path + '.fast.wav'
            run(['ffmpeg', '-y', '-i', path, '-filter:a', 'atempo=%.4f' % f, fast])
            path, dur = fast, probe_duration(fast)
            print('  %s sped up x%.2f to fit %.1fs slot' % (ln['id'], f, slot))
            if dur > slot + 0.2:
                print('  WARNING: %s still %.1fs > slot %.1fs' % (ln['id'], dur, slot), file=sys.stderr)
        clips[ln['id']] = (ln['t'], load_wav_mono(path))
        timings[ln['id']] = round(dur, 3)
    return clips, timings, engine


# ------------------------------------------------------------------ synthesis helpers
def tt(n):
    return np.arange(n, dtype=np.float64) / SR


def lowpass(x, fc, order=2):
    sos = signal.butter(order, fc, btype='low', fs=SR, output='sos')
    return signal.sosfilt(sos, x)


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def note(n):  # MIDI -> Hz
    return 440.0 * 2 ** ((n - 69) / 12)


def interp_curve(keys, t):
    ks = np.array([k[0] for k in keys]); vs = np.array([k[1] for k in keys])
    return np.interp(t, ks, vs)


def boom(freq0=70, freq1=28, dur=5.0, noise=0.35, seed=0):
    n = int(dur * SR); t = tt(n)
    f = freq1 + (freq0 - freq1) * np.exp(-t * 3.2)
    ph = 2 * np.pi * np.cumsum(f) / SR
    body = np.sin(ph) * np.exp(-t * 0.9)
    rng = np.random.default_rng(seed)
    nz = lowpass(rng.standard_normal(n), 400) * np.exp(-t * 2.2) * noise * 6
    return (body + nz) * 0.9


def riser(dur, f0=80, f1=900, seed=1):
    n = int(dur * SR); t = tt(n); rng = np.random.default_rng(seed)
    nz = rng.standard_normal(n)
    sweep = np.linspace(f0, f1, n)
    b = signal.sosfilt(signal.butter(2, [200, 3200], btype='band', fs=SR, output='sos'), nz)
    env = (t / dur) ** 2.2
    tone = np.sin(2 * np.pi * np.cumsum(sweep) / SR) * 0.35
    return (b * 0.5 + tone) * env * 0.5


def pad(total, intensity_keys):
    n = int(total * SR); out = np.zeros(n)
    # slow progression in D minor: Dm, Bb, Gm, A(sus)   (MIDI note sets)
    chords = [[38, 45, 50, 53, 57], [34, 41, 46, 50, 53], [43, 50, 55, 58, 62], [45, 52, 57, 59, 64]]
    seg = 16.0; nseg = int(np.ceil(total / seg)) + 1
    for i in range(nseg):
        t0 = i * seg - 4.0; t1 = t0 + seg + 8.0
        a, b = max(int(t0 * SR), 0), min(int(t1 * SR), n)
        if b <= a:
            continue
        t = (np.arange(a, b) / SR)
        env = smoothstep(t0, t0 + 6.0, t) * (1 - smoothstep(t1 - 6.0, t1, t))
        seg_sig = np.zeros(b - a)
        for k, m in enumerate(chords[i % 4]):
            f = note(m)
            for det in (-0.12, 0.0, 0.12):
                ff = f * 2 ** (det / 12)
                ph = 2 * np.pi * ff * t + k
                for h, amp in ((1, 1.0), (2, 0.45), (3, 0.22), (4, 0.10)):
                    seg_sig += amp * np.sin(h * ph) / (1 + 0.15 * k)
        out[a:b] += seg_sig * env * (0.5 + 0.5 * np.sin(2 * np.pi * t / 23.0 + i))
    out = lowpass(out, 1400)
    tg = tt(n)
    out *= interp_curve(intensity_keys, tg)
    return out / (np.max(np.abs(out)) + 1e-9)


def reverb(x, seconds=3.2, wet=0.35, seed=3):
    rng = np.random.default_rng(seed)
    n = int(seconds * SR); t = tt(n)
    ir = rng.standard_normal(n) * np.exp(-t * 2.4)
    ir = lowpass(ir, 5000)
    ir /= np.sqrt(np.sum(ir ** 2))
    w = signal.fftconvolve(x, ir, mode='full')[:len(x)]
    return x * (1 - wet) + w * wet * 1.8


def mix_into(buf, sig, t0, gain=1.0, pan=0.0):
    a = int(t0 * SR)
    if a >= buf.shape[1]:
        return
    b = min(a + len(sig), buf.shape[1]); sig = sig[:b - a] * gain
    l = np.cos((pan + 1) * np.pi / 4); r = np.sin((pan + 1) * np.pi / 4)
    buf[0, a:b] += sig * l; buf[1, a:b] += sig * r


# ------------------------------------------------------------------ main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--script', default='public/data/script.json')
    ap.add_argument('--out', default='build/audio')
    ap.add_argument('--engine', default='auto', choices=['auto', 'edge', 'espeak', 'silent'])
    ap.add_argument('--voice', default='en-GB-RyanNeural')
    ap.add_argument('--rate', default='-4%')
    args = ap.parse_args()
    script = json.load(open(args.script))
    total = float(script['duration'])
    os.makedirs(args.out, exist_ok=True)
    work = os.path.join(args.out, 'tts')

    print('1/4 narration ...')
    clips, timings, engine = build_narration(script, args.engine, args.voice, args.rate, work)
    print('    engine:', engine, ' lines:', len(clips))

    print('2/4 score ...')
    n = int(total * SR)
    intensity = [(0, .30), (4, .45), (18, .55), (45, .85), (51, 1.0), (56, .45), (78, .40), (93, .42), (128, .50), (140, .55),
                 (163, .75), (172, .9), (178, .8), (198, .42), (250, .70), (299, .95), (322, .8), (328, .6), (382, .55), (408, .85),
                 (436, .55), (466, .75), (478, .3), (480, 0.0)]
    music = np.zeros((2, n))
    p = pad(total, intensity)
    music[0] += p * 0.34; music[1] += np.roll(p, 700) * 0.34  # slight stereo decorrelation
    # sub drone
    t = tt(n)
    drone = np.sin(2 * np.pi * 36.7 * t) * (0.5 + 0.5 * np.sin(2 * np.pi * t / 31)) * interp_curve(intensity, t) * 0.16
    music[0] += drone; music[1] += drone

    print('3/4 sound design ...')
    fx = np.zeros((2, n))
    # chirp of the black-hole inspiral (matches visuals 18-51 s)
    t0, tm = 18.0, 51.0
    m = int((tm - 30.0) * SR); tc = 30.0 + tt(m)
    tau = np.clip((tc - t0) / (tm - t0), 0, 0.9995)
    f = np.minimum(55 * (1 - tau) ** (-3 / 8), 700)
    amp = (smoothstep(30, 51, tc)) ** 1.8 * 0.35
    chirp = np.sin(2 * np.pi * np.cumsum(f) / SR) * amp
    mix_into(fx, chirp, 30.0, 0.55)
    mix_into(fx, boom(90, 32, 6.0, 0.5, 1), 51.0, 0.9)             # merger
    mix_into(fx, riser(8.0, 80, 700, 2), 43.0, 0.6)
    mix_into(fx, boom(60, 26, 5.0, 0.3, 4), 83.0, 0.35)            # wormhole appears
    mix_into(fx, riser(5.0, 100, 1200, 5), 158.0, 0.45)            # traversable != stable
    mix_into(fx, boom(80, 30, 5.0, 0.5, 6), 171.7, 0.85)           # throat collapse
    mix_into(fx, boom(55, 24, 6.0, 0.35, 7), 276.5, 0.55)          # flyby
    mix_into(fx, riser(14.0, 60, 900, 8), 286.0, 0.6)              # plunge
    mix_into(fx, boom(95, 28, 7.0, 0.55, 9), 299.7, 1.0)           # horizon forms
    mix_into(fx, boom(45, 22, 8.0, 0.2, 10), 322.5, 0.8)           # "It shrank."
    for i, tb in enumerate((392.0, 395.0, 412.0, 416.0, 421.0)):   # gravitational-wave bursts
        k = int(1.6 * SR); tk = tt(k)
        pulse = np.sin(2 * np.pi * (140 - 60 * tk) * tk) * np.exp(-tk * 5.5)
        mix_into(fx, pulse, tb, 0.55, pan=(-0.4 if i % 2 else 0.4))
    mix_into(fx, riser(6.0, 70, 500, 11), 460.0, 0.35)
    mix_into(fx, boom(70, 26, 8.0, 0.2, 12), 469.0, 0.5)

    bus = music + fx * 0.9
    for c in (0, 1):
        bus[c] = reverb(bus[c], wet=0.28, seed=3 + c)

    # narration bus + ducking
    print('4/4 mix ...')
    narr = np.zeros((2, n))
    for _id, (t_start, data) in clips.items():
        mix_into(narr, data, t_start, 1.0)
    env = np.abs(narr[0])
    env = lowpass(env, 3.0, order=1)
    env = np.clip(env / (np.percentile(env, 99) + 1e-9), 0, 1)
    duck = 1.0 - 0.55 * env
    out = bus * duck[None, :] * 0.8 + narr * 1.0
    # fade in/out and soft-limit
    out *= (smoothstep(0, 2.0, t) * (1 - smoothstep(total - 2.0, total, t)))[None, :]
    peak = np.max(np.abs(out)) + 1e-9
    out = np.tanh(out / peak * 1.25) / np.tanh(1.25) * 0.89

    wav_path = os.path.join(args.out, 'audio.wav')
    pcm = (np.clip(out.T, -1, 1) * 32767).astype(np.int16)
    with wave.open(wav_path, 'wb') as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
    run(['ffmpeg', '-y', '-i', wav_path, '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-c:a', 'aac', '-b:a', '256k', os.path.join(args.out, 'audio.m4a')])
    json.dump(timings, open(os.path.join(args.out, 'timings.json'), 'w'), indent=1)
    print('done ->', args.out, ' duration %.1fs' % (n / SR))


if __name__ == '__main__':
    main()
