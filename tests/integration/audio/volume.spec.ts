import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
    await page.addScriptTag({ path: "dist/kaplay.js" });
});

// Render a constant stereo signal, so each output sample is the applied gain.
// Suspend at render-quantum boundaries to change volume without wall-clock races.
const renderVolume = async ({
    initial = 1,
    changes = [],
    beforeLoad,
    beforePlay,
}: {
    initial?: number;
    changes?: { sample: number; values: number[] }[];
    beforeLoad?: number;
    beforePlay?: number;
}) => {
    const sampleRate = 48000;
    const ctx = new OfflineAudioContext(2, 4800, sampleRate);
    window.AudioContext = function() {
        return ctx;
    } as unknown as typeof AudioContext;
    const k = kaplay({ global: false });
    const buffer = ctx.createBuffer(2, 4800, sampleRate);
    buffer.getChannelData(0).fill(1);
    buffer.getChannelData(1).fill(1);
    const asset = k.loadSound(null, buffer);
    const sound = k.play(asset, {
        volume: initial,
        paused: beforePlay !== undefined,
    });
    if (beforeLoad !== undefined) sound.volume = beforeLoad;
    await new Promise(resolve => asset.onLoad(resolve));
    if (beforePlay !== undefined) {
        sound.volume = beforePlay;
        sound.paused = false;
    }
    const initialVolume = sound.volume;
    const getters: number[] = [];
    const updates = changes.map(({ sample, values }) =>
        ctx.suspend(sample / sampleRate).then(async () => {
            for (const value of values) {
                sound.volume = value;
                getters.push(sound.volume);
            }
            await ctx.resume();
        })
    );
    const rendered = await ctx.startRendering();
    await Promise.all(updates);
    return {
        samples: Array.from(rendered.getChannelData(0)),
        initialVolume,
        getters,
        volume: sound.volume,
    };
};

for (const initial of [0, 0.25, 1, 2]) {
    test(`initial volume ${initial} is applied without a fade`, async ({ page }) => {
        const result = await page.evaluate(renderVolume, { initial });
        expect(result.initialVolume).toBe(initial);
        expect(result.samples.every(sample => sample === initial)).toBe(true);
    });
}

test("volume changes are smooth at the sample rate, not stepped per frame", async ({ page }) => {
    const changes = [
        { sample: 768, values: [0.75] },
        { sample: 1536, values: [0.5] },
        { sample: 2304, values: [0.25] },
        { sample: 3072, values: [0] },
    ];
    const result = await page.evaluate(renderVolume, { changes });
    expect(result.getters).toEqual([0.75, 0.5, 0.25, 0]);
    expect(result.volume).toBe(0);
    let previous = 1;
    for (const { sample, values: [target] } of changes) {
        // The next frame must continue at the current gain instead of jumping
        // to its target. It then approaches that target between audio samples.
        expect(result.samples[sample]).toBeCloseTo(previous, 4);
        expect(result.samples[sample + 1]).toBeLessThan(result.samples[sample]);
        expect(result.samples[sample + 1]).toBeGreaterThan(target);
        previous = target + (previous - target) * Math.exp(-0.016 / 0.005);
    }
    const largestStep = Math.max(
        ...result.samples.slice(1).map(
            (sample, index) => Math.abs(sample - result.samples[index]),
        ),
    );
    expect(largestStep).toBeLessThan(0.002);
    expect(result.samples.at(-1)).toBeLessThan(0.001);
});

test("rapid retargets stay continuous and the last same-frame write wins", async ({ page }) => {
    const result = await page.evaluate(renderVolume, {
        changes: [
            { sample: 768, values: [0] },
            { sample: 896, values: [2, 0.5] },
            { sample: 1024, values: [-1] },
        ],
    });
    expect(result.getters).toEqual([0, 2, 0.5, 0]);
    expect(result.volume).toBe(0);
    const atRetarget = Math.exp(-128 / 48000 / 0.005);
    expect(result.samples[896]).toBeCloseTo(atRetarget, 4);
    const afterRetarget = 0.5 + (atRetarget - 0.5)
            * Math.exp(-128 / 48000 / 0.005);
    expect(result.samples[1024]).toBeCloseTo(afterRetarget, 4);
    expect(result.samples.at(-1)).toBeLessThan(0.001);
});

test("setting volume before loading or resuming does not leak the old volume", async ({ page }) => {
    const beforeLoad = await page.evaluate(renderVolume, { beforeLoad: 0 });
    expect(beforeLoad.volume).toBe(0);
    expect(beforeLoad.samples.every(sample => sample === 0)).toBe(true);
    const beforePlay = await page.evaluate(renderVolume, { beforePlay: 0 });
    expect(beforePlay.volume).toBe(0);
    expect(beforePlay.samples.every(sample => sample === 0)).toBe(true);
});
