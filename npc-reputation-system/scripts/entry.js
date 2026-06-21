/**
 * entry.js
 */

const MODULE_ID = "npc-reputation-system";

const _openWindows = {
    playerPresets:   null,
    questFullscreen: null
};

Hooks.once("init", () => {

    game.settings.registerMenu(MODULE_ID, "menuFactionManager", {
        name:       "派系 & NPC 管理",
        label:      "🏛 打开派系管理",
        hint:       "管理派系结构、NPC录入、区域绑定。",
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

    game.settings.registerMenu(MODULE_ID, "menuPlayerPresets", {
        name:       "玩家互动预设分组",
        label:      "👥 管理玩家预设",
        hint:       "配置 DM 拦截面板中的玩家快速选择预设分组。",
        icon:       "fas fa-users",
        type:       PlayerPresetsForm,
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

    game.keybindings.register(MODULE_ID, "openPlayerPresets", {
        name:       "[GM] 打开玩家互动预设分组",
        hint:       "打开玩家预设分组管理面板；已打开则关闭。",
        editable:   [],
        restricted: true,
        onDown:     () => _toggleWindow("playerPresets", () => new PlayerPresetsForm())
    });

    game.keybindings.register(MODULE_ID, "openPlayerPanel", {
        name:       "查看 NPC 面板",
        hint:       "GM：悬停/选中Token打开全屏锁定到该NPC；无Token则打开全部。玩家：悬停NPC Token打开互动面板。",
        editable:   [],
        restricted: false,
        onDown:     () => _playerOpenPanel()
    });

    game.keybindings.register(MODULE_ID, "openQuestFullscreen", {
        name:       "打开全屏任务管理页面",
        hint:       "打开独立的全屏任务管理中心；已打开则关闭。",
        editable:   [],
        restricted: false,
        onDown:     () => _toggleQuestFullscreen()
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

    // ── 玩家：悬停Token打开窗口化互动面板 ────────────────────
    const hovered = canvas.tokens?.hover;
    if (!hovered) {
        return ui.notifications.warn(
            "请将鼠标移到 NPC Token 上再按快捷键。"
        );
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
// 玩家互动预设分组弹窗
// ══════════════════════════════════════════════════════════════

class PlayerPresetsForm extends FormApplication {

    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            id:             "npc-player-presets",
            title:          "玩家互动预设分组 - NPC声望系统",
            width:          420,
            height:         "auto",
            resizable:      true,
            closeOnSubmit:  false,
            submitOnChange: false,
            submitOnClose:  false
        });
    }

    async _renderInner(_data) {
        const { getRepData } = await import("./data-manager.js");
        this._repData = getRepData();
        this._presets = this._repData?.settings?.presets ?? [];
        return $(this._buildHTML());
    }

    _buildHTML() {
        const users = game.users.filter(u => !u.isGM && u.character);

        const listHtml = this._presets.length === 0
            ? `<div style="text-align:center;color:#777;padding:20px;">
                   暂无预设分组</div>`
            : this._presets.map((p, idx) => `
                <div class="pp-row" data-idx="${idx}"
                    style="background:#1a252f;padding:10px;
                           margin-bottom:8px;border-radius:4px;
                           border:1px solid #2c3e50;">
                    <div style="display:flex;justify-content:space-between;
                        align-items:center;margin-bottom:8px;">
                        <input type="text" class="pp-name"
                            data-idx="${idx}" value="${p.name}"
                            style="flex:1;background:#111;color:#fff;
                                   border:1px solid #555;padding:4px 8px;
                                   border-radius:3px;font-weight:bold;
                                   margin-right:8px;height:30px;">
                        <button type="button" class="pp-del"
                            data-idx="${idx}"
                            style="background:#c0392b;border:none;
                                   color:#fff;width:30px;height:30px;
                                   border-radius:3px;cursor:pointer;
                                   flex:none;">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                    <div style="display:flex;flex-wrap:wrap;gap:6px;">
                        ${users.map(u => `
                            <label style="display:flex;align-items:center;
                                gap:5px;background:#2c3e50;padding:4px 8px;
                                border-radius:3px;cursor:pointer;
                                color:#ecf0f1;font-size:0.9em;">
                                <input type="checkbox" class="pp-user-cb"
                                    data-idx="${idx}" value="${u.id}"
                                    style="cursor:pointer;"
                                    ${p.users.includes(u.id)
                                        ? "checked" : ""}>
                                ${u.name}
                                <span style="color:#7f8c8d;font-size:0.85em;">
                                    (${u.character.name})
                                </span>
                            </label>`
                        ).join("")}
                    </div>
                </div>`
            ).join("");

        return `
        <form onsubmit="return false;"
            style="padding:15px;background:#1a1a1a;
                   color:#eee;font-family:'Signika',sans-serif;">
            <p style="color:#aaa;font-size:0.9em;margin-top:0;
                margin-bottom:12px;background:#252525;padding:8px;
                border-radius:4px;border:1px solid #333;">
                <i class="fas fa-info-circle" style="color:#3498db;"></i>
                这些预设用于 DM 拦截审批面板中，快速勾选特定玩家组合。
            </p>
            <div id="pp-list"
                style="max-height:400px;overflow-y:auto;padding-right:4px;">
                ${listHtml}
            </div>
            <button type="button" id="pp-add"
                style="width:100%;margin-top:12px;padding:8px;
                       background:#2980b9;border:1px solid #3498db;
                       color:#fff;border-radius:4px;cursor:pointer;
                       font-weight:bold;font-size:1em;">
                <i class="fas fa-plus"></i> 新建预设分组
            </button>
            <button type="button" id="pp-save"
                style="width:100%;margin-top:8px;padding:10px;
                       background:#27ae60;border:1px solid #2ecc71;
                       color:#fff;border-radius:4px;cursor:pointer;
                       font-weight:bold;font-size:1em;">
                <i class="fas fa-save"></i> 保存预设
            </button>
        </form>`;
    }

    activateListeners(html) {
        super.activateListeners(html);
        html.find("form").on("submit", e => e.preventDefault());

        html.find(".pp-name").on("change", (e) => {
            const idx = Number($(e.currentTarget).data("idx"));
            this._presets[idx].name = $(e.currentTarget).val();
        });

        html.find(".pp-user-cb").on("change", (e) => {
            const idx = Number($(e.currentTarget).data("idx"));
            const uid = $(e.currentTarget).val();
            if ($(e.currentTarget).is(":checked")) {
                if (!this._presets[idx].users.includes(uid))
                    this._presets[idx].users.push(uid);
            } else {
                this._presets[idx].users =
                    this._presets[idx].users.filter(x => x !== uid);
            }
        });

        html.find(".pp-del").on("click", async (e) => {
            const idx = Number($(e.currentTarget).data("idx"));
            this._presets.splice(idx, 1);
            await this._savePresets();
            this.render(true);
        });

        html.find("#pp-add").on("click", async () => {
            this._presets.push({
                id: foundry.utils.randomID(), name: "新预设", users: []
            });
            await this._savePresets();
            this.render(true);
        });

        html.find("#pp-save").on("click", async () => {
            await this._savePresets();
            ui.notifications.success("[NPC声望系统] 玩家预设分组已保存。");
            this.close();
        });
    }

    async _updateObject() {}

    async _savePresets() {
        const { saveRepData } = await import("./data-manager.js");
        this._repData.settings        ??= {};
        this._repData.settings.presets  = this._presets;
        await saveRepData(this._repData);
    }
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