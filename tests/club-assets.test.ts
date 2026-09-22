import { afterEach, describe, expect, it, vi } from "vitest";
import * as T from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { ClubAssets } from "../src/club-assets";
import {
  CLUB_MEMBERS,
  CLUB_SELECTION_KEY,
  readClubMember,
  saveClubMember,
} from "../src/club-roster";

function fixture() {
  const scene = new T.Group();
  const wheels = ["FL", "FR", "RL", "RR"].map((id) => ({
    center: [0.8, 0.345, id.startsWith("F") ? 1.4 : -1.4],
    radius: 0.345,
    steerNode: `WheelSteer_${id}`,
    spinNode: `WheelSpin_${id}`,
    steering: id.startsWith("F"),
  }));
  for (const name of [
    "DoorHinge_L",
    "DoorHinge_R",
    "SteeringWheel",
    ...wheels.flatMap((w) => [w.steerNode, w.spinNode]),
  ]) {
    const node = new T.Group();
    node.name = name;
    scene.add(node);
  }
  return {
    scene,
    manifest: {
      name: "Test car",
      wheels,
      steeringWheel: {
        node: "SteeringWheel",
        center: [0.4, 1, 0],
        axis: [0, 0.6, -0.8],
        radius: 0.2,
      },
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("club asset loading", () => {
  it("coalesces concurrent requests but loads different members separately", async () => {
    const asset = fixture();
    const loader = new GLTFLoader();
    const load = vi
      .spyOn(loader, "loadAsync")
      .mockResolvedValue({ scene: asset.scene } as GLTF);
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify(asset.manifest)),
    );
    vi.stubGlobal("fetch", fetchMock);
    const cache = new ClubAssets(loader);
    const first = cache.load(CLUB_MEMBERS[1]);
    expect(cache.load(CLUB_MEMBERS[1])).toBe(first);
    await Promise.all([first, cache.load(CLUB_MEMBERS[3])]);
    expect(load.mock.calls.map(([url]) => url)).toEqual([
      CLUB_MEMBERS[1].asset,
      CLUB_MEMBERS[3].asset,
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects missing opening doors and permits a fixed asset to retry", async () => {
    const asset = fixture();
    const door = asset.scene.getObjectByName("DoorHinge_L")!;
    asset.scene.remove(door);
    const loader = new GLTFLoader();
    const load = vi
      .spyOn(loader, "loadAsync")
      .mockResolvedValue({ scene: asset.scene } as GLTF);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(asset.manifest))),
    );
    const cache = new ClubAssets(loader);
    await expect(cache.load(CLUB_MEMBERS[1])).rejects.toThrow(
      "missing an interactive part",
    );
    asset.scene.add(door);
    await expect(cache.load(CLUB_MEMBERS[1])).resolves.toMatchObject({
      scene: asset.scene,
    });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("does not cache a failed manifest response", async () => {
    const asset = fixture();
    const loader = new GLTFLoader();
    vi.spyOn(loader, "loadAsync").mockResolvedValue({
      scene: asset.scene,
    } as GLTF);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("Unavailable", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(asset.manifest)));
    vi.stubGlobal("fetch", fetchMock);
    const cache = new ClubAssets(loader);
    await expect(cache.load(CLUB_MEMBERS[4])).rejects.toThrow(
      "Couldn’t load Ed",
    );
    await expect(cache.load(CLUB_MEMBERS[4])).resolves.toBeDefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("saved club selection", () => {
  it("round trips a member ID and ignores obsolete or malformed values", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    };
    saveClubMember(storage, "craig");
    expect(readClubMember(storage).id).toBe("craig");
    values.set(CLUB_SELECTION_KEY, '{"id":"craig"}');
    expect(readClubMember(storage).id).toBe("joe");
    values.set(CLUB_SELECTION_KEY, "retired-member");
    expect(readClubMember(storage).id).toBe("joe");
  });
  it("keeps selection usable when browser storage is blocked", () => {
    const storage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readClubMember(storage).id).toBe("joe");
    expect(() => saveClubMember(storage, "lou")).not.toThrow();
    expect(readClubMember(null).id).toBe("joe");
  });
});
