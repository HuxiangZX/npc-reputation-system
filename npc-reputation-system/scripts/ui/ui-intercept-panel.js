/**
 * ui-intercept-panel.js
 * DM 拦截审批面板（从宏3中拆分）
 */

import { NpcRepApi }      from "../api.js";
import { activeDialogLock } from "../radar-engine.js";

const MODULE_ID = "npc-reputation-system";

/**
 * 显示 DM 拦截审批面板
 * @param {Array}  targetNPCs   - 触发的NPC对象数组
 * @param {object} triggerToken - 触发的玩家Token文档
 * @param {object} sys          - 当前引擎设置
 * @param {string} rawFid       - 派系ID或 "ind_xxx"
 */
export function showInterceptPanel(targetNPCs, triggerToken, sys, rawFid = "未知") {
    const lockKey = targetNPCs.map(n => n.id).sort().join("_");
    if (activeDialogLock.has(lockKey)) return;
    activeDialogLock.add(lockKey);

    const onlineUsers = game.users.filter(u => u.active && !u.isGM && u.character);
    if (onlineUsers.length === 0) {
        activeDialogLock.delete(lockKey);
        return ui.notifications.info("当前没有玩家在线。");
    }

    // ── 构建玩家Checkbox列表 ────────────────────────────────
    const userCheckboxes = onlineUsers.map(u => `
        <label style="display:flex; align-items:center; padding:8px 10px;
            background:#2c3e50; color:#ecf0f1; margin-bottom:6px;
            border-radius:4px; border:1px solid #34495e; cursor:pointer;">
            <input type="checkbox" class="target-user-cb" value="${u.id}"
                ${u.character?.id === triggerToken.actor?.id ? "checked" : ""}
                style="margin-right:10px; transform:scale(1.3);">
            <span><b>${u.name}</b>
                <span style="font-size:0.85em; color:#bdc3c7;">
                    (角色: ${u.character?.name})</span></span>
        </label>`
    ).join("");

    // ── 预设按钮 ────────────────────────────────────────────
    const presetButtons = (sys.presets || []).map(p => `
        <button class="p-btn" data-users='${JSON.stringify(p.users)}'
            style="flex:1; padding:8px; font-size:0.95em; background:#2980b9;
                   color:#fff; border:1px solid #1f618d; border-radius:4px;
                   font-weight:bold; cursor:pointer;">
            ${p.name}
        </button>`
    ).join("");

    // ── NPC互动语录预处理 ────────────────────────────────────
    const npcDataMap = {};
    targetNPCs.forEach(n => {
        const effAff = n.affection || 0;
        const phrase = (n.phrases || [])
            .slice().sort((a, b) => b.minAff - a.minAff)
            .find(p => effAff >= p.minAff);
        let text = phrase?.text ?? "对方似乎有话对你们说...";
        text = text.replace(/这个NPC/g, n.name).replace(/{name}/gi, n.name);
        npcDataMap[n.id] = { name: n.name, img: n.img, text, title: n.title || "平民" };
    });

    const mainNPC     = targetNPCs[0];
    const mainData    = npcDataMap[mainNPC.id];
    const debugFname  = rawFid.startsWith("ind")
        ? "❌ 独立NPC"
        : (sys.fullData?.factions?.[rawFid]?.name || "未知派系");

    // ── 多NPC选择器（仅扎堆时显示） ─────────────────────────
    const npcSelectHtml = targetNPCs.length > 1 ? `
        <div style="margin-bottom:12px; background:rgba(52,152,219,0.1);
            padding:10px; border-radius:6px; border:1px solid #2c3e50;
            border-left:4px solid #3498db;">
            <label style="color:#3498db; font-weight:bold; display:block; margin-bottom:6px;">
                <i class="fas fa-users"></i>
                检测到 ${targetNPCs.length} 名同派系成员扎堆，请指定主导者：
            </label>
            <select id="intercept-npc-select"
                style="width:100%; background:#111; color:#eee; border:1px solid #444;
                       padding:6px; height:36px; border-radius:4px; font-size:1em;">
                ${targetNPCs.map((n, i) =>
                    `<option value="${n.id}" ${i === 0 ? "selected" : ""}>
                        ${n.name} (${n.title || "平民"})
                    </option>`
                ).join("")}
            </select>
        </div>` : "";

    new Dialog({
        title:   `互动触发审批: ${mainNPC.name}${targetNPCs.length > 1 ? " 等" : ""}`,
        content: `
        <div style="padding:12px; font-size:1.05em; font-family:'Signika',sans-serif;
             background:#1e1e1e; color:#eee; border-radius:6px; border:1px solid #444;">
            <p style="color:#e67e22; font-weight:bold; font-size:1.1em;
               border-bottom:1px solid #333; padding-bottom:6px; margin-top:0;">
                ⚠️ 玩家 ${triggerToken.name} 触发了互动！</p>

            ${npcSelectHtml}

            <div id="npc-preview-area"
                style="background:#111; border:1px solid #333; padding:12px;
                       border-radius:6px; text-align:center; margin-bottom:15px; position:relative;">
                <span style="position:absolute; top:5px; right:5px;
                      font-size:0.8em; color:#777;">玩家预览</span>
                <img id="prev-img" src="${mainData.img}"
                    style="width:64px; height:64px; border-radius:4px; margin-bottom:5px;
                           object-fit:contain; background:rgba(0,0,0,0.6); border:1px solid #555;">
                <h3 id="prev-name" style="margin-top:0; color:#3498db; font-size:1.2em;">
                    ${mainData.name}</h3>
                <p id="prev-text"
                   style="font-size:0.95em; color:#e67e22; font-style:italic; margin-bottom:5px;">
                    「 ${mainData.text} 」</p>
            </div>

            <p style="color:#ccc; margin-bottom:10px; font-size:0.95em;">
                请选择向哪些玩家推送此任务板请求：</p>
            <div style="margin-bottom:10px; display:flex; gap:6px; flex-wrap:wrap;">
                ${presetButtons}
            </div>
            <div style="margin-bottom:12px; display:flex; gap:6px;">
                <button class="sel-all-btn"
                    style="flex:1; padding:6px; background:#444; color:#fff;
                           border:1px solid #555; border-radius:3px; cursor:pointer;">全选</button>
                <button class="sel-none-btn"
                    style="flex:1; padding:6px; background:#444; color:#fff;
                           border:1px solid #555; border-radius:3px; cursor:pointer;">全不选</button>
            </div>
            <div id="user-cb-list"
                style="max-height:200px; overflow-y:auto; border:1px solid #333;
                       padding:5px; border-radius:4px; background:#111;">
                ${userCheckboxes}
            </div>
            <div style="margin-top:10px; text-align:center;">
                <span style="font-size:0.85em; color:#777; background:#000;
                      padding:2px 8px; border-radius:4px; border:1px solid #333;">
                    [系统底层判定归属: ${debugFname}]</span>
            </div>
        </div>`,
        buttons: {
            send: {
                label: "发送互动请求",
                icon:  '<i class="fas fa-paper-plane"></i>',
                callback: (html) => {
                    const selectedUserIds = [];
                    html.find(".target-user-cb:checked").each(function () {
                        selectedUserIds.push($(this).val());
                    });
                    if (selectedUserIds.length === 0) {
                        return ui.notifications.warn("未选择玩家，已忽略。");
                    }

                    const selectedNpcId = targetNPCs.length > 1
                        ? html.find("#intercept-npc-select").val()
                        : targetNPCs[0].id;
                    const finalNPC  = targetNPCs.find(n => n.id === selectedNpcId);
                    const finalData = npcDataMap[selectedNpcId];

                    // 向玩家发送互动卡片
                    const chatContent = `
                    <div style="background:#111; border:1px solid #444; padding:10px;
                         border-radius:5px; text-align:center;">
                        <img src="${finalData.img}"
                            style="width:60px; height:60px; border-radius:4px; margin-bottom:5px;
                                   object-fit:contain; background:rgba(0,0,0,0.6); border:1px solid #555;">
                        <h3 style="margin-top:0; color:#3498db;">${finalData.name}</h3>
                        <p style="font-size:0.95em; color:#e67e22;
                           font-style:italic; margin-bottom:12px;">
                            「 ${finalData.text} 」</p>
                        <button class="open-pc-panel-btn" data-npcid="${finalNPC.id}"
                            style="background:#27ae60; color:white; border:none; padding:8px;
                                   border-radius:3px; cursor:pointer; width:100%; font-weight:bold;">
                            <i class="fas fa-hand-paper"></i> 上前交谈
                        </button>
                    </div>`;

                    ChatMessage.create({
                        speaker: { alias: "系统提示" },
                        content: chatContent,
                        whisper: selectedUserIds
                    });

                    // 同时给DM打开管理面板
                    NpcRepApi.openDMPanel(finalNPC.id);
                }
            },
            cancel: { label: "无视" }
        },
        close: () => activeDialogLock.delete(lockKey),
        render: (html) => {
            // 多NPC切换时更新预览
            if (targetNPCs.length > 1) {
                html.find("#intercept-npc-select").change(function () {
                    const d = npcDataMap[$(this).val()];
                    html.find("#prev-img").attr("src", d.img);
                    html.find("#prev-name").text(d.name);
                    html.find("#prev-text").text(`「 ${d.text} 」`);
                });
            }
            html.find(".sel-all-btn").click(
                () => html.find(".target-user-cb").prop("checked", true)
            );
            html.find(".sel-none-btn").click(
                () => html.find(".target-user-cb").prop("checked", false)
            );
            html.find(".p-btn").click(function () {
                const uArr = JSON.parse($(this).attr("data-users"));
                html.find(".target-user-cb").prop("checked", false);
                html.find(".target-user-cb").each(function () {
                    if (uArr.includes($(this).val())) $(this).prop("checked", true);
                });
            });
        }
    }, { width: 440, resizable: true }).render(true);
}