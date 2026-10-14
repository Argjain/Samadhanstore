module.exports = function formMethod(req) {
  if (req.method !== 'POST') return undefined;
  const value = req.body?._method || req.query?._method;
  return typeof value === 'string' && ['PUT', 'PATCH', 'DELETE'].includes(value.toUpperCase())
    ? value.toUpperCase() : undefined;
};
