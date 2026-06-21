/**
 * api.js
 * 所有面板调用走动态 import，彻底切断循环依赖链
 */

export const NpcRepApi = {

    async openDMPanel(npcId, options = {}) {
        const { openDMPanel } = await import("./ui/ui-dm-panel.js");
        return openDMPanel(npcId, options);
    },

    async openAdminPanel() {
        const { openAdminPanel } = await import("./ui/ui-faction-manager.js");
        return openAdminPanel();
    },

    async openPlayerPanel(npcId) {
        const { openPlayerPanel } = await import("./ui/ui-player-panel.js");
        return openPlayerPanel(npcId);
    }
};