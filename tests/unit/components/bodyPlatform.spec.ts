import { expect, test } from "@playwright/test";
import type { Engine } from "../../../src/core/engine";
import type { AreaComp } from "../../../src/ecs/components/physics/area";
import { body, type BodyComp } from "../../../src/ecs/components/physics/body";
import { pos, type PosComp } from "../../../src/ecs/components/transform/pos";
import { Collision } from "../../../src/ecs/systems/Collision";
import { KEventHandler } from "../../../src/events/events";
import { Mat23, vec2 } from "../../../src/math/math";
import { updateEngine } from "../../../src/shared";
import type { GameObj } from "../../../src/types";

type BodyObj = GameObj<BodyComp | PosComp | AreaComp>;

// Keep contact fixed so only the body's sticky-platform bookkeeping is tested.
// Positions and parent transforms still use the actual pos() component.
function makeBody(parent: GameObj, x: number, y: number, sticky = true) {
    const events = new KEventHandler<any>();
    const comp = body({ stickToPlatform: sticky });
    const obj = Object.defineProperties({
        parent,
        transform: new Mat23(),
        exists: () => true,
        has: () => true,
        isColliding: () => true,
        onCollideUpdate: () => {},
        on: (name: string, action: (...args: any[]) => void) =>
            events.on(name, action),
        trigger: (name: string, ...args: any[]) =>
            events.trigger(name, ...args),
        ...comp,
    }, Object.getOwnPropertyDescriptors(pos(x, y))) as unknown as BodyObj;
    comp.add!.call(obj);
    return { obj, update: () => comp.update!.call(obj) };
}

function parent(x = 0, y = 0, scale = 1) {
    return {
        transform: new Mat23().translateSelf(x, y).scaleSelf(scale, scale),
    } as GameObj;
}

function setup(sticky = true, riderParent?: GameObj) {
    updateEngine(
        {
            game: { gravity: vec2(0, 100) },
            app: { restDt: () => 0 },
        } as unknown as Engine,
    );
    const root = parent();
    const platform = makeBody(root, 100, 200);
    const rider = makeBody(riderParent ?? root, 120, 168, sticky);
    rider.obj.worldPos = vec2(120, 168);
    rider.obj.vel = vec2(0, 1);
    rider.obj.trigger(
        "physicsResolve",
        new Collision(rider.obj, platform.obj, vec2(0, -1), 0),
    );
    rider.update();
    return { root, platform, rider };
}

test("reparenting a platform without moving it does not teleport its rider", () => {
    const { platform, rider } = setup();
    const carrier = parent(100, 200);
    platform.obj.parent = carrier;
    platform.obj.pos = vec2(0, 0);
    rider.update();
    expect(rider.obj.pos).toEqual(vec2(120, 168));
});

test("a rider follows actual movement after its platform changes parents", () => {
    const { platform, rider } = setup();
    const carrier = parent(100, 200, 2);
    platform.obj.parent = carrier;
    platform.obj.pos = vec2(0, 0);
    rider.update();
    platform.obj.moveBy(10, 0);
    rider.update();
    expect(rider.obj.pos).toEqual(vec2(140, 168));
});

test("a rider follows movement of the platform's parent", () => {
    const { platform, rider } = setup();
    const carrier = parent(100, 200);
    platform.obj.parent = carrier;
    platform.obj.pos = vec2(0, 0);
    rider.update();
    carrier.transform.translateSelf(25, 0);
    rider.update();
    expect(rider.obj.pos).toEqual(vec2(145, 168));
});

test("shared parent movement is not applied to the rider twice", () => {
    const { root, platform, rider } = setup();
    rider.update();
    root.transform.translateSelf(25, 0);
    rider.update();
    expect(rider.obj.pos).toEqual(vec2(120, 168));
    expect(rider.obj.worldPos).toEqual(vec2(145, 168));
    platform.obj.moveBy(10, 0);
    rider.update();
    expect(rider.obj.pos).toEqual(vec2(130, 168));
});

test("stickToPlatform false does not carry the rider", () => {
    const { platform, rider } = setup(false);
    platform.obj.moveBy(20, 0);
    rider.update();
    expect(rider.obj.pos).toEqual(vec2(120, 168));
});

test("platform movement is converted into a differently transformed rider parent", () => {
    const riderParent = parent(300, 100, 2);
    riderParent.transform.rotateSelf(90);
    const { platform, rider } = setup(true, riderParent);
    platform.obj.moveBy(20, 0);
    rider.update();
    expect(rider.obj.worldPos.x).toBeCloseTo(140);
    expect(rider.obj.worldPos.y).toBeCloseTo(168);
});

test("changing the rider's parent resets its platform coordinate snapshot", () => {
    const { platform, rider } = setup();
    rider.obj.parent = parent(100, 100, 2);
    rider.obj.worldPos = vec2(120, 168);
    rider.update();
    expect(rider.obj.worldPos).toEqual(vec2(120, 168));
    platform.obj.moveBy(20, 0);
    rider.update();
    expect(rider.obj.worldPos).toEqual(vec2(140, 168));
});
