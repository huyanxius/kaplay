import { expect, test } from "@playwright/test";

test("a grounded rider stays in place when its platform is reparented", async ({ page }) => {
    await page.addScriptTag({ path: "dist/kaplay.js" });

    const result = await page.evaluate(() => {
        const k = kaplay({ global: false });
        k.setGravity(1600);
        const carrier = k.add([k.pos(100, 200), k.scale(2)]);
        const platform = k.add([
            k.pos(100, 200),
            k.rect(200, 20),
            k.area(),
            k.body({ isStatic: true }),
        ]);
        const rider = k.add([
            k.pos(130, 100),
            k.rect(32, 32),
            k.area(),
            k.body(),
        ]);

        return new Promise<{
            grounded: boolean;
            before: { x: number; y: number };
            reparented: { x: number; y: number };
            moved: { x: number; y: number };
        }>((resolve) => {
            k.wait(0.5, () => {
                k.debug.paused = true;
                const before = rider.pos.clone();
                const grounded = rider.curPlatform() === platform;
                platform.setParent(carrier, { keep: k.KeepFlags.Pos });
                // Step just the sticky-platform hook: no new collision pass can
                // hide a coordinate-space jump by resolving another collision.
                rider.c("body")!.update!();
                const reparented = rider.pos.clone();
                platform.moveBy(10, 0);
                rider.c("body")!.update!();
                resolve({
                    grounded,
                    before,
                    reparented,
                    moved: rider.pos.clone(),
                });
            });
        });
    });

    expect(result.grounded).toBe(true);
    expect(result.reparented).toEqual(result.before);
    expect(result.moved.x).toBeCloseTo(result.before.x + 20);
    expect(result.moved.y).toBeCloseTo(result.before.y);
});
