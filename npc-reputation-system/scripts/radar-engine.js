/**
 * radar-engine.js
 * 替代原宏3的雷达探测与区域触发逻辑。
 *
 * 主要变化：
 *   - 原宏3需要DM手动点击开关，现在由 entry.js 根据设置项自动控制
 *   - 原宏3的"测试入口"弹窗不再需要，DM在模组设置里直接勾选
 *   - showInterceptPanel 拆分到 ui-intercept-panel.js
 *   - 所有设置读取改为从 game.settings 获取，不再每次读 Journal
 */

import { getRepData, getAllNPCs } from "./data-manager.js";
import { showInterceptPanel }    from "./ui/ui-intercept-panel.js";
import { NpcRepApi }             from "./api.js";

const MODULE_ID = "npc-reputation-system";

// ─── 模块内部状态 ─────────────────────────────────────────────
let _proximityHookId  = null;   // updateToken 钩子的返回 id
let _triggerHopper    = {};     // { tokenId → Map<npcId, npcObj> }
let _triggerCooldown  = {};     // { cdKey → timestamp }
let _activeDialogLock = new Set();

// 供外部（intercept-panel）使用的锁
export const activeDialogLock = _activeDialogLock;

// ─── 隐藏 GM 拦截消息（玩家端不可见）────────────────────────
let _hideWhisperHookId = null;
function _registerHideHook() {
    if (_hideWhisperHookId) Hooks.off("renderChatMessage", _hideWhisperHookId);
    _hideWhisperHookId = Hooks.on("renderChatMessage", (msg, html) => {
        if (!game.user.isGM && msg.getFlag("world", "isInterceptMsg")) {
            html.hide();
        }
    });
}

// ─── 读取当前生效的引擎参数 ───────────────────────────────────
function _getSettings() {
    return {
        mode:         game.settings.get(MODULE_ID, "triggerMode"),
        distance:     game.settings.get(MODULE_ID, "proximityDistance"),
        radarCooldown:game.settings.get(MODULE_ID, "radarCooldown"),
        clumpRadius:  game.settings.get(MODULE_ID, "clumpRadius"),
        hopperDelay:  game.settings.get(MODULE_ID, "hopperDelay"),
        fullData:     getRepData()
    };
}

// ─── 触发漏斗（Hopper）────────────────────────────────────────

function _queueNpcTrigger(triggerToken, targetNPC) {
    const key     = triggerToken.id;
    const delay   = _getSettings().hopperDelay;

    if (!_triggerHopper[key]) {
        _triggerHopper[key] = new Map();
        setTimeout(() => _processHopper(triggerToken), delay);
    }
    _triggerHopper[key].set(targetNPC.id, targetNPC);
}

function _processHopper(triggerToken) {
    const npcMap = _triggerHopper[triggerToken.id];
    delete _triggerHopper[triggerToken.id];
    if (!npcMap || npcMap.size === 0) return;

    const allTriggered = Array.from(npcMap.values());
    const sys          = _getSettings();
    const gridPx       = canvas.grid.size;

    // ── 按派系分组 ──────────────────────────────────────────
    const factionGroups = {};
    allTriggered.forEach(npc => {
        let fId = "ind";
        for (const id of (sys.fullData.factionOrder || Object.keys(sys.fullData.factions))) {
            if (id.startsWith("-=")) continue;
            const faction = sys.fullData.factions[id];
            if (faction?.members?.some(m => m.id === npc.id)) { fId = id; break; }
        }
        // 独立NPC每个单独成组
        if (fId === "ind") fId = "ind_" + npc.id;
        factionGroups[fId] ??= [];
        factionGroups[fId].push(npc);
    });

    // ── 扎堆合并 ────────────────────────────────────────────
    const finalClusters = [];
    for (const [fId, members] of Object.entries(factionGroups)) {
        if (fId.startsWith("ind_") || sys.clumpRadius <= 0) {
            members.forEach(m => finalClusters.push({ rawFid: fId, npcs: [m] }));
            continue;
        }
        const pool = [...members];
        while (pool.length > 0) {
            const seed    = pool.shift();
            const cluster = [seed];
            let added     = true;
            while (added) {
                added = false;
                for (let i = pool.length - 1; i >= 0; i--) {
                    const candidate = pool[i];
                    const t1 = canvas.tokens.placeables.find(t => t.actor?.id === seed.actorId);
                    const t2 = canvas.tokens.placeables.find(t => t.actor?.id === candidate.actorId);
                    const inRange = (() => {
                        if (!t1 || !t2) return true; // 找不到token则保守合并
                        const dx = Math.abs(t1.x - t2.x) / gridPx;
                        const dy = Math.abs(t1.y - t2.y) / gridPx;
                        return Math.max(dx, dy) <= sys.clumpRadius;
                    })();
                    if (inRange) {
                        cluster.push(candidate);
                        pool.splice(i, 1);
                        added = true;
                    }
                }
            }
            finalClusters.push({ rawFid: fId, npcs: cluster });
        }
    }

    // ── 冷却检查并派发 ──────────────────────────────────────
    const cdMs = (sys.radarCooldown || 20) * 1000;
    finalClusters.forEach(cluster => {
        cluster.npcs.sort((a, b) => (b.weight || 0) - (a.weight || 0));
        const repId = cluster.npcs[0].id;
        const cdKey = `${triggerToken.id}_cluster_${repId}`;
        if ((_triggerCooldown[cdKey] ?? 0) > Date.now()) return;
        _triggerCooldown[cdKey] = Date.now() + cdMs;
        _dispatchGroupInteraction(triggerToken, cluster.npcs, sys, cluster.rawFid);
    });
}

// ─── 派发互动 ─────────────────────────────────────────────────

function _dispatchGroupInteraction(triggerToken, targetNPCs, sys, rawFid) {
    const mainNPC = targetNPCs[0];

    // 模式1：双端各自弹窗（经典模式）
    if (sys.mode === 1) {
        if (game.user.isGM) {
            new Dialog({
                title:   `区域触发: ${mainNPC.name}${targetNPCs.length > 1 ? " 等" : ""}`,
                content: `<div style="padding:10px; font-size:1.1em; background:#111; color:#eee; border-radius:4px; border:1px solid #444;">
                    <p>玩家 <b>${triggerToken.name}</b> 触发了 <b>${mainNPC.name}</b>
                    ${targetNPCs.length > 1 ? `及附近 ${targetNPCs.length - 1} 名同派系NPC` : ""}。</p>
                    <p style="color:#aaa; font-size:0.9em;">是否打开该NPC的DM管理面板？</p></div>`,
                buttons: {
                    yes: { label: "打开管理面板", icon: '<i class="fas fa-cogs"></i>',
                           callback: () => NpcRepApi.openDMPanel(mainNPC.id) },
                    no:  { label: "忽略" }
                },
                default: "yes"
            }).render(true);
        } else if (triggerToken.isOwner) {
            _showPlayerEncounterDialog(mainNPC, triggerToken);
        }
        return;
    }

    // 模式2/3：DM拦截模式
    if (game.user.isGM) {
        showInterceptPanel(targetNPCs, triggerToken, sys, rawFid);
    } else {
        _sendInterceptRequestToGM(targetNPCs, triggerToken, rawFid);
    }
}

/** 玩家端遭遇弹窗（模式1专用） */
function _showPlayerEncounterDialog(npc, triggerToken) {
    const effAff  = npc.affection || 0;
    const phrase  = (npc.phrases || [])
        .slice()
        .sort((a, b) => b.minAff - a.minAff)
        .find(p => effAff >= p.minAff);
    let chatText  = phrase?.text ?? "对方似乎有话对你们说...";
    chatText = chatText.replace(/这个NPC/g, npc.name).replace(/{name}/gi, npc.name);

    new Dialog({
        title:   `遇到 NPC: ${npc.name}`,
        content: `<div style="padding:10px; font-size:1.1em; text-align:center;
                    background:#111; color:#eee; border-radius:4px; border:1px solid #444;">
            <img src="${npc.img}" style="width:80px; height:80px; border-radius:50%;
                 border:2px solid #555; margin-bottom:10px; object-fit:cover;">
            <p>你遇到了 <b>${npc.name}</b>
               <span style="font-size:0.8em; color:#f1c40f;">(${npc.title || "平民"})</span>。</p>
            <p style="color:#e67e22; font-style:italic; font-size:0.9em;">「 ${chatText} 」</p>
        </div>`,
        buttons: {
            yes: { label: "查看任务板", icon: '<i class="fas fa-clipboard-list"></i>',
                   callback: () => NpcRepApi.openPlayerPanel(npc.id) },
            no:  { label: "离开" }
        },
        default: "yes"
    }).render(true);
}

/** 玩家端向GM发送拦截请求（模式2/3） */
function _sendInterceptRequestToGM(targetNPCs, triggerToken, rawFid) {
    const gmUsers = game.users.filter(u => u.isGM && u.active).map(u => u.id);
    if (gmUsers.length === 0) return;

    const npcIdsStr  = targetNPCs.map(n => n.id).join(",");
    const clumpText  = targetNPCs.length > 1
        ? `<span style="color:#2ecc71; font-weight:bold;"> (及同派系扎堆 ${targetNPCs.length - 1} 人)</span>`
        : "";

    const chatContent = `
    <div style="background:#1a1a1a; padding:10px; border-radius:5px;
                border:1px solid #444; border-left:4px solid #e67e22;">
        <h3 style="color:#e67e22; margin-top:0; font-size:1.1em;">
            <i class="fas fa-satellite-dish"></i> 互动拦截请求</h3>
        <p style="color:#eee; font-size:0.95em;">
            玩家 <b>${triggerToken.name}</b> 遇到了 <b>${targetNPCs[0].name}</b>${clumpText}。</p>
        <p style="font-size:0.8em; color:#777; margin-top:4px;">
            [底层判定: ${rawFid.startsWith("ind") ? "独立NPC" : "派系成员"}]</p>
        <button class="gm-intercept-btn"
            data-npcids="${npcIdsStr}"
            data-tokenid="${triggerToken.id}"
            data-rawfid="${rawFid}"
            style="background:#2980b9; color:#fff; border:none; padding:6px;
                   width:100%; border-radius:3px; cursor:pointer; font-weight:bold;">
            <i class="fas fa-tasks"></i> 审批 (${targetNPCs.length}人事件)
        </button>
    </div>`;

    ChatMessage.create({
        speaker: { alias: "系统提示" },
        content: chatContent,
        whisper: gmUsers,
        flags:   { world: { isInterceptMsg: true } }
    });
}

// ─── GM 端：点击聊天里的"审批"按钮 ──────────────────────────
// 事件委托绑在 document 上，由 initRadarEngine 注册
function _bindGMInterceptButton() {
    $(document).off("click", ".gm-intercept-btn");
    $(document).on("click",  ".gm-intercept-btn", async function (e) {
        e.preventDefault();
        const npcIdsStr = String($(this).data("npcids"));
        const tId       = $(this).data("tokenid");
        const rawFid    = $(this).data("rawfid") || "未知";
        const tDoc      = canvas.tokens.get(tId)?.document
                          ?? { actor: { id: null }, name: "未知角色" };

        const sys      = _getSettings();
        const allNpcs  = getAllNPCs(sys.fullData);
        const targetNPCs = npcIdsStr.split(",")
            .map(id => allNpcs.find(x => x.id === id))
            .filter(Boolean);

        if (targetNPCs.length > 0) {
            showInterceptPanel(targetNPCs, tDoc, sys, rawFid);
            const msgId = $(this).closest(".message").data("messageId");
            if (msgId) game.messages.get(msgId)?.delete();
        }
    });
}

// ─── 公开的启动 / 关闭接口 ───────────────────────────────────

export function initRadarEngine() {
    if (_proximityHookId) return; // 已经在运行，防止重复

    const sys = _getSettings();
    if (sys.mode === 1) {
        console.log(`[${MODULE_ID}] 当前为模式1，雷达不启动。`);
        return;
    }

    _registerHideHook();
    _bindGMInterceptButton();

    const delay = sys.hopperDelay;
    const debouncedRadar = foundry.utils.debounce((tokenDoc) => {
        if (!game.user.isGM) return;
        const currentSys = _getSettings();
        if (!currentSys || currentSys.mode === 1) return;

        const allNpcs = getAllNPCs(currentSys.fullData);
        const gridPx  = canvas.grid.size;

        canvas.tokens.placeables.forEach(t => {
            const npcMatch = allNpcs.find(n => n.actorId === t.actor?.id);
            if (!npcMatch) return;
            const dx = Math.abs(tokenDoc.x - t.x) / gridPx;
            const dy = Math.abs(tokenDoc.y - t.y) / gridPx;
            if (Math.max(dx, dy) <= currentSys.distance) {
                _queueNpcTrigger(tokenDoc, npcMatch);
            }
        });
    }, delay);

    _proximityHookId = Hooks.on("updateToken", (tokenDoc, change) => {
        if (!game.user.isGM) return;
        if (change.x === undefined && change.y === undefined) return;
        if (!tokenDoc.hasPlayerOwner) return;
        debouncedRadar(tokenDoc);
    });

    ui.notifications.success(
        `[NPC声望系统] 雷达已启动（距离:${sys.distance}格 | 冷却:${sys.radarCooldown}s）`
    );
    console.log(`[${MODULE_ID}] 雷达引擎已启动，Hook ID: ${_proximityHookId}`);
}

export function shutdownRadarEngine() {
    if (!_proximityHookId) return;
    Hooks.off("updateToken", _proximityHookId);
    _proximityHookId = null;
    _triggerHopper   = {};
    ui.notifications.info("[NPC声望系统] 雷达已关闭。");
    console.log(`[${MODULE_ID}] 雷达引擎已关闭。`);
}