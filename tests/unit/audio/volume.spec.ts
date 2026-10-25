import { expect, test } from "@playwright/test";
import { Asset } from "../../../src/assets/asset";
import { SoundData } from "../../../src/assets/sound";
import { play } from "../../../src/audio/play";
import type { AudioPlayOpt } from "../../../src/audio/play";
import type { Engine } from "../../../src/core/engine";
import { updateEngine } from "../../../src/shared";

function setup(opt: AudioPlayOpt = {}, loaded = true) {
    const targets: [number, number, number][] = [];
    const cancellations: number[] = [];
    const gain = {
        value: 1,
        setTargetAtTime(value: number, time: number, constant: number) {
            if (!Number.isFinite(Math.fround(value))) throw new TypeError();
            targets.push([value, time, constant]);
        },
        cancelScheduledValues(time: number) {
            cancellations.push(time);
        },
    };
    const ctx = {
        currentTime: 1,
        createBufferSource: () => ({
            playbackRate: { value: 1 },
            detune: { value: 0 },
            connect() {},
            start() {},
            stop() {},
        }),
        createGain: () => ({ gain, connect() {} }),
        createStereoPanner: () => ({ pan: { value: 0 }, connect() {} }),
    };
    updateEngine({ audio: { ctx } } as unknown as Engine);
    const data = new SoundData({ duration: 10 } as AudioBuffer);
    const source = loaded ? data : new Asset<SoundData>(new Promise(() => {}));
    const sound = play(source, opt);
    return { sound, ctx, gain, targets, cancellations };
}

test("playing volume uses audio-clock automation and returns its target immediately", () => {
    const { sound, ctx, gain, targets } = setup();
    ctx.currentTime = 2;
    sound.volume = 0.1;
    expect(targets).toEqual([[0.1, 2, 0.005]]);
    expect(gain.value).toBe(1);
    expect(sound.volume).toBe(Math.fround(0.1));
});

test("rapid and same-frame volume writes schedule the latest target", () => {
    const { sound, ctx, targets } = setup();
    sound.volume = 0;
    sound.volume = 2;
    ctx.currentTime += 0.001;
    sound.volume = 0.5;
    expect(targets).toEqual([
        [0, 1, 0.005],
        [2, 1, 0.005],
        [0.5, 1.001, 0.005],
    ]);
    expect(sound.volume).toBe(0.5);
});

test("volume clamps negative targets and keeps its value after an invalid write", () => {
    const { sound, targets } = setup();
    sound.volume = -1;
    expect(targets).toEqual([[0, 1, 0.005]]);
    expect(sound.volume).toBe(0);
    expect(() => sound.volume = NaN).toThrow(TypeError);
    expect(sound.volume).toBe(0);
});

test("initial volume is applied directly without scheduling a fade", () => {
    const { sound, gain, targets } = setup({ volume: 0.25 });
    expect(sound.volume).toBe(0.25);
    expect(gain.value).toBe(0.25);
    expect(targets).toEqual([]);
});

for (const loaded of [true, false]) {
    test(`volume is immediate for a ${loaded ? "paused" : "loading"} sound`, () => {
        const { sound, gain, targets, cancellations } = setup({
            paused: loaded,
        }, loaded);
        sound.volume = 0;
        expect(sound.volume).toBe(0);
        expect(gain.value).toBe(0);
        expect(targets).toEqual([]);
        expect(cancellations).toEqual([0]);
    });
}

test("changing volume while paused clears the previous fade before resuming", () => {
    const { sound, gain, targets, cancellations } = setup();
    sound.volume = 0;
    sound.paused = true;
    sound.volume = 0.25;
    sound.paused = false;
    expect(targets).toEqual([[0, 1, 0.005]]);
    expect(cancellations).toEqual([0]);
    expect(gain.value).toBe(0.25);
    expect(sound.volume).toBe(0.25);
});
