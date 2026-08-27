class ResourceRegistry {
  #items = new Map();

  constructor(kind) {
    this.kind = kind;
  }

  register(resource, { replace = false } = {}) {
    const id = String(resource?.id || "").trim();
    if (!id) throw new Error(`${this.kind} resource requires a stable id.`);
    if (this.#items.has(id) && !replace)
      throw new Error(`${this.kind} resource "${id}" is already registered.`);
    this.#items.set(id, Object.freeze({ ...resource, id }));
    return this.#items.get(id);
  }

  get(id) {
    return this.#items.get(String(id)) || null;
  }

  list() {
    return [...this.#items.values()];
  }

  clear() {
    this.#items.clear();
  }
}

module.exports = { ResourceRegistry };
