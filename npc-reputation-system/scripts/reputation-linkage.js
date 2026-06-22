/**
 * reputation-linkage.js
 * 派系声望联动传播
 */
import { saveRepData } from "./data-manager.js";
import { getWorldTimeString } from "./utils.js";

const PREFIX = "[联动调试]";

/**
 * 传播声望变动给同派系成员
 * @param {object} sourceNPC  - 触发变动的 NPC
 * @param {string} pcid       - 玩家ID，传 "global" 表示全局声望
 * @param {number} changeAmt  - 变动量
 * @param {string} reason     - 原因
 * @param {string} factionId  - 派系ID
 * @param {object} repData    - 完整数据
 */
export async function propagateFactionLinkage(
    sourceNPC, pcid, changeAmt, reason, factionId, repData
) {
    const fl = repData.settings?.factionLink;

    console.log(`${PREFIX} 触发 | NPC:${sourceNPC.name} | pcid:${pcid} | 变动:${changeAmt} | 派系:${factionId}`);
    console.log(`${PREFIX} 联动开关:${fl?.enabled} | 阈值:${fl?.threshold}`);

    if (!fl?.enabled) {
        console.warn(`${PREFIX} ❌ 全局联动开关未启用`);
        return;
    }
    if (factionId === "ind" || !factionId) {
        console.warn(`${PREFIX} ❌ 独立NPC，不传播`);
        return;
    }
    if (changeAmt === 0) {
        console.warn(`${PREFIX} ❌ 变动量为0`);
        return;
    }
    if (Math.abs(changeAmt) < (fl.threshold ?? 10)) {
        console.warn(`${PREFIX} ❌ 变动量${Math.abs(changeAmt)}未达阈值${fl.threshold ?? 10}`);
        return;
    }

    const srcLink = sourceNPC.repLink ?? {};
    const srcMode = srcLink.mode ?? 1;
    console.log(`${PREFIX} 发送方模式:${srcMode}`);

    if (srcMode === 0 || srcMode === 3) {
        console.warn(`${PREFIX} ❌ 发送方模式${srcMode}不向外发送`);
        return;
    }

    const faction = repData.factions[factionId];
    if (!faction?.members) {
        console.warn(`${PREFIX} ❌ 找不到派系成员`);
        return;
    }

    // 发送方广播倍率（按权重区间）
    const srcWeight = sourceNPC.weight ?? 1;
    let broadcastMult = 1.0;
    for (const rule of (srcLink.rules ?? [])) {
        if (srcWeight >= rule.min && srcWeight <= rule.max) {
            broadcastMult = rule.mult ?? 1.0;
            break;
        }
    }
    console.log(`${PREFIX} 广播倍率:${broadcastMult}`);

    let changed = false;

    for (const member of faction.members) {
        if (member.id === sourceNPC.id) continue;

        const rcvLink = member.repLink ?? {};
        const rcvMode = rcvLink.mode ?? 1;

        if (rcvMode === 0 || rcvMode === 2) {
            console.log(`${PREFIX} 跳过 ${member.name}（接收模式${rcvMode}）`);
            continue;
        }

        // 接收方对发送方的特殊倍率
        let rcvMult = rcvLink.mult ?? 1.0;
        if (rcvLink.ignores?.[sourceNPC.id] !== undefined) {
            rcvMult = rcvLink.ignores[sourceNPC.id];
        }

        const finalChange = Math.round(changeAmt * broadcastMult * rcvMult);
        console.log(`${PREFIX} ${member.name} | 接收倍率:${rcvMult} | 最终变动:${finalChange}`);

        if (finalChange === 0) continue;

        // 根据 pcid 决定写全局还是写玩家个人
        if (pcid === "global") {
            const oldVal = member.affection || 0;
            member.affection = oldVal + finalChange;
            member.history ??= [];
            member.history.push({
                date:   getWorldTimeString(),
                old:    oldVal,
                new:    member.affection,
                change: finalChange,
                reason: `[联动自 ${sourceNPC.name}] ${reason}`
            });
            console.log(`${PREFIX} ✅ ${member.name} 全局 ${oldVal}→${member.affection}`);
        } else {
            member.playerAffection       ??= {};
            member.playerAffection[pcid] ??= { affection: 0, history: [] };
            const oldVal = member.playerAffection[pcid].affection || 0;
            member.playerAffection[pcid].affection = oldVal + finalChange;
            member.playerAffection[pcid].history.push({
                date:   getWorldTimeString(),
                old:    oldVal,
                new:    oldVal + finalChange,
                change: finalChange,
                reason: `[联动自 ${sourceNPC.name}] ${reason}`
            });
            console.log(`${PREFIX} ✅ ${member.name} [玩家${pcid}] ${oldVal}→${oldVal + finalChange}`);
        }
        changed = true;
    }

    if (changed) {
        await saveRepData(repData);
        console.log(`${PREFIX} ✅ 保存完成`);
    } else {
        console.warn(`${PREFIX} ⚠️ 没有成员被更新`);
    }
}