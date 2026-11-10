// Remove obsolete custom-header rules. Never log request bodies or credentials.
async function removeLegacyRules() {
    try {
        await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [1, 2] });
    } catch (error) {
        console.error('[还我推流权] 清理旧规则失败:', error.message);
    }
}
chrome.runtime.onInstalled.addListener(removeLegacyRules);
chrome.runtime.onStartup.addListener(removeLegacyRules);
removeLegacyRules();
