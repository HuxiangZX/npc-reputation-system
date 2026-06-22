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

    const srcWeight = sourceNPC.weight ?? 1;

    // 发送方广播倍率：用接收方权重去匹配发送方的 rules 区间
    // rules 存在发送方 repLink.rules，每条规则是 { min, max, mult }
    // 含义：对权重在 [min, max] 范围内的接收方，广播倍率为 mult
    const srcRules = srcLink.rules ?? [];

    let changed = false;

    for (const member of faction.members) {
        if (member.id === sourceNPC.id) continue;

        const rcvLink = member.repLink ?? {};
        const rcvMode = rcvLink.mode ?? 1;

        if (rcvMode === 0 || rcvMode === 2) {
            console.log(`${PREFIX} 跳过 ${member.name}（接收模式${rcvMode}）`);
            continue;
        }

        // 检查发送方是否针对该接收方设置了屏蔽/特殊倍率（ignores key 为接收方id）
        // 注意：ignores 在接收方 rcvLink 里，key 是来源NPC的id
        // 即：接收方对某个特定来源设置特殊倍率
        let rcvSpecialMult = null;
        if (rcvLink.ignores && sourceNPC.id in rcvLink.ignores) {
            rcvSpecialMult = rcvLink.ignores[sourceNPC.id];
            console.log(`${PREFIX} ${member.name} 对来源 ${sourceNPC.name} 有特殊倍率: ${rcvSpecialMult}`);
        }

        // 接收方个人基础接收倍率
        const rcvBaseMult = rcvLink.mult ?? 1.0;

        // 发送方广播倍率：用接收方的权重匹配发送方的规则区间
        const rcvWeight = member.weight ?? 1;
        let broadcastMult = 0;
        let matchedRule = false;
        for (const rule of srcRules) {
            const rMin = rule.min ?? 0;
            const rMax = rule.max ?? 0;
            if (rcvWeight >= rMin && rcvWeight <= rMax) {
                broadcastMult = rule.mult ?? 0;
                matchedRule = true;
                break;
            }
        }

        if (!matchedRule && srcRules.length > 0) {
            console.log(`${PREFIX} 跳过 ${member.name}（权重${rcvWeight}不在发送方任何规则区间内）`);
            continue;
        }

        if (matchedRule && broadcastMult === 0) {
            console.log(`${PREFIX} 跳过 ${member.name}（广播倍率为0）`);
            continue;
        }

        // 如果发送方没有配置任何规则，广播倍率默认1
        if (!matchedRule && srcRules.length === 0) {
            broadcastMult = 1.0;
        }

        // 最终变动量计算
        // 如果接收方对该来源有特殊倍率（包括0），优先用特殊倍率替代基础接收倍率
        const effectiveRcvMult = rcvSpecialMult !== null ? rcvSpecialMult : rcvBaseMult;

        if (rcvSpecialMult === 0) {
            console.log(`${PREFIX} 跳过 ${member.name}（来源特殊倍率为0，屏蔽）`);
            continue;
        }

        const finalChange = Math.round(changeAmt * broadcastMult * effectiveRcvMult);
        console.log(`${PREFIX} ${member.name} | rcvWeight:${rcvWeight} | broadcastMult:${broadcastMult} | effectiveRcvMult:${effectiveRcvMult} | 最终变动:${finalChange}`);

        if (finalChange === 0) continue;

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
            const actor = game.actors.get(pcid);
            if (!actor || actor.type.match(/party|group/i)) continue;
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