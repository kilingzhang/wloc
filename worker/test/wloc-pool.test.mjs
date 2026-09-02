import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const script = await readFile(new URL("../../dist/wloc.js", import.meta.url), "utf8");

function readSettings(store, expression = "Ze()") {
  const context = vm.createContext({
    $environment: { "stash-version": "3.2.5" },
    $script: { startTime: Date.now() },
    $argument: "logLevel=off",
    $request: { url: "https://gs-loc.apple.com/clls/wloc" },
    $response: { status: 200, headers: {}, body: new Uint8Array() },
    $persistentStore: {
      read(key) {
        return store[key] ?? null;
      },
      write(value, key) {
        store[key] = value;
        return true;
      },
    },
    $done() {},
    console: { log() {} },
    setTimeout,
    clearTimeout,
    Uint8Array,
    ArrayBuffer,
    TextEncoder,
    TextDecoder,
  });
  vm.runInContext(`${script}\nglobalThis.__settings = ${expression};`, context);
  return context.__settings;
}

test("位置池选择并在驻留周期内保持同一地点", () => {
  const store = {
    wloc_settings: JSON.stringify({
      locations: [
        { name: "A", longitude: 10, latitude: 20, randomRadius: 5 },
        { name: "B", longitude: 30, latitude: 40, randomRadius: 7 },
      ],
      dwellMinutes: 20,
      updatedAt: "revision-1",
    }),
  };

  const first = readSettings(store);
  const second = readSettings(store);
  assert.equal(first.locations.length, 2);
  assert.ok([[10, 20], [30, 40]].some(([lon, lat]) => lon === first.longitude && lat === first.latitude));
  assert.deepEqual([second.longitude, second.latitude], [first.longitude, first.latitude]);
  assert.equal(JSON.parse(store.wloc_runtime_state).settingsUpdatedAt, "revision-1");
});

test("位置池支持零经纬度", () => {
  const settings = readSettings({
    wloc_settings: JSON.stringify({
      locations: [{ longitude: 0, latitude: 0, accuracy: 25 }],
      updatedAt: "revision-zero",
    }),
  });
  assert.equal(settings.longitude, 0);
  assert.equal(settings.latitude, 0);
});

test("时间范围支持普通区间和跨午夜区间", () => {
  const normal = readSettings({}, "matchTimeRange([{start: '08:00', end: '18:00'}], new Date(2026, 8, 2, 12, 0))");
  const overnight = readSettings({}, "matchTimeRange([{start: '23:00', end: '02:00'}], new Date(2026, 8, 2, 1, 0))");
  const outside = readSettings({}, "matchTimeRange([{start: '08:00', end: '18:00'}], new Date(2026, 8, 2, 20, 0))");
  assert.equal(normal.index, 0);
  assert.equal(overnight.index, 0);
  assert.equal(outside, null);
});
