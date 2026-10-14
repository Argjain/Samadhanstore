// Cache only public layout data. Inventory, prices, identity and checkout stay fresh.
let entry, pending, generation = 0;
exports.clear = () => { generation++; entry = null; pending = null; };
exports.get = async function get(loader) {
  if (entry && Date.now() < entry.expires) return entry.value;
  if (pending) return pending;
  const started = generation;
  const promise = Promise.resolve().then(loader).then(value => {
    if (started === generation) entry = { value, expires: Date.now() + 30000 };
    return value;
  }).finally(() => { if (pending === promise) pending = null; });
  pending = promise;
  return promise;
};
