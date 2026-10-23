# 黑秤記 · 第一章灰模

《黑秤記》第一章〈鹽與血〉嘅可玩灰模。里程做到 **M3**（升舖收章）；對決由 **M2** 起：

**S-1 序幕 → S0 開檔 → S1 市集看板 → 對決鹽幫香主**

零美術，文字同卡片。本機運行，無後端、無帳號。

戰敗即完局（`onDefeat = game_over`）。城主軍刀唔係開戰門檻：冇刀都可以打，但會先彈 `warnIfNoWeapon` 確認。爆擊只來自已裝備嘅軍刀，唔入六圍開檔。

勝咗唔會直接揀結局。流程係：戰勝短句 → 強制黑市一次 → 至少成功拋售 1 次 → 見管事揀立場（正義／黑心）→ 按倍率兌現剩餘庫存 → 鋪由起點升到終點 → 章末總表。可以新開一局，或者留喺 Lv2 看板。香主勝後唔會再打。

**M3 收呢一章。** 未做：用腰牌製貨、完整套戥、稅點實扣、義軍耳目、美術、部署、第二章。

## 點玩

網上直接玩：<https://siumeifc1988-sketch.github.io/heichengji/>

原始碼：<https://github.com/siumeifc1988-sketch/heichengji>

## 點樣跑

需要 Node.js 22 或更新。

```bash
npm install
npm run dev
```

開發伺服器：<http://127.0.0.1:4317/heichengji/>

其他指令：

```bash
npm run check    # 開檔、貨價、對決公式自我檢查
npm run build    # 型別檢查同生產建構
npm run preview  # 預覽建構結果
```

## 設定

玩法數值來自 [`public/config/chapter1.json`](public/config/chapter1.json)：序幕、六圍、禁配、招式、三件貨嘅價錢同用途、命中上下限、守勢加防、爆擊封頂、無刀警告文案、完局文案、香主六圍同「虧本大拍賣」、勝後黑市衝擊、立場倍率、升舖同章末。介面唔會把呢啲數寫死。

## 設計初值（唔喺 JSON）

- 開局現金 **50 文**。常數 `DESIGN_INITIAL_CASH`（`src/design.ts`）。
- 保底傷害 **1**。攻減防低過呢個數仍然打出 1 點。常數 `DESIGN_MIN_DAMAGE`。JSON 只寫命中上下限同守勢加防，冇最低傷害。
- 勝前成交量一手係 **1**。常數 `DESIGN_BASE_VOLUME`。JSON 只寫 shock 之後嘅 `volumeMul`。低過一手，嗰件貨買唔入亦賣唔出。

存檔節點名係 **OpenBoard**，寫入瀏覽器 `localStorage`（鍵 `heichengji.m1.save`）。章節 `save.schemaVersion` 維持 **1**，欄位見 `save.fields`（鋪等、格數、稅率、現金、庫存、裝備、指數、成交量、立場、幫派、旗號、角色、招式）。程式信封版本 4，版本 1–3 仍然讀得。對決中途同戰敗都唔會覆寫呢個存檔。結算、留喺看板、之後嘅買賣會寫入。重整頁面如果已經升舖，會直接返到寫低嗰一屏。

## 開檔規則

- 名字、口頭禪、招式名稱、招式說明、觸發時機必填；招式 1–2 項效果（上限跟 `maxEffects`）。
- 六圍由 `baseline` 起步，用 `budgetPoints` 重配。氣血每點加減 `hpPerPoint`。超出 `clamps`、點數超支，或者觸發 `forbid`，確認會停用。
- 威力分數要 ≤ `maxPowerScore`。計分寫喺程式（JSON 只有上限）：
  - 攻／防按數值；敵方降防取絕對值
  - 命中、閃避每 5 計 1
  - 回血每 2 計 1
  - 下次傷害倍率：1.2 計 2、1.5 計 3，中間按步進直線內插
  - 反傷按數值
  - 情報揭示計 0
- 爆擊率、爆擊倍率唔係六圍，開檔計唔到。

## 市集

貨價 = `basePrice × index`。進貨、拋售每次一件。`stackable: false` 嘅貨（軍刀、布衣）買咗一件就唔可以再進。裝備唔扣存貨；賣到最後一件會自動卸下。

`market.taxApplies` 為真時，介面會顯示當前鋪等嘅稅率，但牌價仍然係 `basePrice × index`。稅點點加落成交價，章節設定冇公式，所以未實扣。持有布衣 ≥3 解鎖「義軍耳目」係之後嘅選項，M2 只用裝備效果。

## 對決

「去教訓香主」永遠可以撳（除非 JSON 設咗 `requireItemToFight`）。未裝備警告指定嘅武器（而家係城主軍刀）會出確認框，文案用 `warnIfNoWeapon`。確認就開戰，取消返市集。袋入面有刀但未裝備，一樣當未帶。

回合：玩家先選，結算，再由香主自動出一招（而家永遠攻擊），再檢查勝負。`spdMul` 會改香主速度數字同寫入日誌，唔會調轉出手，亦唔會俾香主多打一下。

公式（唔喺 JSON，跟 `combat` 入面嘅上下限同加乘）：

- 命中 = 攻方命中 − 守方閃避，再壓入 `hitFloor`…`hitCeil`。擲骰 ≥ 命中線即打唔中。
- 傷害 = max(保底 1, 攻擊 − 防禦)。守勢只加 `guardDefBonus` 喺下一記打中；打唔中唔會食走守勢。
- 爆擊只喺打中之後再擲一次。率 = min(裝備 `critRate`, `critRateCap`)。`critMulStack = max_one_equip` 時只取倍率最高嗰一件。
- 招式「下次傷害倍率」先乘、再爆擊（四捨五入）。粗鹽嘅傷加喺爆擊之後，所以 +2 唔會被倍率放大。
- **抹刀唔結束回合**，抹完可以即刻攻擊。每場最多 `maxPerBattle` 次，扣 `consumeQty`。加成果用喺下一擊，打唔中都會食走。
- 義軍布衣：裝備後閃避 +`dodgeAdd`（只加喺呢場鬥士身上，唔改開檔六圍），開戰多寫一行香主技提示。
- 香主氣血比例 ≤ `hpRatioTrigger` 時，喺**佢嗰個回合開始**先收割：防禦改成 `onTrigger.def`，速度乘 `spdMul`，之後每個敵方回合攻擊 +`atkPerTurnBonus`。`reapStaysOn` 為真就唔會自動復原。一擊打死、同時跌穿門檻，唔會再播收割。

戰勝：短句一屏，唯一出口係入黑市。`flags.beatXiangzhu = true`。唔會喺呢度揀結局。

戰敗：完局畫面用 `gameOver` 標題同正文。可以讀返最近一次 OpenBoard，或者重新開檔（本機存檔留低）。未存檔嘅市集變動會冇咗。戰敗唔會開黑市。

## 勝後黑市

進入 `postFightBlackMarket` 先至結算，而且只結算一次。

- 幫派用**開戰前**庫存，唔用打完之後嘅袋（抹鹽唔會改訊號）。`gangResolve.rules` 由上至下，第一條 `when` 全中就用。`cloth_qty_gte`／`salt_qty_gte`／`blade_owned` 對住 `goods` 嘅鍵。冇條中就用 `fallbackGang`。
- 用 `shocks.win[幫派]`：指數加 `indexDelta`，成交量改成 `volumeMul`。價差 banner 列原牌價 → 新牌價，同埋成交量由一手變成新倍數。
- 庫存保留。`addWinLootStub` 嘅腰牌入袋；`sellable: false` 就賣唔出。
- 「去見管事」要成功拋售至少 `mustSell.minSellActions` 次。買貨、賣唔出（冇貨或未夠一手）都唔計。

## 立場

見管事之後先揀。預覽仍會列出勝後牌價 × `sellMul`。真正兌現時：

1. 全部貨嘅指數加上呢條立場嘅 `indexDelta`。
2. 若勾住「結算時按倍率兌現庫存」（預設跟 `m3.settle.autoRedeemAppliesToStock`），`appliesTo` 剩餘件數按 **新牌價 × sellMul** 一次過換成現金。新牌價 = 底價 ×（勝後指數 + 指數差）。
3. 畫面顯示結算前現金 → 結算後現金。
4. 鋪等改成 `m3.promotion.toShopLv`，貨架改成 `chapter.endSlots`，稅率改讀 `taxByShopLv` 對應鋪等。徽章寫「流動小販 → 」加上升舖標題。

揀完只結算一次。章末總表列立場、現金、三貨指數同牌價、成交量、幫派、旗號、鋪等／格數／稅。可以新開一局，或者留喺黑市看板繼續買賣。`xiangzhuRematch` 為假時，「去教訓香主」停用，標「已了結」。

## 範圍外

用腰牌製貨、完整套戥、稅點實扣、義軍耳目、線上、多人經濟、第二章、落敗送藍圖、跳過勝後黑市。
