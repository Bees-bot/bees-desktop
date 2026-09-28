// The existing controls use the same form interface in either scope. Runtime
// controllers retain the real personal forms; editing defaults never starts AI.
export class ProductSettings {
  constructor(request, onError) {
    this.request = request;
    this.onError = onError;
    this.listeners = new Set();
    this.state = { isPlatformAdmin: false, editing: false, busy: false, scopeVersion: 0 };
    this.generation = 0;
    this.saves = Promise.resolve();
  }
  subscribe = (listener) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  emit() { for (const listener of this.listeners) listener(); }
  reset() {
    this.generation++;
    this.state = { isPlatformAdmin: false, editing: false, busy: false, scopeVersion: this.generation };
    this.emit();
  }
  async check() {
    const generation = this.generation;
    try {
      const status = await this.request("/bees-api/product-defaults");
      if (generation !== this.generation) return;
      this.state = { ...status, editing: false, busy: false, scopeVersion: this.generation };
    } catch {
      if (generation !== this.generation) return;
      this.state = { isPlatformAdmin: false, editing: false, busy: false, scopeVersion: this.generation };
    }
    this.emit();
  }
  async toggle(enabled) {
    const generation = this.generation;
    this.state = { ...this.state, busy: true }; this.emit();
    await this.saves.catch(() => {});
    if (generation !== this.generation) return;
    if (enabled) await this.check();
    if (generation !== this.generation) return;
    this.generation++;
    this.state = { ...this.state, editing: enabled && this.state.isPlatformAdmin && this.state.editable, busy: false, scopeVersion: this.generation };
    this.emit();
  }
  save(namespace, key, value, generation = this.generation) {
    const save = this.saves.then(async () => {
      if (generation !== this.generation || !this.state.editing) throw new Error("Product-default editing is no longer active");
      const result = await this.request("/bees-api/product-defaults", { method: "PUT", body: JSON.stringify({
        accountUserId: this.state.accountUserId, namespace, key, value, revision: this.state.revision
      }) });
      if (generation === this.generation) { this.state = { ...this.state, ...result }; this.emit(); }
      return true;
    });
    // Attach an error handler even for fire-and-forget layout/appearance controls.
    this.saves = save.catch((error) => {
      if ([401, 403].includes(error.status)) this.reset();
      this.onError(error.message || String(error));
    });
    return save;
  }
  scope(namespace, personal) {
    const owner = this;
    const generation = owner.generation;
    const editing = owner.state.editing;
    return {
      productDefaults: editing,
      getSnapshot() {
        const snapshot = personal.getSnapshot();
        if (!editing || !owner.state.values) return snapshot;
        const defaults = owner.state.values[namespace];
        return { ...snapshot, status: "ready", value: namespace === "bees"
          ? { ...snapshot.value, ...defaults, localModelWantedIds: [] }
          : defaults };
      },
      subscribe(listener) {
        const unsubscribe = personal.subscribe(listener);
        const unsubscribeDefaults = owner.subscribe(listener);
        return () => { unsubscribe(); unsubscribeDefaults(); };
      },
      set(key, value) {
        // An OAuth dialog or delayed drag callback must never change its target
        // because the user switched modes while it was pending.
        if (generation !== owner.generation && (editing || owner.state.editing)) {
          const error = new Error("The settings scope changed. Repeat the action in the current mode");
          owner.onError(error.message);
          const rejected = Promise.reject(error); rejected.catch(() => {}); return rejected;
        }
        if (editing && Object.hasOwn(owner.state.values[namespace] ?? {}, key)) return owner.save(namespace, key, value);
        if (editing && namespace !== "bees") return Promise.reject(new Error("This setting belongs to this device"));
        return personal.set(key, value);
      }
    };
  }
}
