/**
 * chat-listener.js
 * 只保留 DM 面板相关的聊天按钮监听，移除所有雷达/拦截逻辑。
 */

import { NpcRepApi } from "./api.js";

const MODULE_ID = "npc-reputation-system";

export function initChatListener() {

    if (game.user.isGM) {
        const style = document.createElement("style");
        style.textContent = `.dm-only-btn { display: block !important; }`;
        document.head.appendChild(style);
    }

    // DM 点击"一键批准接取"
    $(document).on("click", ".npc-quick-accept-btn", function (e) {
        e.preventDefault();
        const btn = $(this);
        if (btn.data("clicked")) return;
        btn.data("clicked", true)
           .prop("disabled", true)
           .css({ background: "#555", cursor: "not-allowed", "border-color": "#444" })
           .html('<i class="fas fa-check"></i> 已一键批准');

        NpcRepApi.openDMPanel(btn.data("npcid"), {
            action:    "quick_accept",
            qid:       String(btn.data("qid")),
            reqUserId: btn.data("reqid")
        });
    });

    // DM 点击"一键批准结算"
    $(document).on("click", ".npc-quick-complete-btn", function (e) {
        e.preventDefault();
        const btn = $(this);
        if (btn.data("clicked")) return;
        btn.data("clicked", true)
           .prop("disabled", true)
           .css({ background: "#555", cursor: "not-allowed", "border-color": "#444" })
           .html('<i class="fas fa-check"></i> 面板已拉起');

        NpcRepApi.openDMPanel(btn.data("npcid"), {
            action: "quick_complete",
            qid:    String(btn.data("qid"))
        });
    });

    console.log(`[${MODULE_ID}] 聊天监听器已就绪。`);
}