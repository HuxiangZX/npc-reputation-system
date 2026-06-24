/**
 * entry.js
 */

const MODULE_ID = "npc-reputation-system";

const _openWindows = {
    questFullscreen: null
};

Hooks.once("init", () => {

    game.settings.registerMenu(MODULE_ID, "menuFactionManager", {
        name:       "派系 & NPC 管理",
        label:      "🏛 打开派系管理",
        hint:       "管理派系结构、NPC录入。",
        icon:       "fas fa-sitemap",
        type:       FactionManagerLauncher,
        restricted: true
    });

    game.settings.registerMenu(MODULE_ID, "menuNpcDetail", {
        name:       "NPC 详情管理",
        label:      "👤 打开 NPC 详情",
        hint:       "选中NPC Token后使用快捷键可直接进入；此处点击则弹出选择列表。",
        icon:       "fas fa-user-cog",
        type:       NpcDetailLauncher,
        restricted: true
    });

    // ── 存储用设置项 ───────────────────────────────────────────
    game.settings.register(MODULE_ID, "autoOpenPanel", {
        name:  "自动弹出任务面板",
        hint:  "收到 DM 推送的 NPC 互动请求时，自动打开玩家任务面板。",
        scope: "client", config: true, type: Boolean, default: false
    });

    // ── 快捷键 ─────────────────────────────────────────────────
    game.keybindings.register(MODULE_ID, "openAdminPanel", {
        name:       "[GM] 打开派系管理中枢",
        hint:       "打开派系与 NPC 录入管理面板；已打开则关闭。",
        editable:   [],
        restricted: true,
        onDown:     () => _toggleAdminPanel()
    });

    game.keybindings.register(MODULE_ID, "openDMPanel", {
        name:       "[GM] 打开 NPC DM 管理面板",
        hint:       "选中 Token 直接打开；未选中弹列表；已打开则关闭。",
        editable:   [],
        restricted: true,
        onDown:     () => _toggleDMPanel()
    });

    game.keybindings.register(MODULE_ID, "openPlayerPanel", {
        name:       "查看 NPC 面板",
        hint:       "GM：悬停/选中Token打开全屏锁定到该NPC；无Token则打开全部。玩家：悬停NPC Token打开互动面板。",
        editable:   [],
        restricted: false,
        onDown:     () => _playerOpenPanel()
    });

    console.log(`[${MODULE_ID}] ✅ init 完成`);
});

Hooks.once("ready", async () => {
    const { NpcRepApi }        = await import("./api.js");
    const { initChatListener } = await import("./chat-listener.js");

    // ── 仅 GM：自动创建数据库 Journal ─────────────────────────
    if (game.user.isGM) {
        try {
            const {
                getOrCreateRepJournal,
                getOrCreateQuestJournal
            } = await import("./data-manager.js");

            await getOrCreateRepJournal();
            await getOrCreateQuestJournal();

            console.log(`[${MODULE_ID}] 数据库 Journal 检查完毕。`);
        } catch (err) {
            console.error(`[${MODULE_ID}] 数据库初始化失败：`, err);
        }
    }

    const mod = game.modules.get(MODULE_ID);
    if (mod) mod.api = NpcRepApi;

    globalThis.NPC_System_OpenPanel = (npcId, opts) =>
        NpcRepApi.openDMPanel(npcId, opts ?? {});

    initChatListener();

    if (game.user.isGM) {
        const style = document.createElement("style");
        style.textContent = `.dm-only-btn { display: block !important; }`;
        document.head.appendChild(style);
    }

    _checkDependencies();
    console.log(`[${MODULE_ID}] ✅ ready 完成`);
});

// ══════════════════════════════════════════════════════════════
// 单例开关工具
// ══════════════════════════════════════════════════════════════

function _toggleWindow(key, factory) {
    const existing = _openWindows[key];
    if (existing && existing._state > 0) {
        existing.close();
        _openWindows[key] = null;
        return;
    }
    const inst = factory();
    _openWindows[key] = inst;
    const origClose = inst.close.bind(inst);
    inst.close = async (...args) => {
        _openWindows[key] = null;
        return origClose(...args);
    };
    inst.render(true);
}

async function _toggleAdminPanel() {
    const existing = Object.values(ui.windows).find(
        w => w.title === "NPC & 派系管理中枢"
    );
    if (existing) { existing.close(); return; }
    const { openAdminPanel } = await import("./ui/ui-faction-manager.js");
    openAdminPanel();
}

async function _toggleDMPanel() {
    const { getRepData, getAllNPCs } = await import("./data-manager.js");
    const repData = getRepData();
    const allNpcs = getAllNPCs(repData);

    const controlled = canvas.tokens?.controlled ?? [];
    if (controlled.length > 0) {
        const actorId = controlled[0].actor?.id;
        const match   = allNpcs.find(n => n.actorId === actorId);
        if (match) {
            const panelTitle = `管理面板: ${match.name}`;
            const existing   = Object.values(ui.windows).find(
                w => w.title === panelTitle
            );
            if (existing) { existing.close(); return; }
            const { openDMPanel } = await import("./ui/ui-dm-panel.js");
            return openDMPanel(match.id);
        }
        ui.notifications.warn("选中的 Token 未在 NPC 声望系统中登记。");
        return;
    }

    const listDialog = Object.values(ui.windows).find(
        w => w.title === "选择要管理的 NPC"
    );
    if (listDialog) { listDialog.close(); return; }
    await _openNpcPickDialog(repData, allNpcs);
}

async function _toggleQuestFullscreen() {
    const { openQuestFullscreen } =
        await import("./ui/ui-quest-fullscreen.js");
    openQuestFullscreen();
}

// ── 查看NPC面板：GM→全屏，玩家→窗口互动面板 ─────────────────
async function _playerOpenPanel() {
    const { getRepData, getAllNPCs } = await import("./data-manager.js");
    const repData = getRepData();
    const allNpcs = getAllNPCs(repData);

    // ── GM：打开全屏，锁定到悬停/选中的NPC ───────────────────
    if (game.user.isGM) {
        const { openQuestFullscreen } =
            await import("./ui/ui-quest-fullscreen.js");

        const hovered = canvas.tokens?.hover;
        if (hovered) {
            const match = allNpcs.find(
                n => n.actorId === hovered.actor?.id
            );
            if (match) {
                openQuestFullscreen({ npcId: match.id });
                return;
            }
        }

        const controlled = canvas.tokens?.controlled ?? [];
        if (controlled.length > 0) {
            const match = allNpcs.find(
                n => n.actorId === controlled[0].actor?.id
            );
            if (match) {
                openQuestFullscreen({ npcId: match.id });
                return;
            }
        }

        openQuestFullscreen();
        return;
    }

    // ── 玩家：悬停Token打开互动面板；无Token则打开全屏任务总览 ──
    const hovered = canvas.tokens?.hover;
    if (!hovered) {
        const { openQuestFullscreen } = await import("./ui/ui-quest-fullscreen.js");
        openQuestFullscreen();
        return;
    }

    const match = allNpcs.find(n => n.actorId === hovered.actor?.id);
    if (!match) {
        return ui.notifications.warn(
            "该 Token 未在 NPC 声望系统中登记。"
        );
    }

    const panelTitle = `与 ${match.name} 互动`;
    const existing   = Object.values(ui.windows).find(
        w => w.title === panelTitle
    );
    if (existing) { existing.close(); return; }

    const { openPlayerPanel } = await import("./ui/ui-player-panel.js");
    openPlayerPanel(match.id);
}

async function _openNpcPickDialog(repData, allNpcs) {
    if (allNpcs.length === 0) {
        return ui.notifications.warn("系统中尚未录入任何 NPC。");
    }

    const factions     = repData.factions    ?? {};
    const factionOrder = repData.factionOrder ?? Object.keys(factions);
    let   optsHtml     = "";

    for (const fid of factionOrder) {
        const f = factions[fid];
        if (!f?.members?.length) continue;
        optsHtml += `<optgroup label="⚑ ${f.name}">`;
        for (const n of f.members) {
            optsHtml += `<option value="${n.id}">
                ${n.name}（${n.title || "平民"}）</option>`;
        }
        optsHtml += `</optgroup>`;
    }

    if (repData.independent?.length > 0) {
        optsHtml += `<optgroup label="— 独立 NPC —">`;
        for (const n of repData.independent) {
            optsHtml += `<option value="${n.id}">${n.name}</option>`;
        }
        optsHtml += `</optgroup>`;
    }

    new Dialog({
        title:   "选择要管理的 NPC",
        content: `
        <div style="padding:10px;">
            <p style="color:#aaa;margin-top:0;">
                请选择要打开管理面板的 NPC：
            </p>
            <select id="npc-pick-sel"
                style="width:100%;height:36px;background:#111;
                       color:#fff;border:1px solid #555;padding:0 8px;">
                ${optsHtml}
            </select>
        </div>`,
        buttons: {
            open: {
                label:    "打开管理面板",
                icon:     '<i class="fas fa-cogs"></i>',
                callback: async (html) => {
                    const npcId = html.find("#npc-pick-sel").val();
                    if (!npcId) return;
                    const { openDMPanel } =
                        await import("./ui/ui-dm-panel.js");
                    openDMPanel(npcId);
                }
            },
            cancel: { label: "取消" }
        },
        default: "open"
    }, { width: 360 }).render(true);
}


// ══════════════════════════════════════════════════════════════
// 启动器类
// ══════════════════════════════════════════════════════════════

class FactionManagerLauncher extends FormApplication {
    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            title: ""
        });
    }
    async render(_force) { _toggleAdminPanel(); }
    async _updateObject() {}
}

class NpcDetailLauncher extends FormApplication {
    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            title: ""
        });
    }
    async render(_force) { _toggleDMPanel(); }
    async _updateObject() {}
}

// ══════════════════════════════════════════════════════════════
// 工具函数
// ══════════════════════════════════════════════════════════════

function _checkDependencies() {
    const deps = [{ id: "calendaria", name: "Calendaria" }];
    for (const dep of deps) {
        if (!game.modules.get(dep.id)?.active) {
            ui.notifications.warn(
                `[NPC声望系统] 依赖模组 "${dep.name}" 未启用，`
                + `部分功能可能异常。`,
                { permanent: true }
            );
        }
    }
}