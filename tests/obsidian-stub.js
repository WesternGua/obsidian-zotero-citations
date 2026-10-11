exports.Platform = { isMacOS: true, isWin: false, isLinux: false };
exports.requestUrl = async () => ({ status: 500, text: "", json: null });
exports.Notice = class Notice { constructor() {} hide() {} };

exports.Component = class Component { load() {} unload() {} };
exports.MarkdownRenderer = { render: async (app, markdown, element) => { if (!globalThis.__zoteroTestRender) throw new Error("Isolated Markdown renderer was not configured"); element.innerHTML = await globalThis.__zoteroTestRender(markdown); } };

exports.Plugin=class Plugin {};
exports.Modal=class Modal { constructor(app){this.app=app;this.contentEl=globalThis.document?.createElement("div");} close() {} };
exports.PluginSettingTab=class PluginSettingTab {};
exports.Setting=class Setting {};
exports.MarkdownView=class MarkdownView {};
exports.FileSystemAdapter=class FileSystemAdapter {};
