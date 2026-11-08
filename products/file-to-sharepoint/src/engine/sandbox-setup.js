// These paths are constants relative to the packaged frame, never source data.
window.AscCommon = {RELATIVE_SDKJS_PATH:new URL('../../vendor/office/sdkjs/',location.href).href};
// Native model import never runs document macros/plugins or PDF actions.
window.g_asc_plugins = undefined;
