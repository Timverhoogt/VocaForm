import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const storeVersion = 1;

function emptyStore() {
  return {
    version: storeVersion,
    active_form_id: null,
    forms: {},
    sessions: {}
  };
}

async function readJsonIfExists(filePath) {
  if (!existsSync(filePath)) return null;
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function writeJsonAtomic(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tempPath, filePath);
}

function normalizeStore(value) {
  const store = value && typeof value === "object" ? value : emptyStore();
  return {
    version: storeVersion,
    active_form_id: store.active_form_id || null,
    forms: store.forms && typeof store.forms === "object" ? store.forms : {},
    sessions: store.sessions && typeof store.sessions === "object" ? store.sessions : {}
  };
}

export function createFormStore({ workDir }) {
  const dbPath = path.join(workDir, "vocaform_store.json");
  let loaded = false;
  let data = emptyStore();
  let writeQueue = Promise.resolve();

  async function load() {
    if (loaded) return data;
    data = normalizeStore(await readJsonIfExists(dbPath));
    loaded = true;
    return data;
  }

  async function persist() {
    const write = writeQueue.catch(() => {}).then(() => writeJsonAtomic(dbPath, data));
    writeQueue = write;
    await write;
  }

  return {
    dbPath,

    async getActiveFormConfig() {
      const store = await load();
      if (!store.active_form_id) return null;
      return store.forms[store.active_form_id] || null;
    },

    async setActiveFormConfig(config) {
      const store = await load();
      const formId = config.form_id || "default";
      const now = new Date().toISOString();
      store.forms[formId] = {
        ...(store.forms[formId] || {}),
        ...config,
        form_id: formId,
        updated_at: now
      };
      store.active_form_id = formId;
      await persist();
      return store.forms[formId];
    },

    async listForms() {
      const store = await load();
      return {
        active_form_id: store.active_form_id,
        forms: Object.values(store.forms).sort((left, right) =>
          String(right.updated_at || right.imported_at || "").localeCompare(String(left.updated_at || left.imported_at || ""))
        )
      };
    },

    async getForm(formId) {
      const store = await load();
      return store.forms[formId] || null;
    },

    async setActiveFormId(formId) {
      const store = await load();
      if (!store.forms[formId]) return null;
      store.active_form_id = formId;
      store.forms[formId] = {
        ...store.forms[formId],
        updated_at: new Date().toISOString()
      };
      await persist();
      return store.forms[formId];
    },

    async getSession(formId) {
      const store = await load();
      return store.sessions[formId]?.state || null;
    },

    async saveSession(formId, state) {
      const store = await load();
      store.sessions[formId] = {
        state,
        updated_at: new Date().toISOString()
      };
      await persist();
      return store.sessions[formId];
    }
  };
}
