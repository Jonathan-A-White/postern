// src/version.ts — the build stamp ('<version> · <UTC time>Z · <commit>') as one small module of its own
// (mw-7dige5.3). Its value is not compiled into any chunk: the page carries it (vite.config.ts writes it
// into index.html as window.__APP_VERSION__ before the main chunk loads; vitest.config.ts defines it for
// tests), so a build with the same code gives the same main chunk, and an update downloads only the code
// that changed. Everything that shows the version reads it from here.
export const APP_VERSION_STRING: string = __APP_VERSION__;
