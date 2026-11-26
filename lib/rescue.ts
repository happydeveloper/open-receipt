// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * 오류 화면에서 쓰는 비상 백업. 앱 화면이 열리지 않아도 이 기기의 기록을 백업 파일로 꺼낼 수 있게 한다.
 * 설정 화면의 "백업 내보내기"와 같은 파일을 만든다.
 */
import { deviceMasked, deviceOriginals, type ImageBag } from "./originals";
import { slotsOf } from "./photos";
import { loadSettings, makeBackup } from "./settings";
import { hydrateImages, loadExpenses, type KV } from "./storage";

export interface Rescue {
  name: string;
  text: string;
  count: number;
}
/** 기록이 없으면 null. 사진을 읽지 못하면 사진 없이라도 만든다. */
export async function rescueBackup(kv: KV, at = new Date().toISOString(), masked: ImageBag = deviceMasked, originals: ImageBag = deviceOriginals): Promise<Rescue | null> {
  const list = loadExpenses(kv);
  if (!list || !list.length) return null;
  let full = list;
  const orig: Record<string, string> = {};
  try {
    full = await hydrateImages(list, masked);
    for (const s of full.flatMap(slotsOf)) {
      if (!s.original) continue;
      const img = await originals.get(s.key);
      if (img) orig[s.key] = img;
    }
  } catch {
    /* 사진 보관함을 열지 못해도 기록은 꺼낸다 */
  }
  return { name: `열린영수증_백업_${at.slice(0, 10)}.json`, text: makeBackup(loadSettings(kv), full, at, orig), count: full.length };
}
