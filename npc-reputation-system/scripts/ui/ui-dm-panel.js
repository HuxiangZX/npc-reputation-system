/**
 * ui-dm-panel.js
 * DM 主面板：声望管理 + 任务板（对应原宏2）
 * 阶段编辑逻辑委托给 ui-quest-editor.js
 * 联动设置委托给 ui-linkage-settings.js
 */

import {
    getRepData, saveRepData,
    getOrCreateQuestJournal, getQuests, saveQuests,
    findNPCById, getAllNPCs
} from "../data-manager.js";
import {
    getWorldTimeString, getDaysDiff,
    calcAffectionUI, getFloatingGold, parseItemsWithQuantity
} from "../utils.js";
import { openLinkageSettings } from "./ui-linkage-settings.js";
import {
    buildQuestEditorHTML, bindQuestEditorEvents,
    fillForm, getCurrentFormData, renderPhases, renderTargetTags
} from "./ui-quest-editor.js";
import { propagateFactionLinkage } from "../reputation-linkage.js";

// 记录当前打开的面板实例（供 npc-receiver.js 调用 refreshBoard）
globalThis.npcActivePanels = globalThis.npcActivePanels || {};

// ─── 主入口 ───────────────────────────────────────────────────

export async function openDMPanel(npcId, options = {}) {
    const repJournal   = getRepData.__journal ?? (() => {
        const j = game.journal.getName("NPC_Reputation_Database");
        return j;
    })();

    const repData      = getRepData();
    const questsData   = await getQuests();
    const questJournal = await getOrCreateQuestJournal();

    const { npc: targetNPC, factionId: targetFactionId, factionName: targetFactionName } =
        findNPCById(repData, npcId);
    if (!targetNPC) return ui.notifications.error("未在系统中找到该 NPC。");

    // 补全字段
    targetNPC.history        ??= [];
    targetNPC.playerAffection ??= {};
    targetNPC.phrases        ??= [{
        minAff: -100,
        text:   "你们遇到了这个NPC，对方似乎有话对你们说..."
    }];
    targetNPC.repLink        ??= {
        mode: 1, mult: 1.0, ignores: {}, rules: [{ min: 0, max: 1, mult: 1.0 }]
    };

    const allNpcsRaw     = getAllNPCs(repData);
    const goldScaling    = repData.goldScaling;
    const systemPresets  = repData.settings?.rewardPresets ?? [];

    // 同派系成员（不含自身）
    const factionMembers = targetFactionId === "ind"
        ? []
        : (repData.factions[targetFactionId]?.members ?? [])
              .filter(m => m.id !== targetNPC.id);

    // 待发薪任务
    const pendingSalaries = questsData.filter(q =>
        q.isPeriodic && q.status === "active" &&
        q.lastPayTime && getDaysDiff(q.lastPayTime) >= (q.periodDays || 7)
    );

    // ── quick_accept / quick_complete 快捷操作 ────────────────
    if (options.action === "quick_accept") {
        const q = questsData.find(x => x.id === options.qid);
        if (q && q.status === "avail") {
            q.status     = "active";
            q.timeAccept = getWorldTimeString();
            await saveQuests(questsData);
            await _syncJournalForNPC(npcId, targetNPC, repData, questsData, allNpcsRaw, targetFactionName);
            if (q.npcId !== npcId)
                await _syncJournalForNPC(q.npcId, allNpcsRaw.find(n => n.id === q.npcId),
                    repData, questsData, allNpcsRaw, "");
            ui.notifications.success("已批准任务接取！");
            globalThis.npcActivePanels[npcId]?.refreshBoard?.();
        }
        return;
    }

    // ── 构建分配目标选项 ──────────────────────────────────────
    const pcActors    = game.actors.filter(a => a.type === "character");
    const partyActors = game.actors.filter(a =>
        a.type === "party" || a.type === "group" ||
        a.name === "组"   || a.name === "Party"
    );
    const pcOptsHtml    = pcActors.map(a =>
        `<option value="${a.id}">👤 ${a.name}</option>`).join("");
    const partyOptHtml  = partyActors.map(p =>
        `<option value="${p.id}" style="color:#2ecc71; font-weight:bold;">👥 ${p.name}</option>`
    ).join("");
    const targetOptions = partyOptHtml +
        `<option value="ALL" style="font-weight:bold; color:#3498db;">全体玩家分别发放</option>` +
        pcOptsHtml;

    // ── 派系内共享Checkbox HTML ───────────────────────────────
    const shareCbsHtml = factionMembers.length > 0
        ? factionMembers.map(m =>
            `<label style="display:flex; align-items:center; background:#111;
                 padding:4px 8px; border-radius:3px; border:1px solid #444;
                 cursor:pointer; margin:0; color:#eee; font-size:0.95em;">
                <input type="checkbox" class="share-cb" value="${m.id}"
                    style="width:16px; height:16px; margin:0 6px 0 0;
                           -webkit-appearance:checkbox; appearance:checkbox;">
                ${m.name}
             </label>`
        ).join("")
        : `<span style="color:#777; font-style:italic;">该NPC没有同派系成员可共享。</span>`;

    // ── 初始声望 UI ───────────────────────────────────────────
    const initAffUI = calcAffectionUI(targetNPC.affection || 0);

    // ── 构建主面板 HTML ───────────────────────────────────────
    const paydayAlertHtml = (() => {
        if (pendingSalaries.length === 0) return "";
        const details = pendingSalaries.map(pq => {
            const pNpc = allNpcsRaw.find(n => n.id === pq.npcId)?.name || "未知";
            return `[${pNpc}] 的 ${pq.name}`;
        }).join("，");
        return `<div class="payday-alert">
            <i class="fas fa-bullhorn"></i> 发薪提醒：${details}
        </div>`;
    })();

    const app = new Dialog({
        title:   `管理面板: ${targetNPC.name}`,
        content: `
        <div class="npc-panel">
            <div id="payday-alert-container">${paydayAlertHtml}</div>

            <!-- 头部名片 -->
            <div class="header-card">
                <img src="${targetNPC.img}" class="npc-avatar act-open-sheet"
                     title="点击查看角色卡">
                <div class="npc-info">
                    <div class="npc-name">${targetNPC.name}</div>
                    <div class="npc-tags">
                        <span class="tag faction act-edit-faction" title="点击更改派系">
                            ${targetFactionName}
                        </span>
                        <span class="tag job act-edit-job" title="点击更改职位">
                            ${targetNPC.title} (权重:${targetNPC.weight ?? 2})
                        </span>
                    </div>
                </div>
            </div>

            <!-- 声望区块 -->
            <div class="aff-section">
                <!-- 视角选择器 -->
                <div style="display:flex; align-items:center; gap:10px; margin-bottom:12px;
                     background:rgba(0,0,0,0.3); padding:8px 12px; border-radius:6px;
                     border:1px solid #444;">
                    <label style="color:#3498db; font-weight:bold; white-space:nowrap;">
                        <i class="fas fa-eye"></i> 当前视角:
                    </label>
                    <select id="aff-target-select"
                        style="width:200px; background:#1a1a1a; color:#fff;
                               border:1px solid #555; padding:0 8px; height:32px; border-radius:4px;">
                        <option value="global">🌍 全局声望 (Global)</option>
                        ${partyOptHtml}${pcOptsHtml}
                    </select>
                    <div style="flex:1;"></div>
                    <button type="button" class="q-btn act-backup-sys"
                        style="flex:none; width:32px; height:32px; padding:0; margin:0;
                               background:#2c3e50; border-color:#34495e; border-radius:4px;"
                        title="NPC个体备份与还原">
                        <i class="fas fa-hdd"></i>
                    </button>
                </div>

                <!-- 声望值显示 -->
                <div class="aff-title">
                    <span>
                        <i class="fas fa-heart" id="ui-aff-icon"
                           style="color:${initAffUI.color}"></i>
                        当前声望:
                        <span id="ui-aff-val"
                              style="color:${initAffUI.color}; font-size:1.2em; margin-left:5px;">
                            ${targetNPC.affection || 0}
                        </span>
                    </span>
                    <div style="display:flex; gap:6px;">
                        <button type="button" class="q-btn act-view-history"
                            style="width:auto; min-width:90px; padding:0 8px; height:28px;
                                   margin:0; background:#444; border-color:#555; white-space:nowrap;">
                            <i class="fas fa-history"></i> 声望变动
                        </button>
                        <button type="button" class="q-btn act-clear-history"
                            style="width:28px; height:28px; padding:0; margin:0;
                                   background:#c0392b; border-color:#e74c3c;"
                            title="清空历史记录">
                            <i class="fas fa-trash-alt"></i>
                        </button>
                    </div>
                </div>

                <!-- 声望进度条 -->
                <div class="aff-bar-bg" style="margin-bottom:12px;">
                    <div class="aff-zero-line"></div>
                    <div id="ui-aff-bar" class="aff-bar-fill"
                         style="width:${initAffUI.percent}%; background:${initAffUI.color};"></div>
                </div>

                <!-- 联动/迁移 -->
                <div style="display:flex; gap:10px; margin-bottom:5px;">
                    <button type="button" class="q-btn act-faction-settings"
                        style="width:110px; height:30px; padding:0; margin:0;
                               background:#8e44ad; border-color:#9b59b6;">
                        <i class="fas fa-project-diagram"></i> 联动设置
                    </button>
                    <button type="button" class="q-btn act-transfer-aff"
                        style="width:110px; height:30px; padding:0; margin:0;
                               background:#e67e22; border-color:#d35400;">
                        <i class="fas fa-exchange-alt"></i> 迁移/复制
                    </button>
                </div>

                <!-- 手动修改声望 -->
                <div style="margin-top:15px; padding:8px; background:#111;
                     border:1px dashed #555; border-radius:4px;">
                    <div style="display:flex; gap:10px; align-items:center; margin-bottom:8px;">
                        <label class="edit-q-cb-wrap"
                            style="color:#f1c40f; font-weight:bold; margin:0;">
                            <input type="checkbox" id="apply-all-pcs"
                                style="transform:scale(1.2);">
                            应用到所有独立玩家（单次）
                        </label>
                    </div>
                    <div style="display:flex; gap:5px; align-items:center;">
                        <input type="number" id="custom-aff-change" placeholder="数值"
                            style="width:70px; height:32px; background:#222; color:#fff;
                                   border:1px solid #444; padding:0 8px;">
                        <button class="q-btn act-custom-add"
                            style="flex:1; background:#27ae60; border-color:#2ecc71;">
                            <i class="fas fa-plus"></i> 增/减
                        </button>
                        <button class="q-btn act-custom-set"
                            style="flex:1; background:#2980b9; border-color:#3498db;">
                            <i class="fas fa-equals"></i> 设定
                        </button>
                    </div>
                </div>

                <!-- 快速按钮 -->
                <div class="impact-btns">
                    <div class="imp-btn pos act-imp" data-val="1">小 <span style="color:#2ecc71">+1</span></div>
                    <div class="imp-btn pos act-imp" data-val="3">中 <span style="color:#2ecc71">+3</span></div>
                    <div class="imp-btn pos act-imp" data-val="5">大 <span style="color:#2ecc71">+5</span></div>
                    <div class="imp-btn neg act-imp" data-val="-2">小 <span style="color:#e74c3c">-2</span></div>
                    <div class="imp-btn neg act-imp" data-val="-6">中 <span style="color:#e74c3c">-6</span></div>
                    <div class="imp-btn neg act-imp" data-val="-10">大 <span style="color:#e74c3c">-10</span></div>
                </div>
            </div>

            <!-- 标签页 -->
            <div class="tab-nav">
                <div class="tab-btn active" data-tab="board">
                    <i class="fas fa-clipboard-list"></i> 任务板
                </div>
                <div class="tab-btn" data-tab="edit">
                    <i class="fas fa-plus-circle"></i> 添加/编辑/复制
                </div>
                <div class="tab-btn" data-tab="phrases">
                    <i class="fas fa-comment-dots"></i> 互动语录
                </div>
            </div>

            <div class="tab-content active" id="tab-board">
                <div id="board-container"></div>
            </div>

            <div class="tab-content" id="tab-edit">
                ${buildQuestEditorHTML(systemPresets, factionMembers, targetOptions, shareCbsHtml)}
            </div>

            <div class="tab-content" id="tab-phrases">
                <div id="phrases-container"></div>
                <button class="q-btn accept" id="add-phrase-btn"
                    style="width:100%; margin-top:10px; height:36px;">
                    <i class="fas fa-plus"></i> 添加新阶段语录
                </button>
            </div>
        </div>`,
        buttons: {},
        close:   () => { delete globalThis.npcActivePanels[npcId]; },
        render:  (html) => _bindDMPanelEvents(html, {
            npcId, targetNPC, targetFactionId, targetFactionName,
            factionMembers, allNpcsRaw, repData, questsData,
            goldScaling, systemPresets, questJournal, app
        })
    }, { width: 550, height: "auto", resizable: true,
         left: window.innerWidth - 570, top: 20 });

    app.render(true);
}

// ─── 事件绑定主函数 ───────────────────────────────────────────

function _bindDMPanelEvents(html, ctx) {
    const {
        npcId, targetNPC, targetFactionId, targetFactionName,
        factionMembers, allNpcsRaw, repData, questsData,
        goldScaling, systemPresets, questJournal, app
    } = ctx;

    let currentAffTarget = "global";

    const getCurrentAff = () =>
        currentAffTarget === "global"
            ? (targetNPC.affection || 0)
            : (targetNPC.playerAffection[currentAffTarget]?.affection || 0);

    const getCurrentHistory = () =>
        currentAffTarget === "global"
            ? (targetNPC.history || [])
            : (targetNPC.playerAffection[currentAffTarget]?.history || []);

    // ── 声望 UI 刷新 ──────────────────────────────────────────
    const updateAffectionUI = (newVal) => {
        const uiData = calcAffectionUI(newVal);
        html.find("#ui-aff-val").text(newVal).css("color", uiData.color);
        html.find("#ui-aff-icon").css("color", uiData.color);
        html.find("#ui-aff-bar").css({
            width:      `${uiData.percent}%`,
            background: uiData.color
        });
        html.find("#board-container").html(
            _generateQuestBoardHtml(getCurrentAff(), npcId, allNpcsRaw,
                questsData, goldScaling)
        );
        _bindBoardEvents(html, ctx, updateAffectionUI);
    };

    // 注册全局面板引用（供 quick_accept 等操作刷新用）
    globalThis.npcActivePanels[npcId] = {
        refreshBoard: () => {
            html.find("#board-container").html(
                _generateQuestBoardHtml(getCurrentAff(), npcId, allNpcsRaw,
                    questsData, goldScaling)
            );
            _bindBoardEvents(html, ctx, updateAffectionUI);
        }
    };

    // 初始渲染任务板
    updateAffectionUI(targetNPC.affection || 0);

    // ── 视角切换 ──────────────────────────────────────────────
    html.find("#aff-target-select").change(function () {
        currentAffTarget = $(this).val();
        updateAffectionUI(getCurrentAff());
    });

    // ── 标签页切换 ────────────────────────────────────────────
    html.find(".tab-btn").click(function () {
        html.find(".tab-btn").removeClass("active");
        html.find(".tab-content").removeClass("active");
        $(this).addClass("active");
        html.find(`#tab-${$(this).data("tab")}`).addClass("active");
    });

    // ── 打开角色卡 ────────────────────────────────────────────
    html.on("click", ".act-open-sheet", () => {
        const actor = game.actors.get(targetNPC.actorId) ||
                      game.actors.getName(targetNPC.name);
        if (actor) actor.sheet.render(true);
        else ui.notifications.warn("未找到对应角色卡！");
    });

    // ── 声望历史 ──────────────────────────────────────────────
    html.on("click", ".act-view-history", () => {
        const hist  = getCurrentHistory();
        const hList = hist.slice().reverse().map(h => `
            <div style="background:#222; border-left:4px solid ${h.change >= 0 ? "#27ae60" : "#c0392b"};
                 padding:10px; margin-bottom:8px; border-radius:0 4px 4px 0;">
                <div style="font-size:0.85em; color:#999; margin-bottom:4px;">${h.date}</div>
                <div style="color:#eee; font-size:1.2em; margin-bottom:4px;">
                    <b>${h.change >= 0 ? "+" : ""}${h.change}</b>
                    <span style="font-size:0.8em; color:#aaa; font-weight:normal;">
                        ( ${h.old} ➜ ${h.new} )
                    </span>
                </div>
                <div style="color:#bbb; font-style:italic; font-size:0.95em;">
                    原因: ${h.reason}
                </div>
            </div>`
        ).join("");

        new Dialog({
            title:   `${currentAffTarget === "global" ? targetNPC.name : game.actors.get(currentAffTarget)?.name} 的声望历史`,
            content: `<div style="padding:10px; max-height:400px; overflow-y:auto; background:#111;">
                ${hList || '<div style="color:#777; text-align:center;">无记录</div>'}
            </div>`,
            buttons: { ok: { label: "关闭" } }
        }).render(true);
    });

    html.on("click", ".act-clear-history", () => {
        new Dialog({
            title:   "清空历史记录",
            content: `确定要清空 <b>${currentAffTarget === "global" ? "全局" : game.actors.get(currentAffTarget)?.name}</b> 的声望记录吗？`,
            buttons: {
                yes: {
                    label: "确认清空", icon: '<i class="fas fa-trash"></i>',
                    callback: async () => {
                        if (currentAffTarget === "global") targetNPC.history = [];
                        else if (targetNPC.playerAffection[currentAffTarget])
                            targetNPC.playerAffection[currentAffTarget].history = [];
                        await saveRepData(repData);
                        ui.notifications.info("已清空");
                    }
                },
                no: { label: "取消" }
            }
        }).render(true);
    });

    // ── 快速声望按钮 ──────────────────────────────────────────
    const promptAffChange = (val, isSetTo = false) => {
        const applyAll   = html.find("#apply-all-pcs").is(":checked");
        const targetName = applyAll
            ? "所有独立玩家"
            : (currentAffTarget === "global"
                ? "全局"
                : game.actors.get(currentAffTarget)?.name);
        new Dialog({
            title:   "修改声望",
            content: `<div style="padding:10px;">
                <p>即将把 <b>${targetName}</b> 的声望
                   ${isSetTo ? "设置为" : (val >= 0 ? "增加" : "减少")}
                   <b>${Math.abs(val)}</b>。</p>
                <input type="text" id="aff-reason"
                    placeholder="输入变动原因（必填或默认）"
                    style="width:100%; height:36px; padding:0 8px;
                           background:#222; color:#fff; border:1px solid #555;">
            </div>`,
            buttons: {
                ok: {
                    label: "确认执行",
                    callback: (h) => _pushAffectionUpdate(
                        val, isSetTo, applyAll,
                        h.find("#aff-reason").val() || (isSetTo ? "DM设定" : "行为影响"),
                        false, null,
                        { targetNPC, targetFactionId, repData, currentAffTarget,
                          allNpcsRaw, updateAffectionUI, html }
                    )
                }
            }
        }).render(true);
    };

    html.on("click", ".act-imp", function () {
        promptAffChange(parseInt($(this).data("val")), false);
    });
    html.on("click", ".act-custom-add", () => {
        const v = parseInt(html.find("#custom-aff-change").val());
        if (!isNaN(v)) promptAffChange(v, false);
    });
    html.on("click", ".act-custom-set", () => {
        const v = parseInt(html.find("#custom-aff-change").val());
        if (!isNaN(v)) promptAffChange(v, true);
    });

    // ── 联动设置 ──────────────────────────────────────────────
    html.on("click", ".act-faction-settings", () => {
        openLinkageSettings(targetNPC, targetFactionId, factionMembers, repData);
    });

    // ── 迁移/复制声望 ─────────────────────────────────────────
    html.on("click", ".act-transfer-aff", () => {
        const optHtml = allNpcsRaw
            .filter(n => n.id !== targetNPC.id)
            .map(n => `<option value="${n.id}">${n.name}</option>`)
            .join("");
        new Dialog({
            title:   "迁移 / 复制声望",
            content: `<div style="padding:10px;">
                <p style="color:#e74c3c;">选择将当前NPC的声望数据应用到另一NPC身上。</p>
                <select id="transfer-target"
                    style="width:100%; height:36px; background:#111; color:#fff;">
                    ${optHtml}
                </select>
            </div>`,
            buttons: {
                doMigrate: {
                    label: "迁移（覆盖原NPC）", icon: '<i class="fas fa-exchange-alt"></i>',
                    callback: async (h) => {
                        const tNpc = allNpcsRaw.find(n => n.id === h.find("#transfer-target").val());
                        if (!tNpc) return;
                        tNpc.affection        = targetNPC.affection;
                        tNpc.history          = [...targetNPC.history];
                        tNpc.playerAffection  = foundry.utils.duplicate(targetNPC.playerAffection);
                        targetNPC.affection   = 0;
                        targetNPC.history     = [];
                        targetNPC.playerAffection = {};
                        await saveRepData(repData);
                        ui.notifications.success("迁移完成！");
                        app.close(); openDMPanel(npcId);
                    }
                },
                doCopy: {
                    label: "复制（保留原数据）", icon: '<i class="fas fa-copy"></i>',
                    callback: async (h) => {
                        const tNpc = allNpcsRaw.find(n => n.id === h.find("#transfer-target").val());
                        if (!tNpc) return;
                        tNpc.affection       = targetNPC.affection;
                        tNpc.history         = [...targetNPC.history];
                        tNpc.playerAffection = foundry.utils.duplicate(targetNPC.playerAffection);
                        await saveRepData(repData);
                        ui.notifications.success("复制完成！");
                    }
                },
                cancel: { label: "取消" }
            }
        }).render(true);
    });

    // ── 互动语录 ──────────────────────────────────────────────
    const renderPhrases = () => {
        targetNPC.phrases.sort((a, b) => b.minAff - a.minAff);
        const pList = targetNPC.phrases.map((p, i) => `
            <div class="phrase-row"
                style="display:flex; gap:5px; margin-bottom:8px; align-items:center;">
                <input type="number" class="p-min" value="${p.minAff}"
                    style="width:60px; height:32px; background:#000; color:#fff;
                           border:1px solid #555; padding:0 8px; box-sizing:border-box;">
                <input type="text" class="p-text" value="${p.text}"
                    style="flex:1; height:32px; background:#000; color:#fff;
                           border:1px solid #555; padding:0 8px; box-sizing:border-box;">
                <button class="q-btn fail p-del" data-idx="${i}"
                    style="flex:0 0 35px; height:32px; padding:0; margin:0;">
                    <i class="fas fa-times"></i>
                </button>
            </div>`
        ).join("");
        html.find("#phrases-container").html(pList);

        html.find(".p-min, .p-text").on("change", async function () {
            const idx = $(this).closest(".phrase-row").find(".p-del").data("idx");
            targetNPC.phrases[idx].minAff =
                parseInt($(this).closest(".phrase-row").find(".p-min").val()) || 0;
            targetNPC.phrases[idx].text =
                $(this).closest(".phrase-row").find(".p-text").val();
            await saveRepData(repData);
        });

        html.find(".p-del").off("click").click(async function () {
            targetNPC.phrases.splice($(this).data("idx"), 1);
            await saveRepData(repData);
            renderPhrases();
        });
    };
    renderPhrases();

    html.find("#add-phrase-btn").click(async () => {
        targetNPC.phrases.push({ minAff: 0, text: "新的互动语录..." });
        await saveRepData(repData);
        renderPhrases();
    });

    // ── NPC个体备份 ───────────────────────────────────────────
    html.on("click", ".act-backup-sys", () =>
        _openNpcBackupPanel(targetNPC, repData, questsData, npcId, app, allNpcsRaw)
    );

    // ── 绑定任务编辑器事件 ────────────────────────────────────
    bindQuestEditorEvents(html, {
        targetNPC, allNpcsRaw, factionMembers, questsData,
        repData, goldScaling,
        getCurrentAff,
        refreshBoard: () => updateAffectionUI(getCurrentAff()),
        syncJournalForNPC: (id) => {
            const npc = allNpcsRaw.find(n => n.id === id);
            if (npc) _syncJournalForNPC(id, npc, repData, questsData, allNpcsRaw, "");
        }
    });

    // ── 保存任务 ──────────────────────────────────────────────
    html.find("#act-save-quest").click(async () => {
        const formData = getCurrentFormData(html);
        if (!formData.name)               return ui.notifications.warn("必须输入任务名");
        if (!formData.targetId)           return ui.notifications.warn("必须至少分配一个目标");
        if (formData.phases.length === 0) return ui.notifications.warn("必须至少保留一个阶段");

        const isNew  = !formData.id;
        const qid    = formData.id || foundry.utils.randomID();
        const ex     = questsData.find(x => x.id === qid);

        const questObj = {
            ...formData,
            id:           qid,
            npcId:        targetNPC.id,
            status:       isNew ? "avail" : (ex?.status || "avail"),
            timeAccept:   ex?.timeAccept   || null,
            timeComplete: ex?.timeComplete || null,
            timeFail:     ex?.timeFail     || null,
            appliedAffection: ex?.appliedAffection || null,
            payHistory:   ex?.payHistory   || [],
            lastPayTime:  ex?.lastPayTime  || null,
            currentPhase: ex?.currentPhase || 0
        };

        if (isNew) questsData.push(questObj);
        else {
            const idx = questsData.findIndex(x => x.id === qid);
            if (idx > -1) questsData[idx] = questObj;
        }

        await saveQuests(questsData);
        ui.notifications.success("任务已存入");
        fillForm(html, null, factionMembers, allNpcsRaw);
        updateAffectionUI(getCurrentAff());
        html.find(".tab-btn[data-tab='board']").click();
    });

    // ── 任务板初始事件绑定 ────────────────────────────────────
    _bindBoardEvents(html, ctx, updateAffectionUI);
}

// ─── 任务板 HTML 生成 ─────────────────────────────────────────

function _generateQuestBoardHtml(currentAff, npcId, allNpcsRaw, questsData, goldScaling) {
    const npcQuests = questsData.filter(q =>
        q.npcId === npcId || (q.sharedWith?.includes(npcId))
    );
    if (npcQuests.length === 0) {
        return `<div style="color:#777; text-align:center; margin-top:20px;">
            该NPC暂无相关任务。
        </div>`;
    }

    return npcQuests.map(q => {
        const cp    = q.currentPhase || 0;
        const phase = (q.phases?.length > cp) ? q.phases[cp] : q;

        const actualGold  = getFloatingGold(phase.goldNum, currentAff, goldScaling, q.useScale !== false);
        const isTooHated  = currentAff <= -41;
        const isLocked    = (!q.ignoreAff && currentAff < q.minAff) || isTooHated;

        const statusMap   = {
            avail:  { color: "#7f8c8d", text: "可接取" },
            active: { color: "#3498db", text: "进行中" },
            done:   { color: "#27ae60", text: "已完成" },
            failed: { color: "#c0392b", text: "已失败" }
        };
        const st = statusMap[q.status] ?? statusMap.avail;

        const isShared    = q.npcId !== npcId;
        const ownerName   = isShared
            ? (allNpcsRaw.find(n => n.id === q.npcId)?.name || "未知发布人")
            : "";
        const sharedBadge = isShared
            ? `<span style="background:#8e44ad; color:#fff; font-size:0.7em;
                    padding:2px 4px; border-radius:3px; margin-left:5px;">
                    🤝 来自: ${ownerName}
               </span>`
            : "";
        const lockedBadge = isLocked
            ? `<span style="color:#e74c3c; font-size:0.75em; border:1px solid #e74c3c;
                    padding:2px 4px; border-radius:4px; margin-left:8px; vertical-align:middle;">
                    <i class="fas fa-exclamation-triangle"></i> 当前声望不足
               </span>`
            : "";

        const displayItems = parseItemsWithQuantity(phase.items).map(i =>
            i.qty > 1 ? `${i.name} <b style="color:#2ecc71">x${i.qty}</b>` : i.name
        ).join(", ") || "无";

        const goldDisplay  = `${phase.goldNum}${q.goldType || "gp"}${
            q.useScale !== false && actualGold !== phase.goldNum
                ? ` <span style="color:#3498db;">(实发: ${actualGold})</span>`
                : ""
        }`;

        const phaseInfo   = (q.phases?.length > 1)
            ? `<div style="color:#3498db; font-size:0.85em; font-weight:bold; margin-bottom:5px;">
                   [进度: 第 ${cp + 1} 阶段 / 共 ${q.phases.length} 阶段]
               </div>`
            : "";

        // 周期发薪按钮区
        let periodicHtml = "";
        if (q.isPeriodic) {
            const period   = q.periodDays || 7;
            const diffDays = q.lastPayTime ? getDaysDiff(q.lastPayTime) : -1;
            if (diffDays === -1) {
                periodicHtml = `<div style="margin-top:8px; border-top:1px dashed #555; padding-top:8px; display:flex; gap:8px; align-items:center;">
                    <span style="color:#e67e22; font-size:0.85em; flex:1;">
                        <i class="fas fa-sync"></i> 每 ${period} 天发薪 |
                        <span style="color:#f1c40f;">等待首次结算定下发薪日</span>
                    </span>
                    <button class="q-btn" disabled style="flex:1.6; background:#444; border-color:#555;">
                        <i class="fas fa-ban"></i> 需先完成首次结算
                    </button></div>`;
            } else if (diffDays >= period) {
                periodicHtml = `<div style="margin-top:8px; border-top:1px dashed #555; padding-top:8px; display:flex; gap:8px; align-items:center;">
                    <span style="color:#e67e22; font-size:0.85em; flex:1;">
                        <i class="fas fa-sync"></i> 每 ${period} 天发薪 |
                        <span style="color:#e74c3c; font-weight:bold;">
                            <i class="fas fa-exclamation-circle"></i> 待发薪
                        </span>
                    </span>
                    <button class="q-btn act-pay-notify" data-qid="${q.id}"
                        style="flex:0.8; background:#8e44ad; border-color:#9b59b6;">
                        <i class="fas fa-bullhorn"></i> 提醒
                    </button>
                    <button class="q-btn act-pay-execute" data-qid="${q.id}"
                        style="flex:0.8; background:#27ae60; border-color:#2ecc71;">
                        <i class="fas fa-hand-holding-usd"></i> 发薪
                    </button></div>`;
            } else {
                periodicHtml = `<div style="margin-top:8px; border-top:1px dashed #555; padding-top:8px; display:flex; gap:8px; align-items:center;">
                    <span style="color:#e67e22; font-size:0.85em; flex:1;">
                        <i class="fas fa-sync"></i> 每 ${period} 天发薪 |
                        <span style="color:#2ecc71;">
                            <i class="fas fa-check-circle"></i> 距下次 ${period - diffDays} 天
                        </span>
                    </span>
                    <button class="q-btn" disabled style="flex:1.6; background:#444; border-color:#555;">
                        <i class="fas fa-ban"></i> 未到发薪日
                    </button></div>`;
            }
        }

        // 操作按钮区
        const actionBtns = (() => {
            const isLastPhase = !q.phases || q.phases.length <= 1 || cp >= q.phases.length - 1;
            if (q.status === "avail") {
                return `<button class="q-btn accept act-accept">
                    <i class="fas fa-share-square"></i> 接取并发放日志
                </button>`;
            }
            if (q.status === "active") {
                if (!q.isPeriodic) {
                    return `
                    <button class="q-btn complete act-complete">
                        <i class="fas fa-check"></i> ${isLastPhase ? "完成任务" : "结算当前阶段"}
                    </button>
                    <button class="q-btn fail act-fail">
                        <i class="fas fa-times"></i> 失败
                    </button>`;
                } else {
                    if (!isLastPhase) {
                        return `
                        <button class="q-btn complete act-complete">
                            <i class="fas fa-check"></i> 结算当前阶段
                        </button>
                        <button class="q-btn fail act-fail">
                            <i class="fas fa-times"></i> 失败
                        </button>`;
                    } else if (!q.lastPayTime) {
                        return `
                        <button class="q-btn complete act-complete">
                            <i class="fas fa-check"></i> 首次结算并启动发薪
                        </button>
                        <button class="q-btn fail act-fail">
                            <i class="fas fa-times"></i> 失败
                        </button>`;
                    } else {
                        return `
                        <button class="q-btn act-finish-periodic"
                            style="background:#8e44ad; border-color:#9b59b6; color:#fff;">
                            <i class="fas fa-flag-checkered"></i> 彻底完结
                        </button>
                        <button class="q-btn fail act-fail">
                            <i class="fas fa-times"></i> 终止合作
                        </button>`;
                    }
                }
            }
            if (q.status === "failed" || q.status === "done") {
                return `<button class="q-btn reset act-reset">
                    <i class="fas fa-redo"></i> 撤销重置
                </button>`;
            }
            return "";
        })();

        return `
        <div class="quest-card ${isShared ? "shared-quest" : ""}"
             style="border-left-color:${st.color}" data-qid="${q.id}">
            <div class="q-head">
                <span>${q.name} ${sharedBadge} ${lockedBadge}</span>
                <div>
                    <span style="font-size:0.8em; padding:2px 6px; background:rgba(0,0,0,0.5);
                          border-radius:4px; margin-right:5px; color:${st.color}">
                        ${st.text}
                    </span>
                    ${!isShared && q.status === "avail"
                        ? `<i class="fas fa-edit act-edit-q" title="编辑任务"
                               style="cursor:pointer; color:#aaa;"></i>`
                        : ""}
                </div>
            </div>
            ${!q.ignoreAff
                ? `<div class="q-req">需求声望: ${q.minAff}</div>`
                : `<div class="q-req" style="color:#2ecc71">无声望门槛</div>`}
            ${phaseInfo}
            <div class="q-desc">${phase.desc}</div>
            <div class="q-rewards">
                <span title="基础报酬: ${phase.goldNum}">
                    <i class="fas fa-coins"></i> ${goldDisplay}
                </span>
                <span><i class="fas fa-box"></i> 物品: ${displayItems}</span>
                <span style="color:#2ecc71">
                    <i class="fas fa-heart"></i> +${phase.posAff}
                </span>
                <span style="color:#e74c3c">
                    <i class="fas fa-heart-broken"></i> -${phase.negAff}
                </span>
                <span style="color:#3498db">
                    <i class="fas fa-user-check"></i> 目标: ${q.targetName || "未指定"}
                </span>
            </div>
            ${periodicHtml}
            <div class="q-actions">
                ${actionBtns}
                ${!isShared
                    ? `<button class="q-btn act-migrate"
                           style="background:#e67e22; border-color:#d35400;" title="迁移给他人">
                           <i class="fas fa-truck-moving"></i>
                       </button>
                       <button class="q-btn act-delete"
                           style="background:#c0392b; border-color:#e74c3c;" title="删除任务">
                           <i class="fas fa-trash"></i>
                       </button>`
                    : ""}
            </div>
        </div>`;
    }).join("");
}

// ─── 任务板事件绑定 ───────────────────────────────────────────

function _bindBoardEvents(html, ctx, updateAffectionUI) {
    const { npcId, targetNPC, targetFactionId, allNpcsRaw,
            repData, questsData, goldScaling, factionMembers } = ctx;

    const getCurrentAff = () => {
        const sel = html.find("#aff-target-select").val() || "global";
        return sel === "global"
            ? (targetNPC.affection || 0)
            : (targetNPC.playerAffection[sel]?.affection || 0);
    };

    // 编辑
    html.find(".act-edit-q").off("click").on("click", function () {
        const q = questsData.find(x => x.id === $(this).closest(".quest-card").data("qid"));
        fillForm(html, q, factionMembers, allNpcsRaw);
    });

    // 删除
    html.find(".act-delete").off("click").on("click", async function () {
        const qid = $(this).closest(".quest-card").data("qid");
        const idx = questsData.findIndex(x => x.id === qid);
        if (idx > -1) questsData.splice(idx, 1);
        await saveQuests(questsData);
        await _syncJournalForNPC(npcId, targetNPC, repData, questsData, allNpcsRaw, "");
        updateAffectionUI(getCurrentAff());
    });

    // 接取
    html.find(".act-accept").off("click").on("click", async function () {
        const q = questsData.find(x => x.id === $(this).closest(".quest-card").data("qid"));
        if (!q) return;
        q.status     = "active";
        q.timeAccept = getWorldTimeString();
        await saveQuests(questsData);
        await _syncJournalForNPC(npcId, targetNPC, repData, questsData, allNpcsRaw, "");
        if (q.npcId !== npcId)
            await _syncJournalForNPC(q.npcId, allNpcsRaw.find(n => n.id === q.npcId),
                repData, questsData, allNpcsRaw, "");
        updateAffectionUI(getCurrentAff());
    });

    // 迁移
    html.find(".act-migrate").off("click").on("click", function () {
        const qid     = $(this).closest(".quest-card").data("qid");
        const optHtml = allNpcsRaw
            .filter(n => n.id !== targetNPC.id)
            .map(n => `<option value="${n.id}">${n.name}</option>`)
            .join("");
        new Dialog({
            title:   "任务迁移（剪切）",
            content: `<div style="padding:10px;">
                <p style="color:#e67e22;">选择将此任务转移给哪位NPC？</p>
                <select id="mig-target"
                    style="width:100%; height:36px; background:#111; color:#fff;">
                    ${optHtml}
                </select>
            </div>`,
            buttons: {
                confirm: {
                    label: "确认迁移", icon: '<i class="fas fa-truck-moving"></i>',
                    callback: async (dh) => {
                        const q = questsData.find(x => x.id === qid);
                        if (!q) return;
                        q.npcId = dh.find("#mig-target").val();
                        await saveQuests(questsData);
                        ui.notifications.success("任务已迁移");
                        ctx.app.close();
                        openDMPanel(npcId);
                    }
                },
                cancel: { label: "取消" }
            }
        }).render(true);
    });

    // 撤销重置
    html.find(".act-reset").off("click").on("click", async function () {
        const q       = questsData.find(x => x.id === $(this).closest(".quest-card").data("qid"));
        if (!q) return;
        if (q.appliedAffection) {
            const isShared  = q.npcId !== targetNPC.id;
            const ownerNPC  = isShared ? allNpcsRaw.find(n => n.id === q.npcId) : null;
            const revSettler = {
                global: -(q.appliedAffection.settler?.global || 0),
                pcs:    Object.fromEntries(
                    Object.entries(q.appliedAffection.settler?.pcs || {})
                          .map(([k, v]) => [k, -v])
                )
            };
            await _applyDetailedAffection(targetNPC, revSettler,
                `撤销结算: ${q.name}`, repData);
            if (isShared && ownerNPC && q.appliedAffection.owner) {
                const revOwner = {
                    global: -(q.appliedAffection.owner.global || 0),
                    pcs:    Object.fromEntries(
                        Object.entries(q.appliedAffection.owner.pcs || {})
                              .map(([k, v]) => [k, -v])
                    )
                };
                await _applyDetailedAffection(ownerNPC, revOwner,
                    `撤销发布记录: ${q.name}`, repData);
            }
            q.appliedAffection = null;
            await saveRepData(repData);
        }
        q.status = "avail"; q.timeAccept = null; q.timeComplete = null;
        q.timeFail = null; q.settlerName = null;
        q.lastPayTime = null; q.payHistory = []; q.currentPhase = 0;
        await saveQuests(questsData);
        await _syncJournalForNPC(npcId, targetNPC, repData, questsData, allNpcsRaw, "");
        if (q.npcId !== npcId)
            await _syncJournalForNPC(q.npcId, allNpcsRaw.find(n => n.id === q.npcId),
                repData, questsData, allNpcsRaw, "");
        updateAffectionUI(getCurrentAff());
    });

    // 完成/失败/周期完结/发薪 — 复用通用结算流程
    html.find(".act-complete, .act-fail, .act-finish-periodic")
        .off("click").on("click", function () {
            const isComplete = !$(this).hasClass("act-fail");
            const isFinishP  = $(this).hasClass("act-finish-periodic");
            const q          = questsData.find(
                x => x.id === $(this).closest(".quest-card").data("qid")
            );
            if (!q) return;
            _promptAndSettle(q, isComplete, isFinishP, ctx, html, updateAffectionUI);
        });

    // 发薪提醒
    html.find(".act-pay-notify").off("click").on("click", function () {
        const q = questsData.find(
            x => x.id === ($(this).data("qid") || $(this).closest(".quest-card").data("qid"))
        );
        if (!q) return;
        const ownerName = allNpcsRaw.find(n => n.id === q.npcId)?.name || "未知NPC";
        ChatMessage.create({
            content: `
            <div style="background:#111; border:2px solid #8e44ad; border-radius:4px;
                 padding:10px; color:#eee; font-family:'Signika',sans-serif;">
                <h3 style="color:#9b59b6; margin-top:0; margin-bottom:8px;
                    border-bottom:1px dashed #555; padding-bottom:5px;">
                    <i class="fas fa-bullhorn"></i> 发薪日到了
                </h3>
                <p style="margin-bottom:5px; font-size:1.1em;">
                    <b>${ownerName}</b> 的任务 <b>【${q.name}】</b> 周期结算已就绪！
                </p>
                <p style="color:#aaa; font-size:0.9em; margin:0;">
                    请相关人员尽快前往交接，领取属于你们的报酬。
                </p>
            </div>`,
            speaker: { alias: "系统播报" }
        });
        ui.notifications.success("已发送公屏提醒！");
    });

    // 执行发薪
    html.find(".act-pay-execute").off("click").on("click", async function () {
        const q = questsData.find(
            x => x.id === ($(this).data("qid") || $(this).closest(".quest-card").data("qid"))
        );
        if (!q) return;
        const cp       = q.currentPhase || 0;
        const phase    = (q.phases?.length > cp) ? q.phases[cp] : q;
        const actors   = _resolveTargetActors(q);
        await _distributeRewards(q, phase, actors, false, getCurrentAff(), goldScaling);
        const nowTime  = getWorldTimeString();
        q.lastPayTime  = nowTime;
        q.payHistory   ??= [];
        q.payHistory.push(nowTime);
        await saveQuests(questsData);
        await _syncJournalForNPC(npcId, targetNPC, repData, questsData, allNpcsRaw, "");
        ui.notifications.success("发薪完毕！");
        updateAffectionUI(getCurrentAff());
    });
}

// ─── 结算弹窗 & 执行 ─────────────────────────────────────────

function _promptAndSettle(q, isComplete, isFinishPeriodic, ctx, html, updateAffectionUI) {
    const { npcId, targetNPC, allNpcsRaw, repData, questsData, goldScaling } = ctx;
    const cp     = q.currentPhase || 0;
    const phase  = (q.phases?.length > cp) ? q.phases[cp] : q;
    const baseVal = isComplete ? (phase.posAff || 0) : -Math.abs(phase.negAff || 0);

    const isShared  = q.npcId !== targetNPC.id;
    const ownerNPC  = isShared ? allNpcsRaw.find(n => n.id === q.npcId) : targetNPC;
    const actors    = _resolveTargetActors(q);

    const buildCol = (title, color, prefix, npcName) => {
        const pcRows = actors.map(a => `
            <div style="display:flex; justify-content:space-between; align-items:center;
                 margin-bottom:8px; background:#111; padding:6px; border-radius:4px;
                 border:1px solid #333;">
                <label style="color:#aaa; margin:0; font-size:0.9em;">
                    <i class="fas fa-user"></i> ${a.name}
                </label>
                <input type="number" class="${prefix}-pc" data-pcid="${a.id}"
                    value="${baseVal}"
                    style="width:60px; height:28px; padding:0; background:#000;
                           color:#fff; border:1px solid #555; text-align:center;">
            </div>`
        ).join("");

        return `
        <div style="flex:1; ${prefix === "owner" && isShared
            ? "border-right:1px dashed #444; padding-right:15px;"
            : ""}">
            <h4 style="color:${color}; margin-top:0; margin-bottom:10px;
                border-bottom:1px solid #333; padding-bottom:5px;">
                ${title}: ${npcName}
            </h4>
            <div style="display:flex; justify-content:space-between; align-items:center;
                 margin-bottom:15px; background:#222; padding:6px; border-radius:4px;
                 border:1px solid #444;">
                <label style="color:#f1c40f; font-weight:bold; font-size:0.9em;">全局声望</label>
                <input type="number" id="${prefix}-global" value="${baseVal}"
                    style="width:60px; height:28px; background:#000; color:#fff;
                           border:1px solid #555; text-align:center; font-weight:bold;">
            </div>
            ${pcRows}
        </div>`;
    };

    new Dialog({
        title:   isComplete
            ? `结算: ${q.name} (阶段 ${cp + 1})`
            : `失败: ${q.name}`,
        content: `
        <div style="padding:15px; background:#1a1a1a; color:#eee;
             font-family:'Signika',sans-serif;">
            <p style="margin-top:0; color:#bbb; font-size:0.95em; margin-bottom:15px;">
                <i class="fas fa-info-circle"></i> 请确认声望变动（0表示无变动）：
            </p>
            <div style="display:flex; gap:15px;">
                ${isShared ? buildCol("A. 发布人", "#9b59b6", "owner", ownerNPC?.name || "未知") : ""}
                ${buildCol(isShared ? "B. 结算人" : "A. 结算对象", "#3498db", "settler", targetNPC.name)}
            </div>
        </div>`,
        buttons: {
            confirm: {
                label: "确认发放", icon: '<i class="fas fa-check-double"></i>',
                callback: async (h) => {
                    const affResults = {
                        settler: {
                            global: parseInt(h.find("#settler-global").val()) || 0,
                            pcs:    {}
                        },
                        owner: isShared ? {
                            global: parseInt(h.find("#owner-global").val()) || 0,
                            pcs:    {}
                        } : null
                    };
                    h.find(".settler-pc").each(function () {
                        affResults.settler.pcs[$(this).data("pcid")] =
                            parseInt($(this).val()) || 0;
                    });
                    if (isShared) {
                        h.find(".owner-pc").each(function () {
                            affResults.owner.pcs[$(this).data("pcid")] =
                                parseInt($(this).val()) || 0;
                        });
                    }

                    // 发放奖励
                    const getCurrentAff = () => targetNPC.affection || 0;
                    await _distributeRewards(
                        q, phase, actors, false, getCurrentAff(), goldScaling
                    );

                    // 应用声望
                    q.appliedAffection = affResults;
                    await _applyDetailedAffection(
                        targetNPC, affResults.settler,
                        `[阶段 ${cp + 1}] ${isComplete ? "结算" : "失败"}: ${q.name}`,
                        repData
                    );
                    if (isShared && ownerNPC) {
                        await _applyDetailedAffection(
                            ownerNPC, affResults.owner,
                            `[阶段 ${cp + 1}] 发布${isComplete ? "结算" : "失败"}: ${q.name}`,
                            repData
                        );
                    }
                    if (isShared) q.settlerName = targetNPC.name;

                    // 更新任务状态
                    if (!isComplete) {
                        q.status  = "failed";
                        q.timeFail = getWorldTimeString();
                    } else if (isFinishPeriodic) {
                        q.status      = "done";
                        q.timeComplete = getWorldTimeString();
                    } else {
                        const isLastPhase = !q.phases ||
                            q.phases.length <= 1 ||
                            cp >= q.phases.length - 1;

                        if (!isLastPhase) {
                            // 多阶段：询问是否推进
                            new Dialog({
                                title:   "推进阶段",
                                content: `<div style="padding:10px; font-size:1.1em;
                                     color:#3498db; text-align:center;">
                                    任务存在多个阶段。<br>
                                    要进入 <b>第 ${cp + 2} 阶段</b> 还是完结？
                                </div>`,
                                buttons: {
                                    next: {
                                        label: "进入下一阶段",
                                        icon:  '<i class="fas fa-forward"></i>',
                                        callback: async () => {
                                            q.currentPhase++;
                                            q.status = "active";
                                            await _finalize(q, repData, questsData,
                                                npcId, targetNPC, allNpcsRaw);
                                            updateAffectionUI(targetNPC.affection || 0);
                                        }
                                    },
                                    end: {
                                        label: q.isPeriodic
                                            ? "停留在此阶段"
                                            : "彻底完结任务",
                                        icon:  '<i class="fas fa-flag-checkered"></i>',
                                        callback: async () => {
                                            if (q.isPeriodic) {
                                                const nowTime    = getWorldTimeString();
                                                q.lastPayTime    = nowTime;
                                                q.payHistory     ??= [];
                                                q.payHistory.push(nowTime);
                                                q.status         = "active";
                                            } else {
                                                q.status      = "done";
                                                q.timeComplete = getWorldTimeString();
                                            }
                                            await _finalize(q, repData, questsData,
                                                npcId, targetNPC, allNpcsRaw);
                                            updateAffectionUI(targetNPC.affection || 0);
                                        }
                                    }
                                }
                            }).render(true);
                            return; // 等待子弹窗回调
                        } else if (q.isPeriodic && !q.lastPayTime) {
                            // 首次结算
                            const nowTime    = getWorldTimeString();
                            q.lastPayTime    = nowTime;
                            q.payHistory     ??= [];
                            q.payHistory.push(nowTime);
                            q.status         = "active";
                        } else if (!q.isPeriodic) {
                            q.status      = "done";
                            q.timeComplete = getWorldTimeString();
                        }
                    }

                    await _finalize(q, repData, questsData, npcId, targetNPC, allNpcsRaw);
                    updateAffectionUI(targetNPC.affection || 0);
                }
            },
            cancel: { label: "取消" }
        },
        default: "confirm"
    }, { width: isShared ? 550 : 350 }).render(true);
}

// ─── 辅助函数 ─────────────────────────────────────────────────

async function _finalize(q, repData, questsData, npcId, targetNPC, allNpcsRaw) {
    await saveRepData(repData);
    await saveQuests(questsData);
    await _syncJournalForNPC(npcId, targetNPC, repData, questsData, allNpcsRaw, "");
    if (q.npcId !== npcId) {
        const ownerNpc = allNpcsRaw.find(n => n.id === q.npcId);
        if (ownerNpc)
            await _syncJournalForNPC(q.npcId, ownerNpc, repData, questsData, allNpcsRaw, "");
    }
}

function _resolveTargetActors(q) {
    const targetIdStr = q.targetId || "ALL";
    if (targetIdStr === "ALL")
        return game.actors.filter(a => a.type === "character");
    return targetIdStr.split(",")
        .map(id => game.actors.get(id))
        .filter(Boolean);
}

async function _distributeRewards(q, phase, targetActors, isMultiPrivate, currentAff, goldScaling) {
    const actualGold  = getFloatingGold(phase.goldNum, currentAff, goldScaling, q.useScale !== false);
    const goldPerActor = (isMultiPrivate && targetActors.length > 0)
        ? Math.floor(actualGold / targetActors.length)
        : actualGold;
    const gType = q.goldType || "gp";

    const parsedItems = parseItemsWithQuantity(phase.items);
    const itemsToCreate = [];
    for (const it of parsedItems) {
        let itemData = null;
        if (it.type === "uuid") {
            const src = await fromUuid(it.uuid);
            if (src) itemData = src.toObject();
        } else {
            const src = game.items.getName(it.name);
            if (src) itemData = src.toObject();
        }
        if (itemData) {
            if (itemData.system?.quantity !== undefined) {
                itemData.system.quantity = it.qty;
                itemsToCreate.push(itemData);
            } else {
                for (let i = 0; i < it.qty; i++)
                    itemsToCreate.push(foundry.utils.duplicate(itemData));
            }
        }
    }

    for (const a of targetActors) {
        if (goldPerActor > 0) {
            const curr = foundry.utils.duplicate(
                a.system.currency || { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 }
            );
            curr[gType] = (curr[gType] || 0) + goldPerActor;
            await a.update({ "system.currency": curr });
        }
        if (!isMultiPrivate && itemsToCreate.length > 0) {
            await Item.create(itemsToCreate, { parent: a });
        }
    }
}

async function _applyDetailedAffection(npcObj, affData, reason, repData) {
    console.log("[测试] _applyDetailedAffection 被调用", npcObj?.name, affData);
    if (!npcObj || !affData) return;
    let changed = false;

    // 找派系
    let factionId = "ind";
    for (const [fid, fData] of Object.entries(repData.factions)) {
        if (fid.startsWith("-=")) continue;
        if (fData?.members?.find(m => m.id === npcObj.id)) {
            factionId = fid;
            break;
        }
    }
    console.log(`[联动调试] NPC:${npcObj.name} 派系:${factionId} affData:`, JSON.stringify(affData));

    // 全局声望
    if (affData.global !== 0) {
        const oldVal = npcObj.affection || 0;
        const newVal = oldVal + affData.global;
        npcObj.affection = newVal;
        npcObj.history ??= [];
        npcObj.history.push({
            date: getWorldTimeString(), old: oldVal, new: newVal,
            change: affData.global, reason
        });
        changed = true;

        await propagateFactionLinkage(npcObj, "global", affData.global, reason, factionId, repData);
    }

    // 玩家个人声望
    for (const [pcid, val] of Object.entries(affData.pcs || {})) {
        if (val !== 0) {
            npcObj.playerAffection       ??= {};
            npcObj.playerAffection[pcid] ??= { affection: 0, history: [] };
            const oldVal = npcObj.playerAffection[pcid].affection || 0;
            const newVal = oldVal + val;
            npcObj.playerAffection[pcid].affection = newVal;
            npcObj.playerAffection[pcid].history.push({
                date: getWorldTimeString(), old: oldVal, new: newVal, change: val, reason
            });
            changed = true;

            await propagateFactionLinkage(npcObj, pcid, val, reason, factionId, repData);
        }
    }

    if (changed) await saveRepData(repData);
}

async function _pushAffectionUpdate(val, isSetTo, applyAllPcs, reason,
    isLinkage, explicitNpc, env) {
    const { targetNPC, targetFactionId, repData, currentAffTarget,
            allNpcsRaw, updateAffectionUI, html } = env;
    const npcObj = explicitNpc || targetNPC;

    const targets = applyAllPcs
        ? ["global", ...game.actors.filter(a =>
            a.type === "character" || a.type.match(/party|group/i)).map(a => a.id)]
        : [currentAffTarget];

    let globalChangeAmt = 0;  // ← 在这里声明，修复 ReferenceError

    for (const tId of [...new Set(targets)]) {
        const oldVal    = tId === "global"
            ? (npcObj.affection || 0)
            : (npcObj.playerAffection?.[tId]?.affection || 0);
        const newVal    = isSetTo ? val : (oldVal + val);
        const changeAmt = newVal - oldVal;
        if (changeAmt === 0) continue;

        const histEntry = {
            date:   getWorldTimeString(),
            old:    oldVal,
            new:    newVal,
            change: changeAmt,
            reason
        };

        if (tId === "global") {
            npcObj.affection = newVal;
            npcObj.history   ??= [];
            npcObj.history.push(histEntry);
            globalChangeAmt = changeAmt;  // ← 记录全局变动量
        } else {
            npcObj.playerAffection       ??= {};
            npcObj.playerAffection[tId]  ??= { affection: 0, history: [] };
            npcObj.playerAffection[tId].affection = newVal;
            npcObj.playerAffection[tId].history.push(histEntry);

            // pcs 也触发联动
            if (!isLinkage) {
                await propagateFactionLinkage(
                    npcObj, tId, changeAmt, reason, targetFactionId ?? "ind", repData
                );
            }
        }
    }

    await saveRepData(repData);

    // 全局联动
    if (globalChangeAmt !== 0 && !isLinkage) {
        await propagateFactionLinkage(
            npcObj, "global", globalChangeAmt, reason, targetFactionId ?? "ind", repData
        );
    }

    if (!explicitNpc) {
        updateAffectionUI(
            currentAffTarget === "global"
                ? (targetNPC.affection || 0)
                : (targetNPC.playerAffection?.[currentAffTarget]?.affection || 0)
        );
        if (applyAllPcs) html.find("#apply-all-pcs").prop("checked", false);
    }
}

// ─── NPC个体备份面板 ──────────────────────────────────────────

function _openNpcBackupPanel(targetNPC, repData, questsData, npcId, app, allNpcsRaw) {
    targetNPC.backups ??= [];

    const renderContent = () => {
        const listHtml = targetNPC.backups.length === 0
            ? '<div style="color:#777; text-align:center; padding:10px;">暂无备份</div>'
            : targetNPC.backups.map((bk, i) => `
                <div style="display:flex; justify-content:space-between; align-items:center;
                     background:#1a1a1a; padding:6px; margin-bottom:6px;
                     border-radius:4px; border:1px solid #444;">
                    <span style="color:#2ecc71; font-weight:bold; font-size:0.9em;">
                        ${bk.timestamp}
                    </span>
                    <div style="display:flex; gap:4px;">
                        <button type="button" class="q-btn btn-prev-bk" data-idx="${i}"
                            style="width:auto; padding:0 8px; height:26px;
                                   background:#3498db; border-color:#2980b9;">预览</button>
                        <button type="button" class="q-btn btn-rest-bk" data-idx="${i}"
                            style="width:auto; padding:0 8px; height:26px;
                                   background:#8e44ad; border-color:#9b59b6;">还原</button>
                        <button type="button" class="q-btn fail btn-del-bk" data-idx="${i}"
                            style="width:26px; height:26px; padding:0;">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>`
            ).join("");

        return `
        <div style="padding:10px; background:#111; color:#eee;">
            <h3 style="color:#f1c40f; margin-top:0; margin-bottom:10px; text-align:center;">
                <i class="fas fa-box-open"></i> ${targetNPC.name} 专属备份
            </h3>
            <p style="color:#aaa; font-size:0.85em; background:#222; padding:8px;
                border-radius:4px; border:1px solid #444; margin-bottom:12px;">
                此操作仅针对 <b>当前NPC</b> 的声望及其任务进行备份与还原。
            </p>
            <button type="button" class="q-btn accept" id="btn-create-bk"
                style="width:100%; height:32px; margin-bottom:10px;">
                <i class="fas fa-plus"></i> 创建该NPC的新备份
            </button>
            <div style="max-height:250px; overflow-y:auto; padding-right:5px;">
                ${listHtml}
            </div>
        </div>`;
    };

    const bd = new Dialog({
        title:   "NPC个体数据备份与还原",
        content: renderContent(),
        buttons: { close: { label: "关闭窗口" } },
        render:  (h) => {
            const refreshD = () => {
                h.find(".dialog-content").html(renderContent());
                bindD(h);
            };
            const bindD = (dh) => {
                dh.find("#btn-create-bk").click(async () => {
                    const npcQs = questsData.filter(q => q.npcId === targetNPC.id);
                    targetNPC.backups.push({
                        id:               foundry.utils.randomID(),
                        timestamp:        getWorldTimeString(),
                        affection:        targetNPC.affection || 0,
                        playerAffection:  foundry.utils.duplicate(targetNPC.playerAffection || {}),
                        quests: foundry.utils.duplicate(npcQs)
                    });
                    await saveRepData(repData);
                    ui.notifications.success(`已为 ${targetNPC.name} 成功创建备份！`);
                    refreshD();
                });

                dh.find(".btn-del-bk").click(async function () {
                    targetNPC.backups.splice($(this).data("idx"), 1);
                    await saveRepData(repData);
                    refreshD();
                });

                dh.find(".btn-prev-bk").click(function () {
                    const bk     = targetNPC.backups[$(this).data("idx")];
                    const pReps  = Object.entries(bk.playerAffection || {}).map(([pid, pData]) => {
                        const pName = game.actors.get(pid)?.name || "未知玩家";
                        return `<div style="display:flex; justify-content:space-between;
                            border-bottom:1px solid #333; padding:2px 0;">
                            <span><i class="fas fa-user"></i> ${pName}</span>
                            <span style="${pData.affection >= 0 ? "color:#2ecc71" : "color:#e74c3c"}">
                                ${pData.affection}
                            </span>
                        </div>`;
                    }).join("");

                    const statusMap = {
                        avail:  '<span style="color:#7f8c8d">可接取</span>',
                        active: '<span style="color:#3498db">进行中</span>',
                        done:   '<span style="color:#27ae60">已完成</span>',
                        failed: '<span style="color:#c0392b">已失败</span>'
                    };
                    const qs = (bk.quests || []).map(q => `
                        <div style="margin-bottom:6px; padding:6px; background:#222;
                             border-radius:3px; font-size:0.9em; border-left:3px solid #555;">
                            <div style="font-weight:bold; color:#e67e22; margin-bottom:4px;">
                                ${q.name}
                            </div>
                            <div style="display:flex; justify-content:space-between; color:#bbb;">
                                <span>状态: ${statusMap[q.status] || q.status}</span>
                                <span>目标: ${q.targetName || "未指定"}</span>
                            </div>
                        </div>`
                    ).join("");

                    new Dialog({
                        title:   `备份详细预览 (${bk.timestamp})`,
                        content: `
                        <div style="padding:10px; max-height:450px; overflow-y:auto;
                             background:#111; color:#eee;">
                            <h4 style="margin:0 0 5px 0; color:#3498db;
                                border-bottom:1px solid #444; padding-bottom:3px;">
                                <i class="fas fa-heart"></i> 声望快照
                            </h4>
                            <div style="display:flex; justify-content:space-between;
                                 border-bottom:1px solid #333; padding:2px 0;">
                                <span>🌍 全局声望 (Global)</span>
                                <span style="font-weight:bold;
                                    ${bk.affection >= 0 ? "color:#2ecc71" : "color:#e74c3c"}">
                                    ${bk.affection}
                                </span>
                            </div>
                            ${pReps}
                            <h4 style="margin:15px 0 5px 0; color:#9b59b6;
                                border-bottom:1px solid #444; padding-bottom:3px;">
                                <i class="fas fa-clipboard-list"></i>
                                任务快照 (${(bk.quests || []).length}项)
                            </h4>
                            ${qs || '<div style="color:#777; font-style:italic;">该备份下无任何任务记录</div>'}
                        </div>`,
                        buttons: { close: { label: "关闭预览" } }
                    }).render(true);
                });

                dh.find(".btn-rest-bk").click(function () {
                    const idx = $(this).data("idx");
                    const bk  = targetNPC.backups[idx];
                    new Dialog({
                        title:   "危险: 还原当前NPC",
                        content: `<p style="color:#e74c3c; font-weight:bold; padding:10px;">
                            警告！这将使用选中的备份数据<br><br>
                            <b>无情覆盖</b> 当前NPC【${targetNPC.name}】
                            的面板声望以及相关的全部任务进度！<br><br>
                            确定要执行还原吗？
                        </p>`,
                        buttons: {
                            yes: {
                                label: "我确定还原",
                                icon:  '<i class="fas fa-exclamation-triangle"></i>',
                                callback: async () => {
                                    targetNPC.affection       = bk.affection;
                                    targetNPC.playerAffection =
                                        foundry.utils.duplicate(bk.playerAffection || {});
                                    await saveRepData(repData);

                                    const filtered  = questsData.filter(
                                        q => q.npcId !== targetNPC.id
                                    );
                                    const restored  = foundry.utils.duplicate(bk.quests || []);
                                    filtered.push(...restored);
                                    await saveQuests(filtered);

                                    await _syncJournalForNPC(
                                        npcId, targetNPC, repData, filtered, allNpcsRaw, ""
                                    );

                                    ui.notifications.success(
                                        "该NPC的数据已还原完成！面板即将刷新。"
                                    );
                                    bd.close();
                                    app.close();
                                    openDMPanel(npcId);
                                }
                            },
                            no: { label: "取消" }
                        },
                        default: "no"
                    }).render(true);
                });
            };
            bindD(h);
        }
    });
    bd.render(true);
}

// ─── 同步世界日志 ─────────────────────────────────────────────

async function _syncJournalForNPC(npcId, npcObj, repData, questsData, allNpcsRaw, factionName) {
    if (!npcObj) return;

    let fName = factionName;
    if (!fName) {
        for (const [fid, fData] of Object.entries(repData.factions)) {
            if (fid.startsWith("-=")) continue;
            if (fData?.members.find(n => n.id === npcId)) {
                fName = fData.name;
                break;
            }
        }
        fName = fName || "独立 NPC";
    }

    const questsFolder = game.folders.find(
        f => f.type === "JournalEntry" &&
             f.name.trim().toLowerCase() === "quests"
    ) ?? await Folder.create({ name: "Quests", type: "JournalEntry" });

    const npcQs = questsData.filter(
        q => q.npcId === npcId && q.status !== "avail"
    );

    const journalGroups  = {};
    const updatedJournalIds = new Set();

    for (const q of npcQs) {
        const targetIdStr = q.targetId || "ALL";
        const isPrivate   = targetIdStr !== "ALL" &&
            !game.actors.get(targetIdStr.split(",")[0])?.type.match(/party|group/i);
        const jName = isPrivate
            ? `私密任务 - ${q.targetName || "玩家"}`
            : (fName === "独立 NPC" ? "独立 NPC" : fName);

        journalGroups[jName] ??= { isPrivate, targetId: targetIdStr, qs: [] };
        journalGroups[jName].qs.push(q);
    }

    for (const [jName, group] of Object.entries(journalGroups)) {
        let journal = game.journal.find(
            j => j.name === jName && j.folder?.id === questsFolder.id
        );

        const ownership = { default: 0 };
        if (group.isPrivate) {
            const tIds = group.targetId.split(",");
            for (const tid of tIds) {
                const tActor = game.actors.get(tid);
                if (tActor) {
                    for (const [uid, lvl] of Object.entries(tActor.ownership)) {
                        if (lvl >= 3 && uid !== "default") ownership[uid] = 3;
                    }
                }
                const fallback = game.users.find(u => u.character?.id === tid);
                if (fallback) ownership[fallback.id] = 3;
            }
        } else {
            ownership.default = 3;
        }

        if (!journal) {
            journal = await JournalEntry.create({
                name:      jName,
                folder:    questsFolder.id,
                ownership: ownership
            });
        } else {
            const newOwn = foundry.utils.duplicate(journal.ownership);
            Object.assign(newOwn, ownership);
            await journal.update({ ownership: newOwn });
        }
        updatedJournalIds.add(journal.id);

        const newContent = group.qs.map(q => {
            const cp    = q.currentPhase || 0;
            const phase = (q.phases?.length > cp) ? q.phases[cp] : q;

            const displayItems = parseItemsWithQuantity(phase.items).map(i =>
                i.qty > 1
                    ? `${i.name} <b style="color:#2ecc71">x${i.qty}</b>`
                    : i.name
            ).join(", ") || "无";

            const goldStr   = phase.goldNum ? `${phase.goldNum}${q.goldType || "gp"}` : "";
            const rewardStr = [goldStr, displayItems].filter(Boolean).join(" | ");

            const titlePrefix  = q.status === "done"
                ? "(已完成) "
                : q.status === "failed" ? "(已失败) " : "";
            const strikeStyle  = (q.status === "done" || q.status === "failed")
                ? "text-decoration:line-through; opacity:0.7;"
                : "";

            const periodicInfo = q.isPeriodic
                ? `<p style="color:#e67e22; font-weight:bold; margin-top:5px;">
                       <i class="fas fa-sync"></i> 发薪周期：每 ${q.periodDays} 天
                   </p>`
                : "";

            const phaseInfo = (q.phases?.length > 1)
                ? `<p style="color:#3498db; font-weight:bold; margin-top:2px;">
                       [当前进度: 第 ${cp + 1} 阶段 / 共 ${q.phases.length} 阶段]
                   </p>`
                : "";

            const settlerInfo = q.settlerName
                ? `<p style="color:#9b59b6; font-size:0.85em; margin-top:4px; font-weight:bold;">
                       <i class="fas fa-handshake"></i> 代为结算: ${q.settlerName}
                   </p>`
                : "";

            const ownerNpc  = allNpcsRaw.find(n => n.id === q.npcId);
            const ownerInfo = (q.npcId !== npcId)
                ? `<p style="color:#3498db; font-size:0.85em; margin-top:4px; font-weight:bold;">
                       <i class="fas fa-user-tag"></i> 发布人: ${ownerNpc?.name || "未知"}
                   </p>`
                : "";

            const timeInfoArr = [];
            if (q.timeAccept)
                timeInfoArr.push(
                    `<span style="color:#7f8c8d; font-style:italic;">▶ 接取: ${q.timeAccept}</span>`
                );
            (q.payHistory || []).forEach((time, index) => {
                const label = index === 0 ? "💰 首次发薪" : `💰 续发(${index + 1})`;
                timeInfoArr.push(
                    `<span style="color:#f39c12; font-style:italic;">${label}: ${time}</span>`
                );
            });
            if (q.status === "done" && q.timeComplete)
                timeInfoArr.push(
                    `<span style="color:#2ecc71; font-style:italic;">✔️ 完成: ${q.timeComplete}</span>`
                );
            if (q.status === "failed" && q.timeFail)
                timeInfoArr.push(
                    `<span style="color:#e74c3c; font-style:italic;">❌ 失败: ${q.timeFail}</span>`
                );
            if (q.timeLimit)
                timeInfoArr.push(
                    `<span style="color:#e67e22; font-style:italic;">⌛ 时限: ${q.timeLimit}</span>`
                );
            const timeHtml = timeInfoArr.length > 0
                ? `<p style="margin-top:8px; font-size:0.9em; margin-bottom:5px;">
                       ${timeInfoArr.join(" &nbsp;&nbsp; ")}
                   </p>`
                : "";

            return `
            <h3>${titlePrefix}${q.name}</h3>
            <div style="${strikeStyle}">
                ${phaseInfo}
                <ul><li>${(phase.desc || "").replace(/\n/g, "</li><li>")}</li></ul>
                <p>预期报酬: ${rewardStr || "无"}</p>
                ${ownerInfo}${settlerInfo}
            </div>
            ${timeHtml}${periodicInfo}
            <hr>`;
        }).join("");

        const page = journal.pages.find(p => p.name === npcObj.name);
        if (!page) {
            await JournalEntryPage.create(
                { name: npcObj.name, text: { content: newContent, format: 1 } },
                { parent: journal }
            );
        } else {
            await page.update({ "text.content": newContent });
        }
    }

    // 清理已无任务的旧页面
    const journalsInFolder = game.journal.filter(
        j => j.folder?.id === questsFolder.id
    );
    for (const j of journalsInFolder) {
        if (updatedJournalIds.has(j.id)) continue;
        const oldPage = j.pages.find(p => p.name === npcObj.name);
        if (oldPage) await oldPage.delete();
    }
}