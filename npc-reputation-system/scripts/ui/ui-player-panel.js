/**
 * ui-player-panel.js
 * 玩家任务面板（对应原宏4）
 */

import { getRepData, getQuests, findNPCById } from "../data-manager.js";
import { parseItemsWithQuantity }             from "../utils.js";

/**
 * 打开玩家任务面板
 * @param {string} npcId
 */
export async function openPlayerPanel(npcId) {
    const repData    = getRepData();
    const questsData = await getQuests();

    const { npc: targetNPC, factionName: targetFactionName } =
        findNPCById(repData, npcId);

    if (!targetNPC) return;

    // 必须有绑定角色
    const myCharacter = game.user.character;
    if (!myCharacter) {
        return ui.notifications.warn("你尚未绑定角色，无法查看任务面板。");
    }

    // 当前玩家所属队伍
    const myGroupIds = game.actors
        .filter(a =>
            a.type.match(/party|group/i) &&
            a.testUserPermission(game.user, "OWNER")
        )
        .map(a => a.id);

    // ── 筛选对当前玩家可见的任务 ─────────────────────────────
    const visibleQuests = questsData.filter(q => {
        const isSharedWithThisNpc = q.sharedWith?.includes(npcId);
        if (q.npcId !== npcId && !isSharedWithThisNpc) return false;
        if (q.status !== "avail" && q.status !== "active") return false;
        if (q.targetId === "ALL") return true;
        const tIds = q.targetId.split(",");
        return tIds.includes(myCharacter.id) ||
               tIds.some(id => myGroupIds.includes(id));
    });

    // ── 构建任务卡片 HTML ─────────────────────────────────────
    let questsHtml = "";

    if (visibleQuests.length === 0) {
        questsHtml = `
        <div style="text-align:center; padding:30px; color:#777; font-style:italic;">
            该 NPC 目前似乎没有什么可以委托给你的事情...
        </div>`;
    } else {
        questsHtml = visibleQuests.map(q => {
            // ── 计算有效声望 ──────────────────────────────────
            let effAff = targetNPC.affection || 0;
            if (targetNPC.playerAffection) {
                const tIds = q.targetId === "ALL" ? [] : q.targetId.split(",");
                const validIds = [];
                if (q.targetId === "ALL") {
                    if (targetNPC.playerAffection[myCharacter.id]) validIds.push(myCharacter.id);
                    validIds.push(...myGroupIds);
                } else {
                    if (tIds.includes(myCharacter.id)) validIds.push(myCharacter.id);
                    validIds.push(...tIds.filter(id => myGroupIds.includes(id)));
                }
                let maxAff = effAff;
                for (const id of validIds) {
                    const pa = targetNPC.playerAffection[id];
                    if (pa) maxAff = Math.max(maxAff, pa.affection);
                }
                effAff = maxAff;
            }

            // ── 锁定判断 ──────────────────────────────────────
            const isTooHated  = effAff <= -41;
            const isLocked    = (!q.ignoreAff && effAff < q.minAff) || isTooHated;
            const isPrivate   = q.targetId !== "ALL" &&
                !game.actors.get(q.targetId.split(",")[0])?.type.match(/party|group/i);
            const statusTag   = q.status === "active"
                ? `<span style="background:rgba(52,152,219,0.2); color:#3498db;
                        padding:2px 8px; border-radius:4px; font-size:0.8em;
                        border:1px solid #3498db;">🔄 已被接取（进行中）</span>`
                : "";

            if (isLocked) {
                return `
                <div class="quest-card locked">
                    <div class="q-head">
                        <span><i class="fas fa-lock"></i> ${q.name}</span>
                        <span style="font-size:0.8em; color:#c0392b;
                            border:1px solid #c0392b; padding:2px 6px; border-radius:4px;">
                            关系不足
                        </span>
                    </div>
                    <div class="q-desc">
                        ???（由于你们之间的交情不足，对方不愿向你透露更多细节…）
                    </div>
                    <button class="q-btn disabled" disabled>无法接取</button>
                </div>`;
            }

            // ── 当前阶段信息 ──────────────────────────────────
            const cp    = q.currentPhase || 0;
            const phase = (q.phases?.length > cp) ? q.phases[cp] : q;

            // 解析物品
            const itemParts = parseItemsWithQuantity(phase.items || "").map(it =>
                `${it.name} x${it.qty}`
            );
            const displayItems = itemParts.join(", ") || "无";
            const goldDisplay  = phase.goldNum > 0
                ? `${phase.goldNum}${q.goldType || "gp"}`
                : "";

            let rewardHtml = "";
            if (phase.goldNum > 0)
                rewardHtml += `<span><i class="fas fa-coins"></i> ${goldDisplay}</span>`;
            if (displayItems !== "无")
                rewardHtml += `<span><i class="fas fa-box"></i> 物品: ${displayItems}</span>`;
            if (!rewardHtml)
                rewardHtml = `<span><i class="fas fa-hands-helping"></i> 无实质性报酬</span>`;

            const isShared  = q.npcId !== npcId;
            const sourceTag = isShared
                ? `<span style="background:#8e44ad; color:#fff; font-size:0.75em;
                        padding:2px 6px; border-radius:3px; margin-left:5px;">
                        🤝 来源共享</span>`
                : "";
            const phaseTag = (q.phases?.length > 1)
                ? `<div style="color:#3498db; font-size:0.85em;
                        margin-bottom:5px; font-weight:bold;">
                        [当前进度: 第 ${cp + 1} / ${q.phases.length} 阶段]
                    </div>`
                : "";

            const actionBtn = q.status === "avail"
                ? `<button class="q-btn act-request">
                        <i class="fas fa-hand-paper"></i> 揭下悬赏 / 申请接取
                   </button>`
                : `<button class="q-btn act-complete-req"
                        style="background:#3498db; border-color:#2980b9;">
                        <i class="fas fa-check-circle"></i> 申请结算当前进度
                   </button>`;

            return `
            <div class="quest-card unlocked"
                data-qid="${q.id}"
                data-qname="${q.name}"
                data-isprivate="${isPrivate}">
                <div class="q-head">
                    <span>${q.name} ${sourceTag}</span>
                    ${statusTag}
                </div>
                ${phaseTag}
                <div class="q-desc">${phase.desc || "暂无详情描述"}</div>
                <div class="q-rewards">
                    <span style="color:#aaa;">当前阶段悬赏：</span>
                    ${rewardHtml}
                    ${q.timeLimit
                        ? `<span style="color:#e67e22; margin-left:auto;">
                                <i class="fas fa-hourglass-half"></i> 时限: ${q.timeLimit}
                           </span>`
                        : ""}
                </div>
                ${actionBtn}
            </div>`;
        }).join("");
    }

    // ── 构建并渲染对话框 ──────────────────────────────────────
    const app = new Dialog({
        title:   `与 ${targetNPC.name} 互动`,
        content: `
        <div class="pc-panel">
            <div class="npc-header">
                <img src="${targetNPC.img}" class="npc-avatar">
                <div class="npc-info">
                    <div class="npc-name">${targetNPC.name}</div>
                    <div class="npc-tags">
                        <span class="tag faction">${targetFactionName}</span>
                        <span class="tag job">${targetNPC.title || "平民"}</span>
                    </div>
                </div>
            </div>
            <div class="board-title">
                <i class="fas fa-scroll"></i> 委托任务板
            </div>
            <div style="max-height:400px; overflow-y:auto; padding-right:5px;">
                ${questsHtml}
            </div>
        </div>`,
        buttons: {
            close: { label: "离开", icon: '<i class="fas fa-door-open"></i>' }
        },
        render: (html) => _bindPlayerPanelEvents(html, npcId, targetNPC, myCharacter, app)
    }, { width: 500, height: "auto" });

    app.render(true);
}

// ─── 事件绑定 ─────────────────────────────────────────────────
function _bindPlayerPanelEvents(html, npcId, targetNPC, myCharacter, app) {

    // ── 接取申请 ──────────────────────────────────────────────
    html.find(".act-request").click(function () {
        const card      = $(this).closest(".quest-card");
        const qId       = card.data("qid");
        const qName     = card.data("qname");
        const isPrivate = card.data("isprivate");

        const chatContent = `
        <div style="background:rgba(0,0,0,0.5); border:1px solid #444;
             border-left:4px solid #e67e22; padding:10px; border-radius:4px;
             font-family:'Signika',sans-serif;">
            <h3 style="margin-top:0; color:#e67e22; border-bottom:1px solid #333;
                padding-bottom:5px;">
                📜 ${isPrivate ? "私密委托申请" : "想要承接委托"}
            </h3>
            <p style="font-size:1.05em; color:#eee; margin-bottom:5px;">
                <b>${myCharacter.name}</b> 想要接下
                <b>${targetNPC.name}</b> 的委托：
            </p>
            <div style="background:#111; padding:8px; border-radius:4px;
                color:#3498db; font-weight:bold; text-align:center;
                font-size:1.1em; margin-bottom:12px;">
                「 ${qName} 」
            </div>
            <div class="dm-only-btn" style="text-align:center;
                border-top:1px dashed #555; padding-top:10px;">
                <button class="npc-quick-accept-btn"
                    data-npcid="${npcId}"
                    data-qid="${qId}"
                    data-reqid="${game.user.id}"
                    style="background:#27ae60; border:1px solid #2ecc71; color:white;
                           padding:6px; border-radius:4px; cursor:pointer;
                           font-size:0.95em; width:100%; font-weight:bold;">
                    <i class="fas fa-check"></i> DM 一键批准接取
                </button>
            </div>
        </div>`;

        const chatData = {
            speaker: ChatMessage.getSpeaker({ actor: myCharacter }),
            content: chatContent
        };
        if (isPrivate) {
            chatData.whisper = ChatMessage.getWhisperRecipients("GM");
        }
        ChatMessage.create(chatData);
        ui.notifications.success("申请已发送给 DM。");
        app.close();
        // 重新打开以同步显示状态
        openPlayerPanel(npcId);
    });

    // ── 结算申请 ──────────────────────────────────────────────
    html.find(".act-complete-req").click(function () {
        const card      = $(this).closest(".quest-card");
        const qId       = card.data("qid");
        const qName     = card.data("qname");
        const isPrivate = card.data("isprivate");

        const chatContent = `
        <div style="background:rgba(0,0,0,0.5); border:1px solid #444;
             border-left:4px solid #3498db; padding:10px; border-radius:4px;">
            <h3 style="margin-top:0; color:#3498db; border-bottom:1px solid #333;
                padding-bottom:5px;">
                ✅ 任务结算申请
            </h3>
            <p style="font-size:1.05em; color:#eee; margin-bottom:5px;">
                <b>${myCharacter.name}</b> 申请结算
                <b>${targetNPC.name}</b> 的委托：
            </p>
            <div style="background:#111; padding:8px; border-radius:4px;
                color:#2ecc71; font-weight:bold; text-align:center;
                font-size:1.1em; margin-bottom:12px;">
                「 ${qName} 」
            </div>
            <div class="dm-only-btn" style="text-align:center;
                border-top:1px dashed #555; padding-top:10px;">
                <button class="npc-quick-complete-btn"
                    data-npcid="${npcId}"
                    data-qid="${qId}"
                    data-reqid="${game.user.id}"
                    style="background:#3498db; border:1px solid #2980b9; color:white;
                           padding:6px; border-radius:4px; cursor:pointer;
                           font-size:0.95em; width:100%; font-weight:bold;">
                    <i class="fas fa-coins"></i> DM 一键批准结算
                </button>
            </div>
        </div>`;

        const chatData = {
            speaker: ChatMessage.getSpeaker({ actor: myCharacter }),
            content: chatContent
        };
        if (isPrivate) {
            chatData.whisper = ChatMessage.getWhisperRecipients("GM");
        }
        ChatMessage.create(chatData);
        ui.notifications.success("结算申请已发送。");
        app.close();
        openPlayerPanel(npcId);
    });
}