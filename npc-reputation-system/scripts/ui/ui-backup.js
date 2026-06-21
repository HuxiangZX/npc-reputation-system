/**
 * ui-backup.js
 * 备份中心（从宏1拆分）
 * 注意：此处的"备份"是全局数据备份，与宏2中的"NPC个体备份"不同
 */

import { saveRepData } from "../data-manager.js";

const BK_FLAG = "backups";

/**
 * 打开备份中心
 * @param {object}       data    - 当前 repData
 * @param {JournalEntry} journal - 声望数据库Journal
 * @param {Function}     refresh - 刷新管理面板的回调
 */
export function openBackupCenter(data, journal, refresh) {
    const _render = async () => {
        const bks     = journal.getFlag("world", BK_FLAG) || [];
        const bkHtml  = bks.length === 0
            ? '<p style="text-align:center; color:#777;">暂无备份数据</p>'
            : bks.map((b, i) => {
                const lkStyle = b.locked
                    ? "background:#d35400; color:#fff;"
                    : "background:#7f8c8d; color:#fff;";
                return `
                <div class="bk-item"
                    style="display:flex; justify-content:space-between; align-items:center;
                           margin-bottom:8px; background:#222; padding:10px;
                           border:1px solid #444; border-radius:4px;">
                    <span class="bk-name" data-idx="${i}"
                        style="cursor:pointer; color:#ecf0f1; font-weight:bold; font-size:1.1em;">
                        <i class="fas fa-save" style="color:#3498db;"></i> ${b.name}
                    </span>
                    <div style="display:flex; gap:6px;">
                        <button class="n-btn r-bk" data-idx="${i}"
                            title="恢复此备份"
                            style="background:#27ae60; padding:4px 8px; color:#fff; border:none;">
                            <i class="fas fa-undo"></i>
                        </button>
                        <button class="n-btn l-bk" data-idx="${i}"
                            title="${b.locked ? "点击解锁" : "点击锁定"}"
                            style="${lkStyle} padding:4px 8px; border:none;">
                            ${b.locked ? "🔒" : "🔓"}
                        </button>
                        <button class="n-btn d-bk" data-idx="${i}"
                            title="删除备份"
                            style="background:#c0392b; padding:4px 8px; color:#fff; border:none;"
                            ${b.locked ? "disabled" : ""}>
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>`;
            }).join("");

        const bkDialog = new Dialog({
            title:   "全局数据备份中心",
            content: `<div style="padding:10px">
                <button id="do-bk" class="n-btn"
                    style="width:100%; margin-bottom:12px; background:#2980b9;
                           font-weight:bold; padding:8px; color:#fff; border:none;">
                    <i class="fas fa-cloud-upload-alt"></i> 立即创建当前备份
                </button>
                <div id="bk-l" style="max-height:400px; overflow-y:auto;">
                    ${bkHtml}
                </div>
            </div>`,
            buttons: { close: { label: "关闭窗口" } },
            render:  (h) => _bindBackupEvents(h, bks, journal, data, refresh, bkDialog)
        }, { width: 420, resizable: true });

        bkDialog.render(true);
    };

    _render();
}

function _bindBackupEvents(h, bks, journal, data, refresh, bkDialog) {
    const reloadSelf = () => {
        bkDialog.close();
        openBackupCenter(data, journal, refresh);
    };

    // 创建备份
    h.find("#do-bk").click(async () => {
        bks.push({
            name:   new Date().toLocaleString(),
            data:   foundry.utils.duplicate(data),
            locked: false
        });
        await journal.setFlag("world", BK_FLAG, bks);
        reloadSelf();
    });

    // 锁定/解锁
    h.find(".l-bk").click(async e => {
        const idx       = $(e.currentTarget).data("idx");
        bks[idx].locked = !bks[idx].locked;
        await journal.setFlag("world", BK_FLAG, bks);
        reloadSelf();
    });

    // 删除
    h.find(".d-bk").click(async e => {
        bks.splice($(e.currentTarget).data("idx"), 1);
        await journal.setFlag("world", BK_FLAG, bks);
        reloadSelf();
    });

    // 预览备份内容
    h.find(".bk-name").click(e => {
        const bData = bks[$(e.currentTarget).data("idx")].data;
        const factionCount = Object.keys(bData.factions || {})
            .filter(id => !id.startsWith("-=")).length;
        const npcCount = Object.values(bData.factions || {})
            .reduce((sum, f) => sum + (f?.members?.length || 0), 0)
            + (bData.independent?.length || 0);

        let detail = `
            <li><b>派系总数</b>：<span style="color:#3498db;">${factionCount}</span> 个</li>
            <li><b>NPC总数</b>：<span style="color:#2ecc71;">${npcCount}</span> 名</li>
            <li><b>系统预设</b>：<span style="color:#e67e22;">
                ${(bData.settings?.presets || []).length}</span> 组</li>
            <li><b>雷达引擎</b>：
                模式 ${bData.settings?.triggerMode || 3} |
                探测 ${bData.settings?.proximityDistance || 1.5}格 |
                冷却 ${bData.settings?.radarCooldown || 20}s
            </li>`;

        new Dialog({
            title:   "备份内容概览",
            content: `<ul style="line-height:1.8; font-size:1.1em; color:#eee;
                          background:#111; padding:15px 15px 15px 30px;
                          border-radius:4px; border:1px solid #333; margin:0;">
                ${detail}
            </ul>`,
            buttons: { ok: { label: "知道了" } }
        }, { resizable: true }).render(true);
    });

    // 还原备份
    h.find(".r-bk").click(async e => {
        const bkData = bks[$(e.currentTarget).data("idx")].data;
        await saveRepData(bkData);
        ui.notifications.success("数据恢复成功！");
        bkDialog.close();
        refresh();
    });
}